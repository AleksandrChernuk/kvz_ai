import { createClient as createSupabaseClient } from "@supabase/supabase-js"

// Service-role клієнт: обходить RLS. ТІЛЬКИ для server-side коду,
// викликаного воркером (оркестратором) після перевірки verifyWorker().
// Ніколи не імпортувати в клієнтські компоненти.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
