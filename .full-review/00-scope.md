# Review Scope

## Target

kvz-ai — мультиагентна AI-платформа. Next.js 16 (App Router) + React 19 фронт/API,
Supabase (Auth + Postgres + RLS + Realtime), асинхронна черга задач, воркер на сервері
з CLI-агентами, MCP-конектори до баз знань (NotebookLM, Bitrix24, 1С) за шлюзом.

## Files

- `src/app/` — UI (auth, dashboard: chat/tasks/queue/runs) + API routes (16 route.ts)
- `src/app/api/` — chat, chat/thread, tasks/* (claim, complete, fail, checkpoint,
  request-approval, watchdog, [taskId]/approve|reject|stream), runs, mail, kb, features
- `src/components/` — chat (ThreadList, ChatWindow, InputBar, MessageBubble, TaskStatusBadge),
  tasks (TasksTable, QueueTable, RunsTable), ui (shadcn)
- `src/lib/` — supabase (client/server/admin/middleware), worker-auth, webhook, validate,
  features, limits, title, threads, task-meta
- `src/types/` — database.ts, roles.ts
- `agent/scripts/` — poll.sh (worker loop), handle_task.sh (LLM handler),
  check_token_limit.py (token gate), validate_result.py (deterministic filter)
- `supabase/migrations/` — 001…011 (profiles, threads, tasks queue, RLS, queue funcs,
  mail/webhook/ratelimit, knowledge_bases, transactional complete, atomic enqueue,
  approval gate)
- `ops/` — self-host infra (supabase, contextforge gateway, backup, logging, deploy)

## Flags

- Security Focus: no
- Performance Critical: no
- Strict Mode: no
- Framework: Next.js 16 + React 19 + Supabase (auto-detected)

## Context for reviewers

- This is Next.js **16** (App Router, React 19). Many v13–15 patterns are deprecated.
- Roles: admin > manager > engineer > viewer. Role ALWAYS read from `profiles`, never request body.
- Queue functions are `security definer`, execute revoked from anon/authenticated, granted to service_role.
- Worker endpoints authed via `WORKER_TOKEN` (timing-safe). Webhooks have an SSRF guard.
- Scale target: ~10 users. Avoid recommending microservices/Kafka/horizontal-scaling — out of scope.

## Review Phases

1. Code Quality & Architecture
2. Security & Performance
3. Testing & Documentation
4. Best Practices & Standards
5. Consolidated Report
