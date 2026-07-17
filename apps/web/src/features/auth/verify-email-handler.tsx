'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { publicRequest } from '@/lib/api'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { parseBackendErrorCode } from './auth-errors'
import { ResendVerificationForm } from './resend-verification-form'
import { authStyles } from './auth-styles'

type VerifyState = 'verifying' | 'success' | 'expired' | 'invalid' | 'rateLimited' | 'missing'

export function VerifyEmailHandler() {
  const t = useTranslations('Auth')
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [state, setState] = useState<VerifyState>(token ? 'verifying' : 'missing')
  const [isInlineResendOpen, setIsInlineResendOpen] = useState(false)

  useEffect(() => {
    if (!token) return

    let cancelled = false

    void (async () => {
      try {
        const response = await publicRequest('/auth/verify-email', {
          method: 'POST',
          body: { token },
        })

        if (response.ok) {
          if (!cancelled) setState('success')
          return
        }

        const code = await parseBackendErrorCode(response)
        if (cancelled) return
        if (code === 'ACTION_TOKEN_EXPIRED') setState('expired')
        else if (code === 'ACTION_TOKEN_CONSUMED') setState('invalid')
        else if (code === 'RATE_LIMIT_EXCEEDED') setState('rateLimited')
        else setState('invalid')
      } catch {
        if (!cancelled) setState('invalid')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [token])

  if (state === 'verifying') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-3 py-4 text-center text-sm text-muted-foreground"
      >
        <span aria-hidden className="size-6 animate-pulse rounded-full bg-primary/40" />
        {t('verifyEmailVerifying')}
      </div>
    )
  }

  if (state === 'success') {
    return (
      <div role="status" className={authStyles.success}>
        <p className="font-medium">{t('verifyEmailSuccessTitle')}</p>
        <p>{t('verifyEmailSuccessBody')}</p>
        <Link href="/login" className={cn(buttonVariants(), 'mt-1 w-full')}>
          {t('verifyEmailSignIn')}
        </Link>
      </div>
    )
  }

  if (state === 'missing') {
    return (
      <div role="alert" className={authStyles.alert}>
        <p>{t('verifyEmailMissingTokenBody')}</p>
        <Link href="/login" className={authStyles.actionLink}>
          {t('verifyEmailSignIn')}
        </Link>
      </div>
    )
  }

  if (state === 'rateLimited') {
    return (
      <div role="alert" className={authStyles.alert}>
        <p className="font-medium">{t('verifyEmailRateLimitedTitle')}</p>
        <p>{t('verifyEmailRateLimitedBody')}</p>
        <Link href="/login" className={authStyles.actionLink}>
          {t('verifyEmailSignIn')}
        </Link>
      </div>
    )
  }

  // state === 'expired' | 'invalid'
  const titleKey =
    state === 'expired' ? 'verifyEmailExpiredTitle' : 'verifyEmailInvalidTitle'
  const bodyKey =
    state === 'expired' ? 'verifyEmailExpiredBody' : 'verifyEmailInvalidBody'

  return (
    <div className="flex flex-col gap-4">
      <div role="alert" className={authStyles.alert}>
        <p className="font-medium">{t(titleKey)}</p>
        <p>{t(bodyKey)}</p>
      </div>

      {isInlineResendOpen ? (
        <ResendVerificationForm mode="inline" />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            {t('verifyEmailResendPrompt')}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsInlineResendOpen(true)}
          >
            {t('verifyEmailResendAction')}
          </Button>
          <Link
            href="/login"
            className={authStyles.quietLink}
          >
            {t('verifyEmailSignIn')}
          </Link>
        </div>
      )}
    </div>
  )
}
