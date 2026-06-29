"use client"

import { useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import type { Task } from "@/types/database"
import { AGENT_LABELS, STATUS_LABELS, STATUS_VARIANTS } from "@/lib/task-meta"
import { ClientTime } from "@/components/common/ClientTime"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"

const EMPTY_VALUE = "—"

function upsert(list: Task[], t: Task): Task[] {
  const idx = list.findIndex((x) => x.id === t.id)
  if (idx === -1) return [t, ...list]
  const next = [...list]
  next[idx] = t
  return next
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatAgent(agent: Task["agent"]) {
  return agent ? AGENT_LABELS[agent] : EMPTY_VALUE
}

function formatTokenUsage(
  tokens: NonNullable<Task["result"]>["tokens"] | undefined
) {
  if (!tokens) return EMPTY_VALUE
  const input = typeof tokens.input === "number" ? tokens.input : 0
  const output = typeof tokens.output === "number" ? tokens.output : 0
  return `${input} / ${output}`
}

export function TasksTable({
  initialTasks,
  isAdmin,
  userId,
}: {
  initialTasks: Task[]
  isAdmin: boolean
  userId: string
}) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    // Не-admin слухає тільки свої задачі — менше подій і нуль ризику
    // показати чуже при зміні RLS
    const channel = supabase
      .channel("tasks-table")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          ...(isAdmin ? {} : { filter: `user_id=eq.${userId}` }),
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as Task
            setTasks((prev) => prev.filter((t) => t.id !== old.id))
          } else {
            setTasks((prev) => upsert(prev, payload.new as Task))
          }
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [isAdmin, userId])

  return (
    <ScrollArea className="flex-1 rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">Час</TableHead>
            <TableHead className="w-32">Агент</TableHead>
            <TableHead className="w-32">Статус</TableHead>
            <TableHead>Повідомлення</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                Задач поки немає
              </TableCell>
            </TableRow>
          )}
          {tasks.map((t) => (
            <FragmentRow
              key={t.id}
              task={t}
              expanded={expanded === t.id}
              onToggle={() => setExpanded(expanded === t.id ? null : t.id)}
              isAdmin={isAdmin}
            />
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  )
}

function FragmentRow({
  task,
  expanded,
  onToggle,
}: {
  task: Task
  expanded: boolean
  onToggle: () => void
  isAdmin: boolean
}) {
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="text-xs"><ClientTime iso={task.created_at} /></TableCell>
        <TableCell>
          {task.agent ? (
            <Badge variant="secondary">{AGENT_LABELS[task.agent]}</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell>
          <Badge variant={STATUS_VARIANTS[task.status]}>
            {STATUS_LABELS[task.status]}
          </Badge>
        </TableCell>
        <TableCell className="max-w-0 truncate text-sm">
          {task.payload?.user_message?.slice(0, 50) ?? "—"}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={4} className="bg-muted/30">
            <div className="space-y-4 py-3 text-sm">
              {task.error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                  <p className="text-xs font-medium uppercase tracking-wide">
                    Помилка
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{task.error}</p>
                </div>
              )}

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <section className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Запит
                  </p>
                  <div className="min-h-20 rounded-md border bg-background/80 p-3">
                    <p className="whitespace-pre-wrap">
                      {task.payload?.user_message || EMPTY_VALUE}
                    </p>
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Відповідь
                  </p>
                  <div className="min-h-20 rounded-md border bg-background/80 p-3">
                    <p className="whitespace-pre-wrap">
                      {task.result?.answer || "Відповіді ще немає"}
                    </p>
                  </div>
                </section>
              </div>

              <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <TaskFact label="Агент" value={formatAgent(task.agent)} />
                <TaskFact
                  label="Виконав"
                  value={formatAgent(task.result?.agent_used ?? null)}
                />
                <TaskFact
                  label="Контекст"
                  value={`${task.payload?.thread_context?.length ?? 0} повідомлень`}
                />
                <TaskFact
                  label="Токени input / output"
                  value={formatTokenUsage(task.result?.tokens)}
                />
              </div>

              {task.result?.steps && task.result.steps.length > 0 && (
                <section className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Кроки
                  </p>
                  <ul className="space-y-1 rounded-md border bg-background/80 p-3 text-xs">
                    {task.result.steps.map((step, idx) => (
                      <li key={`${idx}-${step}`} className="whitespace-pre-wrap">
                        {idx + 1}. {step}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <details className="rounded-md border bg-background/80 p-3 text-xs">
                <summary className="cursor-pointer font-medium">
                  Технічні деталі
                </summary>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div>
                    <p className="mb-1 font-medium text-muted-foreground">
                      Payload
                    </p>
                    <pre className="max-h-72 overflow-auto rounded bg-muted/40 p-2">
                      {formatJson(task.payload)}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-1 font-medium text-muted-foreground">
                      Result
                    </p>
                    <pre className="max-h-72 overflow-auto rounded bg-muted/40 p-2">
                      {task.result ? formatJson(task.result) : EMPTY_VALUE}
                    </pre>
                  </div>
                </div>
              </details>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

function TaskFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background/80 p-3">
      <p className="font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm">{value}</p>
    </div>
  )
}
