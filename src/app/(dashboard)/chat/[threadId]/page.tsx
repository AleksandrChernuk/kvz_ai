import { notFound, redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { loadThreadsWithPreview } from "@/lib/threads"
import type { Message, Profile, Thread } from "@/types/database"
import { ThreadList } from "@/components/chat/ThreadList"
import { ChatWindow } from "@/components/chat/ChatWindow"

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>
}) {
  const { threadId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Перевірка, що тред належить юзеру (RLS додатково гарантує це).
  const { data: thread } = await supabase
    .from("threads")
    .select("*")
    .eq("id", threadId)
    .single<Thread>()

  if (!thread || thread.user_id !== user.id) {
    notFound()
  }

  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<Message[]>()

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single<Pick<Profile, "role">>()

  const threads = await loadThreadsWithPreview(supabase, user.id)

  return (
    <div className="flex flex-1 overflow-hidden">
      <ThreadList threads={threads} activeThreadId={threadId} />
      <ChatWindow
        initialMessages={(messages ?? []).reverse()}
        threadId={threadId}
        userRole={profile?.role ?? "viewer"}
      />
    </div>
  )
}
