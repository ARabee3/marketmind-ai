import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { ResetPasswordForm } from '@/features/auth/reset-password-form'
import { AuthCard } from '@/features/auth/auth-card'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth')
  return { title: t('resetPasswordTitle') }
}

export default async function ResetPasswordPage() {
  const t = await getTranslations('Auth')

  return (
    <AuthCard
      title={t('resetPasswordTitle')}
      description={t('resetPasswordDescription')}
    >
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthCard>
  )
}
