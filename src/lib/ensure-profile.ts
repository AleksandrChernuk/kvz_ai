import "server-only"

import type { User } from "@supabase/supabase-js"

import { createAdminClient } from "@/lib/supabase/admin"
import type { createClient } from "@/lib/supabase/server"
import type { Profile } from "@/types/database"

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>

function fullNameFromUser(user: User) {
  const fullName = user.user_metadata?.full_name
  return typeof fullName === "string" && fullName.trim() ? fullName : null
}

export async function getOrCreateProfile(
  supabase: ServerSupabaseClient,
  user: User
) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle<Profile>()

  if (profile) return profile

  if (error) {
    console.error("profile_lookup_failed", {
      code: error.code,
      message: error.message,
      user_id: user.id,
    })
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("profile_repair_skipped", {
      reason: "missing_service_role_key",
      user_id: user.id,
    })
    return null
  }

  const { data: repaired, error: repairError } = await createAdminClient()
    .from("profiles")
    .upsert(
      {
        user_id: user.id,
        full_name: fullNameFromUser(user),
      },
      { onConflict: "user_id" }
    )
    .select("*")
    .single<Profile>()

  if (repairError || !repaired) {
    console.error("profile_repair_failed", {
      code: repairError?.code,
      message: repairError?.message,
      user_id: user.id,
    })
    return null
  }

  return repaired
}
