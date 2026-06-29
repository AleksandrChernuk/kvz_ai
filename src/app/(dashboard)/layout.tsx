import { redirect } from "next/navigation"

import { getOrCreateProfile } from "@/lib/ensure-profile"
import { createClient } from "@/lib/supabase/server"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { MissingProfilePanel } from "@/components/layout/MissingProfilePanel"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const profile = await getOrCreateProfile(supabase, user)

  if (!profile) {
    return <MissingProfilePanel />
  }

  return (
    <SidebarProvider>
      <AppSidebar profile={profile} />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
        </header>
        <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
