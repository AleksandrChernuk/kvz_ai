"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Plus, Search, X } from "lucide-react"
import { toast } from "sonner"

import type { Thread } from "@/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

export type ThreadListItem = Thread & { preview?: string }

export function ThreadList({
  threads,
  activeThreadId,
}: {
  threads: ThreadListItem[]
  activeThreadId?: string
}) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return threads
    return threads.filter(
      (t) =>
        t.title?.toLowerCase().includes(q) ||
        t.preview?.toLowerCase().includes(q)
    )
  }, [threads, query])

  async function createThread() {
    setCreating(true)
    try {
      const res = await fetch("/api/chat/thread", { method: "POST" })
      if (!res.ok) throw new Error("Не вдалося створити чат")
      const { id } = await res.json()
      router.push(`/chat/${id}`)
      router.refresh()
    } catch (e) {
      toast.error("Помилка", {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setCreating(false)
    }
  }

  async function deleteThread(id: string) {
    if (!confirm("Видалити цей чат?")) return
    try {
      const res = await fetch(`/api/chat/thread?id=${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Не вдалося видалити")
      if (id === activeThreadId) router.push("/chat")
      router.refresh()
    } catch (e) {
      toast.error("Помилка", {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return (
    <div className="flex w-64 shrink-0 flex-col border-r">
      <div className="flex flex-col gap-2 p-3">
        <Button
          onClick={createThread}
          disabled={creating}
          className="w-full justify-start"
          size="sm"
        >
          <Plus className="size-4" />
          Новий чат
        </Button>
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Пошук чатів…"
            className="h-8 pl-8 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 px-2 pb-3">
          {filtered.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              {query ? "Нічого не знайдено" : "Поки немає чатів"}
            </p>
          )}
          {filtered.map((t) => {
            const active = t.id === activeThreadId
            return (
              <div
                key={t.id}
                className={cn(
                  "group relative flex flex-col rounded-md px-2 py-2 text-sm transition-colors",
                  active ? "bg-accent" : "hover:bg-accent/50"
                )}
              >
                <Link href={`/chat/${t.id}`} className="min-w-0 pr-5">
                  <span className="block truncate font-medium">
                    {t.title || "Новий чат"}
                  </span>
                  {t.preview && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {t.preview}
                    </span>
                  )}
                </Link>
                <button
                  type="button"
                  onClick={() => deleteThread(t.id)}
                  aria-label="Видалити чат"
                  className="absolute top-1.5 right-1.5 hidden rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground group-hover:block"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
