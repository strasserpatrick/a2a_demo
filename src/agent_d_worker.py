import json
import os
from typing import TypedDict
from uuid import uuid4

import uvicorn
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

SYSTEM_PROMPT = """You are a world-class expert in design and user experience (UX).

Your areas of expertise include:
- User Interface (UI) design and best practices
- User Experience (UX) research and testing
- Interaction design and user flows
- Information architecture and navigation
- Accessibility (WCAG) and inclusive design
- Design systems and component libraries
- Wireframing and prototyping
- User research methodologies
- Usability principles and heuristics
- Design tools (Figma, Adobe XD, Sketch, etc.)
- Mobile and responsive design
- Web standards and design patterns
- Conversion rate optimization (CRO)
- A/B testing and user analytics

When answering questions:
- Provide practical, user-centric advice
- Reference established design principles and best practices
- Consider accessibility and inclusivity
- Suggest data-driven approaches
- Share real-world examples and case studies
- Balance aesthetics with functionality
- Think about the end user's perspective

You are passionate about creating intuitive, accessible, and beautiful digital experiences that delight users."""


# --- 2. The Worker's Brain (LangGraph) ---
class WorkerState(TypedDict):
    input_text: str
    conversation_history: list[dict]
    output_text: str


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


async def answer_design_question(state: WorkerState):
    """Use LLM to answer design/UX questions."""
    question = state["input_text"]
    history = state.get("conversation_history", [])

    # Build messages list with conversation history
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Add conversation history
    for turn in history:
        messages.append({"role": turn["role"], "content": turn["content"]})

    # Add current question
    messages.append({"role": "user", "content": question})

    response = await client.chat.completions.create(
        model=MODEL_NAME,
        messages=messages,
        temperature=0.7,
        max_tokens=1024,
    )

    answer = response.choices[0].message.content
    return {"output_text": answer}


worker_builder = StateGraph(WorkerState)
worker_builder.add_node("process", answer_design_question)
worker_builder.set_entry_point("process")
worker_builder.add_edge("process", END)
worker_graph = worker_builder.compile()


# --- 3. The A2A Adapter ---
class DesignWorkerExecutor(AgentExecutor):
    async def execute(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        raw_input = context.get_user_input() or "No input provided"

        # Parse input to extract question and conversation history
        question, conversation_history = parse_input_message(raw_input)

        print(f"[Agent D - Design Expert] Received: {question}")
        print(f"[Agent D - Design Expert] Conversation history: {len(conversation_history)} turns")

        # Run LangGraph with conversation history
        response = await worker_graph.ainvoke({
            "input_text": question,
            "conversation_history": conversation_history,
        })

        # Send artifact event with the result
        artifact_event = TaskArtifactUpdateEvent(
            task_id=context.task_id,
            context_id=context.context_id,
            artifact=Artifact(
                artifact_id=uuid4().hex,
                parts=[TextPart(type="text", text=response["output_text"])],
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
        print(f"[Agent D - Design Expert] Cancelling: {context.task_id}")
        status_event = TaskStatusUpdateEvent(
            task_id=context.task_id,
            context_id=context.context_id,
            status=TaskStatus(state=TaskState.canceled),
            final=True,
        )
        await event_queue.enqueue_event(status_event)


# --- 4. Start Agent D on Port 8003 ---
def start_agent_d():
    card = AgentCard(
        name="Design & UX Expert Agent",
        description="Expert in user experience design, UI/UX, and user-centered design practices.",
        version="1.0.0",
        url="http://localhost:8003",
        default_input_modes=["text/plain"],
        default_output_modes=["text/plain"],
        skills=[
            AgentSkill(
                id="design-expert",
                name="Design & UX Expert",
                description="Answers questions about UI/UX design, user research, and design systems",
                tags=["design", "ux", "ui", "accessibility", "user-research"],
            )
        ],
        capabilities=AgentCapabilities(),
    )

    handler = DefaultRequestHandler(
        agent_executor=DesignWorkerExecutor(),
        task_store=InMemoryTaskStore(),
    )

    app = A2AStarletteApplication(
        agent_card=card,
        http_handler=handler,
    )

    print("[Agent D - Design Expert] Starting on port 8003...")
    uvicorn.run(app.build(), host="0.0.0.0", port=8003)


if __name__ == "__main__":
    start_agent_d()
