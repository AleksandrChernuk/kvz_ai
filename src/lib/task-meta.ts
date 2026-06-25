import type { AgentType, TaskStatus } from "@/types/database"

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Очікує",
  running: "Виконується",
  awaiting_approval: "Потребує підтвердження",
  done: "Готово",
  failed: "Помилка",
  cancelled: "Скасовано",
}

export const STATUS_VARIANTS: Record<
  TaskStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "outline",
  running: "secondary",
  awaiting_approval: "secondary",
  done: "default",
  failed: "destructive",
  cancelled: "outline",
}

export const AGENT_LABELS: Record<AgentType, string> = {
  codex: "Codex",
  search: "Пошук",
  drive: "Google Drive",
  bitrix: "Bitrix24",
  email: "Email",
  kb: "База знань",
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}
