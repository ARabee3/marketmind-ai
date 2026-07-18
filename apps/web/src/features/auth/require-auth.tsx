'use client'

import { useEffect, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/navigation'
import { useSession } from './session-provider'

export type RequireAuthProps = {
  children: ReactNode
}

/**
 * Client-side auth UX layer for the workspace shell: avoids flashing protected
 * content and drives a localized redirect after a session expires mid-session.
 *
 * This is NOT the authorization boundary. Workspace authorization is enforced
 * server-side by the prefilter in `src/proxy.ts`, which validates the HttpOnly
 * refresh cookie via the non-rotating `/auth/session` endpoint before any
 * workspace Server Component renders. Nest JWT/RBAC guards remain the final
 * data-access boundary. This component only smooths the client experience.
 */
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
