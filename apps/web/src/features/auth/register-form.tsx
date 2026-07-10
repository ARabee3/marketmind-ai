'use client'

import { useState, useCallback, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { publicRequest } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  validateName,
  validateEmail,
  validatePassword,
  validateConfirmPassword,
  MIN_PASSWORD_LENGTH,
  type ValidationErrorKey,
} from './validation'
import { mapBackendErrorToKey, parseBackendErrorCode } from './auth-errors'

type RegisterFormErrors = {
  name?: ValidationErrorKey
  email?: ValidationErrorKey
  password?: ValidationErrorKey
  confirmPassword?: ValidationErrorKey
  root?: 'errorRegistrationFailed' | 'errorEmailExists'
}

export function RegisterForm() {
  const t = useTranslations('Auth')
  const tCommon = useTranslations('Common')
  const router = useRouter()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<RegisterFormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const validate = useCallback((): boolean => {
    const next: RegisterFormErrors = {}
    const nameError = validateName(name)
    if (nameError) next.name = nameError

    const emailError = validateEmail(email)
    if (emailError) next.email = emailError

    const passwordError = validatePassword(password)
    if (passwordError) next.password = passwordError

    const confirmError = validateConfirmPassword(password, confirmPassword)
    if (confirmError) next.confirmPassword = confirmError

    setErrors(next)
    return Object.keys(next).length === 0
  }, [name, email, password, confirmPassword])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      if (!validate()) return

      setIsSubmitting(true)
      setErrors({})

      try {
        const response = await publicRequest('/auth/register', {
          method: 'POST',
          body: {
            fullName: name.trim(),
            email: email.trim(),
            password,
          },
        })

        if (response.ok) {
          const params = new URLSearchParams()
          params.set('email', email.trim())
          params.set('registered', 'true')
          router.push(`/login?${params.toString()}`)
          return
        }

        const code = await parseBackendErrorCode(response)
        const key = mapBackendErrorToKey(code, 'errorRegistrationFailed')
        setErrors({ root: key })
      } catch {
        setErrors({ root: 'errorRegistrationFailed' })
      } finally {
        setIsSubmitting(false)
      }
    },
    [validate, name, email, password, router],
  )

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
      noValidate
      aria-label={t('registerTitle')}
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
        <Label htmlFor="name">{t('registerNameLabel')}</Label>
        <Input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder={t('registerNamePlaceholder')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={errors.name ? 'true' : 'false'}
          aria-describedby={errors.name ? 'name-error' : undefined}
        />
        {errors.name && (
          <p id="name-error" className="text-sm text-destructive">
            {t(errors.name, { min: MIN_PASSWORD_LENGTH })}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">{t('registerEmailLabel')}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t('registerEmailPlaceholder')}
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
        <Label htmlFor="password">{t('registerPasswordLabel')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder={t('registerPasswordPlaceholder')}
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
          {t('registerConfirmPasswordLabel')}
        </Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          placeholder={t('registerConfirmPasswordPlaceholder')}
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
        {isSubmitting ? tCommon('loading') : t('registerSubmit')}
      </Button>
    </form>
  )
}
