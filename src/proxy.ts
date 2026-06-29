import { type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Зіставляє всі шляхи, крім:
     * - api (worker-ендпоінти автентифікуються WORKER_TOKEN, route-handler-и —
     *   власною перевіркою; cookie-редірект на /login їх ламав би)
     * - _next/static, _next/image
     * - favicon.ico
     * - статичних файлів (svg/png/jpg/...)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
