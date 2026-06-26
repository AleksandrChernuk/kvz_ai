import { createClient } from "@/lib/supabase/server"
import type { Task } from "@/types/database"

// Long-lived SSE needs the Node runtime, never the edge. On serverless (Vercel)
// the function still times out (maxDuration), so this is a best-effort fallback —
// the UI's primary channel is Supabase Realtime (websocket) in the browser.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// GET /api/tasks/[taskId]/stream
// SSE-стрім статусу задачі. Закривається на термінальному статусі.
// Основний канал статусу в UI — Supabase Realtime у браузері; цей стрім
// допоміжний і на serverless обмежений maxDuration.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return new Response("Unauthorized", { status: 401 })
  }

  const TERMINAL = new Set(["done", "failed", "cancelled"])

  let cleanup: (() => void) | null = null

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      let timer: ReturnType<typeof setTimeout> | null = null
      let channel: ReturnType<typeof supabase.channel> | null = null

      function close() {
        if (closed) return
        closed = true
        if (timer) clearTimeout(timer)
        if (channel) supabase.removeChannel(channel)
        try {
          controller.close()
        } catch {
          // контролер уже закритий рантаймом
        }
      }
      cleanup = close

      function send(data: object) {
        if (closed) return
        try {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
          )
        } catch {
          close()
        }
      }

      const { data: initial } = await supabase
        .from("tasks")
        .select("id, status, agent, error, result, retry_count")
        .eq("id", taskId)
        .eq("user_id", user.id)
        .single<Pick<Task, "id" | "status" | "agent" | "error" | "result" | "retry_count">>()

      if (!initial) {
        send({ error: "not_found" })
        close()
        return
      }

      send(initial)

      if (TERMINAL.has(initial.status)) {
        close()
        return
      }

      channel = supabase
        .channel(`task-stream:${taskId}`)
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
            send({
              id: t.id,
              status: t.status,
              agent: t.agent,
              error: t.error,
              result: t.result,
              retry_count: t.retry_count,
            })
            if (TERMINAL.has(t.status)) close()
          }
        )
        .subscribe()

      timer = setTimeout(() => {
        send({ error: "timeout" })
        close()
      }, 10 * 60 * 1000)

      // Клієнт відключився — прибираємо канал і таймер
      req.signal.addEventListener("abort", close)
    },
    cancel() {
      cleanup?.()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
