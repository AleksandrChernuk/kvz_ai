import { Badge } from "@/components/ui/badge"
import { ROLE_COLORS, ROLE_LABELS, type UserRole } from "@/types/roles"

export function RoleBadge({ role }: { role: UserRole }) {
  return <Badge variant={ROLE_COLORS[role]}>{ROLE_LABELS[role]}</Badge>
}
