"use client"

import { useMemo, useState } from "react"
import { Bot, Check, Database, Minus, SlidersHorizontal } from "lucide-react"
import { toast } from "sonner"

import { ACCESS_ROLES, FEATURE_CATALOG } from "@/lib/access"
import type {
  AgentCatalogItem,
  AgentType,
  Connector,
  ConnectorRoleAccess,
  RoleAgentAccess,
  RoleFeature,
} from "@/types/database"
import type { UserRole } from "@/types/roles"
import { ROLE_LABELS } from "@/types/roles"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type Props = {
  initialAgents: AgentCatalogItem[]
  initialRoleAgentAccess: RoleAgentAccess[]
  initialConnectors: Connector[]
  initialConnectorRoleAccess: ConnectorRoleAccess[]
  initialRoleFeatures: RoleFeature[]
}

function roleCellLabel(role: UserRole) {
  return ROLE_LABELS[role]
}

function AccessButton({
  enabled,
  onClick,
  disabled,
}: {
  enabled: boolean
  onClick: () => void
  disabled?: boolean
}) {
  const Icon = enabled ? Check : Minus
  return (
    <Button
      type="button"
      variant={enabled ? "default" : "outline"}
      size="icon-sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={enabled ? "Доступ увімкнено" : "Доступ вимкнено"}
      title={enabled ? "Доступ увімкнено" : "Доступ вимкнено"}
    >
      <Icon className="size-4" />
    </Button>
  )
}

function upsertAgentAccess(
  rows: RoleAgentAccess[],
  next: RoleAgentAccess
) {
  const found = rows.some(
    (row) => row.role === next.role && row.agent === next.agent
  )
  if (!found) return [...rows, next]
  return rows.map((row) =>
    row.role === next.role && row.agent === next.agent ? next : row
  )
}

function upsertRoleFeature(rows: RoleFeature[], next: RoleFeature) {
  const found = rows.some(
    (row) => row.role === next.role && row.feature === next.feature
  )
  if (!found) return [...rows, next]
  return rows.map((row) =>
    row.role === next.role && row.feature === next.feature ? next : row
  )
}

