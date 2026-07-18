'use client'

import { useState, useCallback, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { Link, useRouter } from '@/i18n/navigation'
import { useSession } from './session-provider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  validateEmail,
  validatePassword,
  MIN_PASSWORD_LENGTH,
  type ValidationErrorKey,
} from './validation'
import { mapBackendErrorToKey, parseBackendErrorCode } from './auth-errors'
import { authStyles } from './auth-styles'

type LoginFormErrors = {
  email?: ValidationErrorKey
  password?: ValidationErrorKey
  root?:
    | 'errorLoginFailed'
    | 'errorInvalidCredentials'
    | 'errorEmailNotVerified'
}

function stripLocalePrefix(path: string): string {
  const match = /^\/(en|ar)(\/|$)/.exec(path)
  return match ? path.slice(match[0].length - 1) || '/' : path
}

export function LoginForm() {
  const t = useTranslations('Auth')
  const tCommon = useTranslations('Common')
  const searchParams = useSearchParams()
  const router = useRouter()
  const { login } = useSession()

  const [email, setEmail] = useState(searchParams.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<LoginFormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isRegistered = searchParams.get('registered') === 'true'
  const isReset = searchParams.get('reset') === 'true'

  const validate = useCallback((): boolean => {
    const next: LoginFormErrors = {}
    const emailError = validateEmail(email)
    if (emailError) next.email = emailError

    const passwordError = validatePassword(password)
    if (passwordError) next.password = passwordError

    setErrors(next)
    return Object.keys(next).length === 0
  }, [email, password])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      if (!validate()) return

      setIsSubmitting(true)
      setErrors({})

      try {
        await login({ email: email.trim(), password })
        const returnPath = searchParams.get('from')
        const target = returnPath ? stripLocalePrefix(returnPath) : '/dashboard'
        router.replace(target)
      } catch (error) {
        const apiError = error as { response?: Response }
        if (apiError.response) {
          const code = await parseBackendErrorCode(apiError.response)
          const key = mapBackendErrorToKey(code, 'errorLoginFailed')
          setErrors({ root: key })
        } else {
          setErrors({ root: 'errorLoginFailed' })
        }
      } finally {
        setIsSubmitting(false)
      }
    },
    [validate, email, password, login, router, searchParams],
  )

  return (
    <form
      onSubmit={handleSubmit}
      className={authStyles.form}
      noValidate
      aria-label={t('loginTitle')}
    >
      {isRegistered && (
        <div
          role="status"
          className={authStyles.success}
        >
          {t('loginRegisteredConfirmation')}
        </div>
      )}

      {isReset && !isRegistered && (
        <div
          role="status"
          className={authStyles.success}
        >
          {t('loginResetConfirmation')}
        </div>
      )}

      {errors.root && (
        <div
          role="alert"
          className={authStyles.alert}
        >
          <span>{t(errors.root)}</span>
          {errors.root === 'errorEmailNotVerified' && (
            <Link
              href="/resend-verification"
              className={authStyles.actionLink}
            >
              {t('loginResendVerification')}
            </Link>
          )}
        </div>
      )}

      <div className={authStyles.field}>
        <Label htmlFor="email">{t('loginEmailLabel')}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t('loginEmailPlaceholder')}
          className={authStyles.input}
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

      <div className={authStyles.field}>
        <Label htmlFor="password">{t('loginPasswordLabel')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder={t('loginPasswordPlaceholder')}
          className={authStyles.input}
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

      <Button type="submit" className={authStyles.primaryButton} disabled={isSubmitting}>
        {isSubmitting ? tCommon('loading') : t('loginSubmit')}
      </Button>
    </form>
  )
}
