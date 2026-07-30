import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function StrategyBadge({
  children,
  tone = 'neutral',
}: {
  readonly children: ReactNode
  readonly tone?: 'neutral' | 'good' | 'warning' | 'danger'
}) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-bold',
        tone === 'neutral' && 'border-border bg-background text-muted-foreground',
        tone === 'good' && 'border-primary/20 bg-soft-teal text-primary',
        tone === 'warning' && 'border-warning/20 bg-warning/10 text-warning',
        tone === 'danger' && 'border-destructive/20 bg-destructive/10 text-destructive',
      )}
    >
      {children}
    </span>
  )
}
