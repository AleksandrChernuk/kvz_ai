import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { verifyWorker } from "@/lib/worker-auth"
import { fireWebhook } from "@/lib/webhook"
import type { AgentType, Profile, TaskResult } from "@/types/database"

// POST /api/tasks/complete — оркестратор завершує задачу.
// complete_task (миграція 009) транзакційно: задача + assistant message
// + threads.updated_at. Тут залишається тільки webhook.
// Авторизація: WORKER_TOKEN.
export async function POST(req: Request) {
  if (!verifyWorker(req)) {
    return NextResponse.json({ error: "Невірний worker token" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const task_id = typeof body?.task_id === "string" ? body.task_id : ""
  const worker_id = typeof body?.worker_id === "string" ? body.worker_id : ""
  const result: TaskResult | null = body?.result ?? null
  const agent: AgentType | null = body?.agent ?? null

  if (!task_id || !worker_id || !result?.answer) {
    return NextResponse.json(
      { error: "task_id, worker_id, result.answer обовʼязкові" },
      { status: 400 }
    )
  }

  const supabase = createAdminClient()

  const { error: completeErr } = await supabase.rpc("complete_task", {
    p_task_id: task_id,
    p_worker_id: worker_id,
    p_result: result,
    p_agent: agent,
  })

  if (completeErr) {
    return NextResponse.json({ error: completeErr.message }, { status: 500 })
  }

  // Webhook — поза транзакцією, його провал не впливає на результат
  const { data: task } = await supabase
    .from("tasks")
    .select("user_id")
    .eq("id", task_id)
    .single<{ user_id: string }>()

  if (task) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("webhook_url")
      .eq("user_id", task.user_id)
      .single<Pick<Profile, "webhook_url">>()

    if (profile?.webhook_url) {
      await fireWebhook(profile.webhook_url, { task_id, result, agent })
    }
  }

  return NextResponse.json({ ok: true })
}
