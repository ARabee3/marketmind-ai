import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { LoginForm } from '@/features/auth/login-form'
import { GoogleAuthButton } from '@/features/auth/google-auth-button'
import { AuthCard } from '@/features/auth/auth-card'
import { authStyles } from '@/features/auth/auth-styles'

export async function generateMetadata() {
  const t = await getTranslations('Auth')
  return {
    title: t('loginTitle'),
  }
}

export default async function LoginPage() {
  const t = await getTranslations('Auth')

  return (
    <AuthCard
      title={t('loginTitle')}
      description={t('loginDescription')}
      footer={
        <>
          {t('loginNoAccount')}{' '}
          <Link href="/register" className={authStyles.actionLink}>
            {t('registerSubmit')}
          </Link>
        </>
      }
    >
      <div className="mb-4">
        <GoogleAuthButton />
      </div>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
      <p className="mt-3 text-center text-sm">
        <Link href="/forgot-password" className={authStyles.actionLink}>
          {t('loginForgotPassword')}
        </Link>
      </p>
    </AuthCard>
  )
}
