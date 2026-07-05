'use client'

import { useEffect, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/navigation'
import { useSession } from './session-provider'

export type RequireAuthProps = {
  children: ReactNode
}

export function RequireAuth({ children }: RequireAuthProps) {
  const t = useTranslations('Common')
  const { isLoading, isAuthenticated } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      // next-intl's router preserves the active locale prefix automatically.
      const returnUrl = encodeURIComponent(pathname)
      router.replace(`/login?from=${returnUrl}`)
    }
  }, [isLoading, isAuthenticated, router, pathname])

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">{t('loading')}</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    // Returning null avoids a flash of protected content while the redirect
    // effect navigates to the localized login route.
    return null
  }

  return children
}
