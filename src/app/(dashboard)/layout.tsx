import { redirect } from "next/navigation"

import { getOrCreateProfile } from "@/lib/ensure-profile"
import { createClient } from "@/lib/supabase/server"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { ChatControlsProvider } from "@/components/chat/ChatControlsContext"
import { DashboardAppBar } from "@/components/layout/DashboardAppBar"
import { MissingProfilePanel } from "@/components/layout/MissingProfilePanel"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

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
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
      <ChatControlsProvider>
        <AppSidebar profile={profile} />
        <SidebarInset className="min-h-0 overflow-hidden">
          <DashboardAppBar />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
        </SidebarInset>
      </ChatControlsProvider>
    </SidebarProvider>
  )
}
