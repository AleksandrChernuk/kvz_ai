# supabase/ — database (Postgres + RLS + queue functions)

Migrations in `migrations/`, applied **in order 001→NNN**. No server provisioned
yet, so migrations need not be idempotent (they may be squashed at first deploy).

## Conventions

- **No ORM, no raw SQL in app code** — the app uses the Supabase query builder;
  this folder holds the schema and the security-definer functions.
- Queue functions are `security definer`, `set search_path = public`, with
  `revoke execute from public, anon, authenticated` + `grant to service_role`.
  Forgetting `public` in the revoke leaves a hole (Postgres grants EXECUTE to
  PUBLIC by default) — always revoke from all three.
- User-facing security-definer functions (e.g. `approve_task`) check
  `auth.uid()` ownership / `is_admin()` internally, then `grant to authenticated`.
- RLS on every user table; `is_admin()` / `current_user_role()` are
  security-definer to avoid policy recursion.
- `alter type … add value` must run in its own statement (cannot use a new enum
  value in the same transaction that added it).

## complete_task — single live definition

`complete_task` is redefined across 009/012/014/016; **only the last (016) is
live**. Its header lists the invariants every edit must preserve: lock-ownership,
running-guard, approval-gate, approval-result-binding, agent-access, empty-answer.
Drop one and you regress (it has happened — see 016 history). Tests in
`src/lib/__tests__/queue-migrations.test.ts` lock these in.

## Map (highlights)

```
001 profiles+trigger · 002 threads/messages · 003 tasks queue · 004 RLS+realtime
005 claim/fail/checkpoint/watchdog/runs/sessions · 006 mail/webhook/ratelimit
007 RLS-recursion fix · 008 knowledge_bases+role_features · 009 tx complete
010 atomic enqueue · 011 approval gate · 012 complete backstop+indexes
013 retry accounting · 014 approval result binding · 015 safe thread delete
016 access entities (agents/role_agent_access/kb_role_access) · 017 allowed_roles
projection trigger · 018 seed kb-docs role-scoped libraries
```

After applying: create the first user, set their `role = 'admin'` in `profiles`.

## Testing

- `src/lib/__tests__/queue-migrations.test.ts` — asserts migration **text**
  (cheap, runs in `npm test`). Catches dropped guards by string match.
- `scripts/db-test/run.sh` — **integration**: applies all migrations to a real
  throwaway Postgres and runs the actual functions + RLS (claim/complete/approve
  guards, result binding, agent guard, per-user isolation). This is the layer
  that catches execution regressions. Runs in CI.

When you change a queue function, add/extend an assertion in
`scripts/db-test/tests.sql`, not just the text test.
