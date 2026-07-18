import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { RegisterForm } from '@/features/auth/register-form'
import { GoogleAuthButton } from '@/features/auth/google-auth-button'
import { AuthCard } from '@/features/auth/auth-card'
import { authStyles } from '@/features/auth/auth-styles'

export async function generateMetadata() {
  const t = await getTranslations('Auth')
  return {
    title: t('registerTitle'),
  }
}

export default async function RegisterPage() {
  const t = await getTranslations('Auth')

  return (
    <AuthCard
      title={t('registerTitle')}
      description={t('registerDescription')}
      footer={
        <>
          {t('registerHaveAccount')}{' '}
          <Link href="/login" className={authStyles.actionLink}>
            {t('loginSubmit')}
          </Link>
        </>
      }
    >
      <div className="mb-4">
        <GoogleAuthButton />
      </div>
      <RegisterForm />
    </AuthCard>
  )
}
