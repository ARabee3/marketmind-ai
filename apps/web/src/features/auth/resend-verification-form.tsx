'use client'

import { useState, useCallback, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { publicRequest } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { validateEmail, type ValidationErrorKey } from './validation'
import { mapBackendErrorToKey, parseBackendErrorCode } from './auth-errors'

type ResendVerificationFormErrors = {
  email?: ValidationErrorKey
  root?: 'errorRateLimited' | 'errorResendFailed'
}

const styles = {
  wrapper: 'flex flex-col gap-4 rounded-md bg-secondary px-3 py-3 text-sm text-secondary-foreground',
  alert: 'rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive',
} as const

type ResendVerificationMode = 'standalone' | 'inline'

export interface ResendVerificationFormProps {
  /** standalone mode renders a back-to-login link; inline mode doesn't. */
  mode?: ResendVerificationMode
  /** Optional prefilled email (e.g. when invoked inline post-registration). */
  defaultEmail?: string
  /** Called after a successful submit so the parent can update its UI. */
  onSuccess?: () => void
}

export function ResendVerificationForm({
  mode = 'standalone',
  defaultEmail = '',
  onSuccess,
}: ResendVerificationFormProps) {
  const t = useTranslations('Auth')
  const tCommon = useTranslations('Common')
  const [email, setEmail] = useState(defaultEmail)
  const [errors, setErrors] = useState<ResendVerificationFormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  const validate = useCallback((): boolean => {
    const next: ResendVerificationFormErrors = {}
    const emailError = validateEmail(email)
    if (emailError) next.email = emailError
    setErrors(next)
    return Object.keys(next).length === 0
  }, [email])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!validate()) return

      setIsSubmitting(true)
      setErrors({})

      try {
        const response = await publicRequest('/auth/resend-verification', {
          method: 'POST',
          body: { email: email.trim() },
        })

        if (response.ok) {
          setIsSuccess(true)
          onSuccess?.()
          return
        }

        const code = await parseBackendErrorCode(response)
        const key = mapBackendErrorToKey(code, 'errorResendFailed')
        setErrors({ root: key })
      } catch {
        setErrors({ root: 'errorResendFailed' })
      } finally {
        setIsSubmitting(false)
      }
    },
    [validate, email, onSuccess],
  )

  if (isSuccess) {
    return (
      <div role="status" className={styles.wrapper}>
        <p className="font-medium">{t('resendVerificationSuccessTitle')}</p>
        <p>{t('resendVerificationSuccessBody')}</p>
        {mode === 'standalone' && (
          <Link
            href="/login"
            className="font-medium text-action hover:underline"
          >
            {t('resendVerificationBackToLogin')}
          </Link>
        )}
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
      noValidate
      aria-label={t('resendVerificationTitle')}
    >
      {mode === 'standalone' && (
        <p className="text-sm text-muted-foreground">
          {t('resendVerificationDescription')}
        </p>
      )}

      {errors.root && (
        <div role="alert" className={styles.alert}>
          {t(errors.root)}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">{t('resendVerificationEmailLabel')}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t('resendVerificationEmailPlaceholder')}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={errors.email ? 'true' : 'false'}
          aria-describedby={errors.email ? 'email-error' : undefined}
        />
        {errors.email && (
          <p id="email-error" className="text-sm text-destructive">
            {t(errors.email)}
          </p>
        )}
      </div>

      <Button type="submit" className="mt-2 w-full" disabled={isSubmitting}>
        {isSubmitting ? tCommon('loading') : t('resendVerificationSubmit')}
      </Button>

      {mode === 'standalone' && (
        <Link
          href="/login"
          className="text-center text-sm text-muted-foreground hover:underline"
        >
          {t('resendVerificationBackToLogin')}
        </Link>
      )}
    </form>
  )
}