# agent/scripts/ — worker scripts

Bash + Python that drive one task from claim to completion. Dependencies on the
host: `curl`, `jq`, `python3`, and `node` (for RAG grounding).

## Files

| Script | Contract |
|---|---|
| `poll.sh` | `--once` for cron, else loop. claim → token gate → enrich (role-scoped `/api/agents` + `/api/kb`, includes `library`) → handler → `validate_result.py` → approval gate → complete/fail. Watchdog every 10th iteration. |
| `handle_task.sh` | stdin `TaskPayload` → stdout `TaskResult`. RAG: retrieves from each role-allowed kb-docs library via `KB_QUERY_JS`, grounds the Anthropic answer (`agent_used:"kb"` + sources), else plain (`codex`). Override with `HANDLER` env. |
| `check_token_limit.py` | deterministic 5000-token gate. exit 0 ok / 1 over / 2 malformed. `--trim` drops oldest context. `--self-test`. |
| `validate_result.py` | deterministic result filter (weight/selection/ilogic/dxf/json). exit 0 pass / 1 fail+reason. `--self-test`. **No AI.** |

## Rules

- The two Python scripts are **deterministic and AI-free** — same input → same
  output anywhere. Bump `*_VERSION` if you change the rules; keep `--self-test`
  green (`npm test` runs them).
- `handle_task.sh` must **fail safe**: if `node`/the connector build/the query CLI
  is missing, grounding silently falls back to a plain answer — never error out
  of grounding.
- `poll.sh` returns `0` after a handled failure (`fail_task` then `return 0`) —
  that "handled, move on" contract is load-bearing; preserve it.
- Never call Supabase or update `tasks` directly — only the worker API endpoints.
- Shell guards: keep `set -euo pipefail`; wrap optional/External calls with
  `|| true` / `set +e` so one flaky call doesn't abort the task.
