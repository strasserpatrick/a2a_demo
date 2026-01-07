"""
Terminal Client - A2A Frontend Application

This is a simple terminal-based frontend that communicates with
Agent A (Manager) via the A2A protocol, demonstrating frontend/backend separation.

Usage:
    python terminal_client.py

Make sure Agent A is running in server mode first:
    python agent_a_manager.py --server
"""

import asyncio
import json

import httpx
from a2a.client import ClientFactory
from a2a.client.client import ClientConfig
from a2a.types import Message, Role, TextPart
from uuid import uuid4

# Agent A Manager URL
AGENT_A_URL = "http://localhost:8002"

# HTTP client with longer timeout for LLM responses
HTTP_TIMEOUT = httpx.Timeout(timeout=120.0)  # 2 minutes

# Session ID for conversation continuity
SESSION_ID = uuid4().hex


def format_message_with_history(
    question: str, conversation_history: list[dict]
) -> str:
    """Format the current question with conversation history as JSON context."""
    payload = {
        "current_question": question,
        "conversation_history": conversation_history,
    }
    return json.dumps(payload)


def extract_assistant_response(response_text: str) -> str:
    """Extract just the assistant response, stripping the formatted header."""
    # The response contains a formatted box, extract the actual content
    lines = response_text.strip().split("\n")
    # Find content after the box header
    content_lines = []
    in_content = False
    for line in lines:
        if line.startswith("╚"):
            in_content = True
            continue
        if in_content and not line.startswith("───"):
            content_lines.append(line)
    return "\n".join(content_lines).strip() if content_lines else response_text


async def send_question(question: str, conversation_history: list[dict]) -> str:
    """Send a question to Agent A via A2A and return the response."""
    httpx_client = httpx.AsyncClient(timeout=HTTP_TIMEOUT)
    config = ClientConfig(httpx_client=httpx_client)

    try:
        a2a_client = await ClientFactory.connect(AGENT_A_URL, client_config=config)
    except Exception as e:
        return f"Error connecting to Agent A: {e}\nMake sure agent_a_manager.py is running with --server flag."

    # Include conversation history in the message
    message_text = format_message_with_history(question, conversation_history)

    message = Message(
        message_id=uuid4().hex,
        context_id=SESSION_ID,  # Use consistent session ID for conversation
        role=Role.user,
        parts=[TextPart(type="text", text=message_text)],
    )

    response_text = "No response received."
    try:
        async for event in a2a_client.send_message(message):
            if isinstance(event, tuple):
                task, update = event
                if task.artifacts:
                    artifact = task.artifacts[0]
                    if artifact.parts:
                        part = artifact.parts[0].root
                        if hasattr(part, "text"):
                            response_text = part.text
    except Exception as e:
        response_text = f"Error during communication: {e}"
    finally:
        await a2a_client.close()

    return response_text


async def main():
    print("=" * 70)
    print("  TERMINAL CLIENT - A2A Frontend")
    print("  Communicates with Agent A (Manager) via A2A protocol")
    print("-" * 70)
    print("  This demonstrates frontend/backend separation:")
    print("  - This client = Frontend (user interface)")
    print("  - Agent A     = Backend (routes to expert agents)")
    print("-" * 70)
    print("  Conversation history is maintained across messages.")
    print("  Type 'clear' to start a new conversation.")
    print("  Type 'quit' or 'exit' to stop.")
    print("=" * 70)

    # Conversation history maintained by the client
    conversation_history: list[dict] = []

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

        if question.lower() == "clear":
            conversation_history.clear()
            print("[Conversation history cleared]")
            continue

        print("\n[Sending to Agent A via A2A...]")
        response = await send_question(question, conversation_history)
        print(response)

        # Add this exchange to conversation history
        assistant_content = extract_assistant_response(response)
        conversation_history.append({"role": "user", "content": question})
        conversation_history.append({"role": "assistant", "content": assistant_content})


if __name__ == "__main__":
    asyncio.run(main())
