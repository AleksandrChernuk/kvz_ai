"use client"

import { useEffect } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"

export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error("dashboard_error", error)
  }, [error])

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <section className="flex max-w-md flex-col items-center gap-4 text-center">
        <AlertTriangle className="size-10 text-destructive" />
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Не вдалося завантажити сторінку</h1>
          <p className="text-sm text-muted-foreground">
            Спробуйте оновити сторінку. Якщо помилка повториться, деталі вже є
            у серверних або браузерних логах.
          </p>
        </div>
        <Button type="button" onClick={() => unstable_retry()}>
          <RotateCcw className="size-4" />
          Повторити
        </Button>
      </section>
    </main>
  )
}
