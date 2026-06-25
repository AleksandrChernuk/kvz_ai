import { timingSafeEqual } from "node:crypto"

// Перевіряє shared-secret токен воркера (оркестратора на VPS).
// Заголовок: Authorization: Bearer <WORKER_TOKEN> або X-Worker-Token.
// Якщо WORKER_TOKEN не заданий в env — усі worker-запити відхиляються.
export function verifyWorker(req: Request): boolean {
  const expected = process.env.WORKER_TOKEN
  if (!expected) return false

  const auth = req.headers.get("authorization")
  const provided = auth?.startsWith("Bearer ")
    ? auth.slice(7)
    : req.headers.get("x-worker-token")

  if (!provided) return false

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
