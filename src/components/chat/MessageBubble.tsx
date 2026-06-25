import type { Message } from "@/types/database"
import { cn } from "@/lib/utils"
import { TaskStatusBadge } from "@/components/chat/TaskStatusBadge"

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user"

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className="flex max-w-[80%] flex-col">
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          )}
        >
          {message.content}
        </div>
        <div
          className={cn(
            "mt-1 flex items-center gap-2 text-[10px] text-muted-foreground",
            isUser ? "justify-end" : "justify-start"
          )}
        >
          <span>{formatTime(message.created_at)}</span>
        </div>
        {message.task_id && <TaskStatusBadge taskId={message.task_id} />}
      </div>
    </div>
  )
}
