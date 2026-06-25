import type { MailType } from "@/types/database"
import type { UserRole } from "@/types/roles"

export const USER_ROLES: readonly UserRole[] = [
  "admin",
  "manager",
  "engineer",
  "viewer",
] as const

export const MAIL_TYPES: readonly MailType[] = [
  "worker_done",
  "worker_died",
  "escalation",
  "health_check",
  "dispatch",
  "info",
] as const

export function isUserRole(x: unknown): x is UserRole {
  return typeof x === "string" && (USER_ROLES as readonly string[]).includes(x)
}

export function isMailType(x: unknown): x is MailType {
  return typeof x === "string" && (MAIL_TYPES as readonly string[]).includes(x)
}

// Парсить масив ролей; null = невалідний вхід (повертати 400)
export function parseRoles(x: unknown): UserRole[] | null {
  if (!Array.isArray(x) || x.length === 0) return null
  const unique = [...new Set(x)]
  if (!unique.every(isUserRole)) return null
  return unique
}
