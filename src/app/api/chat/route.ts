import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import {
  CHAT_ACTIVE_TASK_LIMIT,
  mapEnqueueChatTaskError,
} from "@/lib/limits"
import { AGENT_CATALOG } from "@/lib/access"
import { generateThreadTitle } from "@/lib/title"
import type {
  AgentType,
  Connector,
  Message,
  Profile,
  TaskPayload,
} from "@/types/database"

type EnqueueChatTaskRow = {
  message_id: string
  task_id: string
}

function isRoutableChatAgent(value: unknown): value is AgentType {
  return (
    typeof value === "string" &&
    AGENT_CATALOG.some((agent) => agent.key === value)
  )
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
  const preferredAgent = body?.preferred_agent
  const preferredConnectorId =
    body?.preferred_connector_id === undefined
      ? undefined
      : typeof body.preferred_connector_id === "string"
        ? body.preferred_connector_id.trim()
        : ""

  if (!content) {
    return NextResponse.json({ error: "Порожнє повідомлення" }, { status: 400 })
  }
  if (!threadId) {
    return NextResponse.json({ error: "thread_id обовʼязковий" }, { status: 400 })
  }
  if (preferredAgent !== undefined && !isRoutableChatAgent(preferredAgent)) {
    return NextResponse.json({ error: "agent невалідний" }, { status: 400 })
  }
  if (preferredConnectorId === "") {
    return NextResponse.json({ error: "connector_id невалідний" }, { status: 400 })
  }
  const selectedAgent: AgentType | undefined = preferredAgent
  const admin = createAdminClient()

  const { data: thread } = await supabase
    .from("threads")
    .select("id, title")
    .eq("id", threadId)
    .single<{ id: string; title: string | null }>()

  if (!thread) {
    return NextResponse.json({ error: "Тред не знайдено" }, { status: 404 })
  }

  if (selectedAgent) {
    const { data: access } = await admin
      .from("role_agent_access")
      .select("agent")
      .eq("role", profile.role)
      .eq("agent", selectedAgent)
      .eq("enabled", true)
      .maybeSingle<{ agent: AgentType }>()

    if (!access) {
      return NextResponse.json(
        { error: "Агент недоступний для вашої ролі" },
        { status: 403 }
      )
    }
  }

  let selectedConnector: TaskPayload["preferred_connector"] | undefined

  if (preferredConnectorId) {
    const { data: connectorAccess } = await admin
      .from("connector_role_access")
      .select("connector_id")
      .eq("role", profile.role)
      .eq("connector_id", preferredConnectorId)
      .maybeSingle<{ connector_id: string }>()

    if (!connectorAccess) {
      return NextResponse.json(
        { error: "MCP-конектор недоступний для вашої ролі" },
        { status: 403 }
      )
    }

    const { data: connector } = await admin
      .from("connectors")
      .select("*")
      .eq("id", preferredConnectorId)
      .eq("enabled", true)
      .maybeSingle<Connector>()

    if (!connector) {
      return NextResponse.json(
        { error: "MCP-конектор недоступний" },
        { status: 403 }
      )
    }

    selectedConnector = {
      id: connector.id,
      name: connector.name,
      description: connector.description,
      mcp_server: connector.mcp_server,
      library:
        typeof connector.mcp_config.library === "string"
          ? connector.mcp_config.library
          : null,
    }
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
    preferred_agent: selectedAgent,
    preferred_connector: selectedConnector,
    thread_context: (prior ?? []).reverse(),
    metadata: {
      timestamp: new Date().toISOString(),
      preferred_agent: selectedAgent ?? "auto",
      preferred_connector_id: selectedConnector?.id ?? "auto",
    },
  }

  const { data: rows, error: enqueueErr } = await admin
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
