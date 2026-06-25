# Phase 2: Security & Performance Review

## Security Findings

### High
- **H1 — mail `.or()` filter injection** (`src/app/api/mail/route.ts:43`, CWE-89/943, CVSS ~6.5).
  `agent` query param interpolated into PostgREST `.or()` grammar. Admin/worker caller can inject
  clauses (`?agent=x,read_at.not.is.null`) and read mail not addressed to them. **REAL.**
  Fix: regex-validate + `.in("to_agent",[agent,"@all"])`.

### Medium
- **M2 — approval gate not enforced at `complete_task`** (CWE-863, safety-critical). The "refuse to
  complete unapproved irreversible task" check lives only in poll.sh bash. A leaked worker token or
  buggy subagent can `POST /api/tasks/complete` and bypass the human gate. Fix in SQL:
  `if v_task.approval_required and v_task.approved_at is null then raise exception ...`.
- **M1 — raw Postgres `error.message` forwarded to clients** (CWE-209). ~12 routes leak schema
  internals. Add shared mapper: log full server-side, return generic message.
- **M3 — webhook DNS-rebinding window** (CWE-918, CVSS ~5.0). Guard resolves hostname, then fetch
  re-resolves → attacker low-TTL DNS can hit 169.254.169.254. Fix: pin resolved IP OR make
  `WEBHOOK_ALLOWED_HOSTS` mandatory in prod. Low urgency at scale.

### Low
- L1 — `messages` RLS `for all using` has no `with check` (forge assistant turn if insert ever exposed; not currently reachable).
- L2 — SSE route no `export const runtime="nodejs"`.
- L3 — webhook DNS-fail silent drop (add warn).
- L4 — verifyWorker length-leak via timing (negligible, standard).

### Verified CLEAN (no action)
Migration 011 revoke **correct**. approve/reject **cannot** be called by non-owner (DB-level
auth.uid() check). Worker-token boundary solid on all 16 routes. No route trusts role from body.
service-role client not client-reachable. RLS enabled everywhere. Deps current (Next 16.2.7,
React 19.2.4, supabase-js ^2.108) — no known-vulnerable pins. No hardcoded secrets.

## Performance Findings (judged at ~10 users)

### Medium
- **M1 — missing index `messages(thread_id, created_at desc)`.** Every chat-open / send / thread-list
  read filters by thread_id with no index → seq scan. Negligible today, free insurance. Add migration 012.
- **M2 — `loadThreadsWithPreview` unbounded fetch** (`threads.ts:20`). Pulls ALL messages of ALL
  threads to compute previews. Fine at 10 users; first thing to slow down. Fix later: `distinct on`
  RPC or denormalized `threads.last_message_preview`. NOT urgent.

### Low (all "not relevant at current scale")
- L3 — no `threads(user_id, updated_at desc)` index (fold into 012 if doing M1).
- L4 — per-badge Realtime channel + initial SELECT (multiplexed over 1 socket, cleaned up — fine).
- L5 — MessageBubble not memo'd (sub-ms at 50 msgs).
- L6 — smooth-scroll on every messages change (UX nit).

### Verified GOOD (preserve)
Context fetches bounded (10 / 50 limit). Queue claim index-backed + atomic. poll.sh not a busy-loop
(sleep only when empty). Partial index `tasks_queue_idx` covers claim path. Do NOT add LISTEN/NOTIFY
or shorten poll interval at this scale.

## Critical Issues for Phase 3 Context

- H1 mail injection + M2 complete_task gate → testing should add: (a) mail filter-injection test,
  (b) test that complete refuses unapproved irreversible task.
- Perf M1 index → migration 012 worth adding.
- No test currently covers the approval gate (approve→pending, reject→cancelled) or the deterministic
  filter integration — testing phase should flag coverage gaps here.
