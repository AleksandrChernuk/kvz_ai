# src/app/api/ — Route Handlers

Two kinds of endpoints with **different auth**. Get this right or you create a hole.

## Auth model

| Caller | How to authenticate | Client |
|---|---|---|
| **User** (browser session) | `supabase.auth.getUser()` → 401 if null; read role from `profiles` | `@/lib/supabase/server` (RLS-bound) |
| **Worker** (orchestrator on VPS) | `verifyWorker(req)` — timing-safe `WORKER_TOKEN` | `@/lib/supabase/admin` (service role, bypasses RLS) |

Some endpoints accept **either** (e.g. `connectors` GET, `mail` GET, `watchdog`): try
`verifyWorker` first, else fall back to a session + `profiles.role === 'admin'` check.

## Hard rules

- **Never trust `role` from the request body** — read it from `profiles` by `user_id`
  (`@/lib/get-profile-role`).
- **Never return raw DB errors** — use `apiError(detail, status, message)`
  (`@/lib/api-error`): logs full error server-side, returns a generic message
  (CWE-209). The only exception is reading `error.message` to *map* a known case.
- **Don't update `tasks` status directly** — call the atomic RPCs
  (`claim_next_task`, `complete_task`, `fail_task`, …) which verify lock ownership.
- Parse bodies defensively: `await req.json().catch(() => null)` then
  `typeof body?.x === "string" ? … : …`.
- Return `NextResponse.json({ error }, { status })`; never throw from a handler.
- Filter/`.or()` inputs from the query string must be charset-validated before use
  (PostgREST filter-injection — see the mail route).

## Map

```
chat/            POST: enqueue_chat_task (message + task in one tx, rate-limited)
chat/thread/     POST create / DELETE via delete_thread_safely (rejects active tasks)
tasks/           GET (own/admin) · PATCH (admin cancel) · claim|complete|fail|
                 checkpoint|request-approval|watchdog (worker) · [taskId]/approve|reject
                 (user, owner/admin via security-definer RPC) · [taskId]/stream (SSE, node-only)
runs/ mail/      worker/admin batch + inter-agent mail
connectors/ agents/ role-scoped access matrices (016/025) · features/ role_features
ops/smoke/       service-role health probe
```
