import { NextResponse } from "next/server"

import { apiError } from "@/lib/api-error"
import { createClient } from "@/lib/supabase/server"

// Створити новий тред для поточного юзера.
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 })
  }

  const { data, error } = await supabase
    .from("threads")
    .insert({ user_id: user.id })
    .select("id")
    .single<{ id: string }>()

  if (error || !data) {
    return apiError(error, 500, "Не вдалося створити чат")
  }

  return NextResponse.json({ id: data.id })
}

// Видалити тред (RLS гарантує, що тільки власник).
export async function DELETE(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 })
  }

  const id = new URL(req.url).searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "id обовʼязковий" }, { status: 400 })
  }

  const { error } = await supabase.rpc("delete_thread_safely", {
    p_thread_id: id,
  })

  if (error) {
    const message = error.message.includes("has active tasks")
      ? "Неможливо видалити чат з активними задачами"
      : "Не вдалося видалити чат"
    return apiError(error, 409, message)
  }

  return NextResponse.json({ ok: true })
}
