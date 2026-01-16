import asyncio
import json
import os
from typing import Literal, TypedDict
from uuid import uuid4

import httpx
import uvicorn
from a2a.client import ClientFactory
from a2a.client.client import ClientConfig
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.apps import A2AStarletteApplication
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
    Artifact,
    Message,
    Role,
    TaskArtifactUpdateEvent,
    TaskState,
    TaskStatus,
    TaskStatusUpdateEvent,
    TextPart,
)
from dotenv import load_dotenv
from langgraph.graph import END, StateGraph
from openai import AsyncOpenAI

load_dotenv()

# --- 1. LLM Client Setup ---
client = AsyncOpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_BASE_URL"),
)
MODEL_NAME = os.getenv("MODEL_NAME", "gpt-4")

ROUTER_SYSTEM_PROMPT = """You are a routing assistant. Your job is to analyze questions and determine which expert should answer them.

You have three experts available:
1. TECH - Expert in technology, programming, software development, code, databases, cloud, DevOps, AI/ML
2. HR - Expert in human relations, communication, leadership, team dynamics, conflict resolution, career advice, interpersonal skills
3. DESIGN - Expert in UI/UX design, user experience, design systems, accessibility, user research, interaction design

Analyze the user's question and respond with ONLY one word: either "TECH", "HR", or "DESIGN"

Examples:
- "How do I implement a REST API?" -> TECH
- "How do I give constructive feedback to my team?" -> HR
- "What's the best database for my startup?" -> TECH
- "How do I negotiate a salary raise?" -> HR
- "How do I design an accessible button component?" -> DESIGN
- "What are UX best practices for mobile apps?" -> DESIGN
- "How is AI changing coding interviews?" -> TECH (because it's primarily about coding/tech)
- "How do I improve team communication?" -> HR
- "How do I create an effective design system?" -> DESIGN"""

# Worker agent URLs
AGENT_B_URL = "http://localhost:8000"  # HR Expert
AGENT_C_URL = "http://localhost:8001"  # Tech Expert
AGENT_D_URL = "http://localhost:8003"  # Design Expert

# HTTP client with longer timeout for LLM responses
HTTP_TIMEOUT = httpx.Timeout(timeout=120.0)  # 2 minutes


# --- 2. The Manager's State ---
class ManagerState(TypedDict):
    question: str
    conversation_history: list[dict]  # Previous conversation turns
    routed_to: Literal["TECH", "HR", "DESIGN"] | None
    worker_response: str
    final_output: str


def parse_input_message(raw_input: str) -> tuple[str, list[dict]]:
    """Parse incoming message which may contain JSON with history, or plain text."""
    try:
        data = json.loads(raw_input)
        if isinstance(data, dict) and "current_question" in data:
            return data["current_question"], data.get("conversation_history", [])
    except (json.JSONDecodeError, TypeError):
        pass
    # Fallback: treat as plain question with no history
    return raw_input, []


def format_question_with_history(question: str, history: list[dict]) -> str:
    """Format a question with conversation history for the worker agents."""
    payload = {
        "current_question": question,
        "conversation_history": history,
    }
    return json.dumps(payload)


# --- 3. The Nodes ---
async def route_question(state: ManagerState):
    """Use LLM to determine which expert should handle the question."""
    question = state["question"]

    print(f"[Agent A - Router] Analyzing question: {question}")

    response = await client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": ROUTER_SYSTEM_PROMPT},
            {"role": "user", "content": question},
        ],
        temperature=0,
        max_tokens=10,
    )

    decision = response.choices[0].message.content.strip().upper()

    # Normalize the decision
    if "TECH" in decision:
        routed_to = "TECH"
    elif "HR" in decision:
        routed_to = "HR"
    elif "DESIGN" in decision:
        routed_to = "DESIGN"
    else:
        # Default to TECH if unclear
        routed_to = "TECH"

    print(f"[Agent A - Router] Routing to: {routed_to}")
    return {"routed_to": routed_to}


