import { lookup } from "node:dns/promises"

// SSRF-захист вебхуків: webhook-URL задається користувачем, а fetch робить
// сервер. Три рівні: статична перевірка hostname → DNS resolve з перевіркою
// приватних діапазонів → redirect: "manual" (не слідуємо за редіректами).
// Опційний allowlist: env WEBHOOK_ALLOWED_HOSTS="hooks.slack.com,example.com"
// — якщо заданий, дозволені тільки ці хости та їх піддомени.

export function isPrivateAddress(ip: string): boolean {
  // IPv4
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(ip)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true // CGNAT
  // IPv6
  const v6 = ip.toLowerCase()
  if (v6 === "::1" || v6 === "::") return true
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true // ULA
  if (v6.startsWith("fe80")) return true // link-local
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7)) // mapped v4
  return false
}

// Статична перевірка URL — синхронна, без мережі (юніт-тестована)
export function isSafeWebhookUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }

  if (url.protocol !== "https:") return false

  const host = url.hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return false
  }
  // hostname вже є IP-адресою
  if (/^[\d.]+$/.test(host) || host.includes(":")) {
    return !isPrivateAddress(host.replace(/^\[|\]$/g, ""))
  }

  const allowlist = (process.env.WEBHOOK_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  if (allowlist.length > 0) {
    return allowlist.some((a) => host === a || host.endsWith("." + a))
  }

  return true
}

async function resolvesToPrivateIp(hostname: string): Promise<boolean> {
  try {
    const addrs = await lookup(hostname, { all: true })
    return addrs.some((a) => isPrivateAddress(a.address))
  } catch {
    return true // не резолвиться — не відправляємо
  }
}

export async function fireWebhook(url: string, payload: unknown): Promise<void> {
  if (!isSafeWebhookUrl(url)) return

  const hostname = new URL(url).hostname
  // DNS-перевірка пропускається для буквених IP (вже перевірені вище)
  if (!/^[\d.]+$/.test(hostname) && (await resolvesToPrivateIp(hostname))) {
    return
  }

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "manual", // redirect-to-internal не спрацює
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // Вебхук недоступний — не блокуємо основний потік
  }
}
