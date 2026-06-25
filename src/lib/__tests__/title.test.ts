import { describe, expect, it } from "vitest"

import { generateThreadTitle } from "@/lib/title"

describe("generateThreadTitle", () => {
  it("повертає коротке повідомлення як є", () => {
    expect(generateThreadTitle("Порахуй бюджет")).toBe("Порахуй бюджет")
  })

  it("нормалізує пробіли", () => {
    expect(generateThreadTitle("  багато   пробілів  ")).toBe("багато пробілів")
  })

  it("обрізає довге повідомлення по межі слова з трикрапкою", () => {
    const long =
      "Порахуй будь ласка бюджет проєкту за другий квартал з урахуванням перевитрат"
    const title = generateThreadTitle(long)
    expect(title.length).toBeLessThanOrEqual(41) // 40 + "…"
    expect(title.endsWith("…")).toBe(true)
    expect(title).not.toMatch(/\s…$/) // без обрізаного півслова з пробілом
  })
})
