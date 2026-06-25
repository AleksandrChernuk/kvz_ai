"use client"

import { useMemo, useState } from "react"
import { Bot, Check, Database, Minus, SlidersHorizontal } from "lucide-react"
import { toast } from "sonner"

import { ACCESS_ROLES, FEATURE_CATALOG } from "@/lib/access"
import type {
  AgentCatalogItem,
  AgentType,
  KnowledgeBase,
  KnowledgeBaseRoleAccess,
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
  initialKnowledgeBases: KnowledgeBase[]
  initialKnowledgeBaseRoleAccess: KnowledgeBaseRoleAccess[]
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
  initialKnowledgeBases,
  initialKnowledgeBaseRoleAccess,
  initialRoleFeatures,
}: Props) {
  const [agents, setAgents] = useState(initialAgents)
  const [roleAgentAccess, setRoleAgentAccess] = useState(initialRoleAgentAccess)
  const [knowledgeBases, setKnowledgeBases] = useState(initialKnowledgeBases)
  const [knowledgeBaseRoleAccess, setKnowledgeBaseRoleAccess] = useState(
    initialKnowledgeBaseRoleAccess
  )
  const [roleFeatures, setRoleFeatures] = useState(initialRoleFeatures)
  const [loadingKey, setLoadingKey] = useState<string | null>(null)

  const kbRoles = useMemo(() => {
    const map = new Map<string, Set<UserRole>>()
    for (const kb of knowledgeBases) {
      map.set(kb.id, new Set(kb.allowed_roles))
    }
    for (const row of knowledgeBaseRoleAccess) {
      const roles = map.get(row.knowledge_base_id) ?? new Set<UserRole>()
      roles.add(row.role)
      map.set(row.knowledge_base_id, roles)
    }
    return map
  }, [knowledgeBases, knowledgeBaseRoleAccess])

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

  async function toggleKnowledgeBase(kb: KnowledgeBase) {
    const key = `kb:${kb.id}:enabled`
    setLoadingKey(key)
    try {
      const res = await fetch("/api/kb", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: kb.id, enabled: !kb.enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setKnowledgeBases((current) =>
        current.map((item) => (item.id === kb.id ? data.knowledge_base : item))
      )
    } catch (error) {
      toast.error("Не вдалося оновити сервіс", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoadingKey(null)
    }
  }

  async function toggleKnowledgeBaseRole(kb: KnowledgeBase, role: UserRole) {
    const roles = new Set(kbRoles.get(kb.id) ?? [])
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
    const key = `kb:${kb.id}:${role}`
    setLoadingKey(key)
    try {
      const res = await fetch("/api/kb", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: kb.id, allowed_roles }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setKnowledgeBases((current) =>
        current.map((item) => (item.id === kb.id ? data.knowledge_base : item))
      )
      setKnowledgeBaseRoleAccess((current) => [
        ...current.filter((row) => row.knowledge_base_id !== kb.id),
        ...allowed_roles.map((allowedRole) => ({
          knowledge_base_id: kb.id,
          role: allowedRole,
          created_at: new Date().toISOString(),
        })),
      ])
    } catch (error) {
      toast.error("Не вдалося оновити доступ до сервісу", {
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
                <TableHead>Сервіс / KB</TableHead>
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
              {knowledgeBases.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={ACCESS_ROLES.length + 3}
                    className="text-center text-muted-foreground"
                  >
                    Сервіси ще не додані
                  </TableCell>
                </TableRow>
              )}
              {knowledgeBases.map((kb) => (
                <TableRow key={kb.id}>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{kb.name}</span>
                      {kb.description && (
                        <span className="max-w-xl text-wrap text-xs text-muted-foreground">
                          {kb.description}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{kb.mcp_server}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant={kb.enabled ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => toggleKnowledgeBase(kb)}
                      disabled={loadingKey === `kb:${kb.id}:enabled`}
                    >
                      {kb.enabled ? "Увімкнено" : "Вимкнено"}
                    </Button>
                  </TableCell>
                  {ACCESS_ROLES.map((role) => (
                    <TableCell key={role} className="text-center">
                      <AccessButton
                        enabled={kbRoles.get(kb.id)?.has(role) ?? false}
                        disabled={loadingKey === `kb:${kb.id}:${role}`}
                        onClick={() => toggleKnowledgeBaseRole(kb, role)}
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
