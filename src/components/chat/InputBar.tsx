"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Plus, SendHorizontal } from "lucide-react"
import { toast } from "sonner"

import type { AgentCatalogItem, AgentType } from "@/types/database"
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

export function InputBar({ threadId, disabled, onSend, onSendFailed }: Props) {
  const [value, setValue] = useState("")
  const [pending, setPending] = useState(false)
  const [agents, setAgents] = useState<AgentCatalogItem[]>([])
  const [agentMode, setAgentMode] = useState<ChatAgentMode>("auto")
  const ref = useRef<HTMLTextAreaElement>(null)

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.key === agentMode),
    [agentMode, agents]
  )
  const modeLabel = agentMode === "auto" ? "Авто" : (selectedAgent?.name ?? agentMode)

  function autoResize() {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    // max ~5 рядків (≈ 120px)
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  useEffect(() => {
    let active = true

    fetch("/api/agents")
      .then((res) => {
        if (!res.ok) throw new Error("Не вдалося отримати агентів")
        return res.json() as Promise<{ agents?: AgentCatalogItem[] }>
      })
      .then((data) => {
        if (!active) return
        setAgents(
          (data.agents ?? []).filter((agent) => agent.key !== "orchestrated")
        )
      })
      .catch(() => {
        if (active) setAgents([])
      })

    return () => {
      active = false
    }
  }, [])

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
        <span>Режим:</span>
        <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
          {modeLabel}
        </span>
      </div>
      <div className="flex items-end gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Обрати агента"
              disabled={disabled || pending}
            >
              <Plus className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top">
            <DropdownMenuLabel>Обробити через</DropdownMenuLabel>
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
