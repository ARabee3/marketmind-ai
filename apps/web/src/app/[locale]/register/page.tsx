import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { RegisterForm } from '@/features/auth/register-form'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export async function generateMetadata() {
  const t = await getTranslations('Auth')
  return {
    title: t('registerTitle'),
  }
}

export default async function RegisterPage() {
  const t = await getTranslations('Auth')

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-sm items-center justify-center px-4">
      <Card className="w-full">
        <CardHeader className="text-center">
          <CardTitle>{t('registerTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <RegisterForm />
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t('registerHaveAccount')}{' '}
            <Link
              href="/login"
              className="font-medium text-action hover:underline"
            >
              {t('loginSubmit')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
