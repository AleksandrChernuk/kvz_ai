"use client"

import { useEffect, useId, useState } from "react"
import {
  CheckCircle2,
  Loader2,
  MinusCircle,
  ShieldQuestion,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import type {
  AgentType,
  Task,
  TaskCheckpoint,
  TaskStatus,
} from "@/types/database"
import { cn } from "@/lib/utils"
import { AGENT_LABELS } from "@/lib/task-meta"

type State = {
  status: TaskStatus
  agent: AgentType | null
  checkpoint: TaskCheckpoint | null
  error: string | null
  retry_count: number
}

function cleanProgressText(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ") ?? ""
}

function progressLabel(state: State) {
  const pending = cleanProgressText(state.checkpoint?.pending_work)
  const summary = cleanProgressText(state.checkpoint?.progress_summary)
  const agentName = state.agent ? AGENT_LABELS[state.agent] : "агента"

  if (state.status === "pending") {
    return state.retry_count > 0
      ? `Повторна спроба ${state.retry_count}: чекаю в черзі`
      : "У черзі: чекаю вільного воркера"
  }

  if (state.status !== "running") return ""

  if (pending.includes("LLM-обробника")) {
    return `Звертаюся до ${agentName}`
  }

  if (pending) return pending

  if (summary.includes("token gate пройдено")) {
    return "Перевірив ліміт контексту, запускаю агента"
  }

  if (summary) return summary

  return state.agent ? `${agentName}: виконую задачу` : "Запускаю обробку"
}

// Realtime-підписка: всі бейджі мультиплексуються через один websocket,
// на відміну від SSE (окреме HTTP-зʼєднання на кожен бейдж).
export function TaskStatusBadge({ taskId }: { taskId: string }) {
  const [state, setState] = useState<State | null>(null)
  const [acting, setActing] = useState(false)
  // Унікальний суфікс на кожен інстанс: одне завдання може мати кілька бейджів
  // (повідомлення юзера й відповідь асистента поділяють той самий task_id), а
  // Supabase-realtime забороняє два канали з однаковим іменем → інакше падіння
  // "cannot add postgres_changes callbacks ... after subscribe()".
  const uid = useId()

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
      .select("status, agent, checkpoint, error, retry_count")
      .eq("id", taskId)
      .single<
        Pick<Task, "status" | "agent" | "checkpoint" | "error" | "retry_count">
      >()
      .then(({ data }) => {
        if (active && data) setState(data)
      })

    const channel = supabase
      .channel(`task:${taskId}:${uid}`)
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
            checkpoint: t.checkpoint,
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
  }, [taskId, uid])

  if (!state) return null

  const base = "mt-1 inline-flex items-center gap-1.5 text-xs"

  switch (state.status) {
    case "pending":
      return (
        <span className={cn(base, "text-muted-foreground")}>
          <Loader2 className="size-3.5 animate-spin" />
          {progressLabel(state)}
        </span>
      )
    case "running":
      return (
        <span className={cn(base, "text-muted-foreground")}>
          <Loader2 className="size-3.5 animate-spin" />
          {progressLabel(state)}
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