export function AccessManager({
  initialAgents,
  initialRoleAgentAccess,
  initialConnectors,
  initialConnectorRoleAccess,
  initialRoleFeatures,
}: Props) {
  const [agents, setAgents] = useState(initialAgents)
  const [roleAgentAccess, setRoleAgentAccess] = useState(initialRoleAgentAccess)
  const [connectors, setConnectors] = useState(initialConnectors)
  const [connectorRoleAccess, setConnectorRoleAccess] = useState(
    initialConnectorRoleAccess
  )
  const [roleFeatures, setRoleFeatures] = useState(initialRoleFeatures)
  const [loadingKey, setLoadingKey] = useState<string | null>(null)

  const connectorRoles = useMemo(() => {
    const map = new Map<string, Set<UserRole>>()
    for (const connector of connectors) {
      map.set(connector.id, new Set(connector.allowed_roles))
    }
    for (const row of connectorRoleAccess) {
      const roles = map.get(row.connector_id) ?? new Set<UserRole>()
      roles.add(row.role)
      map.set(row.connector_id, roles)
    }
    return map
  }, [connectors, connectorRoleAccess])

  function hasAgentAccess(agent: AgentType, role: UserRole) {
    return (
      roleAgentAccess.find((row) => row.agent === agent && row.role === role)
        ?.enabled ?? false
    )
  }

  function hasFeature(feature: string, role: UserRole) {
    return (
      roleFeatures.find((row) => row.feature === feature && row.role === role)
        ?.enabled ?? false
    )
  }

  async function toggleAgent(agent: AgentCatalogItem) {
    const key = `agent:${agent.key}:enabled`
    setLoadingKey(key)
    try {
      const res = await fetch("/api/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: agent.key, enabled: !agent.enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAgents((current) =>
        current.map((item) => (item.key === agent.key ? data.agent : item))
      )
    } catch (error) {
      toast.error("Не вдалося оновити агента", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoadingKey(null)
    }
  }

  async function toggleAgentRole(agent: AgentType, role: UserRole) {
    const enabled = !hasAgentAccess(agent, role)
    const key = `agent:${agent}:${role}`
    setLoadingKey(key)
    try {
      const res = await fetch("/api/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, role, enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setRoleAgentAccess((current) =>
        upsertAgentAccess(current, data.role_agent_access)
      )
    } catch (error) {
      toast.error("Не вдалося оновити доступ до агента", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoadingKey(null)
    }
  }

  function upsertConnectorAccess(
    rows: ConnectorRoleAccess[],
    connectorId: string,
    roles: UserRole[]
  ) {
    return [
      ...rows.filter((row) => row.connector_id !== connectorId),
      ...roles.map((role) => ({
        connector_id: connectorId,
        role,
        created_at: new Date().toISOString(),
      })),
    ]
  }

  async function toggleConnector(connector: Connector) {
    const key = `connector:${connector.id}:enabled`
    setLoadingKey(key)
    try {
      const res = await fetch("/api/connectors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: connector.id, enabled: !connector.enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setConnectors((current) =>
        current.map((item) => (item.id === connector.id ? data.connector : item))
      )
    } catch (error) {
      toast.error("Не вдалося оновити конектор", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoadingKey(null)
    }
  }

  async function toggleConnectorRole(connector: Connector, role: UserRole) {
    const roles = new Set(connectorRoles.get(connector.id) ?? [])
    if (roles.has(role)) {
      roles.delete(role)
    } else {
      roles.add(role)
    }

    if (roles.size === 0) {
      toast.error("Сервіс має бути доступний хоча б одній ролі")
      return
    }

    const allowed_roles = [...roles]
    const key = `connector:${connector.id}:${role}`
    setLoadingKey(key)
    try {
      const res = await fetch("/api/connectors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: connector.id, allowed_roles }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setConnectors((current) =>
        current.map((item) =>
          item.id === connector.id ? data.connector : item
        )
      )
      setConnectorRoleAccess((current) =>
        upsertConnectorAccess(current, connector.id, allowed_roles)
      )
    } catch (error) {
      toast.error("Не вдалося оновити доступ до конектора", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoadingKey(null)
    }
  }

  async function toggleFeature(feature: string, role: UserRole) {
    const enabled = !hasFeature(feature, role)
    const key = `feature:${feature}:${role}`
    setLoadingKey(key)
    try {
      const res = await fetch("/api/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature, role, enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setRoleFeatures((current) =>
        upsertRoleFeature(current, data.role_feature)
      )
    } catch (error) {
      toast.error("Не вдалося оновити фічу", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoadingKey(null)
    }
  }

  return (
    <Tabs defaultValue="agents" className="min-h-0 flex-1">
      <TabsList>
        <TabsTrigger value="agents">
          <Bot className="size-4" />
          Агенти
        </TabsTrigger>
        <TabsTrigger value="services">
          <Database className="size-4" />
          Сервіси
        </TabsTrigger>
        <TabsTrigger value="features">
          <SlidersHorizontal className="size-4" />
          Фічі
        </TabsTrigger>
      </TabsList>

      <TabsContent value="agents" className="min-h-0">
        <ScrollArea className="h-[calc(100vh-11rem)] rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Агент</TableHead>
                <TableHead className="w-28">Стан</TableHead>
                {ACCESS_ROLES.map((role) => (
                  <TableHead key={role} className="w-28 text-center">
                    {roleCellLabel(role)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => (
                <TableRow key={agent.key}>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{agent.name}</span>
                      <span className="max-w-xl text-wrap text-xs text-muted-foreground">
                        {agent.description ?? agent.key}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant={agent.enabled ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => toggleAgent(agent)}
                      disabled={loadingKey === `agent:${agent.key}:enabled`}
                    >
                      {agent.enabled ? "Увімкнено" : "Вимкнено"}
                    </Button>
                  </TableCell>
                  {ACCESS_ROLES.map((role) => (
                    <TableCell key={role} className="text-center">
                      <AccessButton
                        enabled={hasAgentAccess(agent.key, role)}
                        disabled={loadingKey === `agent:${agent.key}:${role}`}
                        onClick={() => toggleAgentRole(agent.key, role)}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="services" className="min-h-0">
        <ScrollArea className="h-[calc(100vh-11rem)] rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Конектор</TableHead>
                <TableHead className="w-36">MCP</TableHead>
                <TableHead className="w-28">Стан</TableHead>
                {ACCESS_ROLES.map((role) => (
                  <TableHead key={role} className="w-28 text-center">
                    {roleCellLabel(role)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {connectors.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={ACCESS_ROLES.length + 3}
                    className="text-center text-muted-foreground"
                  >
                    Конектори ще не додані
                  </TableCell>
                </TableRow>
              )}
              {connectors.map((connector) => (
                <TableRow key={connector.id}>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{connector.name}</span>
                      {connector.description && (
                        <span className="max-w-xl text-wrap text-xs text-muted-foreground">
                          {connector.description}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{connector.mcp_server}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant={connector.enabled ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => toggleConnector(connector)}
                      disabled={loadingKey === `connector:${connector.id}:enabled`}
                    >
                      {connector.enabled ? "Увімкнено" : "Вимкнено"}
                    </Button>
                  </TableCell>
                  {ACCESS_ROLES.map((role) => (
                    <TableCell key={role} className="text-center">
                      <AccessButton
                        enabled={
                          connectorRoles.get(connector.id)?.has(role) ?? false
                        }
                        disabled={
                          loadingKey === `connector:${connector.id}:${role}`
                        }
                        onClick={() => toggleConnectorRole(connector, role)}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="features" className="min-h-0">
        <ScrollArea className="h-[calc(100vh-11rem)] rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Фіча</TableHead>
                {ACCESS_ROLES.map((role) => (
                  <TableHead key={role} className="w-28 text-center">
                    {roleCellLabel(role)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {FEATURE_CATALOG.map((feature) => (
                <TableRow key={feature.key}>
                  <TableCell className="font-medium">{feature.label}</TableCell>
                  {ACCESS_ROLES.map((role) => (
                    <TableCell key={role} className="text-center">
                      <AccessButton
                        enabled={hasFeature(feature.key, role)}
                        disabled={loadingKey === `feature:${feature.key}:${role}`}
                        onClick={() => toggleFeature(feature.key, role)}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  )
}
