import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { VerifyEmailHandler } from '@/features/auth/verify-email-handler'
import { AuthCard } from '@/features/auth/auth-card'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth')
  return { title: t('verifyEmailTitle') }
}

export default async function VerifyEmailPage() {
  const t = await getTranslations('Auth')

  return (
    <AuthCard
      title={t('verifyEmailTitle')}
      description={t('verifyEmailDescription')}
    >
      <Suspense fallback={null}>
        <VerifyEmailHandler />
      </Suspense>
    </AuthCard>
  )
}
