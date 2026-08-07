'use client'

import * as React from 'react'
import { Info } from 'lucide-react'

export type TooltipProps = {
  content: string
  ariaLabel?: string
  className?: string
  iconClassName?: string
}

export function ContextualHelp({
  content,
  ariaLabel,
  className = '',
  iconClassName = 'h-3.5 w-3.5 text-slate-400 hover:text-slate-600 transition-colors',
}: TooltipProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const tipId = React.useId()

  return (
    <span className={`relative inline-flex items-center align-middle ms-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        aria-label={ariaLabel || content}
        aria-describedby={isOpen ? tipId : undefined}
        className="inline-flex items-center justify-center rounded-full p-0.5 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-1 shrink-0 cursor-help"
      >
        <Info className={iconClassName} />
      </button>

      {isOpen && (
        <span
          id={tipId}
          role="tooltip"
          className="absolute bottom-full mb-1.5 start-1/2 ltr:-translate-x-1/2 rtl:translate-x-1/2 z-50 w-60 sm:w-64 rounded-lg bg-[var(--color-navy)] p-2.5 text-xs font-normal text-white shadow-xl leading-relaxed tracking-normal text-start normal-case pointer-events-none border border-slate-700"
        >
          {content}
        </span>
      )}
    </span>
  )
}

export const Tooltip = ContextualHelp
