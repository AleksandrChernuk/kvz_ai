# Architecture roadmap — best-practice evolution

The agent architecture matches the dominant **2026 router/supervisor multi-agent
pattern** (verified against industry sources, 2026-06-26):

```
Claude = brain / pure router  →  decides the executor, does not answer
Executors:  Codex (code/technical)  ·  Gemini (knowledge + RAG)
Orchestration: poll.sh queue + deterministic filter + human approval gate
```

This is the right pattern — **do not rewrite it**. The items below are evolution
steps, each gated on a real trigger so we don't build them early.

## To do (priority / trigger order)

### 1. Task decomposition + synthesis in the router — ✅ DONE (commit 53f6d8a)
Shipped: `plan_task.sh` (Claude plans) → parallel sub-tasks respecting
`depends_on` → per-step `validate_result.py` → `synthesize.sh` →
`agent_used:"orchestrated"`. Opt-in (≥2 steps); 1-step plans reuse the executor.
Deterministic filter + approval gate apply **per sub-result**; irreversible
sub-steps are held fail-closed before execution. See `agent/scripts/AGENTS.md`.

- **Follow-up (before any write-capable executor):** resume-after-approval — held
  irreversible sub-steps are currently held but NOT auto-executed after approval
  (`poll.sh` re-completes the stored preview without re-running the handler).
  Required before wiring a Bitrix/email/`.dxf` write executor. Tracked separately.

### 2. Richer handoffs between agents — MEDIUM
Currently only fail-soft fallback (codex → gemini → claude). Best practice:
structured handoffs — an executor can request clarification or delegate back.

- **Trigger:** when an executor needs missing input mid-task instead of failing.
- **How:** build on the existing `agent_mail` table (typed inter-agent messages).

### 3. State-graph framework for coordination — LOW / deferred
Routing/coordination lives in bash (`poll.sh` + `handle_task.sh`). This is a
deliberate, sound choice at ~10 users (no heavy deps, full control, subscription
CLIs). The mature industry path is a state-graph engine (LangGraph / CrewAI).

- **Trigger:** ONLY when the bash routing logic becomes fragile or hard to reason
  about. Adopting a framework now would be over-engineering.

### 4. Routing strategies — LOW
Fallback-model / latency-budget routing on top of task-type routing. Nice to have.

## What NOT to do
- Don't add microservices, Kafka, vector-DB-at-scale, or horizontal scaling —
  out of scope at this size.
- Don't migrate to a framework before bash actually hurts.
- Don't let executors self-orchestrate a second dispatch layer — keep one router
  (Claude) over flat executors.
