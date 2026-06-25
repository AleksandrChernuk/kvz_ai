---
name: mcp-connector-builder
description: Build, review, or modify MCP connectors for the kvz-ai project. Use when working on ContextForge/MCP gateway integrations, knowledge-base connectors, 1C/Bitrix/NotebookLM-style connectors, MCP tool/resource schemas, connector auth, runtime secrets, rate limits, audit logging, SSRF/egress controls, Docker/runtime layout, or registration of connectors in kvz-ai.
---

# MCP Connector Builder

Use this skill to build production-grade MCP connectors that fit `kvz-ai` instead of generic demo servers.

## Required Context

Before editing code, read:

- `AGENTS.md`
- `README.md`
- `ops/contextforge/README.md`
- Any existing connector/gateway files relevant to the request

If the task touches Next.js route handlers, also read the relevant Next.js 16 docs from `node_modules/next/dist/docs/` before writing code, as required by this project.

## Workflow

1. Classify the connector:
   - `read-only KB/query connector`
   - `restricted workflow connector`
   - `write-capable connector requiring approval`

2. Design the boundary:
   - Prefer ContextForge as the only worker-facing gateway.
   - Keep vendor credentials inside gateway/connector runtime, never in Next.js or worker code.
   - Keep real secrets in 1Password; env files are runtime materialization only.

3. Define MCP surface:
   - Use `resources` for stable/readable context.
   - Use `tools` for parameterized actions.
   - Use `prompts` only for reusable interaction templates.
   - Keep tool names stable, specific, and domain-scoped.

4. Build safety first:
   - Read-only by default.
   - Strict input schemas.
   - Output sanitization.
   - Per-tool access control.
   - Rate limits and timeouts.
   - Audit logs for every tool invocation.
   - Explicit egress allowlist for external calls.

5. Integrate with kvz-ai:
   - Register connector keys to match `knowledge_bases.mcp_server`.
   - Route access through role checks before invocation.
   - Preserve the queue/approval architecture; write-capable tools must not bypass the human approval gate.

6. Verify:
   - Add focused unit tests for schema validation, auth, deny paths, and egress restrictions.
   - Add smoke tests or documented manual checks for the connector runtime.
   - Run the project checks required by `AGENTS.md` for touched files.

## References

Read these only when needed:

- `references/connector-standard.md` — kvz-ai connector architecture and implementation rules.
- `references/review-checklist.md` — checklist for reviewing or accepting a connector.

For protocol details, prefer official MCP sources:

- https://modelcontextprotocol.io/docs/develop/build-server
- https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices
