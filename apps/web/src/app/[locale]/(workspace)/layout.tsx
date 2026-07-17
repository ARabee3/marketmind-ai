import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { AppShell } from '@/components/layout/app-shell'
import { RequireAuth } from '@/features/auth/require-auth'

type Props = {
  children: ReactNode
}

export default async function WorkspaceLayout({ children }: Props) {
  const t = await getTranslations('Common')

  return (
    <RequireAuth>
      <AppShell brandName={t('appName')}>{children}</AppShell>
    </RequireAuth>
  )
}
