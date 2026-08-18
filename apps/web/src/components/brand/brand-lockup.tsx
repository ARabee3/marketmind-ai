import { cn } from '@/lib/utils'
import { BrandMark } from './brand-mark'

type BrandLockupVariant = 'default' | 'inverse' | 'mono'

export function BrandLockup({
  label,
  className,
  markClassName,
  wordmarkClassName,
  variant = 'default',
}: {
  readonly label: string
  readonly className?: string
  readonly markClassName?: string
  readonly wordmarkClassName?: string
  readonly variant?: BrandLockupVariant
}) {
  const normalizedLabel = label.trim()
  const isMarketMind = /^marketmind(?:\s+ai)?$/i.test(normalizedLabel)

  return (
    <span
      role="img"
      aria-label={normalizedLabel}
      translate="no"
      dir="ltr"
      className={cn('inline-flex min-w-0 items-center gap-1.5 leading-none', className)}
    >
      <BrandMark className={cn('size-7 shrink-0', markClassName)} variant={variant} />
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex items-center whitespace-nowrap font-latin text-[17px] font-bold tracking-[-0.045em] leading-none',
          variant === 'inverse' ? 'text-white' : 'text-navy',
          wordmarkClassName,
        )}
      >
        {isMarketMind ? (
          <>
            <span>Market</span>
            <span className={variant === 'inverse' ? 'text-journey-mint' : variant === 'mono' ? 'text-current' : 'text-primary'}>
              Mind
            </span>
          </>
        ) : (
          normalizedLabel
        )}
      </span>
    </span>
  )
}
