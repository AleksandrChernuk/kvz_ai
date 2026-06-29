"use client"

import { SidebarTrigger } from "@/components/ui/sidebar"

export function DashboardAppBar() {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger />
    </header>
  )
}
