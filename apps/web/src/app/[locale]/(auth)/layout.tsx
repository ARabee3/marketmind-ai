import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'

type Props = {
  children: ReactNode
}

export default async function AuthLayout({ children }: Props) {
  const t = await getTranslations('Common')

  return (
    <main className="min-h-dvh bg-bg px-4 py-8">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <Link href="/" className="font-latin text-lg font-bold text-navy">
          {t('appName')}
        </Link>
      </div>
      {children}
    </main>
  )
}
