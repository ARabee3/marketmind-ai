'use client'

import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { EASE, useReducedMotion } from '../lib/motion'

type RevealProps = {
  readonly children: ReactNode
  readonly className?: string
  readonly delay?: number
  readonly y?: number
  readonly viewportMargin?: string
  readonly once?: boolean
}

/**
 * Thin client animation island: wraps already server-rendered children in a
 * framer-motion `whileInView` reveal. Children flow through as server HTML
 * (crawlable); only cosmetic opacity/translate is animated. Respects
 * prefers-reduced-motion by rendering children with no animation wrapper.
 */
export function Reveal({
  children,
  className = '',
  delay = 0,
  y = 24,
  viewportMargin = '-15%',
  once = true,
}: RevealProps) {
  const reduced = useReducedMotion()

  if (reduced) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: viewportMargin }}
      transition={{ duration: 0.42, ease: EASE.decel, delay }}
    >
      {children}
    </motion.div>
  )
}