async def call_tech_expert(state: ManagerState):
    """Call Agent C (Tech Expert) via A2A protocol."""
    print("[Agent A] Delegating to Agent C (Tech Expert)...")

    httpx_client = httpx.AsyncClient(timeout=HTTP_TIMEOUT)
    config = ClientConfig(httpx_client=httpx_client)
    a2a_client = await ClientFactory.connect(AGENT_C_URL, client_config=config)

    # Pass question with conversation history to the worker
    message_text = format_question_with_history(
        state["question"], state.get("conversation_history", [])
    )

    message = Message(
        message_id=uuid4().hex,
        role=Role.user,
        parts=[TextPart(type="text", text=message_text)],
    )

    worker_text = "No result from Tech Expert."
    async for event in a2a_client.send_message(message):
        if isinstance(event, tuple):
            task, update = event
            if task.artifacts:
                artifact = task.artifacts[0]
                if artifact.parts:
                    part = artifact.parts[0].root
                    if hasattr(part, "text"):
                        worker_text = part.text

    await a2a_client.close()
    return {"worker_response": worker_text}


async def call_hr_expert(state: ManagerState):
    """Call Agent B (HR Expert) via A2A protocol."""
    print("[Agent A] Delegating to Agent B (HR Expert)...")

    httpx_client = httpx.AsyncClient(timeout=HTTP_TIMEOUT)
    config = ClientConfig(httpx_client=httpx_client)
    a2a_client = await ClientFactory.connect(AGENT_B_URL, client_config=config)

    # Pass question with conversation history to the worker
    message_text = format_question_with_history(
        state["question"], state.get("conversation_history", [])
    )

    message = Message(
        message_id=uuid4().hex,
        role=Role.user,
        parts=[TextPart(type="text", text=message_text)],
    )

    worker_text = "No result from HR Expert."
    async for event in a2a_client.send_message(message):
        if isinstance(event, tuple):
            task, update = event
            if task.artifacts:
                artifact = task.artifacts[0]
                if artifact.parts:
                    part = artifact.parts[0].root
                    if hasattr(part, "text"):
                        worker_text = part.text

    await a2a_client.close()
    return {"worker_response": worker_text}


async def call_design_expert(state: ManagerState):
    """Call Agent D (Design Expert) via A2A protocol."""
    print("[Agent A] Delegating to Agent D (Design Expert)...")

    httpx_client = httpx.AsyncClient(timeout=HTTP_TIMEOUT)
    config = ClientConfig(httpx_client=httpx_client)
    a2a_client = await ClientFactory.connect(AGENT_D_URL, client_config=config)

    # Pass question with conversation history to the worker
    message_text = format_question_with_history(
        state["question"], state.get("conversation_history", [])
    )

    message = Message(
        message_id=uuid4().hex,
        role=Role.user,
        parts=[TextPart(type="text", text=message_text)],
    )

    worker_text = "No result from Design Expert."
    async for event in a2a_client.send_message(message):
        if isinstance(event, tuple):
            task, update = event
            if task.artifacts:
                artifact = task.artifacts[0]
                if artifact.parts:
                    part = artifact.parts[0].root
                    if hasattr(part, "text"):
                        worker_text = part.text

    await a2a_client.close()
    return {"worker_response": worker_text}


def finalize_response(state: ManagerState):
    """Format the final response."""
    if state["routed_to"] == "TECH":
        expert = "Tech Expert"
    elif state["routed_to"] == "HR":
        expert = "HR Expert"
    else:
        expert = "Design Expert"
    report = f"""
╔══════════════════════════════════════════════════════════════╗
║  AGENT A - MANAGER RESPONSE                                  ║
╠══════════════════════════════════════════════════════════════╣
║  Question routed to: {expert:<40} ║
╚══════════════════════════════════════════════════════════════╝

{state['worker_response']}

───────────────────────────────────────────────────────────────
"""
    return {"final_output": report}


def route_to_expert(state: ManagerState) -> str:
    """Conditional edge: route to the appropriate expert based on the decision."""
    if state["routed_to"] == "TECH":
        return "call_tech_expert"
    elif state["routed_to"] == "HR":
        return "call_hr_expert"
    else:
        return "call_design_expert"


# --- 4. Build Manager Graph ---
manager_builder = StateGraph(ManagerState)

