# Phase 1: Code Quality & Architecture Review

## Code Quality Findings

### High
- **H1 — mail `.or()` filter injection** (`src/app/api/mail/route.ts:43`). `agent` from query
  string interpolated into PostgREST `.or()` grammar with no validation → caller can inject
  filter clauses and read mail not addressed to them. Reachable by any admin session.
  **VERIFIED REAL.** Fix: validate `/^[a-z0-9_@-]{1,64}$/i` then use `.in("to_agent",[agent,"@all"])`.

### Medium
- M1 — `/api/chat` pre-checks duplicate `enqueue_chat_task` ownership check (TOCTOU, marginal 404).
- M2 — `process_one()` in poll.sh: long multi-responsibility fn, repeated `set +e/-e` boilerplate ×4.
- M3 — `complete/route.ts` webhook lookup is a missed abstraction (belongs in `lib/webhook.ts`).
- M4 — Inconsistent error status across worker RPC routes (500 vs 400) + raw Postgres `error.message`
  forwarded to client (leaks internal names). Add a shared RPC-error mapper.
- M5 — `loadThreadsWithPreview` fetches all messages of all threads (latent N-row; fine at scale).

### Low
- L1 — `userRole` prop threaded through ChatWindow→InputBar but never read (dead surface).
- L2 — `title.ts` comment references unimplemented Claude-title behavior.
- L3 — webhook DNS-resolve failure silently drops delivery (add `console.warn`).
- L4 — `fireWebhook` re-parses URL already validated by `isSafeWebhookUrl`.
- L5 — magic numbers (10-msg context, 40-char preview, 16000 max_tokens) not centralized.
- L6 — watchdog timeout configurable but poll.sh hardcodes 5.

### Done well
verifyWorker length-check before timingSafeEqual; uniformly defensive body parsing; pure/tested
deterministic scripts with bool⊂int guards; layered SSRF guard; role always from profiles.

## Architecture Findings

### High
- **H1 (arch) — `claim_next_task` 004 vs 005 divergent semantics** (doc/consistency debt). 004's
  version self-recovers stale locks + no retry check; 005 (authoritative) checks retries, delegates
  stale recovery to watchdog. Add comment in 005 explaining the move. Not a runtime bug.
- **H2 (arch) — double retry_count increment.** Watchdog increments on freeing stale `running`
  (005:124) AND `fail_task` increments on retry (005:211). A timeout + a real fail can burn 2/3
  retries from one logical attempt. Pick one owner: watchdog frees WITHOUT increment.

### Medium
- M1 (arch) — irreversible-action backstop lives only in poll.sh bash (`needs_approval && !approved_at`).
  Move final guard into `complete_task`: refuse to complete when `approval_required AND approved_at IS NULL`.
- M2 (arch) — webhook fired outside tx, no delivery record, 2 extra round-trips; `complete_task`
  could return user_id/webhook_url.
- **M3 (arch) — `agent_type` enum missing `kb`. → FALSE POSITIVE.** Migration 008:8 adds
  `kb` via `alter type agent_type add value if not exists 'kb'`. Agent missed 008. No bug.
- M4 (arch) — validation split between route and `enqueue_chat_task`; concentrate in DB authority.

### Low
- L1 — SSE stream route node-only but no `runtime` directive asserting it.
- L2 — `priority` range lives only in route handler; add `check (priority between 0 and 100)`.
- L3 — `is_admin()`/`current_user_role()` granted to authenticated (benign, self-scoped).
- L4 — poll.sh hardcodes orchestration policy (docs + script must move together).

### Architectural strengths (preserve)
Queue-on-Postgres + SKIP LOCKED + service-role-only RPCs = correct, no broker needed.
Transactional complete (009) + atomic enqueue (010) eliminated real races. Clean worker↔API↔DB
layering. Deterministic filter + approval gate is good design. No over-engineering.

## Critical Issues for Phase 2 Context

- **H1 mail `.or()` injection** — security-relevant access-control gap; security agent should confirm scope.
- **M1 (arch) approval backstop in bash only** — security/safety: irreversible-action gate not enforced at DB.
- M4 error-message leakage (raw Postgres errors to client) — info disclosure.
- No Critical findings; M3 enum concern already disproven (kb present via migration 008).
