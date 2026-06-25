import type { SupabaseClient } from "@supabase/supabase-js"

import type { UserRole } from "@/types/roles"

// Центральний feature gate: чи доступна фіча цій ролі.
// Джерело правди — таблиця role_features (керується адміном).
export async function hasFeature(
  supabase: SupabaseClient,
  role: UserRole,
  feature: string
): Promise<boolean> {
  const { data } = await supabase
    .from("role_features")
    .select("enabled")
    .eq("role", role)
    .eq("feature", feature)
    .maybeSingle<{ enabled: boolean }>()

  return data?.enabled ?? false
}

// Усі ввімкнені фічі ролі — для UI (показати/сховати розділи)
export async function listFeatures(
  supabase: SupabaseClient,
  role: UserRole
): Promise<string[]> {
  const { data } = await supabase
    .from("role_features")
    .select("feature")
    .eq("role", role)
    .eq("enabled", true)
    .returns<{ feature: string }[]>()

  return (data ?? []).map((f) => f.feature)
}
