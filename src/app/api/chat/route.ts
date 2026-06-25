import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import {
  CHAT_ACTIVE_TASK_LIMIT,
  mapEnqueueChatTaskError,
} from "@/lib/limits"
import { generateThreadTitle } from "@/lib/title"
import type { Message, Profile, TaskPayload } from "@/types/database"

type EnqueueChatTaskRow = {
  message_id: string
  task_id: string
}

export async function POST(req: Request) {
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

  if (!profile) {
    return NextResponse.json({ error: "Профіль не знайдено" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const content = typeof body?.content === "string" ? body.content.trim() : ""
  const threadId = typeof body?.thread_id === "string" ? body.thread_id : ""

  if (!content) {
    return NextResponse.json({ error: "Порожнє повідомлення" }, { status: 400 })
  }
  if (!threadId) {
    return NextResponse.json({ error: "thread_id обовʼязковий" }, { status: 400 })
  }

  const { data: thread } = await supabase
    .from("threads")
    .select("id, title")
    .eq("id", threadId)
    .single<{ id: string; title: string | null }>()

  if (!thread) {
    return NextResponse.json({ error: "Тред не знайдено" }, { status: 404 })
  }

  // Останні 10 повідомлень як контекст
  const { data: prior } = await supabase
    .from("messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(10)
    .returns<Message[]>()

  const payload: TaskPayload = {
    user_message: content,
    user_role: profile.role,
    thread_context: (prior ?? []).reverse(),
    metadata: { timestamp: new Date().toISOString() },
  }

  const { data: rows, error: enqueueErr } = await createAdminClient()
    .rpc("enqueue_chat_task", {
      p_user_id: user.id,
      p_thread_id: threadId,
      p_content: content,
      p_payload: payload,
      p_title: thread.title ? null : generateThreadTitle(content),
      p_max_active: CHAT_ACTIVE_TASK_LIMIT,
    })
    .returns<EnqueueChatTaskRow[]>()

  const resultRows = Array.isArray(rows) ? rows : []

  if (enqueueErr || !resultRows[0]) {
    const mapped = mapEnqueueChatTaskError(enqueueErr?.message ?? "")
    return NextResponse.json({ error: mapped.error }, { status: mapped.status })
  }

  return NextResponse.json(resultRows[0])
}
