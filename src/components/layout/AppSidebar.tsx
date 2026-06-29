"use client"

import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import {
  Activity,
  GitBranch,
  KeyRound,
  ListTodo,
  LogOut,
  MessageSquare,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { useChatControls } from "@/components/chat/ChatControlsContext"
import type { Profile } from "@/types/database"
import type { UserRole } from "@/types/roles"
import { cn } from "@/lib/utils"
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BrandLogo } from "@/components/layout/BrandLogo"
import { RoleBadge } from "@/components/layout/RoleBadge"
import { ThemeToggle } from "@/components/theme/ThemeToggle"

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
  { href: "/access", label: "Доступи", icon: KeyRound,      roles: ["admin"] },
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
  const {
    activeThreadId,
    creating,
    createThread,
    query,
    setQuery,
    threads,
  } = useChatControls()
  const isChatSection = pathname === "/chat" || pathname.startsWith("/chat/")

  const items = NAV.filter(
    (i) => i.roles === "all" || i.roles.includes(profile.role)
  )
  const filteredThreads = threads.filter((thread) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      thread.title?.toLowerCase().includes(q) ||
      thread.preview?.toLowerCase().includes(q)
    )
  })

  async function deleteThread(id: string) {
    try {
      const res = await fetch(`/api/chat/thread?id=${id}`, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "Не вдалося видалити чат")
      }
      if (id === activeThreadId) router.push("/chat")
      router.refresh()
    } catch (e) {
      toast.error("Помилка", {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-3">
        <BrandLogo className="w-32 self-center" priority />
        {isChatSection && (
          <div className="mt-4 flex flex-col gap-3">
            <Button
              onClick={createThread}
              disabled={creating}
              className="h-8 w-full justify-start rounded-full"
              size="sm"
            >
              <Plus className="size-4" />
              Новий чат
            </Button>

            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Пошук чатів"
                className="h-8 border-0 bg-transparent pr-8 pl-8 shadow-none focus-visible:ring-0"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Очистити пошук"
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
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

        {isChatSection && (
          <SidebarGroup className="gap-2 px-3">
            <p className="px-2 text-xs font-medium text-muted-foreground">
              Нещодавні
            </p>
            <div className="flex flex-col gap-1">
              {filteredThreads.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  {query ? "Нічого не знайдено" : "Поки немає чатів"}
                </p>
              ) : (
                filteredThreads.slice(0, 12).map((thread) => {
                  const active = thread.id === activeThreadId
                  return (
                    <div key={thread.id} className="group/thread relative">
                      <Link
                        href={`/chat/${thread.id}`}
                        className={cn(
                          "flex min-h-8 flex-col justify-center rounded-md px-2 py-1.5 pr-8 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          active &&
                            "bg-sidebar-accent text-sidebar-accent-foreground"
                        )}
                      >
                        <span className="truncate font-medium">
                          {thread.title || "Новий чат"}
                        </span>
                        {thread.preview && (
                          <span className="truncate text-xs text-muted-foreground">
                            {thread.preview}
                          </span>
                        )}
                      </Link>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            type="button"
                            aria-label="Видалити чат"
                            className="absolute top-1.5 right-1.5 hidden rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/thread:block"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Видалити чат?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Повідомлення з цього чату зникнуть зі списку.
                              Дію не можна скасувати.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Скасувати</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteThread(thread.id)}
                              className="bg-destructive text-white hover:bg-destructive/90"
                            >
                              Видалити
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )
                })
              )}
            </div>
          </SidebarGroup>
        )}
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
          <div className="ml-auto">
            <ThemeToggle />
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
