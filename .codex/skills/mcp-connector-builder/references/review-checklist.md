# MCP Connector Review Checklist

Use this checklist before accepting a new or changed connector.

## Fit With kvz-ai

- Connector sits behind ContextForge or there is an explicit reason it does not.
- `knowledge_bases.mcp_server` key and connector route/key are aligned.
- Role access is enforced server-side, not trusted from request body.
- Queue and approval architecture are preserved.
- No real external integration was implemented unless the user explicitly asked for it.

## Secrets

- Real secrets remain in 1Password.
- Env files contain runtime materialization only and are ignored by git.
- Examples contain placeholders only.
- Logs/tests/docs do not include tokens, API keys, vendor passwords, webhook URLs, or service-role keys.

## MCP Design

- Tools/resources/prompts are chosen intentionally.
- Tool names are stable and domain-scoped.
- Input schemas are strict and reject unknown or dangerous fields.
- Outputs are compact, structured, and sanitized.
- Pagination or limits exist for list/search results.

## Security

- Read-only is the default.
- Write tools require explicit human approval.
- Egress is allowlisted.
- SSRF protections cover localhost, private ranges, link-local, metadata IPs, and redirects.
- Tool calls have timeouts.
- Rate limits exist at gateway or connector boundary.
- Vendor errors are redacted before reaching users/LLMs.

## Observability

- Every tool call is audit logged.
- Audit records include connector/tool/task/run/status/duration.
- Audit records exclude secrets and full raw payloads.
- Failures preserve enough detail for operators without leaking internals to users.

## Tests

- Validation accept/deny tests exist.
- Auth deny tests exist.
- Role deny tests exist.
- Egress deny tests exist.
- Error mapping tests exist.
- Approval-gate tests exist for write-capable operations.

## Deployment

- Runtime env variable names are documented as placeholders only.
- Docker/network layout keeps connector internals private.
- Local and production config paths are clear.
- A smoke check is documented or automated.
