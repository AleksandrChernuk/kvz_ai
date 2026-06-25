export type UserRole = "admin" | "manager" | "engineer" | "viewer"

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Адмін",
  manager: "Менеджер",
  engineer: "Інженер",
  viewer: "Перегляд",
}

// Значення відповідають variant у shadcn Badge
export const ROLE_COLORS: Record<UserRole, "default" | "secondary" | "destructive" | "outline"> = {
  admin: "destructive",
  manager: "default",
  engineer: "secondary",
  viewer: "outline",
}
