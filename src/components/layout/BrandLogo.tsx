import Image from "next/image"

import { cn } from "@/lib/utils"

export function BrandLogo({
  className,
  imageClassName,
  priority = false,
}: {
  className?: string
  imageClassName?: string
  priority?: boolean
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center",
        className
      )}
    >
      <Image
        src="/logo_uk_transparent.png"
        alt="Київський вентиляційний завод"
        width={345}
        height={228}
        priority={priority}
        className={cn("h-auto w-full object-contain", imageClassName)}
      />
    </div>
  )
}
