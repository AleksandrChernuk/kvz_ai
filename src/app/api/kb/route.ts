import { NextResponse } from "next/server"

import { hasFeature } from "@/lib/features"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { parseRoles } from "@/lib/validate"
import { verifyWorker } from "@/lib/worker-auth"
import type { KnowledgeBase, Profile } from "@/types/database"

// GET /api/kb — бази знань, доступні ролі юзера (RLS фільтрує сама).
// Воркер з WORKER_TOKEN бачить усі (для маршрутизації задач).
export async function GET(req: Request) {
  if (verifyWorker(req)) {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from("knowledge_bases")
      .select("*")
      .eq("enabled", true)
      .order("name")
      .returns<KnowledgeBase[]>()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ knowledge_bases: data ?? [] })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 })
  }

  const { data, error } = await supabase
    .from("knowledge_bases")
    .select("*")
    .order("name")
    .returns<KnowledgeBase[]>()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ knowledge_bases: data ?? [] })
}

// POST /api/kb — додати базу знань.
// Гейт через role_features: потрібна фіча 'kb_manage' (за сідом — тільки admin).
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

  if (!profile || !(await hasFeature(supabase, profile.role, "kb_manage"))) {
    return NextResponse.json(
      { error: "Недостатньо прав (фіча kb_manage)" },
      { status: 403 }
    )
  }

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === "string" ? body.name.trim() : ""
  const mcp_server = typeof body?.mcp_server === "string" ? body.mcp_server.trim() : ""
  const description = typeof body?.description === "string" ? body.description : null

  if (!name || !mcp_server) {
    return NextResponse.json(
      { error: "name, mcp_server обовʼязкові" },
      { status: 400 }
    )
  }

  // allowed_roles: якщо передано — має бути валідний непорожній масив ролей
  const allowed_roles =
    body?.allowed_roles === undefined
      ? (["admin", "manager", "engineer", "viewer"] as const)
      : parseRoles(body.allowed_roles)

  if (allowed_roles === null) {
    return NextResponse.json(
      { error: "allowed_roles має бути непорожнім масивом з ролей: admin, manager, engineer, viewer" },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from("knowledge_bases")
    .insert({
      name,
      mcp_server,
      description,
      allowed_roles,
      mcp_config: body?.mcp_config ?? {},
    })
    .select()
    .single<KnowledgeBase>()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Не вдалося створити базу знань" },
      { status: 500 }
    )
  }

  return NextResponse.json({ knowledge_base: data })
}
