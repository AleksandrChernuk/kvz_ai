"use client"

import { useEffect, useRef, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import type { Message } from "@/types/database"
import type { UserRole } from "@/types/roles"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MessageBubble } from "@/components/chat/MessageBubble"
import { InputBar } from "@/components/chat/InputBar"

type Props = {
  initialMessages: Message[]
  threadId: string
  userRole: UserRole
}

export function ChatWindow({ initialMessages, threadId, userRole }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`messages:${threadId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as Message
            setMessages((prev) => prev.filter((m) => m.id !== old.id))
            return
          }

          const incoming = payload.new as Message
          setMessages((prev) => {
            if (payload.eventType === "UPDATE") {
              return prev.map((m) => (m.id === incoming.id ? incoming : m))
            }
            // вже є — пропускаємо
            if (prev.some((m) => m.id === incoming.id)) return prev
            // прибираємо оптимістичний дубль того самого повідомлення юзера
            const filtered =
              incoming.role === "user"
                ? prev.filter(
                    (m) =>
                      !(
                        m.id.startsWith("optimistic-") &&
                        m.content === incoming.content
                      )
                  )
                : prev
            return [...filtered, incoming]
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [threadId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  function addOptimistic(content: string) {
    const id = `optimistic-${Date.now()}`
    const optimistic: Message = {
      id,
      thread_id: threadId,
      role: "user",
      content,
      task_id: null,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])
    return id
  }

  function removeOptimistic(id: string) {
    setMessages((prev) => prev.filter((m) => m.id !== id))
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ScrollArea className="flex-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
          {messages.length === 0 ? (
            <p className="mt-12 text-center text-sm text-muted-foreground">
              Почніть розмову — надішліть перше повідомлення.
            </p>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="mx-auto w-full max-w-3xl">
        <InputBar
          threadId={threadId}
          userRole={userRole}
          onSend={addOptimistic}
          onSendFailed={removeOptimistic}
        />
      </div>
    </div>
  )
}
