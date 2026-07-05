/**
 * Lightweight, i18n-ready form validation helpers.
 *
 * These functions return translation keys rather than rendered strings so the
 * UI layer can localise error messages with `next-intl`.
 */

export type ValidationErrorKey =
  | 'validationNameRequired'
  | 'validationNameInvalid'
  | 'validationEmailRequired'
  | 'validationEmailInvalid'
  | 'validationPasswordRequired'
  | 'validationPasswordMinLength'
  | 'validationConfirmPasswordRequired'
  | 'validationConfirmPasswordMismatch'

export const MIN_PASSWORD_LENGTH = 8

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Unicode letters, spaces, and common name punctuation (hyphens/apostrophes).
// Supports Arabic, English, and other scripts without restricting to Latin.
const NAME_REGEX = /^(?!\s)[\p{L}\s'-]+$(?<!\s)/u

export function validateName(name: string): ValidationErrorKey | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'validationNameRequired'
  if (!NAME_REGEX.test(trimmed)) return 'validationNameInvalid'
  return null
}

export function validateEmail(email: string): ValidationErrorKey | null {
  const trimmed = email.trim()
  if (trimmed.length === 0) return 'validationEmailRequired'
  if (!EMAIL_REGEX.test(trimmed)) return 'validationEmailInvalid'
  return null
}

export function validatePassword(password: string): ValidationErrorKey | null {
  if (password.length === 0) return 'validationPasswordRequired'
  if (password.length < MIN_PASSWORD_LENGTH) {
    return 'validationPasswordMinLength'
  }
  return null
}

export function validateConfirmPassword(
  password: string,
  confirmPassword: string,
): ValidationErrorKey | null {
  if (confirmPassword.length === 0) return 'validationConfirmPasswordRequired'
  if (confirmPassword !== password) return 'validationConfirmPasswordMismatch'
  return null
}
