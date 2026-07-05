import { getTranslations } from 'next-intl/server'
import { RequireAuth } from '@/features/auth/require-auth'

export async function generateMetadata() {
  const t = await getTranslations('Common')
  return {
    title: t('appName'),
  }
}

export default async function DashboardPage() {
  const t = await getTranslations('Common')

  return (
    <RequireAuth>
      <section className="flex flex-col gap-6">
        <h1 className="text-3xl font-bold text-navy">{t('appName')}</h1>
        <p className="text-muted-foreground">{t('tagline')}</p>
      </section>
    </RequireAuth>
  )
}
