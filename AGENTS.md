<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Project: kvz-ai

Multi-agent AI assistant platform. Next.js 16 + React 19 frontend, Supabase backend, asynchronous task queue for agent execution.

**Product vision:** users log in and write tasks in chat ("порахуй", "підкажи", …). Answers come primarily from the company's knowledge bases (NotebookLM-style and others) connected as MCP servers — there will be many of them. UI features are gated via `role_features`; agents and MCP/KB services are gated via normalized role access tables.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.7 (App Router, React 19) |
| Auth + DB | Supabase (SSR, RLS enabled) |
| UI | Tailwind CSS v4, shadcn/ui (radix-ui), lucide-react |
| Styling | `clsx` + `tailwind-merge` via `cn()` |
| Notifications | sonner |

## Architecture

```
User → /api/chat → saves Message → creates Task (status: pending)
                                        ↓
                    Orchestrator calls POST /api/tasks/claim  ← atomic FOR UPDATE SKIP LOCKED
                                        ↓
                    saves checkpoint periodically (crash recovery)
                                        ↓
                    routes/decomposes: 1 intent → one executor; composite →
                    plan → parallel sub-tasks → synthesize (agent_used:"orchestrated";
                    irreversible sub-steps held fail-closed → requires_approval)
                                        ↓
                    dispatches to subagent (codex-agent/, search, etc.)
                                        ↓
                    POST /api/tasks/complete → writes Task.result + inserts Message (assistant)
                    POST /api/tasks/fail     → retry (retry_count++) or permanent failed
```

### Queue API surface (orchestrator uses these)

Worker endpoints require `Authorization: Bearer <WORKER_TOKEN>` (shared secret in env). They use the service-role client internally — the worker has no cookies.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/tasks/claim` | worker | Atomic claim — next pending task or null |
| `POST /api/tasks/complete` | worker | Mark done + insert assistant message + webhook |
| `POST /api/tasks/fail` | worker | Mark failed or re-queue with retry |
| `POST /api/tasks/checkpoint` | worker | Save progress for crash recovery |
| `POST /api/tasks/watchdog` | worker or admin | Release stale locks > N min |
| `GET  /api/tasks/[id]/stream` | user | SSE stream of task status (node server only) |
| `GET/POST /api/runs` | admin / worker | Logical run batches |
| `GET/POST/PATCH /api/mail` | worker (GET also admin) | Inter-agent mail |
| `GET/POST /api/connectors` | user+worker / admin | MCP connectors (RLS filters by role) |

### Token limit gate

Every task is capped at **5000 tokens** (deterministic estimate). The orchestrator runs [agent/scripts/check_token_limit.py](agent/scripts/check_token_limit.py) after claim: `--trim` drops oldest context messages to fit; if `user_message` alone exceeds the limit the task is failed with `retry: false`.

### Key directories

```
src/
  app/
    (auth)/login/          — login page, Supabase magic link / password
    (dashboard)/
      chat/                — thread list + [threadId] chat view
      tasks/               — task history per user
      queue/               — admin-only queue view
    api/
      chat/                — POST: save message + enqueue task
      chat/thread/         — GET/POST: list/create threads
      tasks/               — GET: list tasks; PATCH: admin cancel
  components/
    chat/                  — InputBar, ThreadList, MessageBubble
    tasks/                 — TasksTable, QueueTable
    ui/                    — shadcn primitives (never edit directly)
  lib/
    supabase/server.ts     — createClient() for server components/routes
    supabase/client.ts     — createClient() for browser components
  types/
    database.ts            — Task, Message, Thread, Profile, TaskPayload, TaskResult
    roles.ts               — UserRole, ROLE_LABELS, ROLE_COLORS
