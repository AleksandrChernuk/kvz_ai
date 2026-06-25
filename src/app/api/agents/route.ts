import { NextResponse } from "next/server"

import { apiError } from "@/lib/api-error"
import { isManagedAgent } from "@/lib/access"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { isUserRole } from "@/lib/validate"
import { verifyWorker } from "@/lib/worker-auth"
import type { AgentCatalogItem, Profile, RoleAgentAccess } from "@/types/database"

async function getProfileRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", userId)
    .single<Pick<Profile, "role">>()
  return data?.role ?? null
}

// GET /api/agents — агенти, доступні поточній ролі. Worker бачить усі enabled.
export async function GET(req: Request) {
  const roleParam = new URL(req.url).searchParams.get("role")

  if (verifyWorker(req)) {
    const admin = createAdminClient()

    if (roleParam) {
      if (!isUserRole(roleParam)) {
        return NextResponse.json({ error: "role невалідна" }, { status: 400 })
      }

      const { data: access, error: accessError } = await admin
        .from("role_agent_access")
        .select("agent")
        .eq("role", roleParam)
        .eq("enabled", true)
        .returns<Pick<RoleAgentAccess, "agent">[]>()

      if (accessError) {
        return apiError(accessError)
      }

      const keys = (access ?? []).map((row) => row.agent)
      if (keys.length === 0) {
        return NextResponse.json({ agents: [] })
      }

      const { data, error } = await admin
        .from("agents")
        .select("*")
        .in("key", keys)
        .eq("enabled", true)
        .order("name")
        .returns<AgentCatalogItem[]>()

      if (error) {
        return apiError(error)
      }

      return NextResponse.json({ agents: data ?? [] })
    }

    const { data, error } = await admin
      .from("agents")
      .select("*")
      .eq("enabled", true)
      .order("name")
      .returns<AgentCatalogItem[]>()

    if (error) {
      return apiError(error)
    }

    return NextResponse.json({ agents: data ?? [] })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 })
  }

  const role = await getProfileRole(supabase, user.id)
  if (!role) {
    return NextResponse.json({ error: "Профіль не знайдено" }, { status: 403 })
  }

  if (new URL(req.url).searchParams.get("scope") === "all") {
    if (role !== "admin") {
      return NextResponse.json({ error: "Лише для admin" }, { status: 403 })
    }

    const [{ data: agents, error: agentsError }, { data: access, error: accessError }] =
      await Promise.all([
        supabase.from("agents").select("*").order("name").returns<AgentCatalogItem[]>(),
        supabase
          .from("role_agent_access")
          .select("*")
          .order("agent")
          .returns<RoleAgentAccess[]>(),
      ])

    if (agentsError || accessError) {
      return apiError(agentsError ?? accessError, 500, "Не вдалося отримати агентів")
    }

    return NextResponse.json({ agents: agents ?? [], role_agent_access: access ?? [] })
  }

  const { data, error } = await supabase
    .from("role_agent_access")
    .select("agent")
    .eq("role", role)
    .eq("enabled", true)
    .returns<Pick<RoleAgentAccess, "agent">[]>()

  if (error) {
    return apiError(error)
  }

  const agentKeys = (data ?? []).map((row) => row.agent)
  if (agentKeys.length === 0) {
    return NextResponse.json({ agents: [] })
  }

  const { data: agents, error: agentsError } = await supabase
    .from("agents")
    .select("*")
    .in("key", agentKeys)
    .eq("enabled", true)
    .order("name")
    .returns<AgentCatalogItem[]>()

  if (agentsError) {
    return apiError(agentsError)
  }

  return NextResponse.json({ agents: agents ?? [] })
}

// PATCH /api/agents — admin: глобально вмикає агента або міняє доступ ролі.
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
  const agent = body?.agent
  const enabled = body?.enabled

  if (!isManagedAgent(agent) || typeof enabled !== "boolean") {
    return NextResponse.json(
      { error: "agent, enabled обовʼязкові" },
      { status: 400 }
    )
  }

  if (body?.role === undefined) {
    const { data, error } = await supabase
      .from("agents")
      .update({ enabled })
      .eq("key", agent)
      .select()
      .single<AgentCatalogItem>()

    if (error || !data) {
      return apiError(error, 500, "Не вдалося оновити агента")
    }

    return NextResponse.json({ agent: data })
  }

  const accessRole = body.role
  if (!isUserRole(accessRole)) {
    return NextResponse.json({ error: "role невалідна" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("role_agent_access")
    .upsert(
      { role: accessRole, agent, enabled },
      { onConflict: "role,agent" }
    )
    .select()
    .single<RoleAgentAccess>()

  if (error || !data) {
    return apiError(error, 500, "Не вдалося оновити доступ до агента")
  }

  return NextResponse.json({ role_agent_access: data })
}
