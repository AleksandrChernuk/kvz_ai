"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { BrandLogo } from "@/components/layout/BrandLogo"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    if (!email || !password) {
      toast.error("Введіть email і пароль")
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)

    if (error) {
      toast.error("Невірний email або пароль")
      return
    }

    router.push("/chat")
    router.refresh()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleLogin()
      }}
      className="w-full max-w-sm"
    >
      <Card>
      <CardHeader className="justify-items-center text-center">
        <BrandLogo className="mx-auto w-40" priority />
        <CardTitle className="sr-only">KVZ AI</CardTitle>
        <CardDescription>Увійдіть, щоб продовжити</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@kvz.ua"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-sm font-medium">
            Пароль
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
        </div>
        <Button type="submit" disabled={loading} className="w-full">
          {loading && <Loader2 className="animate-spin" />}
          Увійти
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Доступ надається адміністратором
        </p>
      </CardContent>
      </Card>
    </form>
  )
}
