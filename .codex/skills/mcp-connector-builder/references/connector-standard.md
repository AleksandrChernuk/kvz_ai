# kvz-ai MCP Connector Standard

## Architecture

MCP connectors for `kvz-ai` should sit behind ContextForge unless the user explicitly requests a different topology.

```text
worker -> ContextForge gateway -> connector runtime -> external system
```

The Next.js app should not hold vendor credentials for 1C, Bitrix, NotebookLM-like systems, or other external knowledge bases. The worker should call the gateway with a gateway token and role-checked connector key.

## Secret Handling

- 1Password is the source of truth for real secrets.
- `.env*` files are runtime materialization only and must stay uncommitted.
- Never write secrets into README, tasks, memory, logs, tests, fixtures, migration files, or code comments.
- Example files may include variable names and placeholder values only.

## Connector Classes

### Read-only KB/query connector

Default class for knowledge bases. Allowed to read/search/fetch. No mutation tools.

Expected controls:

- Role check before invocation.
- Query length limits.
- Result count limits.
- Output redaction for secrets/tokens.
- Audit log with user/task/run/connector/tool metadata.

### Restricted workflow connector

May call internal workflows but should still be non-destructive by default.

Expected controls:

- Explicit allowlist of operations.
- Idempotency key for operations that can be retried.
- Per-operation timeout and retry policy.
- Structured failure results instead of thrown raw vendor errors.

### Write-capable connector

Only implement when explicitly requested. Writes must route through the existing task approval architecture and never complete irreversible work directly from an LLM-only decision.

Expected controls:

- `requires_approval=true` result before execution, or equivalent pre-execution approval gate.
- Human-visible operation summary.
- Dry-run/preview where possible.
- Strong audit event before and after execution.

## MCP Surface Design

Use resources for stable context:

- schemas
- entity metadata
- available knowledge-base descriptions
- static connector capabilities

Use tools for parameterized operations:

- search
- fetch by id
- list recent records
- validate payload
- create preview/dry-run

Use prompts sparingly:

- guided query construction
- domain-specific summarization templates

Tool design rules:

- Tool names should be stable and domain-scoped, e.g. `bitrix_search_deals`, `onec_get_invoice`.
- Inputs must be JSON-schema/Zod/Pydantic validated.
- Avoid free-form SQL, arbitrary URL fetch, arbitrary method names, or arbitrary file path inputs.
- Return compact structured data. Do not dump full raw vendor payloads unless explicitly needed.
- Include pagination/cursors for list/search tools.

## Access Control

Connector execution must have two layers:

1. kvz-ai role-level routing via `knowledge_bases.allowed_roles`.
2. Connector-local allowlist of exposed tools and outbound targets.

Never trust role, user id, connector id, or operation name from a request body without server-side validation.

## Egress and SSRF

External calls must use fixed base URLs or an allowlist. Reject user-supplied absolute URLs unless there is a narrow, validated allowlist.

Block:

- localhost and loopback
- link-local addresses
- private RFC1918 ranges unless explicitly required for an internal connector
- metadata IPs such as `169.254.169.254`
- redirects to disallowed hosts

Set short connect/read timeouts. Avoid following redirects unless the redirect target is revalidated.

## Rate Limits and Reliability

Each connector should define:

- per-tool timeout
- max result size
- max page size
- retry policy for transient vendor failures
- no retry for validation/auth/permission failures
- circuit-breaker or backoff when vendor systems degrade

For queue compatibility, failures should be structured enough for the worker to choose retry vs permanent fail.

## Audit Logging

Every tool call should emit an audit event with:

- timestamp
- connector key
- tool name
- task id / run id when available
- user role when available
- external target category, not secret URL contents
- result status
- duration
- redacted error class

Do not log tokens, raw headers, request bodies containing secrets, or full external payloads by default.

## Runtime Layout

Preferred production layout:

```text
/opt/kvz-mcp-gateway/
  docker-compose.yml
  .env
  connectors/
    <connector>.env
```

Connector containers should be on an internal Docker network by default. Expose only ContextForge on loopback (`127.0.0.1`) unless the deployment explicitly requires another boundary.

## Testing Expectations

Minimum tests:

- schema accepts valid input and rejects malformed input
- auth/token missing or invalid is denied
- disallowed role is denied
- egress allowlist rejects unsafe hosts
- vendor errors are mapped to safe structured errors
- write-capable operation cannot execute without approval

Prefer mocked vendor clients for unit tests. Add one smoke path for runtime wiring when practical.
