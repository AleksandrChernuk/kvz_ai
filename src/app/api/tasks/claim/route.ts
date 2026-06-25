import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { verifyWorker } from "@/lib/worker-auth"
import type { Task } from "@/types/database"

// POST /api/tasks/claim — оркестратор атомарно захоплює наступну задачу.
// Авторизація: WORKER_TOKEN (Authorization: Bearer або X-Worker-Token).
export async function POST(req: Request) {
  if (!verifyWorker(req)) {
    return NextResponse.json({ error: "Невірний worker token" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const worker_id = typeof body?.worker_id === "string" ? body.worker_id.trim() : ""
  if (!worker_id) {
    return NextResponse.json({ error: "worker_id обовʼязковий" }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc("claim_next_task", {
    p_worker_id: worker_id,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = Array.isArray(data) ? (data as Task[]) : []
  const task = rows[0] ?? null
  return NextResponse.json({ task })
}
