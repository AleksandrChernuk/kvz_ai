import { NextResponse } from "next/server"

import { apiError } from "@/lib/api-error"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { isMailType, MAIL_TYPES } from "@/lib/validate"
import { verifyWorker } from "@/lib/worker-auth"
import type { AgentMail, MailType, Profile } from "@/types/database"

// GET /api/mail?agent=<name> — непрочитана пошта.
// Авторизація: WORKER_TOKEN (агенти читають свою пошту) або admin-сесія.
export async function GET(req: Request) {
  const isWorker = verifyWorker(req)

  if (!isWorker) {
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
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Лише для admin" }, { status: 403 })
    }
  }

  const agent = new URL(req.url).searchParams.get("agent") ?? ""
  // agent потрапляє у фільтр запиту — валідуємо charset, щоб виключити
  // ін'єкцію в граматику PostgREST-фільтра (кома/дужки/оператори).
  if (agent && !/^[a-z0-9_@-]{1,64}$/i.test(agent)) {
    return NextResponse.json({ error: "Невалідний agent" }, { status: 400 })
  }

  const supabase = createAdminClient()
  let query = supabase
    .from("agent_mail")
    .select("*")
    .is("read_at", null)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })

  if (agent) {
    // .in() параметризує значення — не можна вийти в граматику операторів
    query = query.in("to_agent", [agent, "@all"])
  }

  const { data, error } = await query.returns<AgentMail[]>()

  if (error) {
    return apiError(error)
  }

  return NextResponse.json({ mail: data ?? [] })
}

// POST /api/mail — надіслати повідомлення між агентами.
// Авторизація: WORKER_TOKEN (пошта — канал агентів, не юзерів).
export async function POST(req: Request) {
  if (!verifyWorker(req)) {
    return NextResponse.json({ error: "Невірний worker token" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const from_agent = typeof body?.from_agent === "string" ? body.from_agent : ""
  const to_agent = typeof body?.to_agent === "string" ? body.to_agent : ""
  const subject = typeof body?.subject === "string" ? body.subject : ""
  const mail_body = typeof body?.body === "string" ? body.body : ""
  const priority: number = typeof body?.priority === "number" ? body.priority : 0
  const task_id: string | null = body?.task_id ?? null
  const run_id: string | null = body?.run_id ?? null

  if (!from_agent || !to_agent || !subject || !mail_body) {
    return NextResponse.json(
      { error: "from_agent, to_agent, subject, body обовʼязкові" },
      { status: 400 }
    )
  }

  const type: MailType = body?.type === undefined ? "info" : body.type
  if (!isMailType(type)) {
    return NextResponse.json(
      { error: `Невалідний type. Допустимі: ${MAIL_TYPES.join(", ")}` },
      { status: 400 }
    )
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc("send_mail", {
    p_from: from_agent,
    p_to: to_agent,
    p_subject: subject,
    p_body: mail_body,
    p_type: type,
    p_priority: priority,
    p_task_id: task_id,
    p_run_id: run_id,
  })

  if (error) {
    return apiError(error)
  }

  return NextResponse.json({ id: data })
}

// PATCH /api/mail — позначити пошту агента як прочитану.
// Авторизація: WORKER_TOKEN.
export async function PATCH(req: Request) {
  if (!verifyWorker(req)) {
    return NextResponse.json({ error: "Невірний worker token" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const agent = typeof body?.agent === "string" ? body.agent : ""
  if (!agent) {
    return NextResponse.json({ error: "agent обовʼязковий" }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc("mark_mail_read", {
    p_agent: agent,
  })

  if (error) {
    return apiError(error)
  }

  return NextResponse.json({ marked: typeof data === "number" ? data : 0 })
}
