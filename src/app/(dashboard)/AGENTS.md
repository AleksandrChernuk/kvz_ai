# src/app/(dashboard)/ — authenticated pages

Pages behind login. Server Components by default; each page reads the session and
the user's role from `profiles` and renders accordingly.

```
chat/            chat/[threadId] — thread list + conversation (Realtime)
tasks/           the user's own task history (admin: all)
queue/           admin-only queue view
runs/            admin-only run batches
access/          admin-only role↔agent / role↔connector access matrices (AccessManager)
```

## Role gating

- Gate **server-side**: read `profiles.role` in the page/layout and redirect or
  hide — don't rely on the client to enforce access.
- `admin` sees everything; `manager`/`engineer`/`viewer` see only their own rows.
- `/queue`, `/runs`, `/access` are admin-only — guard both the page and the API.
- Feature flags (`role_features`, e.g. `training`, `connectors_manage`) gate optional UI
  via `hasFeature()` — not the same as the role hierarchy.
- Session refresh is handled by `src/proxy.ts`; pages still re-check auth.
