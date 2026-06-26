# codex-agent/ — Codex subagent

A code-focused executor the orchestrator dispatches to for code generation,
debugging, scripting, or technical explanation. The persona and protocol are in
**`CLAUDE.md`** (read it first).

## Contract

- Input: `TaskPayload` from the orchestrator (`user_message`, `user_role`,
  `thread_context`, optional `checkpoint` on recovery runs).
- Output: a `TaskResult` — the orchestrator (not this subagent) writes it back
  via `/api/tasks/complete`. Never touch the queue or DB directly.
- Respect `user_role`: `viewer` gets read-only/advisory answers, no mutating
  instructions.
- This is a **single-level** executor — it does not spawn its own sub-subagents;
  orchestration stays one level deep (orchestrator → subagent).
