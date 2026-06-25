import { NextResponse } from "next/server"

import { apiError } from "@/lib/api-error"

import { createClient } from "@/lib/supabase/server"

// Людина підтверджує задачу, що очікує дозволу перед незворотною дією.
// approve_task() (security definer) перевіряє власника/admin і повертає
// задачу в чергу з відміткою approved_at.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 })
  }

  const { error } = await supabase.rpc("approve_task", { p_task_id: taskId })
  if (error) {
    return apiError(error, 400, "Не вдалося підтвердити задачу")
  }

  return NextResponse.json({ ok: true })
}
