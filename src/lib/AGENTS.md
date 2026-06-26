# src/lib/ — shared utilities

| File | What | Notes |
|---|---|---|
| `supabase/server.ts` | SSR client (RLS-bound) | server components/routes |
| `supabase/client.ts` | browser client | client components |
| `supabase/admin.ts` | **service-role** client (bypasses RLS) | worker/admin paths only — never import in client components |
| `supabase/middleware.ts` | session refresh used by `proxy.ts` | |
| `worker-auth.ts` | `verifyWorker()` timing-safe `WORKER_TOKEN` | fails closed if env unset |
| `api-error.ts` | `apiError()` — log full, return generic | use in every route's error path |
| `get-profile-role.ts` | role from `profiles` (server-only) | the single role lookup |
| `access.ts` | agent/feature catalogs + `isManagedAgent`/`buildFeatureMatrix` | client-safe (no server imports) |
| `features.ts` | `hasFeature()` over `role_features` | |
| `webhook.ts` | `fireWebhook()` + SSRF guard | https-only, blocks private IPs, DNS-resolve, `redirect:"manual"`, `WEBHOOK_ALLOWED_HOSTS` |
| `validate.ts` | input validators (roles, mail types) | |
| `limits.ts` | token limit, rate limits, error mapper for enqueue | |
| `threads.ts` | thread list + previews | preview fetch is the one unbounded read (debt) |
| `title.ts` | autogenerate thread title from first message | |
| `task-meta.ts` | `TaskStatus`/`AgentType` labels + variants | keep in sync with the enums |
| `utils.ts` | `cn()` | |

## Rules

- `access.ts` must stay **client-safe** — it is imported by `AccessManager`. Do not
  pull server-only modules (e.g. `supabase/server`) into it; server helpers like
  `get-profile-role.ts` are separate and `import "server-only"`.
- Anything touching the queue goes through the RPCs, not raw table writes.
- Tests for the guard-critical pieces live in `src/lib/__tests__/`.
