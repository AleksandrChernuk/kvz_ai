export const CHAT_ACTIVE_TASK_LIMIT = 5

export const DEFAULT_WATCHDOG_TIMEOUT_MINUTES = 5
export const MIN_WATCHDOG_TIMEOUT_MINUTES = 1
export const MAX_WATCHDOG_TIMEOUT_MINUTES = 60

export function parseWatchdogTimeoutMinutes(value: unknown): number | null {
  const timeout =
    typeof value === "number" ? value : DEFAULT_WATCHDOG_TIMEOUT_MINUTES

  if (
    !Number.isInteger(timeout) ||
    timeout < MIN_WATCHDOG_TIMEOUT_MINUTES ||
    timeout > MAX_WATCHDOG_TIMEOUT_MINUTES
  ) {
    return null
  }

  return timeout
}

export function mapEnqueueChatTaskError(message: string): {
  error: string
  status: number
} {
  if (message.includes("ACTIVE_TASK_LIMIT_EXCEEDED")) {
    return {
      error: "Забагато активних задач. Зачекайте завершення попередніх.",
      status: 429,
    }
  }

  if (message.includes("THREAD_NOT_FOUND")) {
    return { error: "Тред не знайдено", status: 404 }
  }

  if (message.includes("EMPTY_CONTENT")) {
    return { error: "Порожнє повідомлення", status: 400 }
  }

  if (message.includes("INVALID_ACTIVE_TASK_LIMIT")) {
    return {
      error: "Сервіс тимчасово недоступний, спробуйте за хвилину",
      status: 503,
    }
  }

  return { error: message || "Не вдалося створити задачу", status: 500 }
}
