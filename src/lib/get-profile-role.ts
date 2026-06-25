import "server-only"

import type { createClient } from "@/lib/supabase/server"
import type { Profile } from "@/types/database"

// Роль завжди читається з profiles по user_id (ніколи з тіла запиту).
// Спільний хелпер для route-обробників, щоб не дублювати lookup.
export async function getProfileRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", userId)
    .single<Pick<Profile, "role">>()
  return data?.role ?? null
}
