'use client'

import { useState, useCallback, useRef, type FormEvent } from 'react'
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
import { authStyles } from './auth-styles'

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

  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmPasswordRef = useRef<HTMLInputElement>(null)

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
    if (next.name) {
      nameRef.current?.focus()
    } else if (next.email) {
      emailRef.current?.focus()
    } else if (next.password) {
      passwordRef.current?.focus()
    } else if (next.confirmPassword) {
      confirmPasswordRef.current?.focus()
    }
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
      className={authStyles.form}
      noValidate
      aria-label={t('registerTitle')}
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
        <Label htmlFor="name">{t('registerNameLabel')}</Label>
        <Input
          ref={nameRef}
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder={t('registerNamePlaceholder')}
          className={authStyles.input}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={errors.name ? 'true' : 'false'}
          aria-describedby={errors.name ? 'name-error' : undefined}
        />
        {errors.name && (
          <p id="name-error" role="alert" className="text-sm text-destructive">
            {t(errors.name)}
          </p>
        )}
      </div>

      <div className={authStyles.field}>
        <Label htmlFor="email">{t('registerEmailLabel')}</Label>
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
          placeholder={t('registerEmailPlaceholder')}
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
        <Label htmlFor="password">{t('registerPasswordLabel')}</Label>
        <Input
          ref={passwordRef}
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder={t('registerPasswordPlaceholder')}
          className={authStyles.input}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={errors.password ? 'true' : 'false'}
          aria-describedby={errors.password ? 'password-error' : undefined}
        />
        {errors.password && (
          <p id="password-error" role="alert" className="text-sm text-destructive">
            {t(errors.password, { min: MIN_PASSWORD_LENGTH })}
          </p>
        )}
      </div>

      <div className={authStyles.field}>
        <Label htmlFor="confirmPassword">
          {t('registerConfirmPasswordLabel')}
        </Label>
        <Input
          ref={confirmPasswordRef}
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          placeholder={t('registerConfirmPasswordPlaceholder')}
          className={authStyles.input}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          aria-invalid={errors.confirmPassword ? 'true' : 'false'}
          aria-describedby={
            errors.confirmPassword ? 'confirm-password-error' : undefined
          }
        />
        {errors.confirmPassword && (
          <p id="confirm-password-error" role="alert" className="text-sm text-destructive">
            {t(errors.confirmPassword)}
          </p>
        )}
      </div>

      <Button type="submit" className={authStyles.primaryButton} disabled={isSubmitting}>
        {isSubmitting ? tCommon('loading') : t('registerSubmit')}
      </Button>
    </form>
  )
}
