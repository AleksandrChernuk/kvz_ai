# Implementation brief: task decomposition + synthesis in the router

**Goal (best practice):** evolve the router from "one task → one executor" to
"router decomposes a request into sub-tasks → executors run (possibly in
parallel) → router synthesizes one answer." This is the standard 2026
router/supervisor pattern and is what the PM's composite engineering tasks need
(e.g. one request = "порахуй вагу + підбери обладнання + згенеруй .dxf").

Read first: `AGENTS.md`, `agent/AGENTS.md`, `agent/scripts/AGENTS.md`,
`docs/ARCHITECTURE-ROADMAP.md`, `agent/scripts/handle_task.sh`,
`agent/scripts/handle_codex.sh`, `agent/scripts/handle_gemini.sh`,
`agent/scripts/validate_result.py`. This is Next.js 16 / bash worker; keep the
existing conventions (subscription CLIs, no API keys, fail-soft, deterministic
gates).

## Current state (what exists)

- `handle_task.sh` is a **single-shot router**: Claude classifies → delegates to
  ONE executor (`handle_codex.sh` = code, `handle_gemini.sh` = knowledge+RAG).
- `validate_result.py` = deterministic filter; approval gate lives in
  `complete_task` (DB) + `request_approval`. Token gate caps each task at 5000.
- `TaskResult` (src/types/database.ts): `{ answer, agent_used, steps, tokens, ... }`.

## Target design

```
request
  │
  ▼ Claude (brain) — PLAN: split into ordered sub-tasks, each {id, executor, prompt, depends_on}
  │
  ▼ execute sub-tasks: independent ones in parallel; respect depends_on
  │     each sub-task → handle_codex.sh / handle_gemini.sh (existing executors)
  │     each sub-result → validate_result.py (deterministic filter) BEFORE use
  │
  ▼ Claude (brain) — SYNTHESIZE: combine sub-results into one grounded answer
  │
  ▼ TaskResult { answer, agent_used:"orchestrated", steps:[plan+per-step+sources], plan, sub_results }
```

Keep it **opt-in**: simple tasks (single intent) must still go the current
one-executor path — only decompose when the plan has >1 step. This avoids extra
LLM calls and latency for the common case.

## Steps

### 1. PLAN step (new) — `agent/scripts/plan_task.sh`
- Input: TaskPayload (stdin). Output: JSON plan to stdout:
  ```json
  {"steps":[{"id":"s1","executor":"codex","prompt":"порахуй вагу...","depends_on":[]},
            {"id":"s2","executor":"gemini","prompt":"підбери обладнання...","depends_on":[]},
            {"id":"s3","executor":"codex","prompt":"згенеруй .dxf за s1,s2","depends_on":["s1","s2"]}]}
  ```
- Implement with `claude -p` (subscription, `--output-format json`, `--allowed-tools ""`),
  a strict system prompt: "Виведи JSON-план. Якщо задача проста — один крок."
- Validate the plan JSON with a small check (executor ∈ {codex,gemini}, ids unique,
  depends_on references exist, ≤ N steps cap e.g. 6). Reject/clamp malformed plans.
- **Fail-soft:** if planning fails or returns 1 step → fall back to the current
  single-executor path (no behavior change for simple tasks).

### 2. EXECUTE step — extend `handle_task.sh`
- If plan has 1 step → current path (delegate once). Done.
- If >1 step → for each step whose `depends_on` are satisfied, run the executor
  (`handle_codex.sh`/`handle_gemini.sh`) passing a payload where `user_message` =
  the step prompt + the outputs of its dependencies injected as context.
- Run independent steps in parallel (bash background jobs + `wait`), bounded
  concurrency (e.g. max 3). Capture each step's `TaskResult`.
- After each sub-result, run `validate_result.py` if the step declares a
  `validation` object; on fail, retry the step once, else mark the step failed.
- Collect `{id → sub_result}`.

### 3. SYNTHESIZE step — `agent/scripts/synthesize.sh`
- Input: original request + all sub-results. Use `claude -p` to produce ONE
  Ukrainian answer that integrates the sub-results and cites KB sources from the
  gemini steps (`[library/document]`). Do NOT invent beyond sub-results.
- Output a final `TaskResult`: `agent_used:"orchestrated"`, `steps` = the plan +
  one line per sub-step (executor + status + sources), `answer` = synthesized text.

### 4. Approval + irreversible actions
- If ANY sub-step is an irreversible action (write to 1C/Bitrix, send price, .dxf
  to machine), the WHOLE task must pass the human approval gate BEFORE that step
  executes — reuse `request_approval` / `awaiting_approval`. Do not complete
  irreversible sub-steps from an LLM-only decision (this is already the rule;
  preserve it per sub-step, not just at the end).

### 5. Tests
- Unit-test the plan validator (valid plan accepted; cycles/bad-executor/over-cap
  rejected; single-step → fallback) — add to the connector or a new bash test
  with fixtures (no live LLM; feed a canned plan JSON).
- Extend `scripts/db-test/tests.sql` only if the DB contract changes (it should
  not — sub-results are in-worker; only the final TaskResult hits `complete_task`).
- Keep `npm run lint && npx tsc --noEmit && npm test` and the connector tests green.

## Acceptance criteria
- Simple request (1 intent) → unchanged single-executor behavior, no extra calls.
- Composite request → plan with ≥2 steps, executors run (parallel where possible),
  deterministic filter applied per sub-result, one synthesized answer with sources.
- Any irreversible sub-step → human approval gate fires before it runs.
- Fail-soft everywhere: planning/synthesis failure degrades to the current path.
- `agent_used:"orchestrated"` and `steps` show the plan + per-step provenance.

## Guardrails (do NOT)
- Don't let executors plan/dispatch their own sub-tasks — keep ONE planner (Claude)
  over flat executors (no nested orchestration).
- Don't migrate to a framework (LangGraph/CrewAI) for this — bash + the queue is
  fine at current scale; revisit only when bash routing actually hurts.
- Don't remove the deterministic filter or the approval gate; they apply per
  sub-result, not just to the final answer.
- Cap plan size and concurrency; respect the 5000-token gate per executor call.
