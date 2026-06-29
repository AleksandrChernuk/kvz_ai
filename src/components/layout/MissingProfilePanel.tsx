"use client"

import { useRouter } from "next/navigation"
import { AlertTriangle, LogOut, RotateCcw } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

export function MissingProfilePanel() {
  const router = useRouter()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <section className="flex max-w-md flex-col items-center gap-4 text-center">
        <AlertTriangle className="size-10 text-amber-600 dark:text-amber-500" />
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Профіль ще не готовий</h1>
          <p className="text-sm text-muted-foreground">
            Не вдалося знайти або створити профіль для цього акаунта. Спробуйте
            ще раз або вийдіть і зайдіть повторно.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={() => router.refresh()}>
            <RotateCcw className="size-4" />
            Повторити
          </Button>
          <Button type="button" variant="outline" onClick={signOut}>
            <LogOut className="size-4" />
            Вийти
          </Button>
        </div>
      </section>
    </main>
  )
}
