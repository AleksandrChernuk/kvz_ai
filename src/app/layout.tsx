import type { Metadata } from "next"
import "./globals.css"
import { ThemeProvider } from "@/components/theme/ThemeProvider"
import { Toaster } from "@/components/ui/sonner"

export const metadata: Metadata = {
  title: "KVZ AI",
  description: "Внутрішня AI-система КВЗ",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="uk" className="h-full antialiased" suppressHydrationWarning>
      <body className="flex h-full flex-col overflow-hidden font-sans">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
