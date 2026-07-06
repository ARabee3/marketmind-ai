'use client'

import { useState, useCallback, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/i18n/navigation'
import { useSession } from './session-provider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  validateEmail,
  validatePassword,
  type ValidationErrorKey,
} from './validation'
import { mapBackendErrorToKey, parseBackendErrorCode } from './auth-errors'

type LoginFormErrors = {
  email?: ValidationErrorKey
  password?: ValidationErrorKey
  root?: 'errorLoginFailed' | 'errorInvalidCredentials'
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
      className="flex flex-col gap-4"
      noValidate
      aria-label={t('loginTitle')}
    >
      {isRegistered && (
        <div
          role="status"
          className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground"
        >
          {t('registerSuccess')}
        </div>
      )}

      {errors.root && (
        <div
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t(errors.root)}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">{t('loginEmailLabel')}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t('loginEmailPlaceholder')}
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

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">{t('loginPasswordLabel')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder={t('loginPasswordPlaceholder')}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={errors.password ? 'true' : 'false'}
          aria-describedby={errors.password ? 'password-error' : undefined}
        />
        {errors.password && (
          <p id="password-error" className="text-sm text-destructive">
            {t(errors.password)}
          </p>
        )}
      </div>

      <Button type="submit" className="mt-2 w-full" disabled={isSubmitting}>
        {isSubmitting ? tCommon('loading') : t('loginSubmit')}
      </Button>
    </form>
  )
}
