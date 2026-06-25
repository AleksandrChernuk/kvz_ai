import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

// Людина відхиляє задачу, що очікує дозволу. reject_task() завершує її як
// cancelled з причиною (за наявності).
export async function POST(
  req: Request,
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

  let reason: string | null = null
  try {
    const body = await req.json()
    if (typeof body?.reason === "string") reason = body.reason.slice(0, 500)
  } catch {
    // тіло необов'язкове
  }

  const { error } = await supabase.rpc("reject_task", {
    p_task_id: taskId,
    p_reason: reason,
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
