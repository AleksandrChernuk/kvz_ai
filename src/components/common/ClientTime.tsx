"use client"

import { useEffect, useState } from "react"

import { fmtTime } from "@/lib/task-meta"

// Дата/час залежать від часового поясу, тож SSR (UTC на Vercel) і браузер дають
// різний рядок → помилка гідрації. Рендеримо лише після монтування на клієнті.
export function ClientTime({ iso }: { iso: string }) {
  const [text, setText] = useState("")
  useEffect(() => {
    // навмисний клієнт-онлі формат (TZ-залежний) — поза гідрацією
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(fmtTime(iso))
  }, [iso])
  return <span suppressHydrationWarning>{text}</span>
}
