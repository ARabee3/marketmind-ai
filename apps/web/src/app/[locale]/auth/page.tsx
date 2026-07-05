import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'

export default async function AuthPage() {
  const t = await getTranslations('Auth')

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8">
        <h1 className="text-2xl font-bold text-navy mb-6 text-center">
          {t('loginTitle')}
        </h1>

        <form className="flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-navy mb-1">
              {t('loginEmailLabel')}
            </label>
            <input
              id="email"
              type="email"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-navy placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="name@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-navy mb-1">
              {t('loginPasswordLabel')}
            </label>
            <input
              id="password"
              type="password"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-navy placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
          >
            {t('loginSubmit')}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          {t('loginNoAccount')}{' '}
          <Link href="/auth" className="font-medium text-action hover:underline">
            {t('signupSubmit')}
          </Link>
        </p>
      </div>
    </div>
  )
}
