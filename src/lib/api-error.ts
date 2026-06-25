import { NextResponse } from "next/server"

// Логуємо повну помилку на сервері, але клієнту віддаємо узагальнене
// повідомлення — щоб не світити внутрішні імена таблиць/функцій/колонок
// (CWE-209). Для очікуваних 4xx передавай свій user-facing текст у `message`.
export function apiError(
  detail: unknown,
  status = 500,
  message = "Внутрішня помилка"
) {
  const text =
    detail instanceof Error
      ? detail.message
      : typeof detail === "string"
        ? detail
        : JSON.stringify(detail)
  console.error("api_error", { status, detail: text })
  return NextResponse.json({ error: message }, { status })
}
