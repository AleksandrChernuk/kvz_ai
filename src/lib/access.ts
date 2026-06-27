import type { AgentType, RoleFeature } from "@/types/database"
import type { UserRole } from "@/types/roles"
import { USER_ROLES } from "@/lib/validate"

export const ACCESS_ROLES = USER_ROLES

export const FEATURE_CATALOG = [
  {
    key: "training",
    label: "Навчання",
    group: "core",
  },
  {
    key: "kb_manage",
    label: "Керування KB",
    group: "core",
  },
  {
    key: "export",
    label: "Експорт",
    group: "core",
  },
] as const

export const AGENT_CATALOG = [
  {
    key: "codex",
    label: "Codex",
  },
  {
    key: "search",
    label: "Пошук",
  },
  {
    key: "drive",
    label: "Google Drive",
  },
  {
    key: "bitrix",
    label: "Bitrix24",
  },
  {
    key: "email",
    label: "Email",
  },
  {
    key: "kb",
    label: "Бази знань",
  },
] as const

export type ManagedFeature = (typeof FEATURE_CATALOG)[number]["key"]
export type FeatureGroup = (typeof FEATURE_CATALOG)[number]["group"]

export const MANAGED_FEATURES = FEATURE_CATALOG.map((feature) => feature.key)

export function isManagedFeature(value: unknown): value is ManagedFeature {
  return (
    typeof value === "string" &&
    (MANAGED_FEATURES as readonly string[]).includes(value)
  )
}

export function getFeaturesByGroup(group: FeatureGroup) {
  return FEATURE_CATALOG.filter((feature) => feature.group === group)
}

// Не маршрутизований агент: «orchestrated» — це маркер синтезу (мозок звів
// кілька під-результатів), а не виконавець, яким керує матриця доступів. Тому
// він не входить до AGENT_CATALOG (доступ не налаштовується), але є валідним
// значенням agent у complete_task.
export const RESULT_ONLY_AGENTS = ["orchestrated"] as const

export function isManagedAgent(value: unknown): value is AgentType {
  return (
    typeof value === "string" &&
    (AGENT_CATALOG.some((agent) => agent.key === value) ||
      (RESULT_ONLY_AGENTS as readonly string[]).includes(value))
  )
}

export function buildFeatureMatrix(rows: RoleFeature[]) {
  const matrix = Object.fromEntries(
    FEATURE_CATALOG.map((feature) => [
      feature.key,
      Object.fromEntries(ACCESS_ROLES.map((role) => [role, false])) as Record<
        UserRole,
        boolean
      >,
    ])
  ) as Record<ManagedFeature, Record<UserRole, boolean>>

  for (const row of rows) {
    if (isManagedFeature(row.feature)) {
      matrix[row.feature][row.role] = row.enabled
    }
  }

  return matrix
}
