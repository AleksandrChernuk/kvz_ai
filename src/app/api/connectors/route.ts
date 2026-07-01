import { NextResponse } from "next/server"

import { apiError } from "@/lib/api-error"
import { hasFeature } from "@/lib/features"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isUserRole, parseRoles } from "@/lib/validate"
import { verifyWorker } from "@/lib/worker-auth"
import type { Connector, ConnectorRoleAccess, Profile } from "@/types/database"

// GET /api/connectors — конектори, доступні ролі юзера.
// Воркер з WORKER_TOKEN бачить усі увімкнені (для маршрутизації задач).
export async function GET(req: Request) {
  const roleParam = new URL(req.url).searchParams.get("role")

  if (verifyWorker(req)) {
    const admin = createAdminClient()

    if (roleParam) {
      if (!isUserRole(roleParam)) {
        return NextResponse.json({ error: "role невалідна" }, { status: 400 })
      }

      const { data: access, error: accessError } = await admin
        .from("connector_role_access")
        .select("connector_id")
        .eq("role", roleParam)
        .returns<Pick<ConnectorRoleAccess, "connector_id">[]>()

      if (accessError) {
        return apiError(accessError)
      }

      const ids = (access ?? []).map((row) => row.connector_id)
      if (ids.length === 0) {
        return NextResponse.json({ connectors: [] })
      }

      const { data, error } = await admin
        .from("connectors")
        .select("*")
        .in("id", ids)
        .eq("enabled", true)
        .order("name")
        .returns<Connector[]>()

      if (error) {
        return apiError(error)
      }

      return NextResponse.json({ connectors: data ?? [] })
    }

    const { data, error } = await admin
      .from("connectors")
      .select("*")
      .eq("enabled", true)
      .order("name")
      .returns<Connector[]>()
    if (error) {
      return apiError(error)
    }
    return NextResponse.json({ connectors: data ?? [] })
  }

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

  // Пікер у чаті — це список для використання, не екран управління. Тому навіть
  // адмін бачить лише увімкнені та привʼязані до його ролі конектори. Фільтруємо
  // явно, бо RLS-політика admin віддає адміну ВСІ рядки (в т.ч. вимкнені й
  // непривʼязані), і покладатися на неї тут не можна.
  const { data: access, error: accessError } = await supabase
    .from("connector_role_access")
    .select("connector_id")
    .eq("role", profile.role)
    .returns<Pick<ConnectorRoleAccess, "connector_id">[]>()

  if (accessError) {
    return apiError(accessError)
  }

  const ids = (access ?? []).map((row) => row.connector_id)
  if (ids.length === 0) {
    return NextResponse.json({ connectors: [] })
  }

  const { data, error } = await supabase
    .from("connectors")
    .select("*")
    .in("id", ids)
    .eq("enabled", true)
    .order("name")
    .returns<Connector[]>()

  if (error) {
    return apiError(error)
  }

  return NextResponse.json({ connectors: data ?? [] })
}

// POST /api/connectors — додати конектор.
// Гейт через role_features: потрібна фіча 'connectors_manage' (за сідом — тільки admin).
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

  if (!profile || !(await hasFeature(supabase, profile.role, "connectors_manage"))) {
    return NextResponse.json(
      { error: "Недостатньо прав (фіча connectors_manage)" },
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
    .rpc("create_connector_with_access", {
      p_name: name,
      p_mcp_server: mcp_server,
      p_description: description,
      p_mcp_config: body?.mcp_config ?? {},
      p_allowed_roles: allowed_roles,
    })
    .single<Connector>()

  if (error || !data) {
    return apiError(error, 500, "Не вдалося створити конектор")
  }

  return NextResponse.json({ connector: data })
}

// PATCH /api/connectors — admin: оновити конектор і звʼязки з ролями.
export async function PATCH(req: Request) {
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

  if (!profile || !(await hasFeature(supabase, profile.role, "connectors_manage"))) {
    return NextResponse.json(
      { error: "Недостатньо прав (фіча connectors_manage)" },
      { status: 403 }
    )
  }

  const body = await req.json().catch(() => null)
  const id = typeof body?.id === "string" ? body.id : ""
  if (!id) {
    return NextResponse.json({ error: "id обовʼязковий" }, { status: 400 })
  }

  let name: string | null = null
  let description: string | null = null
  let descriptionSet = false
  let enabled: boolean | null = null

  if (typeof body?.name === "string") {
    name = body.name.trim()
    if (!name) {
      return NextResponse.json({ error: "name не може бути порожнім" }, { status: 400 })
    }
  }

  if (body?.description === null || typeof body?.description === "string") {
    descriptionSet = true
    description =
      typeof body.description === "string" ? body.description.trim() || null : null
  }

  if (typeof body?.enabled === "boolean") {
    enabled = body.enabled
  }

  const allowedRoles =
    body?.allowed_roles === undefined ? undefined : parseRoles(body.allowed_roles)

  if (allowedRoles === null) {
    return NextResponse.json(
      { error: "allowed_roles має бути непорожнім масивом ролей" },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .rpc("update_connector_with_access", {
      p_id: id,
      p_name: name,
      p_description: description,
      p_description_set: descriptionSet,
      p_enabled: enabled,
      p_allowed_roles: allowedRoles ?? null,
    })
    .single<Connector>()

  if (error || !data) {
    return apiError(error, 500, "Не вдалося оновити конектор")
  }

  return NextResponse.json({ connector: data })
}
