.PHONY: start_agent_a start_agent_b start_agent_c start_agent_d start_client

start_agent_a:
	uv run python ./src/agent_a_manager.py --server

start_agent_b:
	uv run python ./src/agent_b_worker.py

start_agent_c:
	uv run python ./src/agent_c_worker.py

start_agent_d:
	uv run python ./src/agent_d_worker.py

start_client:
	uv run python ./src/terminal_client.py
