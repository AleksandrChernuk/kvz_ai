// Output redaction — strip secret-shaped tokens from returned text so a
// document that accidentally contains a key/token does not leak through search
// results (connector-standard: output redaction).

const PATTERNS: RegExp[] = [
  // Anthropic / OpenAI style keys
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  // Generic bearer / long hex / base64-ish secrets
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi,
  /\b[A-Fa-f0-9]{32,}\b/g,
  // JWT
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
]

export function redact(text: string): string {
  let out = text
  for (const re of PATTERNS) out = out.replace(re, "[REDACTED]")
  return out
}
