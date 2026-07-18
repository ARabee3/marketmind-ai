import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { ResendVerificationForm } from '@/features/auth/resend-verification-form'
import { AuthCard } from '@/features/auth/auth-card'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth')
  return { title: t('resendVerificationTitle') }
}

export default async function ResendVerificationPage() {
  const t = await getTranslations('Auth')

  return (
    <AuthCard
      title={t('resendVerificationTitle')}
      description={t('resendVerificationDescription')}
    >
      <Suspense fallback={null}>
        <ResendVerificationForm />
      </Suspense>
    </AuthCard>
  )
}
