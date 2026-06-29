"use client"

import { useEffect } from "react"

import {
  type ChatThreadItem,
  useChatControls,
} from "@/components/chat/ChatControlsContext"

export function ChatSidebarState({
  activeThreadId,
  threads,
}: {
  activeThreadId?: string
  threads: ChatThreadItem[]
}) {
  const { setThreadContext } = useChatControls()

  useEffect(() => {
    setThreadContext(threads, activeThreadId)
  }, [activeThreadId, setThreadContext, threads])

  return null
}
