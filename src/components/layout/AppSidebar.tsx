"use client"

import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import { Activity, GitBranch, ListTodo, LogOut, MessageSquare } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import type { Profile } from "@/types/database"
import type { UserRole } from "@/types/roles"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { RoleBadge } from "@/components/layout/RoleBadge"

type NavItem = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: UserRole[] | "all"
}

const NAV: NavItem[] = [
  { href: "/chat",  label: "Чат",      icon: MessageSquare, roles: "all" },
  { href: "/tasks", label: "Таски",    icon: ListTodo,      roles: "all" },
  { href: "/queue", label: "Черга",    icon: Activity,      roles: ["admin"] },
  { href: "/runs",  label: "Запуски",  icon: GitBranch,     roles: ["admin"] },
]

function initials(name: string | null) {
  if (!name) return "?"
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

export function AppSidebar({ profile }: { profile: Profile }) {
  const pathname = usePathname()
  const router = useRouter()

  const items = NAV.filter(
    (i) => i.roles === "all" || i.roles.includes(profile.role)
  )

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-3">
        <span className="text-lg font-semibold">KVZ AI</span>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(item.href + "/")
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active}>
                      <Link href={item.href}>
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-3 p-3">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{initials(profile.full_name)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-sm font-medium">
              {profile.full_name ?? "Без імені"}
            </span>
            <RoleBadge role={profile.role} />
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={handleLogout}
        >
          <LogOut className="size-4" />
          Вийти
        </Button>
      </SidebarFooter>
    </Sidebar>
  )
}
