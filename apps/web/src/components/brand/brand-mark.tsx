import { cn } from '@/lib/utils'

type BrandMarkVariant = 'default' | 'inverse' | 'mono'

const VARIANT_CLASSES: Record<BrandMarkVariant, readonly [string, string, string]> = {
  default: ['text-primary', 'text-navy', 'text-primary'],
  inverse: ['text-journey-mint', 'text-white', 'text-journey-mint'],
  mono: ['text-current', 'text-current', 'text-current'],
}

export function BrandMark({
  className,
  variant = 'default',
}: {
  readonly className?: string
  readonly variant?: BrandMarkVariant
}) {
  const [start, peak, loop] = VARIANT_CLASSES[variant]

  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0 overflow-visible', className)}
    >
      <path
        d="M7 36V11L24 27"
        className={start}
        stroke="currentColor"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M24 27L41 11V25"
        className={peak}
        stroke="currentColor"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M41 25C41 34 35 40 26 40H18"
        className={loop}
        stroke="currentColor"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
