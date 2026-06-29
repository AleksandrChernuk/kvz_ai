"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Plug, Plus, SendHorizontal } from "lucide-react"
import { toast } from "sonner"

import type { AgentCatalogItem, AgentType, KnowledgeBase } from "@/types/database"
import type { UserRole } from "@/types/roles"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

type Props = {
  threadId: string
  userRole: UserRole
  disabled?: boolean
  // Оптимістичне додавання повідомлення юзера у вікно чату; повертає id
  // доданого оптимістичного повідомлення, щоб відкотити його при помилці.
  onSend?: (content: string) => string | undefined
  onSendFailed?: (optimisticId: string) => void
}

type ChatAgentMode = "auto" | AgentType
type ChatKnowledgeBaseMode = "auto" | string

export function InputBar({ threadId, userRole, disabled, onSend, onSendFailed }: Props) {
  const [value, setValue] = useState("")
  const [pending, setPending] = useState(false)
  const [agents, setAgents] = useState<AgentCatalogItem[]>([])
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [agentMode, setAgentMode] = useState<ChatAgentMode>("auto")
  const [knowledgeBaseMode, setKnowledgeBaseMode] =
    useState<ChatKnowledgeBaseMode>("auto")
  const ref = useRef<HTMLTextAreaElement>(null)

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.key === agentMode),
    [agentMode, agents]
  )
  const selectedKnowledgeBase = useMemo(
    () => knowledgeBases.find((kb) => kb.id === knowledgeBaseMode),
    [knowledgeBaseMode, knowledgeBases]
  )
  const modeLabel = agentMode === "auto" ? "Авто" : (selectedAgent?.name ?? agentMode)
  const knowledgeBaseLabel =
    knowledgeBaseMode === "auto"
      ? "Усі доступні"
      : (selectedKnowledgeBase?.name ?? "Обраний MCP")

  function autoResize() {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    // max ~5 рядків (≈ 120px)
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  useEffect(() => {
    let active = true

    Promise.all([
      fetch("/api/agents").then((res) => {
        if (!res.ok) throw new Error("Не вдалося отримати агентів")
        return res.json() as Promise<{ agents?: AgentCatalogItem[] }>
      }),
      fetch("/api/kb").then((res) => {
        if (!res.ok) throw new Error("Не вдалося отримати MCP-конектори")
        return res.json() as Promise<{ knowledge_bases?: KnowledgeBase[] }>
      }),
    ])
      .then(([agentsData, kbData]) => {
        if (!active) return
        setAgents(
          (agentsData.agents ?? []).filter((agent) => agent.key !== "orchestrated")
        )
        setKnowledgeBases(kbData.knowledge_bases ?? [])
      })
      .catch(() => {
        if (!active) return
        setAgents([])
        setKnowledgeBases([])
      })

    return () => {
      active = false
    }
  }, [])

  function selectKnowledgeBase(id: ChatKnowledgeBaseMode) {
    setKnowledgeBaseMode(id)
    if (id !== "auto" && agents.some((agent) => agent.key === "kb")) {
      setAgentMode("kb")
    }
  }

  async function send() {
    const content = value.trim()
    if (!content || pending) return

    setPending(true)
    const optimisticId = onSend?.(content)
    setValue("")
    requestAnimationFrame(autoResize)

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          thread_id: threadId,
          preferred_agent: agentMode === "auto" ? undefined : agentMode,
          preferred_knowledge_base_id:
            knowledgeBaseMode === "auto" ? undefined : knowledgeBaseMode,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "Не вдалося надіслати повідомлення")
      }
    } catch (e) {
      // Відкочуємо оптимістичне повідомлення — інакше у чаті висить фантом,
      // якого немає в базі.
      if (optimisticId) onSendFailed?.(optimisticId)
      setValue(content)
      toast.error("Помилка", {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Агент:</span>
        <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
          {modeLabel}
        </span>
        <span className="ml-2">MCP:</span>
        <span className="max-w-40 truncate rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
          {knowledgeBaseLabel}
        </span>
      </div>
      <div className="flex items-end gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Обрати агента або MCP-конектор"
              disabled={disabled || pending}
            >
              <Plus className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-72">
            <DropdownMenuLabel>Агент</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setAgentMode("auto")}>
              <span>Авто</span>
              {agentMode === "auto" && <Check className="ml-auto size-4" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {agents.map((agent) => (
              <DropdownMenuItem
                key={agent.key}
                onSelect={() => setAgentMode(agent.key)}
              >
                <span className="min-w-0 truncate">{agent.name}</span>
                {agentMode === agent.key && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            ))}
            {agents.length === 0 && (
              <DropdownMenuItem disabled>
                Немає доступних агентів
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>MCP-конектор</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => selectKnowledgeBase("auto")}>
              <Plug className="size-4 text-muted-foreground" />
              <span>Усі доступні</span>
              {knowledgeBaseMode === "auto" && <Check className="ml-auto size-4" />}
            </DropdownMenuItem>
            {knowledgeBases.map((kb) => (
              <DropdownMenuItem
                key={kb.id}
                className="items-start"
                onSelect={() => selectKnowledgeBase(kb.id)}
              >
                <Plug className="mt-0.5 size-4 text-muted-foreground" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{kb.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {kb.mcp_server}
                  </span>
                </span>
                {knowledgeBaseMode === kb.id && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            ))}
            {knowledgeBases.length === 0 && (
              <DropdownMenuItem disabled>
                Немає доступних MCP-конекторів для ролі {userRole}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled || pending}
          placeholder="Напишіть повідомлення…"
          className={cn(
            "max-h-32 min-h-9 flex-1 resize-none overflow-y-auto rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs",
            "outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
          onChange={(e) => {
            setValue(e.target.value)
            autoResize()
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <Button
          size="icon"
          onClick={send}
          disabled={disabled || pending || !value.trim()}
          aria-label="Надіслати повідомлення"
        >
          <SendHorizontal className="size-4" />
        </Button>
      </div>
    </div>
  )
}
