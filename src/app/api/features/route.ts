import { NextResponse } from "next/server"

import { isManagedFeature } from "@/lib/access"
import { listFeatures } from "@/lib/features"
import { createClient } from "@/lib/supabase/server"
import { isUserRole } from "@/lib/validate"
import type { Profile, RoleFeature } from "@/types/database"

// GET /api/features — увімкнені фічі ролі поточного юзера.
// UI використовує для показу/приховування розділів (training, connectors_manage, …).
export async function GET(req: Request) {
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

  if (new URL(req.url).searchParams.get("scope") === "all") {
    if (profile.role !== "admin") {
      return NextResponse.json({ error: "Лише для admin" }, { status: 403 })
    }

    const { data, error } = await supabase
      .from("role_features")
      .select("*")
      .order("feature")
      .returns<RoleFeature[]>()

    if (error) {
      return NextResponse.json(
        { error: "Не вдалося отримати доступи" },
        { status: 500 }
      )
    }

    return NextResponse.json({ role: profile.role, features, role_features: data ?? [] })
  }

  return NextResponse.json({ role: profile.role, features })
}

// PATCH /api/features — admin: увімкнути/вимкнути керовану фічу для ролі.
export async function PATCH(req: Request) {
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

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Лише для admin" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const role = body?.role
  const feature = body?.feature
  const enabled = body?.enabled

  if (!isUserRole(role) || !isManagedFeature(feature) || typeof enabled !== "boolean") {
    return NextResponse.json(
      { error: "role, feature, enabled обовʼязкові" },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from("role_features")
    .upsert({ role, feature, enabled }, { onConflict: "role,feature" })
    .select()
    .single<RoleFeature>()

  if (error || !data) {
    return NextResponse.json(
      { error: "Не вдалося оновити доступ" },
      { status: 500 }
    )
  }

  return NextResponse.json({ role_feature: data })
}
