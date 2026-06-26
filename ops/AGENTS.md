# ops/ — self-host infrastructure

VPS deployment lives here; app code stays in the repo root. Full runbook is in
**`README.md`** — this is the orientation.

```
supabase/      self-host Supabase (Docker Compose) + apply-migrations.sh
deploy/        deploy-release.sh (releases, build, symlink switch) + smoke-check.sh
systemd/       kvz-ai-web · kvz-ai-worker · kvz-ai-watchdog (.service/.timer)
contextforge/  MCP gateway: compose + hardened connector network (see its README)
nginx/         public reverse proxy (app + supabase only; never Studio or gateway)
backup/        pg_dump backup/restore (cron) — see backup/README.md
logging/       logrotate (app/worker file logs) + docker daemon log caps
env/           worker.env / web.env examples (real values from 1Password on VPS)
server/        one-off server scripts (cleanup)
```

## Rules

- **Secrets never in git.** `.env*`, `secrets/`, `volumes/` are gitignored; real
  values materialize from 1Password into runtime env on the VPS only.
- The MCP gateway and Supabase Studio are **never** proxied publicly by nginx.
- CLI agents (Claude/Codex) install on the **worker** host only — highest-risk
  execution layer, kept off the public-facing web container.
- Two operational must-dos on the server: the **watchdog timer** (else stale
  tasks never fail) and the **backup cron** before any migration.
- The connector must be built on deploy (`connectors/kb-docs`) for RAG grounding.
