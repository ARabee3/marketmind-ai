'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { getLandingCopy, type LandingCopy } from './lib/content'

const LandingCopyContext = createContext<LandingCopy | null>(null)

type Props = {
  children: ReactNode
  locale: string
}

export function LandingCopyProvider({ children, locale }: Props) {
  return (
    <LandingCopyContext.Provider value={getLandingCopy(locale)}>
      {children}
    </LandingCopyContext.Provider>
  )
}

export function useLandingCopy() {
  const copy = useContext(LandingCopyContext)
  if (!copy) {
    throw new Error('LandingCopyProvider is missing')
  }

  return copy
}
