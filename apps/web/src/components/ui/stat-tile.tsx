import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function StatTile({
  label,
  value,
  subtext,
  className,
}: {
  label: string
  value: string
  subtext?: string
  className?: string
}) {
  return (
    <Card className={cn("border-border shadow-sm", className)} size="sm">
      <CardContent>
        <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          {label}
        </p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-navy">
          {value}
        </p>
        {subtext && (
          <p className="mt-0.5 text-xs text-muted-foreground">{subtext}</p>
        )}
      </CardContent>
    </Card>
  )
}
