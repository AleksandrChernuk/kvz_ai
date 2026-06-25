"use client"

import { useRef, useState } from "react"
import { SendHorizontal } from "lucide-react"
import { toast } from "sonner"

import type { UserRole } from "@/types/roles"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Props = {
  threadId: string
  userRole: UserRole
  disabled?: boolean
  // Оптимістичне додавання повідомлення юзера у вікно чату; повертає id
  // доданого оптимістичного повідомлення, щоб відкотити його при помилці.
  onSend?: (content: string) => string | undefined
  onSendFailed?: (optimisticId: string) => void
}

export function InputBar({ threadId, disabled, onSend, onSendFailed }: Props) {
  const [value, setValue] = useState("")
  const [pending, setPending] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  function autoResize() {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    // max ~5 рядків (≈ 120px)
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  async function send() {
    const content = value.trim()
    if (!content || pending) return

    setPending(true)
    const optimisticId = onSend?.(content)
    setValue("")
    requestAnimationFrame(autoResize)

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, thread_id: threadId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "Не вдалося надіслати повідомлення")
      }
    } catch (e) {
      // Відкочуємо оптимістичне повідомлення — інакше у чаті висить фантом,
      // якого немає в базі.
      if (optimisticId) onSendFailed?.(optimisticId)
      setValue(content)
      toast.error("Помилка", {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-end gap-2 border-t p-3">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        disabled={disabled || pending}
        placeholder="Напишіть повідомлення…"
        className={cn(
          "flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs",
          "outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
        onChange={(e) => {
          setValue(e.target.value)
          autoResize()
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            send()
          }
        }}
      />
      <Button
        size="icon"
        onClick={send}
        disabled={disabled || pending || !value.trim()}
      >
        <SendHorizontal className="size-4" />
      </Button>
    </div>
  )
}
