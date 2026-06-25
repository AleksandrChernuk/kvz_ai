import { NextResponse } from "next/server"

import { apiError } from "@/lib/api-error"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { verifyWorker } from "@/lib/worker-auth"
import type { Profile, Run } from "@/types/database"

// GET /api/runs — список запусків (тільки admin)
export async function GET() {
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

  const { data, error } = await supabase
    .from("runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(100)
    .returns<Run[]>()

  if (error) {
    return apiError(error)
  }

  return NextResponse.json({ runs: data ?? [] })
}

// POST /api/runs — створити новий запуск (оркестратор).
// Авторизація: WORKER_TOKEN. RLS на runs не має insert-політики —
// інсерт можливий тільки через service role.
export async function POST(req: Request) {
  if (!verifyWorker(req)) {
    return NextResponse.json({ error: "Невірний worker token" }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("runs")
    .insert({ status: "active" })
    .select()
    .single<Run>()

  if (error || !data) {
    return apiError(error, 500, "Не вдалося створити run")
  }

  return NextResponse.json({ run: data })
}
