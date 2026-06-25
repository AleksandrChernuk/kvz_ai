import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import {
  MAX_WATCHDOG_TIMEOUT_MINUTES,
  MIN_WATCHDOG_TIMEOUT_MINUTES,
  parseWatchdogTimeoutMinutes,
} from "@/lib/limits"
import { verifyWorker } from "@/lib/worker-auth"
import type { Profile } from "@/types/database"

// POST /api/tasks/watchdog — звільнити завислі задачі (locked > N хв).
// Авторизація: WORKER_TOKEN (для cron) або admin-сесія (кнопка в UI).
export async function POST(req: Request) {
  if (!verifyWorker(req)) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single<Pick<Profile, "role">>()

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Лише для admin" }, { status: 403 })
    }
  }

  const body = await req.json().catch(() => ({}))
  const timeout_minutes = parseWatchdogTimeoutMinutes(body?.timeout_minutes)

  if (timeout_minutes === null) {
    return NextResponse.json(
      {
        error: `timeout_minutes має бути цілим числом від ${MIN_WATCHDOG_TIMEOUT_MINUTES} до ${MAX_WATCHDOG_TIMEOUT_MINUTES}`,
      },
      { status: 400 }
    )
  }

  // RPC недоступний для anon/authenticated — виконуємо через service role
  const admin = createAdminClient()
  const { data, error } = await admin.rpc("release_stale_locks", {
    p_timeout_minutes: timeout_minutes,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ released: typeof data === "number" ? data : 0 })
}
