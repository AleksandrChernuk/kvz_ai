import { NextResponse } from "next/server"

import { apiError } from "@/lib/api-error"

import { createAdminClient } from "@/lib/supabase/admin"
import { verifyWorker } from "@/lib/worker-auth"

// POST /api/tasks/fail — помилка виконання. retry=true повертає задачу
// в чергу з retry_count++; після max_retries — постійний failed.
// Авторизація: WORKER_TOKEN.
export async function POST(req: Request) {
  if (!verifyWorker(req)) {
    return NextResponse.json({ error: "Невірний worker token" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const task_id = typeof body?.task_id === "string" ? body.task_id : ""
  const worker_id = typeof body?.worker_id === "string" ? body.worker_id : ""
  const error_msg = typeof body?.error === "string" ? body.error : "Невідома помилка"
  const retry: boolean = body?.retry !== false

  if (!task_id || !worker_id) {
    return NextResponse.json(
      { error: "task_id, worker_id обовʼязкові" },
      { status: 400 }
    )
  }

  const supabase = createAdminClient()
  const { error } = await supabase.rpc("fail_task", {
    p_task_id: task_id,
    p_worker_id: worker_id,
    p_error: error_msg,
    p_retry: retry,
  })

  if (error) {
    return apiError(error)
  }

  return NextResponse.json({ ok: true })
}
