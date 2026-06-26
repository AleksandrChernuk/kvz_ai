// Генерує короткий заголовок треду з першого повідомлення (детермінований
// зріз, без LLM — заголовок не вартий виклику моделі).
export function generateThreadTitle(message: string): string {
  const cleaned = message.replace(/\s+/g, " ").trim()
  if (cleaned.length <= 40) return cleaned
  // Обрізаємо по останньому пробілу в межах 40 символів
  const cut = cleaned.slice(0, 40)
  const lastSpace = cut.lastIndexOf(" ")
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + "…"
}
