"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { Run } from "@/types/database"
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
import { fmtTime } from "@/lib/task-meta"

const STATUS_VARIANTS: Record<Run["status"], "default" | "secondary" | "destructive"> = {
  active: "secondary",
  completed: "default",
  failed: "destructive",
}

const STATUS_LABELS: Record<Run["status"], string> = {
  active: "Активний",
  completed: "Завершено",
  failed: "Помилка",
}

function duration(start: string, end: string | null) {
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}с`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}хв ${s % 60}с`
  return `${Math.floor(m / 60)}год ${m % 60}хв`
}

export function RunsTable({ initialRuns }: { initialRuns: Run[] }) {
  const [runs, setRuns] = useState<Run[]>(initialRuns)

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel("runs-table")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "runs" },
        async () => {
          const res = await fetch("/api/runs", { cache: "no-store" })
          if (!res.ok) return
          const { runs: fresh } = await res.json() as { runs: Run[] }
          setRuns(fresh)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  return (
    <ScrollArea className="flex-1 rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">ID</TableHead>
            <TableHead className="w-28">Статус</TableHead>
            <TableHead className="w-20">Агентів</TableHead>
            <TableHead className="w-40">Початок</TableHead>
            <TableHead className="w-32">Тривалість</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                Запусків поки немає
              </TableCell>
            </TableRow>
          )}
          {runs.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-xs">{r.id.slice(0, 8)}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANTS[r.status]}>
                  {STATUS_LABELS[r.status]}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">{r.agent_count}</TableCell>
              <TableCell className="text-xs">{fmtTime(r.started_at)}</TableCell>
              <TableCell className="text-xs">
                {duration(r.started_at, r.completed_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  )
}
