import { afterEach, describe, expect, it } from "vitest"

import { verifyWorker } from "@/lib/worker-auth"

function req(headers: Record<string, string>): Request {
  return new Request("https://example.com/api/tasks/claim", {
    method: "POST",
    headers,
  })
}

describe("verifyWorker", () => {
  afterEach(() => {
    delete process.env.WORKER_TOKEN
  })

  it("відхиляє все, якщо WORKER_TOKEN не заданий в env", () => {
    expect(verifyWorker(req({ authorization: "Bearer anything" }))).toBe(false)
  })

  it("приймає правильний Bearer-токен", () => {
    process.env.WORKER_TOKEN = "secret123"
    expect(verifyWorker(req({ authorization: "Bearer secret123" }))).toBe(true)
  })

  it("приймає X-Worker-Token", () => {
    process.env.WORKER_TOKEN = "secret123"
    expect(verifyWorker(req({ "x-worker-token": "secret123" }))).toBe(true)
  })

  it("відхиляє невірний токен", () => {
    process.env.WORKER_TOKEN = "secret123"
    expect(verifyWorker(req({ authorization: "Bearer wrong" }))).toBe(false)
    expect(verifyWorker(req({ authorization: "Bearer secret1234" }))).toBe(false) // інша довжина
    expect(verifyWorker(req({}))).toBe(false)
  })
})
