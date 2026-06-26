# src/components/ — UI components

```
chat/     ThreadList, ChatWindow, InputBar, MessageBubble, TaskStatusBadge
tasks/    TasksTable, QueueTable, RunsTable
access/   AccessManager (role↔agent / role↔KB matrices editor)
layout/   AppSidebar, RoleBadge
ui/       shadcn/ui primitives — DO NOT edit by hand (regenerate via shadcn)
```

## Conventions

- Page-specific components co-locate in the page dir; shared ones live here.
- `"use client"` only when hooks/interactivity are needed.
- Style via `cn()` (`@/lib/utils`) = `clsx` + `tailwind-merge`. Tailwind v4.
- Icons: `lucide-react` — verify icon names on upgrade.
- Toasts: `sonner`.

## Realtime + optimistic patterns (chat)

- `ChatWindow` subscribes to one Supabase Realtime channel per thread
  (`messages:<threadId>`); `TaskStatusBadge` multiplexes task updates over the
  same socket. Always clean up channels in the `useEffect` return.
- Optimistic send: `InputBar.onSend` returns the optimistic message id;
  `onSendFailed` rolls it back and restores the input on POST failure. Don't
  leave phantom messages that aren't in the DB.
- Realtime relies on RLS for per-user isolation — verify a user never receives
  another user's rows.
