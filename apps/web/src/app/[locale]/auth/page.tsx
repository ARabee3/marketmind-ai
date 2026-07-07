import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

export default async function AuthPage() {
  const t = await getTranslations('Auth')

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-sm items-center justify-center">
      <div className="w-full rounded-lg border border-border bg-card p-8 text-card-foreground shadow-sm">
        <h1 className="mb-6 text-center text-2xl font-bold text-navy">
          {t('loginTitle')}
        </h1>

        <form className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">{t('loginEmailLabel')}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder={t('loginEmailPlaceholder')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">{t('loginPasswordLabel')}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder={t('loginPasswordPlaceholder')}
            />
          </div>

          <Button type="submit" className="mt-2 w-full">
            {t('loginSubmit')}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('loginNoAccount')}{' '}
          <Link href="/discovery" className="font-medium text-action hover:underline">
            {t('signupSubmit')}
          </Link>
        </p>
      </div>
    </div>
  )
}