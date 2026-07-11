import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { LoginForm } from '@/features/auth/login-form'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export async function generateMetadata() {
  const t = await getTranslations('Auth')
  return {
    title: t('loginTitle'),
  }
}

export default async function LoginPage() {
  const t = await getTranslations('Auth')

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-sm items-center justify-center px-4">
      <Card className="w-full">
        <CardHeader className="text-center">
          <CardTitle>{t('loginTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t('loginNoAccount')}{' '}
            <Link
              href="/register"
              className="font-medium text-action hover:underline"
            >
              {t('registerSubmit')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
