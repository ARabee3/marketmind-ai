import type { ReactNode } from 'react'
import { LandingShell } from '@/features/landing/landing-shell'

type Props = {
  children: ReactNode
  params: Promise<{ locale: string }>
}

export default async function PublicLandingLayout({ children, params }: Props) {
  const { locale } = await params

  return <LandingShell locale={locale}>{children}</LandingShell>
}
