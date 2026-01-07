# A2A Multi-Agent Demo

A demonstration of the [A2A (Agent-to-Agent) protocol](https://github.com/google/a2a) showing frontend/backend separation with multiple specialized agents.

## Architecture

```
┌─────────────────┐     A2A      ┌─────────────────┐     A2A      ┌─────────────────┐
│ Terminal Client │ ──────────▶  │   Agent A       │ ──────────▶  │   Agent B       │
│   (Frontend)    │              │   (Manager)     │              │   (HR Expert)   │
│   port: -       │  ◀─────────  │   port: 8002    │              │   port: 8000    │
└─────────────────┘              └─────────────────┘              └─────────────────┘
                                         │
                                         │ A2A
                                         ▼
                                 ┌─────────────────┐
                                 │   Agent C       │
                                 │  (Tech Expert)  │
                                 │   port: 8001    │
                                 └─────────────────┘
```

- **Terminal Client**: Frontend UI that maintains conversation history
- **Agent A (Manager)**: Routes questions to the appropriate expert based on content
- **Agent B (HR Expert)**: Answers questions about communication, leadership, HR
- **Agent C (Tech Expert)**: Answers questions about programming, software, technology

## Setup

```bash
uv sync
cp .env.example .env  # Configure your API key and URL
```

## Running

Start each agent in a separate terminal:

```bash
make start_agent_b  # HR Expert (port 8000)
make start_agent_c  # Tech Expert (port 8001)
make start_agent_a  # Manager (port 8002)
make start_client   # Terminal client
```

## Usage

Type questions in the terminal client. The manager automatically routes to the appropriate expert:

- Tech questions → Agent C (e.g., "How do I implement a REST API?")
- HR questions → Agent B (e.g., "How do I give feedback to my team?")

Type `clear` to reset conversation history, `quit` to exit.
