import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { verifyWorker } from "@/lib/worker-auth"
import type { TaskCheckpoint } from "@/types/database"

// POST /api/tasks/checkpoint — проміжний прогрес для crash recovery.
// Авторизація: WORKER_TOKEN.
export async function POST(req: Request) {
  if (!verifyWorker(req)) {
    return NextResponse.json({ error: "Невірний worker token" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const task_id = typeof body?.task_id === "string" ? body.task_id : ""
  const worker_id = typeof body?.worker_id === "string" ? body.worker_id : ""
  const checkpoint: TaskCheckpoint | null = body?.checkpoint ?? null

  if (!task_id || !worker_id || !checkpoint) {
    return NextResponse.json(
      { error: "task_id, worker_id, checkpoint обовʼязкові" },
      { status: 400 }
    )
  }

  const supabase = createAdminClient()
  const { error } = await supabase.rpc("save_checkpoint", {
    p_task_id: task_id,
    p_worker_id: worker_id,
    p_checkpoint: { ...checkpoint, saved_at: new Date().toISOString() },
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
