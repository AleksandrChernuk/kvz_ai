# agent/ — orchestrator / worker

The execution layer. Pulls tasks from the Supabase queue and runs them. The full
protocol is in **`CLAUDE.md`** (read it first); this is the short orientation.

## Scripts

```
scripts/poll.sh             queue loop: claim → token gate → enrich (role-scoped
                            agents+KBs) → handler → deterministic filter →
                            approval gate → complete/fail. Watchdog every 10 iters.
scripts/handle_task.sh      LLM handler with RAG grounding (kb-docs libraries) →
                            Anthropic; agent_used:"kb" + sources, else "codex".
scripts/check_token_limit.py deterministic 5000-token gate (--trim drops oldest)
scripts/validate_result.py  deterministic result filter (math/format, no AI)
.mcp.json                   MCP connectors; keys = knowledge_bases.mcp_server
```

## Invariants

- **Never write `tasks` status directly** — only via the worker API endpoints
  (they call atomic, lock-checked RPCs).
- Turn-boundary semantics: claim → process → complete → exit. No sleep-polling
  inside a turn.
- Role comes from `payload.user_role` (set server-side); never trust metadata.
- Worker calls require `Authorization: Bearer <WORKER_TOKEN>`.
- Two deterministic gates are **not** AI and must stay that way: the token gate
  and `validate_result.py`. Same input → same output on any machine.
- Irreversible actions (price to client, .dxf to machine, payment) must pass the
  approval gate; the DB (`complete_task`) is the final backstop, not the bash.

## Config

`agent/.env` (see `.env.example`): `API_URL`, `WORKER_TOKEN`, optional
`MCP_GATEWAY_URL`/`MCP_GATEWAY_TOKEN`, `CLAUDE_MODEL`, `KB_QUERY_JS`.

LLMs run under **subscription**, not API keys: **Claude = brain** (`claude -p`,
`claude login`) routes and answers; **Codex = executor** (`codex exec`, `codex
login`) runs technical/code tasks. Both CLIs must be logged in on the worker host.
Routing is fail-soft: if Codex is unavailable the task falls back to Claude.
