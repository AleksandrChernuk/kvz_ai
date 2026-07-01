# src/types/ — shared type contracts

The TypeScript side of the data model. These must stay in sync with the DB enums
and the worker's JSON shapes — a drift here is a real bug, not a cosmetic one.

## Files

- `database.ts` — `Task`, `Message`, `Thread`, `Profile`, `Run`, `AgentMail`,
  `Connector`, `TaskPayload`, `TaskResult`, `TaskCheckpoint`, and the enums
  `TaskStatus`, `AgentType`, `MessageRole`, `AgentState`, `RunStatus`.
- `roles.ts` — `UserRole`, `ROLE_LABELS`, `ROLE_COLORS`.

## Keep in sync

- `TaskStatus` ⇄ the Postgres `task_status` enum. Adding a value means: the enum
  migration, this type, **and** `src/lib/task-meta.ts` (labels/variants — a
  `Record<TaskStatus, …>` will fail to compile if you miss it).
- `AgentType` ⇄ the `agent_type` enum (`connector` after migration 025) ⇄ the
  orchestrator routing table in `agent/CLAUDE.md`. One contract, change together.
- `TaskResult` is the worker's output shape: `answer`, `agent_used`, `steps`,
  `tokens`, and the optional gates `validation` / `requires_approval` the worker
  reads. If the handler emits a new field, model it here.
- Role is a `UserRole` from `profiles` — never a string from a request body.