agent/                     — Orchestrator Claude Code agent (see agent/CLAUDE.md)
codex-agent/               — Codex subagent (see codex-agent/CLAUDE.md)
.codex/skills/             — project-local skills for Codex/Claude workflows
```

## Project Skills

- `mcp-connector-builder` (`.codex/skills/mcp-connector-builder`) — use for MCP/ContextForge connector work: connector structure, 1Password-sourced runtime config, read-only defaults, schemas, audit logs, rate limits, SSRF/egress controls, tests, Docker/runtime layout, and registration via ContextForge.

## Data model (Supabase)

- **profiles** — `user_id (FK auth.users)`, `role: UserRole`, `full_name`, `webhook_url`
- **threads** — belong to user; `title` (null until autogenerated from first message), `updated_at`
- **messages** — `thread_id`, `role: user|assistant|system`, `content`, `task_id?`
- **tasks** — `status`, `priority`, `agent`, `payload`, `result`, `retry_count`, `max_retries`, `checkpoint`, `locked_at`, `locked_by`, `run_id`
- **runs** — logical session batch; `status: active|completed|failed`, `agent_count`
- **agent_sessions** — orchestrator/subagent state; `state: booting|working|between_turns|stalled|completed|zombie`, `escalation_level`, `checkpoint`, `last_activity`
- **agent_mail** — typed inter-agent messages; `type`, `priority`, `read_at`
- **agents** — agent catalog; `key: AgentType`, `name`, `description`, `enabled`
- **role_agent_access** — role-to-agent access matrix
- **connectors** — MCP connectors; `mcp_server` (key in `agent/.mcp.json`), `enabled`
- **connector_role_access** — role-to-connector access matrix
- **role_features** — UI feature flags per role (`training`, `connectors_manage`, …)

### PostgreSQL functions (service role only)

All queue functions are `security definer` with execute revoked from `anon`/`authenticated` and granted only to `service_role` — the public anon key cannot drive the queue.

| Function | Purpose |
|---|---|
| `claim_next_task(worker_id)` | Atomic claim with `FOR UPDATE SKIP LOCKED` |
| `complete_task(task_id, worker_id, result, agent)` | Mark done, verify lock ownership |
| `fail_task(task_id, worker_id, error, retry)` | Fail or re-queue (verifies lock ownership) |
| `save_checkpoint(task_id, worker_id, checkpoint)` | Save progress snapshot |
| `release_stale_locks(timeout_minutes)` | Watchdog: free zombie tasks |
| `check_pending_limit(user_id, max)` | Rate limit: max active tasks per user |
| `send_mail(...)` / `mark_mail_read(agent)` | Agent mail |
| `is_admin()` / `current_user_role()` | RLS helpers (security definer — no policy recursion) |

**RLS rules:**
- Users see only their own rows (threads, messages, tasks)
- `admin` role bypasses user filter in API routes (not via JWT claim — role is read from `profiles`)
- Never trust `role` from request body — always read from `profiles` table

## Roles

`admin` > `manager` > `engineer` > `viewer`

Access levels are enforced in API routes. UI shows/hides controls based on `profile.role`.

## Coding conventions

- **Language**: UI text and user-facing strings in **Ukrainian**. Code, variable names, comments in English.
- **Server vs Client**: Prefer Server Components. Add `"use client"` only when hooks/interactivity required.
- **Supabase client**: use `createClient()` from `@/lib/supabase/server` in server context, `@/lib/supabase/client` in browser.
- **No raw SQL**: use Supabase query builder only.
- **Types**: always pass `.returns<T[]>()` or `.single<T>()` on Supabase queries — never `any`.
- **Error handling**: return `NextResponse.json({ error })` with correct HTTP status; don't throw in route handlers.
- **Components**: co-locate page-specific components in the page directory. Shared components go to `src/components/`.
- **No comments** unless the WHY is non-obvious (invariant, workaround, hidden constraint).

## Before writing any Next.js code

1. Check `node_modules/next/dist/docs/` for the relevant API guide.
2. This is Next.js **16** with React **19** — many patterns from v13/14/15 are deprecated or removed.
3. Metadata API, Route Handlers, and caching APIs have changed — verify before using.

## Verification (run after any code change)

```bash
npm run lint && npx tsc --noEmit && npm test
```

`npm test` = vitest unit tests (worker-auth, webhook SSRF guard, validators, title, queue-migrations) + Python self-tests (token-gate + plan validator) + the bash orchestrate integration test (`agent/scripts/tests/orchestrate_test.sh`, stubbed LLMs). Run `npm run build` before considering a change deploy-ready.

## Memory system

The persistent memory for this project lives in:
`~/.claude/projects/-Users-aleksandrcernuk/memory/`

Update memory when you learn non-obvious facts about the user's preferences, project decisions, or recurring patterns.
