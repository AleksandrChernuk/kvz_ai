import { createClient as createSupabaseClient } from "@supabase/supabase-js"

// Service-role клієнт: обходить RLS. Тільки для server-side коду після
// окремої перевірки довіри (worker token, admin session або verified user).
// Ніколи не імпортувати в клієнтські компоненти.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
