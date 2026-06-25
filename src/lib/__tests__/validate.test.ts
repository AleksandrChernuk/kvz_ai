import { describe, expect, it } from "vitest"

import { isMailType, isUserRole, parseRoles } from "@/lib/validate"

describe("isUserRole", () => {
  it("приймає валідні ролі", () => {
    expect(isUserRole("admin")).toBe(true)
    expect(isUserRole("viewer")).toBe(true)
  })
  it("відхиляє все інше", () => {
    expect(isUserRole("superadmin")).toBe(false)
    expect(isUserRole("")).toBe(false)
    expect(isUserRole(null)).toBe(false)
    expect(isUserRole(42)).toBe(false)
  })
})

describe("isMailType", () => {
  it("приймає валідні типи", () => {
    expect(isMailType("worker_done")).toBe(true)
    expect(isMailType("escalation")).toBe(true)
    expect(isMailType("info")).toBe(true)
  })
  it("відхиляє невалідні", () => {
    expect(isMailType("spam")).toBe(false)
    expect(isMailType(undefined)).toBe(false)
  })
})

describe("parseRoles", () => {
  it("парсить валідний масив, прибираючи дублікати", () => {
    expect(parseRoles(["admin", "viewer", "admin"])).toEqual(["admin", "viewer"])
  })
  it("повертає null для невалідного входу", () => {
    expect(parseRoles([])).toBeNull()
    expect(parseRoles(["admin", "hacker"])).toBeNull()
    expect(parseRoles("admin")).toBeNull()
    expect(parseRoles(undefined)).toBeNull()
  })
})
