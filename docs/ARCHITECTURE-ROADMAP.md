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

### 1. Task decomposition + synthesis in the router — HIGH (vision-driven)
Today the router picks exactly **one** executor per task. Best practice: the
router decomposes a query into sub-tasks, invokes zero-or-more executors (in
parallel), then **synthesizes** the results.

- **Trigger:** the first composite engineering task — e.g. one request =
  "порахуй + підбери обладнання + згенеруй .dxf". The PM's vision needs this.
- **How:** Claude (brain) splits the task into steps → executors run (Codex /
  Gemini / future MCP connectors) → Claude assembles the final answer. Keep the
  deterministic filter + approval gate **per sub-result**, not just at the end.

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
