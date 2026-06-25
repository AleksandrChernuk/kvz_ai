import { afterEach, describe, expect, it } from "vitest"

import { isPrivateAddress, isSafeWebhookUrl } from "@/lib/webhook"

describe("isPrivateAddress", () => {
  it("блокує loopback і приватні IPv4-діапазони", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true)
    expect(isPrivateAddress("10.0.0.5")).toBe(true)
    expect(isPrivateAddress("192.168.1.1")).toBe(true)
    expect(isPrivateAddress("172.16.0.1")).toBe(true)
    expect(isPrivateAddress("172.31.255.255")).toBe(true)
    expect(isPrivateAddress("169.254.169.254")).toBe(true) // cloud metadata
    expect(isPrivateAddress("100.64.0.1")).toBe(true) // CGNAT
  })

  it("пропускає публічні IPv4", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false)
    expect(isPrivateAddress("172.32.0.1")).toBe(false) // за межами 172.16-31
    expect(isPrivateAddress("101.0.0.1")).toBe(false)
  })

  it("блокує приватні IPv6", () => {
    expect(isPrivateAddress("::1")).toBe(true)
    expect(isPrivateAddress("fd12:3456::1")).toBe(true)
    expect(isPrivateAddress("fe80::1")).toBe(true)
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true) // mapped v4
  })
})

describe("isSafeWebhookUrl", () => {
  afterEach(() => {
    delete process.env.WEBHOOK_ALLOWED_HOSTS
  })

  it("вимагає https", () => {
    expect(isSafeWebhookUrl("http://example.com/hook")).toBe(false)
    expect(isSafeWebhookUrl("ftp://example.com")).toBe(false)
    expect(isSafeWebhookUrl("https://example.com/hook")).toBe(true)
  })

  it("блокує локальні хости", () => {
    expect(isSafeWebhookUrl("https://localhost/hook")).toBe(false)
    expect(isSafeWebhookUrl("https://api.local/hook")).toBe(false)
    expect(isSafeWebhookUrl("https://db.internal/hook")).toBe(false)
  })

  it("блокує приватні IP в hostname", () => {
    expect(isSafeWebhookUrl("https://127.0.0.1/hook")).toBe(false)
    expect(isSafeWebhookUrl("https://192.168.0.1/hook")).toBe(false)
    expect(isSafeWebhookUrl("https://169.254.169.254/latest/meta-data")).toBe(false)
  })

  it("відхиляє некоректні URL", () => {
    expect(isSafeWebhookUrl("not a url")).toBe(false)
    expect(isSafeWebhookUrl("")).toBe(false)
  })

  it("враховує allowlist якщо заданий", () => {
    process.env.WEBHOOK_ALLOWED_HOSTS = "hooks.slack.com,example.com"
    expect(isSafeWebhookUrl("https://hooks.slack.com/services/X")).toBe(true)
    expect(isSafeWebhookUrl("https://sub.example.com/hook")).toBe(true)
    expect(isSafeWebhookUrl("https://evil.com/hook")).toBe(false)
    // suffix-атака: notexample.com не має пройти
    expect(isSafeWebhookUrl("https://notexample.com/hook")).toBe(false)
  })
})
