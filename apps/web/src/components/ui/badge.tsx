import { cn } from "@/lib/utils"

type BadgeVariant =
  | "default"
  | "admin"
  | "owner"
  | "demo"
  | "active"
  | "trialing"
  | "past_due"
  | "expired"
  | "draft"
  | "action"

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-muted text-muted-foreground",
  admin: "bg-navy/10 text-navy",
  owner: "bg-primary/10 text-primary",
  demo: "bg-muted text-muted-foreground",
  active: "bg-primary/10 text-primary",
  trialing: "bg-action/10 text-action",
  past_due: "bg-warning/10 text-warning",
  expired: "bg-danger/10 text-danger",
  draft: "bg-muted text-muted-foreground",
  action: "bg-action/10 text-action",
}

export function Badge({
  variant = "default",
  children,
  className,
}: {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
