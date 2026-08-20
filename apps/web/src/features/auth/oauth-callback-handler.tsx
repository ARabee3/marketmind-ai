'use client'

import { useEffect, useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useRouter, Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSession } from './session-provider'
import { GoogleAuthButton } from './google-auth-button'
import { AuthCard } from './auth-card'
import { authStyles } from './auth-styles'
import { publicRequest } from '@/lib/api'

type OAuthErrorCode =
  | 'OAUTH_STATE_MISMATCH'
  | 'OAUTH_PROVIDER_ERROR'
  | 'OAUTH_EMAIL_ALREADY_USED_PASSWORD'
  | 'FEDERATED_IDENTITY_CONFLICT'
  | 'AUTH_RATE_LIMITED'
  | 'OAUTH_ACCOUNT_SUSPENDED'
  | 'OAUTH_ACCOUNT_DISABLED'
  | 'OAUTH_CONFIGURATION_ERROR'

const errorCodeToTranslationKey = {
  OAUTH_STATE_MISMATCH: {
    title: 'oauthStateMismatchTitle',
    description: 'oauthStateMismatchDescription',
  },
  OAUTH_PROVIDER_ERROR: {
    title: 'oauthProviderErrorTitle',
    description: 'oauthProviderErrorDescription',
  },
  OAUTH_EMAIL_ALREADY_USED_PASSWORD: {
    title: 'oauthEmailAlreadyUsedPasswordTitle',
    description: 'oauthEmailAlreadyUsedPasswordDescription',
  },
  FEDERATED_IDENTITY_CONFLICT: {
    title: 'oauthFederatedIdentityConflictTitle',
    description: 'oauthFederatedIdentityConflictDescription',
  },
  AUTH_RATE_LIMITED: {
    title: 'oauthRateLimitedTitle',
    description: 'oauthRateLimitedDescription',
  },
  OAUTH_ACCOUNT_SUSPENDED: {
    title: 'oauthAccountSuspendedTitle',
    description: 'oauthAccountSuspendedDescription',
  },
  OAUTH_ACCOUNT_DISABLED: {
    title: 'oauthAccountDisabledTitle',
    description: 'oauthAccountDisabledDescription',
  },
  OAUTH_CONFIGURATION_ERROR: {
    title: 'oauthConfigurationErrorTitle',
    description: 'oauthConfigurationErrorDescription',
  },
} as const

export function OAuthCallbackHandler() {
  const t = useTranslations('Auth')
  const tCommon = useTranslations('Common')
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isLoading, isAuthenticated, refresh } = useSession()
  const [isRetrying, setIsRetrying] = useState(false)
  const [suspensionDetail, setSuspensionDetail] = useState<{
    ticket: string
    reason: string | null
  } | null>(null)

  const status = searchParams.get('status')
  const errorCode = searchParams.get('error')
  const errorTicket = searchParams.get('error_ticket')
  const suspensionReason =
    errorTicket && suspensionDetail?.ticket === errorTicket
      ? suspensionDetail.reason
      : null

  useEffect(() => {
    if (status !== 'success') return
    if (isLoading) return
    if (isAuthenticated) {
      router.replace('/dashboard')
    }
  }, [status, isLoading, isAuthenticated, router])

  const handleRetry = useCallback(async () => {
    setIsRetrying(true)
    try {
      const token = await refresh()
      if (token) {
        router.replace('/dashboard')
      }
    } catch {
      // Keep the recovery screen visible and let the owner retry explicitly.
    } finally {
      setIsRetrying(false)
    }
  }, [refresh, router])

  useEffect(() => {
    if (errorCode !== 'OAUTH_ACCOUNT_SUSPENDED' || !errorTicket) return

    let cancelled = false
    void publicRequest(`/auth/oauth/error?ticket=${encodeURIComponent(errorTicket)}`)
      .then(async (response) => {
        if (!response.ok) return null
        const payload = (await response.json()) as { reason?: unknown } | null
        return typeof payload?.reason === 'string' ? payload.reason : null
      })
      .then((reason) => {
        if (!cancelled) setSuspensionDetail({ ticket: errorTicket, reason })
      })
      .catch(() => {
        if (!cancelled) setSuspensionDetail({ ticket: errorTicket, reason: null })
      })

    return () => {
      cancelled = true
    }
  }, [errorCode, errorTicket])

  if (status === 'success') {
    if (isLoading) {
      return (
        <div role="status" aria-live="polite">
          <AuthCard title={t('oauthCompletingSignIn')}>
            <div className="flex justify-center py-4">
              <span aria-hidden className="size-7 animate-pulse motion-reduce:animate-none rounded-full bg-primary/40" />
            </div>
          </AuthCard>
        </div>
      )
    }

    if (isAuthenticated) {
      // Returning null avoids a flash of content while the redirect effect
      // navigates to the localized dashboard.
      return null
    }

    return (
      <div role="alert">
        <AuthCard
          title={t('oauthRetryTitle')}
          description={t('oauthRetryDescription')}
        >
          <div className="flex flex-col gap-4">
            <Button
              onClick={handleRetry}
              disabled={isRetrying}
              className={authStyles.primaryButton}
            >
              {isRetrying ? tCommon('loading') : t('oauthRetryButton')}
            </Button>
            <Link
              href="/login"
              className={cn(buttonVariants({ variant: 'outline' }), authStyles.outlineButton)}
            >
              {t('oauthBackToSignIn')}
            </Link>
          </div>
        </AuthCard>
      </div>
    )
  }

  const errorKeys =
    errorCode && errorCode in errorCodeToTranslationKey
      ? errorCodeToTranslationKey[errorCode as OAuthErrorCode]
      : ({
          title: 'oauthUnknownErrorTitle',
          description: 'oauthUnknownErrorDescription',
        } as const)

  return (
    <div role="alert">
      <AuthCard
        title={t(errorKeys.title)}
        description={t(errorKeys.description)}
      >
        {(errorCode === 'OAUTH_ACCOUNT_SUSPENDED' ||
          errorCode === 'OAUTH_ACCOUNT_DISABLED') && (
          <div className="mb-4 space-y-2 text-start">
            {errorCode === 'OAUTH_ACCOUNT_SUSPENDED' && (
              <p dir="auto" className="text-sm">
                {suspensionReason
                  ? t('suspensionReason', { reason: suspensionReason })
                  : t('suspensionReasonUnavailable')}
              </p>
            )}
            <a
              href={`mailto:${t('supportEmail')}`}
              className={authStyles.actionLink}
            >
              {t('contactSupport')}
            </a>
          </div>
        )}
        <div className="flex flex-col gap-4">
          <Link
            href="/login"
            className={cn(buttonVariants({ variant: 'outline' }), authStyles.outlineButton)}
          >
            {t('oauthBackToSignIn')}
          </Link>
          <GoogleAuthButton showDivider={false} />
        </div>
      </AuthCard>
    </div>
  )
}
