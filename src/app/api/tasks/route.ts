import { NextResponse } from "next/server"

import { apiError } from "@/lib/api-error"
import { getProfileRole } from "@/lib/get-profile-role"
import { createClient } from "@/lib/supabase/server"
import type { Profile, Task } from "@/types/database"

// GET — задачі поточного юзера (або всі для admin)
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 })
  }

  const role = await getProfileRole(supabase, user.id)

  let query = supabase
    .from("tasks")
    .select("*")
    .order("created_at", { ascending: false })

  if (role !== "admin") {
    query = query.eq("user_id", user.id)
  }

  const { data, error } = await query.returns<Task[]>()
  if (error) {
    return apiError(error)
  }

  return NextResponse.json({ tasks: data ?? [] })
}

// PATCH — admin: скасувати задачу або змінити пріоритет
export async function PATCH(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 })
  }

  const role = await getProfileRole(supabase, user.id)
  if (role !== "admin") {
    return NextResponse.json({ error: "Лише для admin" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const id = typeof body?.id === "string" ? body.id : ""
  if (!id) {
    return NextResponse.json({ error: "id обовʼязковий" }, { status: 400 })
  }

  // Скасування: чистимо lock, щоб задача не виглядала захопленою
  if (body?.action === "cancel" || body?.status === "cancelled") {
    const { error } = await supabase
      .from("tasks")
      .update({
        status: "cancelled",
        locked_at: null,
        locked_by: null,
        error: "Скасовано адміністратором",
      })
      .eq("id", id)
    if (error) {
      return apiError(error)
    }
    return NextResponse.json({ ok: true })
  }

  // Зміна пріоритету
  if (typeof body?.priority === "number") {
    const priority = Math.max(0, Math.min(100, body.priority))
    const { error } = await supabase
      .from("tasks")
      .update({ priority })
      .eq("id", id)
      .in("status", ["pending", "running"])
    if (error) {
      return apiError(error)
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "Невідома дія" }, { status: 400 })
}
