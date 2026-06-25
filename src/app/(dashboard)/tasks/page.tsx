import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import type { Profile, Task } from "@/types/database"
import { TasksTable } from "@/components/tasks/TasksTable"

export default async function TasksPage() {
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

  const isAdmin = profile?.role === "admin"

  let query = supabase
    .from("tasks")
    .select("*")
    .order("created_at", { ascending: false })
  if (!isAdmin) query = query.eq("user_id", user.id)

  const { data: tasks } = await query.returns<Task[]>()

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4">
      <h1 className="mb-4 text-xl font-semibold">Таски</h1>
      <TasksTable initialTasks={tasks ?? []} isAdmin={isAdmin} userId={user.id} />
    </div>
  )
}
