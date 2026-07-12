'use client'

import { useState, useCallback, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { Link, useRouter } from '@/i18n/navigation'
import { publicRequest } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  validatePassword,
  validateConfirmPassword,
  MIN_PASSWORD_LENGTH,
  type ValidationErrorKey,
} from './validation'
import { mapBackendErrorToKey, parseBackendErrorCode } from './auth-errors'

type ResetPasswordFormErrors = {
  password?: ValidationErrorKey
  confirmPassword?: ValidationErrorKey
  root?:
    | 'errorTokenExpired'
    | 'errorTokenInvalid'
    | 'errorTokenConsumed'
    | 'errorRateLimited'
    | 'errorResetFailed'
}

type View = 'form' | 'expired' | 'invalid' | 'success'

export function ResetPasswordForm() {
  const t = useTranslations('Auth')
  const tCommon = useTranslations('Common')
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<ResetPasswordFormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [view, setView] = useState<View>(token ? 'form' : 'invalid')

  const validate = useCallback((): boolean => {
    const next: ResetPasswordFormErrors = {}
    const passwordError = validatePassword(password)
    if (passwordError) next.password = passwordError
    const confirmError = validateConfirmPassword(password, confirmPassword)
    if (confirmError) next.confirmPassword = confirmError
    setErrors(next)
    return Object.keys(next).length === 0
  }, [password, confirmPassword])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!validate() || !token) return

      setIsSubmitting(true)
      setErrors({})

      try {
        const response = await publicRequest('/auth/reset-password', {
          method: 'POST',
          body: { token, newPassword: password },
        })

        if (response.ok) {
          setView('success')
          return
        }

        const code = await parseBackendErrorCode(response)
        const key = mapBackendErrorToKey(code, 'errorResetFailed')

        if (
          key === 'errorTokenExpired' ||
          key === 'errorTokenConsumed' ||
          key === 'errorTokenInvalid'
        ) {
          setView(key === 'errorTokenExpired' ? 'expired' : 'invalid')
          return
        }

        setErrors({ root: key })
      } catch {
        setErrors({ root: 'errorResetFailed' })
      } finally {
        setIsSubmitting(false)
      }
    },
    [validate, token, password],
  )

  if (view === 'invalid' && !token) {
    return (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-md bg-destructive/10 px-3 py-3 text-sm text-destructive"
      >
        <p className="font-medium">{t('resetPasswordMissingTokenTitle')}</p>
        <p>{t('resetPasswordMissingTokenBody')}</p>
        <Link
          href="/forgot-password"
          className="font-medium text-action hover:underline"
        >
          {t('resetPasswordRequestNew')}
        </Link>
      </div>
    )
  }

  if (view === 'expired' || view === 'invalid') {
    const titleKey =
      view === 'expired'
        ? 'resetPasswordExpiredTitle'
        : 'resetPasswordInvalidTitle'
    const bodyKey =
      view === 'expired'
        ? 'resetPasswordExpiredBody'
        : 'resetPasswordInvalidBody'

    return (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-md bg-destructive/10 px-3 py-3 text-sm text-destructive"
      >
        <p className="font-medium">{t(titleKey)}</p>
        <p>{t(bodyKey)}</p>
        <Link
          href="/forgot-password"
          className="font-medium text-action hover:underline"
        >
          {t('resetPasswordRequestNew')}
        </Link>
      </div>
    )
  }

  if (view === 'success') {
    return (
      <div
        role="status"
        className="flex flex-col gap-3 rounded-md bg-secondary px-3 py-3 text-sm text-secondary-foreground"
      >
        <p className="font-medium">{t('resetPasswordSuccessTitle')}</p>
        <p>{t('resetPasswordSuccessBody')}</p>
        <Button
          type="button"
          className="mt-1 w-full"
          onClick={() => router.push('/login?reset=true')}
        >
          {t('resetPasswordSignIn')}
        </Button>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
      noValidate
      aria-label={t('resetPasswordTitle')}
    >
      {errors.root && (
        <div
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t(errors.root)}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">{t('resetPasswordPasswordLabel')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder={t('resetPasswordPasswordPlaceholder')}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={errors.password ? 'true' : 'false'}
          aria-describedby={errors.password ? 'password-error' : undefined}
        />
        {errors.password && (
          <p id="password-error" className="text-sm text-destructive">
            {t(errors.password, { min: MIN_PASSWORD_LENGTH })}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirmPassword">
          {t('resetPasswordConfirmPasswordLabel')}
        </Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          placeholder={t('resetPasswordConfirmPasswordPlaceholder')}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          aria-invalid={errors.confirmPassword ? 'true' : 'false'}
          aria-describedby={
            errors.confirmPassword ? 'confirm-password-error' : undefined
          }
        />
        {errors.confirmPassword && (
          <p id="confirm-password-error" className="text-sm text-destructive">
            {t(errors.confirmPassword)}
          </p>
        )}
      </div>

      <Button type="submit" className="mt-2 w-full" disabled={isSubmitting}>
        {isSubmitting ? tCommon('loading') : t('resetPasswordSubmit')}
      </Button>
    </form>
  )
}