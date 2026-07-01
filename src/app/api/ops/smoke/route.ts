import { NextResponse } from "next/server"

import { apiError } from "@/lib/api-error"
import { createAdminClient } from "@/lib/supabase/admin"
import { verifyWorker } from "@/lib/worker-auth"

type SmokeCheck = {
  agents_count: number
  role_agent_access_count: number
  connector_role_access_count: number
  can_role_access_codex_viewer: boolean
  release_stale_locks_available: boolean
}

export async function GET(req: Request) {
  if (!verifyWorker(req)) {
    return NextResponse.json({ error: "Невірний worker token" }, { status: 401 })
  }

  const requiredEnv = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "WORKER_TOKEN",
  ]
  const env = Object.fromEntries(
    requiredEnv.map((name) => [name, Boolean(process.env[name])])
  )

  const { data, error } = await createAdminClient()
    .rpc("ops_smoke_check")
    .single<SmokeCheck>()

  if (error || !data) {
    return apiError(error, 500, "Ops smoke check failed")
  }

  return NextResponse.json({
    ok: true,
    env,
    database: data,
  })
}
