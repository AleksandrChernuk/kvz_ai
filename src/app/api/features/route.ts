import { NextResponse } from "next/server"

import { listFeatures } from "@/lib/features"
import { createClient } from "@/lib/supabase/server"
import type { Profile } from "@/types/database"

// GET /api/features — увімкнені фічі ролі поточного юзера.
// UI використовує для показу/приховування розділів (training, kb_manage, …).
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single<Pick<Profile, "role">>()

  if (!profile) {
    return NextResponse.json({ error: "Профіль не знайдено" }, { status: 403 })
  }

  const features = await listFeatures(supabase, profile.role)
  return NextResponse.json({ role: profile.role, features })
}
