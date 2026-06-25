import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import type { Profile, Run } from "@/types/database"
import { RunsTable } from "@/components/tasks/RunsTable"

export default async function RunsPage() {
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

  if (profile?.role !== "admin") redirect("/chat")

  const { data: runs } = await supabase
    .from("runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(100)
    .returns<Run[]>()

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4">
      <h1 className="mb-4 text-xl font-semibold">Запуски</h1>
      <RunsTable initialRuns={runs ?? []} />
    </div>
  )
}
