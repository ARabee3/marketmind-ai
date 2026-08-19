'use client'

import { useState, useCallback, useRef, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { Link, useRouter } from '@/i18n/navigation'
import { useSession } from './session-provider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  validateEmail,
  validatePassword,
  MIN_PASSWORD_LENGTH,
  type ValidationErrorKey,
} from './validation'
import { mapBackendErrorToKey, parseBackendErrorCode } from './auth-errors'
import { authStyles } from './auth-styles'
import {
  safeAdminReturnPath,
  safeWorkspaceReturnPath,
} from '@/lib/routing/route-policy'

type LoginFormErrors = {
  email?: ValidationErrorKey
  password?: ValidationErrorKey
  root?:
    | 'errorLoginFailed'
    | 'errorInvalidCredentials'
    | 'errorEmailNotVerified'
}

export function LoginForm() {
  const t = useTranslations('Auth')
  const tCommon = useTranslations('Common')
  const searchParams = useSearchParams()
  const router = useRouter()
  const { login } = useSession()

  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const [email, setEmail] = useState(searchParams.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
    if (next.email) {
      emailRef.current?.focus()
    } else if (next.password) {
      passwordRef.current?.focus()
    }
    return Object.keys(next).length === 0
  }, [email, password])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      if (!validate()) return

      setIsSubmitting(true)
      setErrors({})

      try {
        const signedInUser = await login({ email: email.trim(), password })
        const requestedPath = searchParams.get('from')
        const target =
          (signedInUser.roles.includes('ADMIN')
            ? safeAdminReturnPath(requestedPath)
            : null) ??
          safeWorkspaceReturnPath(requestedPath) ??
          (signedInUser.roles.includes('ADMIN') ? '/admin' : '/dashboard')
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
          ref={emailRef}
          id="email"
          name="email"
          type="email"
          dir="ltr"
          autoComplete="email"
          spellCheck={false}
          autoCapitalize="none"
          inputMode="email"
          placeholder={t('loginEmailPlaceholder')}
          className={authStyles.input}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={errors.email ? 'true' : 'false'}
          aria-describedby={errors.email ? 'email-error' : undefined}
        />
        {errors.email && (
          <p id="email-error" role="alert" className="text-sm text-destructive">
            {t(errors.email)}
          </p>
        )}
      </div>

      <div className={authStyles.field}>
        <Label htmlFor="password">{t('loginPasswordLabel')}</Label>
        <div className="relative">
          <Input
            ref={passwordRef}
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder={t('loginPasswordPlaceholder')}
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
            tabIndex={-1}
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

      <Button type="submit" className={authStyles.primaryButton} disabled={isSubmitting}>
        {isSubmitting ? tCommon('loading') : t('loginSubmit')}
      </Button>
    </form>
  )
}
