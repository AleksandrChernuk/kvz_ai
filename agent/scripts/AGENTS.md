# agent/scripts/ — worker scripts

Bash + Python that drive one task from claim to completion. Dependencies on the
host: `curl`, `jq`, `python3`, and `node` (for RAG grounding).

## Files

| Script | Contract |
|---|---|
| `watchdog.sh` | Standalone: one POST to `/api/tasks/watchdog` (frees locks stale > `WATCHDOG_TIMEOUT_MINUTES`, default 5). Meant for an OS scheduler (`launchd`/`cron`/systemd timer), run **independently of `poll.sh`** — so a crashed worker's task still gets freed. See `agent/scripts/com.kvz-ai.watchdog.plist.example` (macOS) or `ops/systemd/kvz-ai-watchdog.*` (Linux). |
| `poll.sh` | `--once` for cron, else loop. claim → token gate → enrich (role-scoped `/api/agents` + `/api/connectors`, includes `library`) → handler → `validate_result.py` → approval gate → complete/fail. Watchdog every 10th iteration. On a claimed task with `approved_at` set: if the stored preview is `agent_used:"orchestrated"` with a `raw_result.plan`, builds a resume payload (`payload.resume = {plan, sub_results}`) and falls through the same pipeline (handler re-invoked to actually execute the previously-held steps) instead of just re-completing the preview; otherwise re-completes the preview as before. |
| `handle_task.sh` | **Router + orchestrator (brain = Claude, executor = Codex).** stdin `TaskPayload`. Tries `plan_task.sh`: plan 0 steps (planning off/failed) → **simple mode** (direct Codex). Plan exactly 1 step → reuse that step's prompt/executor without a second LLM call. Plan ≥2 steps → **decompose mode**: run sub-tasks through Codex (parallel where `depends_on` allows, bounded `ORCH_MAX_CONCURRENCY`, default 3; each sub-payload re-passes the token gate; dependency context is fenced as untrusted data; a failed/missing dependency short-circuits its dependents to `failed`; provenance records the actual executor) → `validate_result.py` per sub-result (validation = step's declared expectation merged with the executor result's `validation`, executor values win; runs only when a `kind` is present; on fail → one retry with the reason fed back, then re-validate, else step `failed`) → `synthesize.sh` → one `TaskResult` (`agent_used:"orchestrated"`). Any irreversible sub-step (and its dependents) is **held — not executed** — and the task returns `requires_approval:true` listing those actions (fail-closed: the gate fires *before* any irreversible action runs). Fail-soft: plan/synth failure → simple mode. `ORCH_DISABLE=1` forces simple mode. Override with `HANDLER` env. **Resume mode:** if `payload.resume.plan` is present, reuses that plan verbatim (no re-planning), seeds `ok`/`failed` sub-results from `payload.resume.sub_results` (skips re-running them), and does NOT re-apply `is_irreversible()` — previously-held steps run for real this time, producing `requires_approval:false`. |
| `plan_task.sh` | **PLAN step (brain = Claude).** stdin `TaskPayload` → JSON plan `{steps:[{id,executor,prompt,depends_on}]}` on stdout. Validates with `validate_plan.py`; simple task → 1 step. Fail-soft: bad/empty plan → exit 1 (caller takes simple path). |
| `synthesize.sh` | **SYNTHESIZE step (brain = Claude).** stdin `{user_message, sub_results}` → one grounded Ukrainian answer (cites `[library/document]`, invents nothing). Fail-soft: exit 1 → caller concatenates sub-answers. |
| `handle_codex.sh` | **Executor = Codex.** Universal read-only PM/KB helper: RAG grounding from role-allowed kb-docs libraries, Bitrix/1C/reporting guidance, production questions, and calculations → `codex exec` under subscription (`codex login`), read-only sandbox → `TaskResult` (`agent_used:"codex"`). |
| `handle_gemini.sh` | Legacy knowledge executor. Kept in the tree for reference, but `handle_task.sh` no longer routes work to it. |
| `check_token_limit.py` | deterministic 5000-token gate. exit 0 ok / 1 over / 2 malformed. `--trim` drops oldest context. `--self-test`. |
| `validate_result.py` | deterministic result filter (weight/selection/ilogic/dxf/json). exit 0 pass / 1 fail+reason. `--self-test`. **No AI.** |
| `validate_plan.py` | deterministic plan-structure check (executor == codex, unique ids, deps exist, acyclic, ≤6 steps). exit 0 valid / 1 invalid / 2 malformed. `--self-test`. **No AI.** `PLAN_MAX_STEPS` only narrows the cap. |
| `tests/orchestrate_test.sh` | integration test of both modes with stub `claude`/`codex` (no live LLM). `npm test` runs it. |

## Rules

- The three Python scripts (`check_token_limit.py`, `validate_result.py`,
  `validate_plan.py`) are **deterministic and AI-free** — same input → same
  output anywhere. Bump `*_VERSION` if you change the rules; keep `--self-test`
  green (`npm test` runs them).
- Decomposition is **opt-in**: only plans with ≥2 steps orchestrate; single-intent
  tasks keep the unchanged one-executor path (no extra LLM calls). Keep ONE planner
  (Claude) over flat executors — executors never plan/dispatch their own sub-tasks.
- Irreversible sub-steps are **fail-closed**: held (never delegated) until human
  approval. On approve, `poll.sh` resumes the handler with the same plan
  (`payload.resume`) so held steps actually execute post-approval — see the
  "Approve → resume" section in `agent/CLAUDE.md`. Migration `023` binds the
  resumed completion to the same `raw_result.plan` (deep jsonb equality) instead
  of exact result-text equality, since the resumed answer legitimately differs
  from the preview (the preview never contained the held step's real output).
- `handle_task.sh` must **fail safe**: if `node`/the connector build/the query CLI
  is missing, grounding silently falls back to a plain answer — never error out
  of grounding.
- `poll.sh` returns `0` after a handled failure (`fail_task` then `return 0`) —
  that "handled, move on" contract is load-bearing; preserve it.
- Never call Supabase or update `tasks` directly — only the worker API endpoints.
- Shell guards: keep `set -euo pipefail`; wrap optional/External calls with
  `|| true` / `set +e` so one flaky call doesn't abort the task.
