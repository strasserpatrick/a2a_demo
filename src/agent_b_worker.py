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

SYSTEM_PROMPT = """You are a world-class expert in human relations, communication, and interpersonal dynamics.

Your areas of expertise include:
- Workplace communication and professional relationships
- Conflict resolution and mediation
- Leadership and management skills
- Team dynamics and collaboration
- Emotional intelligence and empathy
- Career development and mentoring
- Interview preparation and negotiation
- Public speaking and presentation skills
- Written communication (emails, reports, proposals)
- Cross-cultural communication
- HR policies and workplace ethics

When answering questions:
- Provide empathetic, practical advice
- Consider different perspectives and viewpoints
- Suggest actionable steps and strategies
- Be mindful of emotional and social nuances
- Draw from best practices in organizational psychology

You are passionate about helping people communicate effectively, build strong relationships, and thrive in their professional lives."""


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


async def answer_hr_question(state: WorkerState):
    """Use LLM to answer HR/communication questions."""
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
worker_builder.add_node("process", answer_hr_question)
worker_builder.set_entry_point("process")
worker_builder.add_edge("process", END)
worker_graph = worker_builder.compile()


# --- 3. The A2A Adapter ---
class HRWorkerExecutor(AgentExecutor):
    async def execute(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        raw_input = context.get_user_input() or "No input provided"

        # Parse input to extract question and conversation history
        question, conversation_history = parse_input_message(raw_input)

        print(f"[Agent B - HR Expert] Received: {question}")
        print(f"[Agent B - HR Expert] Conversation history: {len(conversation_history)} turns")

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
        print(f"[Agent B - HR Expert] Cancelling: {context.task_id}")
        status_event = TaskStatusUpdateEvent(
            task_id=context.task_id,
            context_id=context.context_id,
            status=TaskStatus(state=TaskState.canceled),
            final=True,
        )
        await event_queue.enqueue_event(status_event)


# --- 4. Start Agent B on Port 8000 ---
def start_agent_b():
    card = AgentCard(
        name="HR & Communication Expert Agent",
        description="Expert in human relations, communication, and interpersonal skills.",
        version="1.0.0",
        url="http://localhost:8000",
        default_input_modes=["text/plain"],
        default_output_modes=["text/plain"],
        skills=[
            AgentSkill(
                id="hr-expert",
                name="HR & Communication Expert",
                description="Answers questions about communication, relationships, and HR",
                tags=["hr", "communication", "leadership", "relationships"],
            )
        ],
        capabilities=AgentCapabilities(),
    )

    handler = DefaultRequestHandler(
        agent_executor=HRWorkerExecutor(),
        task_store=InMemoryTaskStore(),
    )

    app = A2AStarletteApplication(
        agent_card=card,
        http_handler=handler,
    )

    print("[Agent B - HR Expert] Starting on port 8000...")
    uvicorn.run(app.build(), host="0.0.0.0", port=8000)


if __name__ == "__main__":
    start_agent_b()
