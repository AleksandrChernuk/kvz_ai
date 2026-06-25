import { redirect } from "next/navigation"
import { MessageSquare } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { loadThreadsWithPreview } from "@/lib/threads"
import { ThreadList } from "@/components/chat/ThreadList"

export default async function ChatPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const threads = await loadThreadsWithPreview(supabase, user.id)

  return (
    <div className="flex flex-1 overflow-hidden">
      <ThreadList threads={threads} />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <MessageSquare className="size-10" />
        <p className="text-sm">Оберіть чат або створіть новий</p>
      </div>
    </div>
  )
}
