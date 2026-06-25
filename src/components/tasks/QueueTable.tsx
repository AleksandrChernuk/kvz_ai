"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import type { Task } from "@/types/database"
import {
  AGENT_LABELS,
  STATUS_LABELS,
  STATUS_VARIANTS,
  fmtTime,
} from "@/lib/task-meta"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"

const ACTIVE = new Set(["pending", "running"])

export function QueueTable({ initialTasks }: { initialTasks: Task[] }) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [watchdogLoading, setWatchdogLoading] = useState(false)

  const refresh = useCallback(async () => {
    const res = await fetch("/api/tasks", { cache: "no-store" })
    if (!res.ok) return
    const { tasks: all } = (await res.json()) as { tasks: Task[] }
    setTasks(all.filter((t) => ACTIVE.has(t.status)))
  }, [])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel("queue-table")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        () => refresh()
      )
      .subscribe()

    const interval = setInterval(refresh, 5000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [refresh])

  async function cancel(id: string) {
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "cancel" }),
      })
      if (!res.ok) throw new Error("Не вдалося скасувати")
      refresh()
    } catch (e) {
      toast.error("Помилка", {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }

  async function changePriority(id: string, delta: number, current: number) {
    const priority = Math.max(0, Math.min(100, current + delta))
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, priority }),
      })
      if (!res.ok) throw new Error("Не вдалося змінити пріоритет")
      refresh()
    } catch (e) {
      toast.error("Помилка", {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }

  async function runWatchdog() {
    setWatchdogLoading(true)
    try {
      const res = await fetch("/api/tasks/watchdog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeout_minutes: 5 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`Watchdog: звільнено ${data.released} задач`)
      refresh()
    } catch (e) {
      toast.error("Помилка watchdog", {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setWatchdogLoading(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {tasks.length} активних задач
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={runWatchdog}
          disabled={watchdogLoading}
        >
          <RefreshCw className={`size-3.5 ${watchdogLoading ? "animate-spin" : ""}`} />
          Watchdog
        </Button>
      </div>

      <ScrollArea className="flex-1 rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">ID</TableHead>
              <TableHead className="w-28">Агент</TableHead>
              <TableHead className="w-28">Статус</TableHead>
              <TableHead className="w-24">Пріоритет</TableHead>
              <TableHead className="w-32">Retry</TableHead>
              <TableHead className="w-32">locked_by</TableHead>
              <TableHead className="w-40">Створено</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  Черга порожня
                </TableCell>
              </TableRow>
            )}
            {tasks.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-xs">{t.id.slice(0, 8)}</TableCell>
                <TableCell>
                  {t.agent ? (
                    <Badge variant="secondary">{AGENT_LABELS[t.agent]}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANTS[t.status]}>
                    {STATUS_LABELS[t.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <span className="w-6 text-center text-sm">{t.priority}</span>
                    {t.status === "pending" && (
                      <>
                        <button
                          type="button"
                          onClick={() => changePriority(t.id, 10, t.priority)}
                          className="rounded p-0.5 hover:bg-accent"
                          title="Підвищити пріоритет"
                        >
                          <ChevronUp className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => changePriority(t.id, -10, t.priority)}
                          className="rounded p-0.5 hover:bg-accent"
                          title="Знизити пріоритет"
                        >
                          <ChevronDown className="size-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  {t.retry_count}/{t.max_retries}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {t.status === "running" ? (t.locked_by ?? "—") : "—"}
                </TableCell>
                <TableCell className="text-xs">{fmtTime(t.created_at)}</TableCell>
                <TableCell>
                  {(t.status === "pending" || t.status === "running") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => cancel(t.id)}
                    >
                      Скасувати
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  )
}
