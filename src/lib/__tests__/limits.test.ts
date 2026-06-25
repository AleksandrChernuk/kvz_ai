import { describe, expect, it } from "vitest"

import {
  DEFAULT_WATCHDOG_TIMEOUT_MINUTES,
  mapEnqueueChatTaskError,
  parseWatchdogTimeoutMinutes,
} from "@/lib/limits"

describe("parseWatchdogTimeoutMinutes", () => {
  it("повертає дефолт, якщо значення не задане або не число", () => {
    expect(parseWatchdogTimeoutMinutes(undefined)).toBe(
      DEFAULT_WATCHDOG_TIMEOUT_MINUTES
    )
    expect(parseWatchdogTimeoutMinutes("5")).toBe(
      DEFAULT_WATCHDOG_TIMEOUT_MINUTES
    )
  })

  it("приймає цілі хвилини в дозволених межах", () => {
    expect(parseWatchdogTimeoutMinutes(1)).toBe(1)
    expect(parseWatchdogTimeoutMinutes(5)).toBe(5)
    expect(parseWatchdogTimeoutMinutes(60)).toBe(60)
  })

  it("відхиляє небезпечні або нецілі значення", () => {
    expect(parseWatchdogTimeoutMinutes(0)).toBeNull()
    expect(parseWatchdogTimeoutMinutes(-5)).toBeNull()
    expect(parseWatchdogTimeoutMinutes(1.5)).toBeNull()
    expect(parseWatchdogTimeoutMinutes(61)).toBeNull()
  })
})

describe("mapEnqueueChatTaskError", () => {
  it("мапить відомі RPC помилки у стабільні HTTP статуси", () => {
    expect(mapEnqueueChatTaskError("ACTIVE_TASK_LIMIT_EXCEEDED").status).toBe(
      429
    )
    expect(mapEnqueueChatTaskError("THREAD_NOT_FOUND").status).toBe(404)
    expect(mapEnqueueChatTaskError("EMPTY_CONTENT").status).toBe(400)
    expect(mapEnqueueChatTaskError("INVALID_ACTIVE_TASK_LIMIT").status).toBe(
      503
    )
  })

  it("для невідомої помилки повертає 500", () => {
    expect(mapEnqueueChatTaskError("database is down")).toEqual({
      error: "database is down",
      status: 500,
    })
  })
})
