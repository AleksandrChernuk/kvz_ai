"use client"

import { useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import type { Task } from "@/types/database"
import {
  AGENT_LABELS,
  STATUS_LABELS,
  STATUS_VARIANTS,
  fmtTime,
} from "@/lib/task-meta"
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

function upsert(list: Task[], t: Task): Task[] {
  const idx = list.findIndex((x) => x.id === t.id)
  if (idx === -1) return [t, ...list]
  const next = [...list]
  next[idx] = t
  return next
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
        <TableCell className="text-xs">{fmtTime(task.created_at)}</TableCell>
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
            <div className="grid gap-3 py-2 text-xs md:grid-cols-2">
              <div>
                <p className="mb-1 font-medium">payload</p>
                <pre className="overflow-x-auto rounded bg-background p-2">
                  {JSON.stringify(task.payload, null, 2)}
                </pre>
              </div>
              <div>
                <p className="mb-1 font-medium">result</p>
                <pre className="overflow-x-auto rounded bg-background p-2">
                  {task.result ? JSON.stringify(task.result, null, 2) : "—"}
                </pre>
                {task.error && (
                  <p className="mt-2 text-destructive">error: {task.error}</p>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
