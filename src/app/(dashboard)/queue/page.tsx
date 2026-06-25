import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import type { Profile, Task } from "@/types/database"
import { QueueTable } from "@/components/tasks/QueueTable"

export default async function QueuePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single<Pick<Profile, "role">>()

  if (profile?.role !== "admin") {
    redirect("/chat")
  }

  const { data: tasks } = await supabase
    .from("tasks")
    .select("*")
    .in("status", ["pending", "running"])
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .returns<Task[]>()

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4">
      <h1 className="mb-4 text-xl font-semibold">Черга</h1>
      <QueueTable initialTasks={tasks ?? []} />
    </div>
  )
}
