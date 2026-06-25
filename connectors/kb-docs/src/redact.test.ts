import { describe, expect, it } from "vitest"

import { redact } from "./redact.js"

describe("redact", () => {
  it("strips secret-shaped tokens from output", () => {
    expect(redact("key sk-ant-abcdefghijklmnopqrstuvwxyz here")).toContain("[REDACTED]")
    expect(redact("Authorization: Bearer abcdef0123456789abcdef")).toContain("[REDACTED]")
    expect(redact("hash 0123456789abcdef0123456789abcdef")).toContain("[REDACTED]")
  })

  it("leaves normal text untouched", () => {
    const text = "Робоча точка визначається тиском та продуктивністю."
    expect(redact(text)).toBe(text)
  })
})
