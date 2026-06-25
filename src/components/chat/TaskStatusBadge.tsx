"use client"

import { useEffect, useState } from "react"
import {
  CheckCircle2,
  Loader2,
  MinusCircle,
  ShieldQuestion,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import type { AgentType, Task, TaskStatus } from "@/types/database"
import { cn } from "@/lib/utils"

const AGENT_LABELS: Record<AgentType, string> = {
  codex: "Codex",
  search: "Пошук",
  drive: "Google Drive",
  bitrix: "Bitrix24",
  email: "Email",
  kb: "База знань",
}

type State = {
  status: TaskStatus
  agent: AgentType | null
  error: string | null
  retry_count: number
}

// Realtime-підписка: всі бейджі мультиплексуються через один websocket,
// на відміну від SSE (окреме HTTP-зʼєднання на кожен бейдж).
export function TaskStatusBadge({ taskId }: { taskId: string }) {
  const [state, setState] = useState<State | null>(null)
  const [acting, setActing] = useState(false)

  async function decide(action: "approve" | "reject") {
    setActing(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/${action}`, {
        method: "POST",
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }))
        throw new Error(error || "Не вдалося виконати дію")
      }
    } catch (e) {
      toast.error("Помилка", {
        description: e instanceof Error ? e.message : String(e),
      })
      setActing(false)
    }
    // на успіх стан оновиться через realtime-підписку нижче
  }

  useEffect(() => {
    const supabase = createClient()
    let active = true

    supabase
      .from("tasks")
      .select("status, agent, error, retry_count")
      .eq("id", taskId)
      .single<Pick<Task, "status" | "agent" | "error" | "retry_count">>()
      .then(({ data }) => {
        if (active && data) setState(data)
      })

    const channel = supabase
      .channel(`task:${taskId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tasks",
          filter: `id=eq.${taskId}`,
        },
        (payload) => {
          const t = payload.new as Task
          setState({
            status: t.status,
            agent: t.agent,
            error: t.error,
            retry_count: t.retry_count,
          })
        }
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [taskId])

  if (!state) return null

  const base = "mt-1 inline-flex items-center gap-1.5 text-xs"

  switch (state.status) {
    case "pending":
      return (
        <span className={cn(base, "text-muted-foreground")}>
          <Loader2 className="size-3.5 animate-spin" />
          {state.retry_count > 0
            ? `Повторна спроба ${state.retry_count}…`
            : "Обробляється…"}
        </span>
      )
    case "running":
      return (
        <span className={cn(base, "text-muted-foreground")}>
          <Loader2 className="size-3.5 animate-spin" />
          {state.agent ? `${AGENT_LABELS[state.agent]}…` : "Виконується…"}
        </span>
      )
    case "awaiting_approval":
      return (
        <span className={cn(base, "flex-wrap text-amber-600 dark:text-amber-500")}>
          <ShieldQuestion className="size-3.5" />
          Потребує підтвердження
          <button
            type="button"
            disabled={acting}
            onClick={() => decide("approve")}
            className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Підтвердити
          </button>
          <button
            type="button"
            disabled={acting}
            onClick={() => decide("reject")}
            className="rounded border px-2 py-0.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            Відхилити
          </button>
        </span>
      )
    case "done":
      return (
        <span className={cn(base, "text-green-600 dark:text-green-500")}>
          <CheckCircle2 className="size-3.5" />
          Готово
        </span>
      )
    case "failed":
      return (
        <span className={cn(base, "text-destructive")}>
          <XCircle className="size-3.5" />
          Помилка{state.error ? `: ${state.error}` : ""}
        </span>
      )
    case "cancelled":
      return (
        <span className={cn(base, "text-muted-foreground")}>
          <MinusCircle className="size-3.5" />
          Скасовано
        </span>
      )
    default:
      return null
  }
}
