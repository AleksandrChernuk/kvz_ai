"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import type { Thread } from "@/types/database"

export type ChatThreadItem = Thread & { preview?: string }

type ChatControlsContextValue = {
  activeThreadId?: string
  creating: boolean
  createThread: () => Promise<void>
  query: string
  setQuery: (query: string) => void
  setThreadContext: (threads: ChatThreadItem[], activeThreadId?: string) => void
  threads: ChatThreadItem[]
}

const ChatControlsContext = createContext<ChatControlsContextValue | null>(null)

export function ChatControlsProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const [activeThreadId, setActiveThreadId] = useState<string | undefined>()
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState("")
  const [threads, setThreads] = useState<ChatThreadItem[]>([])

  const setThreadContext = useCallback(
    (nextThreads: ChatThreadItem[], nextActiveThreadId?: string) => {
      setThreads(nextThreads)
      setActiveThreadId(nextActiveThreadId)
    },
    []
  )

  const createThread = useCallback(async () => {
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
  }, [router])

  const value = useMemo(
    () => ({
      activeThreadId,
      creating,
      createThread,
      query,
      setQuery,
      setThreadContext,
      threads,
    }),
    [
      activeThreadId,
      creating,
      createThread,
      query,
      setThreadContext,
      threads,
    ]
  )

  return (
    <ChatControlsContext.Provider value={value}>
      {children}
    </ChatControlsContext.Provider>
  )
}

export function useChatControls() {
  const context = useContext(ChatControlsContext)
  if (!context) {
    throw new Error("useChatControls must be used within ChatControlsProvider")
  }
  return context
}
