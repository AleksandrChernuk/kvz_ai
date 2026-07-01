import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import type {
  AgentCatalogItem,
  Connector,
  ConnectorRoleAccess,
  Profile,
  RoleAgentAccess,
  RoleFeature,
} from "@/types/database"
import { AccessManager } from "@/components/access/AccessManager"

export default async function AccessPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single<Pick<Profile, "role">>()

  if (profile?.role !== "admin") {
    redirect("/chat")
  }

  const [
    agentsResult,
    roleAgentAccessResult,
    connectorsResult,
    connectorRoleAccessResult,
    roleFeaturesResult,
  ] = await Promise.all([
    supabase.from("agents").select("*").order("name").returns<AgentCatalogItem[]>(),
    supabase
      .from("role_agent_access")
      .select("*")
      .order("agent")
      .returns<RoleAgentAccess[]>(),
    supabase
      .from("connectors")
      .select("*")
      .order("name")
      .returns<Connector[]>(),
    supabase
      .from("connector_role_access")
      .select("*")
      .returns<ConnectorRoleAccess[]>(),
    supabase
      .from("role_features")
      .select("*")
      .order("feature")
      .returns<RoleFeature[]>(),
  ])

  const error =
    agentsResult.error ??
    roleAgentAccessResult.error ??
    connectorsResult.error ??
    connectorRoleAccessResult.error ??
    roleFeaturesResult.error

  if (error) {
    return (
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h1 className="text-xl font-semibold">Доступи</h1>
        <p className="text-sm text-destructive">Не вдалося завантажити матрицю доступів.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
      <div>
        <h1 className="text-xl font-semibold">Доступи</h1>
        <p className="text-sm text-muted-foreground">
          Ролі, агенти, MCP/KB сервіси та функції інтерфейсу.
        </p>
      </div>
      <AccessManager
        initialAgents={agentsResult.data ?? []}
        initialRoleAgentAccess={roleAgentAccessResult.data ?? []}
        initialConnectors={connectorsResult.data ?? []}
        initialConnectorRoleAccess={connectorRoleAccessResult.data ?? []}
        initialRoleFeatures={roleFeaturesResult.data ?? []}
      />
    </div>
  )
}
