import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { ForgotPasswordForm } from '@/features/auth/forgot-password-form'
import { AuthCard } from '@/features/auth/auth-card'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth')
  return { title: t('forgotPasswordTitle') }
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations('Auth')

  return (
    <AuthCard
      title={t('forgotPasswordTitle')}
      description={t('forgotPasswordDescription')}
    >
      <Suspense fallback={null}>
        <ForgotPasswordForm />
      </Suspense>
    </AuthCard>
  )
}
