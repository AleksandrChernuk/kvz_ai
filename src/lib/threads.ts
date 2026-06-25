import type { SupabaseClient } from "@supabase/supabase-js"

import type { Message, Thread } from "@/types/database"
import type { ThreadListItem } from "@/components/chat/ThreadList"

// Завантажує треди юзера (відсортовані) + прев'ю останнього повідомлення.
export async function loadThreadsWithPreview(
  supabase: SupabaseClient,
  userId: string
): Promise<ThreadListItem[]> {
  const { data: threads } = await supabase
    .from("threads")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .returns<Thread[]>()

  if (!threads || threads.length === 0) return []

  const { data: msgs } = await supabase
    .from("messages")
    .select("thread_id, content, created_at")
    .in(
      "thread_id",
      threads.map((t) => t.id)
    )
    .order("created_at", { ascending: false })
    .returns<Pick<Message, "thread_id" | "content" | "created_at">[]>()

  const previews = new Map<string, string>()
  for (const m of msgs ?? []) {
    if (!previews.has(m.thread_id)) {
      previews.set(m.thread_id, m.content.slice(0, 40))
    }
  }

  return threads.map((t) => ({ ...t, preview: previews.get(t.id) }))
}
