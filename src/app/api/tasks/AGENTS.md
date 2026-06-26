# src/app/api/tasks/ — queue endpoints

The task lifecycle. Most are **worker-only** (`verifyWorker`); approve/reject are
**user** (owner/admin). Every state change goes through an atomic, lock-checked
RPC — never `update tasks` directly here.

## Lifecycle

```
claim      worker  claim_next_task        FOR UPDATE SKIP LOCKED → running, locks to worker
checkpoint worker  save_checkpoint        progress; RAISES if lock lost / not running
complete   worker  complete_task          tx: done + assistant message + thread bump + webhook
fail       worker  fail_task              retry (retry_count++) or terminal failed
request-approval worker request_approval  → awaiting_approval (irreversible-action gate)
watchdog   worker/admin release_stale_locks  free tasks locked > N min
[taskId]/approve user approve_task        owner/admin → re-queue with approved_at
[taskId]/reject  user reject_task         owner/admin → cancelled
[taskId]/stream  user  SSE status         node server only (long-lived); not serverless
route.ts (GET)   user  own tasks (admin: all)   (PATCH) admin cancel / reprioritize
```

## Gotchas

- `complete_task` enforces (in the DB): lock ownership, `status='running'`,
  approval gate (`approval_required ⇒ approved_at`), approval-result binding
  (`result = approved result`), agent access, non-empty answer. The bash worker
  is **not** the security boundary — the function is.
- A task in `awaiting_approval` is **not** `running`, so the watchdog ignores it
  (it waits for a human indefinitely). That's intended.
- The watchdog only works if something **calls it on a schedule** — the
  `kvz-ai-watchdog` systemd timer. Without it, stale tasks never fail.
- approve/reject are security-definer RPCs with internal `auth.uid()` checks, so
  even a direct anon-key RPC call is safe; the route only checks "is logged in".
- Errors from RPCs go through `apiError()` — don't forward raw `error.message`.
