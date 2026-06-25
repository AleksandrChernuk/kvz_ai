import { NextResponse } from "next/server"

import { apiError } from "@/lib/api-error"

import { createAdminClient } from "@/lib/supabase/admin"
import { verifyWorker } from "@/lib/worker-auth"
import type { TaskResult } from "@/types/database"

// POST /api/tasks/request-approval — воркер ставить задачу на підтвердження
// людини перед незворотною дією. Викликається ПІСЛЯ детермінованого фільтра,
// з прев'ю результату. request_approval (миграція 011) перевіряє лок і
// переводить задачу в awaiting_approval.
// Авторизація: WORKER_TOKEN.
export async function POST(req: Request) {
  if (!verifyWorker(req)) {
    return NextResponse.json({ error: "Невірний worker token" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const task_id = typeof body?.task_id === "string" ? body.task_id : ""
  const worker_id = typeof body?.worker_id === "string" ? body.worker_id : ""
  const result: TaskResult | null = body?.result ?? null

  if (!task_id || !worker_id || !result?.answer) {
    return NextResponse.json(
      { error: "task_id, worker_id, result.answer обовʼязкові" },
      { status: 400 }
    )
  }

  const supabase = createAdminClient()

  const { error } = await supabase.rpc("request_approval", {
    p_task_id: task_id,
    p_worker_id: worker_id,
    p_result: result,
  })

  if (error) {
    return apiError(error)
  }

  return NextResponse.json({ ok: true })
}
