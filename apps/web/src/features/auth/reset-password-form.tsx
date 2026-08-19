'use client'

import { useState, useCallback, useRef, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { publicRequest } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  validatePassword,
  validateConfirmPassword,
  MIN_PASSWORD_LENGTH,
  type ValidationErrorKey,
} from './validation'
import { mapBackendErrorToKey, parseBackendErrorCode } from './auth-errors'
import { authStyles } from './auth-styles'

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
  const token = searchParams.get('token')

  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmPasswordRef = useRef<HTMLInputElement>(null)

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
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
    if (next.password) {
      passwordRef.current?.focus()
    } else if (next.confirmPassword) {
      confirmPasswordRef.current?.focus()
    }
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
        className={authStyles.alert}
      >
        <p className="font-medium">{t('resetPasswordMissingTokenTitle')}</p>
        <p>{t('resetPasswordMissingTokenBody')}</p>
        <Link
          href="/forgot-password"
          className={authStyles.actionLink}
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
        className={authStyles.alert}
      >
        <p className="font-medium">{t(titleKey)}</p>
        <p>{t(bodyKey)}</p>
        <Link
          href="/forgot-password"
          className={authStyles.actionLink}
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
        className={authStyles.success}
      >
        <p className="font-medium">{t('resetPasswordSuccessTitle')}</p>
        <p>{t('resetPasswordSuccessBody')}</p>
        <Link
          href="/login?reset=true"
          className={cn(buttonVariants(), authStyles.primaryButton)}
        >
          {t('resetPasswordSignIn')}
        </Link>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={authStyles.form}
      noValidate
      aria-label={t('resetPasswordTitle')}
    >
      {errors.root && (
        <div
          role="alert"
          className={authStyles.alert}
        >
          {t(errors.root)}
        </div>
      )}

      <div className={authStyles.field}>
        <Label htmlFor="password">{t('resetPasswordPasswordLabel')}</Label>
        <div className="relative">
          <Input
            ref={passwordRef}
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder={t('resetPasswordPasswordPlaceholder')}
            className={cn(authStyles.input, 'pe-10')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={errors.password ? 'true' : 'false'}
            aria-describedby={errors.password ? 'password-error' : undefined}
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute inset-y-0 end-0 flex items-center pe-3 text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-action rounded-e-md"
            aria-label={showPassword ? t('hidePassword') : t('showPassword')}
          >
            {showPassword ? (
              <EyeOffIcon className="h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <EyeIcon className="h-4 w-4 shrink-0" aria-hidden />
            )}
          </button>
        </div>
        {errors.password && (
          <p id="password-error" role="alert" className="text-sm text-destructive">
            {t(errors.password, { min: MIN_PASSWORD_LENGTH })}
          </p>
        )}
      </div>

      <div className={authStyles.field}>
        <Label htmlFor="confirmPassword">
          {t('resetPasswordConfirmPasswordLabel')}
        </Label>
        <div className="relative">
          <Input
            ref={confirmPasswordRef}
            id="confirmPassword"
            name="confirmPassword"
            type={showConfirmPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder={t('resetPasswordConfirmPasswordPlaceholder')}
            className={cn(authStyles.input, 'pe-10')}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            aria-invalid={errors.confirmPassword ? 'true' : 'false'}
            aria-describedby={
              errors.confirmPassword ? 'confirm-password-error' : undefined
            }
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword((prev) => !prev)}
            className="absolute inset-y-0 end-0 flex items-center pe-3 text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-action rounded-e-md"
            aria-label={showConfirmPassword ? t('hidePassword') : t('showPassword')}
          >
            {showConfirmPassword ? (
              <EyeOffIcon className="h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <EyeIcon className="h-4 w-4 shrink-0" aria-hidden />
            )}
          </button>
        </div>
        {errors.confirmPassword && (
          <p id="confirm-password-error" role="alert" className="text-sm text-destructive">
            {t(errors.confirmPassword)}
          </p>
        )}
      </div>

      <Button type="submit" className={authStyles.primaryButton} disabled={isSubmitting}>
        {isSubmitting ? tCommon('loading') : t('resetPasswordSubmit')}
      </Button>
    </form>
  )
}
