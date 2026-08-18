import { Card, CardContent } from "@/components/ui/card"
import { Link } from "@/i18n/navigation"
import { cn } from "@/lib/utils"

export function StatTile({
  label,
  value,
  subtext,
  href,
  ariaLabel,
  className,
}: {
  label: string
  value: string
  subtext?: string
  href?: string
  ariaLabel?: string
  className?: string
}) {
  const card = (
    <Card
      className={cn(
        "border-border shadow-sm transition-transform hover:-translate-y-0.5",
        href && "hover:border-primary/60 hover:bg-soft-teal",
        className,
      )}
      size="sm"
    >
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

  if (href) {
    return (
      <Link
        href={href}
        aria-label={ariaLabel}
        className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
      >
        {card}
      </Link>
    )
  }

  return card
}
