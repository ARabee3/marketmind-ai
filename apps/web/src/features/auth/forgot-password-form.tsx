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

type ForgotPasswordFormErrors = {
  email?: ValidationErrorKey
  root?: 'errorRateLimited' | 'errorRecoveryFailed'
}

export function ForgotPasswordForm() {
  const t = useTranslations('Auth')
  const tCommon = useTranslations('Common')
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState<ForgotPasswordFormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  const validate = useCallback((): boolean => {
    const next: ForgotPasswordFormErrors = {}
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
        const response = await publicRequest('/auth/forgot-password', {
          method: 'POST',
          body: { email: email.trim() },
        })

        if (response.ok) {
          setIsSuccess(true)
          return
        }

        const code = await parseBackendErrorCode(response)
        const key = mapBackendErrorToKey(code, 'errorRecoveryFailed')
        setErrors({ root: key })
      } catch {
        setErrors({ root: 'errorRecoveryFailed' })
      } finally {
        setIsSubmitting(false)
      }
    },
    [validate, email],
  )

  if (isSuccess) {
    return (
      <div
        role="status"
        className="flex flex-col gap-4 rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground"
      >
        <p className="font-medium">{t('forgotPasswordSuccessTitle')}</p>
        <p>{t('forgotPasswordSuccessBody')}</p>
        <Link
          href="/login"
          className="font-medium text-action hover:underline"
        >
          {t('forgotPasswordBackToLogin')}
        </Link>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
      noValidate
      aria-label={t('forgotPasswordTitle')}
    >
      <p className="text-sm text-muted-foreground">
        {t('forgotPasswordDescription')}
      </p>

      {errors.root && (
        <div
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t(errors.root)}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">{t('forgotPasswordEmailLabel')}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t('forgotPasswordEmailPlaceholder')}
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
        {isSubmitting ? tCommon('loading') : t('forgotPasswordSubmit')}
      </Button>

      <Link
        href="/login"
        className="text-center text-sm text-muted-foreground hover:underline"
      >
        {t('forgotPasswordBackToLogin')}
      </Link>
    </form>
  )
}