# Add nodes
manager_builder.add_node("route", route_question)
manager_builder.add_node("call_tech_expert", call_tech_expert)
manager_builder.add_node("call_hr_expert", call_hr_expert)
manager_builder.add_node("call_design_expert", call_design_expert)
manager_builder.add_node("finalize", finalize_response)

# Set entry point
manager_builder.set_entry_point("route")

# Add conditional routing
manager_builder.add_conditional_edges(
    "route",
    route_to_expert,
    {
        "call_tech_expert": "call_tech_expert",
        "call_hr_expert": "call_hr_expert",
        "call_design_expert": "call_design_expert",
    },
)

# All experts lead to finalize
manager_builder.add_edge("call_tech_expert", "finalize")
manager_builder.add_edge("call_hr_expert", "finalize")
manager_builder.add_edge("call_design_expert", "finalize")
manager_builder.add_edge("finalize", END)

manager_graph = manager_builder.compile()


# --- 5. The A2A Server Adapter ---
class ManagerExecutor(AgentExecutor):
    async def execute(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        raw_input = context.get_user_input() or "No input provided"

        # Parse input to extract question and conversation history
        question, conversation_history = parse_input_message(raw_input)

        print(f"[Agent A - Manager] Received via A2A: {question}")
        print(f"[Agent A - Manager] Conversation history: {len(conversation_history)} turns")

        # Run LangGraph manager with conversation history
        result = await manager_graph.ainvoke({
            "question": question,
            "conversation_history": conversation_history,
        })

        # Send artifact event with the result
        artifact_event = TaskArtifactUpdateEvent(
            task_id=context.task_id,
            context_id=context.context_id,
            artifact=Artifact(
                artifact_id=uuid4().hex,
                parts=[TextPart(type="text", text=result["final_output"])],
            ),
            last_chunk=True,
        )
        await event_queue.enqueue_event(artifact_event)

        # Send completion status event
        status_event = TaskStatusUpdateEvent(
            task_id=context.task_id,
            context_id=context.context_id,
            status=TaskStatus(state=TaskState.completed),
            final=True,
        )
        await event_queue.enqueue_event(status_event)

    async def cancel(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        print(f"[Agent A - Manager] Cancelling: {context.task_id}")
        status_event = TaskStatusUpdateEvent(
            task_id=context.task_id,
            context_id=context.context_id,
            status=TaskStatus(state=TaskState.canceled),
            final=True,
        )
        await event_queue.enqueue_event(status_event)


# --- 6. Start Agent A as A2A Server on Port 8002 ---
def start_server():
    card = AgentCard(
        name="Manager Agent - Multi-Expert Router",
        description="Routes questions to appropriate experts (Tech, HR, or Design) and returns their responses.",
        version="1.0.0",
        url="http://localhost:8002",
        default_input_modes=["text/plain"],
        default_output_modes=["text/plain"],
        skills=[
            AgentSkill(
                id="multi-expert-router",
                name="Multi-Expert Router",
                description="Routes questions to Tech, HR, or Design experts based on content",
                tags=["router", "manager", "tech", "hr", "design"],
            )
        ],
        capabilities=AgentCapabilities(),
    )

    handler = DefaultRequestHandler(
        agent_executor=ManagerExecutor(),
        task_store=InMemoryTaskStore(),
    )

    app = A2AStarletteApplication(
        agent_card=card,
        http_handler=handler,
    )

    print("[Agent A - Manager] Starting A2A server on port 8002...")
    uvicorn.run(app.build(), host="0.0.0.0", port=8002)


# --- 7. Interactive Chat (local mode) ---
async def chat():
    print("=" * 70)
    print("  AGENT A - MULTI-EXPERT ROUTER (Local Mode)")
    print("  Type your question and press Enter.")
    print("  Type 'quit' or 'exit' to stop.")
    print("=" * 70)

    while True:
        try:
            question = input("\nYou: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not question:
            continue

        if question.lower() in ("quit", "exit", "q"):
            print("Goodbye!")
            break

        result = await manager_graph.ainvoke({"question": question})
        print(result["final_output"])


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "--server":
        start_server()
    else:
        asyncio.run(chat())
