# src/ — Next.js 16 application

Frontend (UI) **and** backend (API routes) live here — the app does not "think",
it persists messages and enqueues tasks; the worker (`agent/`) executes them.

## Layout

```
app/            App Router: (auth) login, (dashboard) chat/tasks/queue/runs/access, api/*
components/     UI: chat/, tasks/, access/, layout/, ui/ (shadcn — never edit by hand)
lib/            shared server/client utilities (see lib/AGENTS.md)
types/          database.ts (Task/Message/Thread/Profile/...), roles.ts
proxy.ts        Supabase session refresh (replaces v13–15 middleware in Next 16)
```

## Rules (inherited from root AGENTS.md)

- This is **Next.js 16 / React 19** — verify APIs in `node_modules/next/dist/docs/`
  before using; many v13–15 patterns are gone.
- Prefer Server Components; add `"use client"` only for hooks/interactivity.
- UI strings in **Ukrainian**; code/comments in English.
- Supabase client: `@/lib/supabase/server` (server), `@/lib/supabase/client`
  (browser), `@/lib/supabase/admin` (service role, worker/admin paths only).
- Always type queries with `.returns<T[]>()` / `.single<T>()`. Never `any`.
- Role is read from `profiles` server-side — **never** trusted from the request body.

## Verify after changes

```bash
npm run lint && npx tsc --noEmit && npm test
```
