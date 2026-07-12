import { test, expect } from '@playwright/test'
import {
  mockAuthRegister,
  mockAuthLogin,
  mockAuthRefresh,
  mockAuthMe,
  mockUser,
} from './fixtures/auth'

const locales = ['en', 'ar'] as const

type NameVariation = {
  fullName: string
  description: string
}

const nameVariationsByLocale: Record<'en' | 'ar', NameVariation[]> = {
  en: [
    { fullName: 'Ahmed Hassan', description: 'standard Arabic name in English' },
    { fullName: 'Mona Ibrahim', description: 'two-part English name' },
  ],
  ar: [
    { fullName: 'أحمد حسن', description: 'standard Arabic name' },
    { fullName: 'منى إبراهيم', description: 'Arabic name with ta marbuta' },
  ],
}

for (const locale of locales) {
  test.describe(`Auth flows (${locale})`, () => {
    for (const { fullName, description } of nameVariationsByLocale[locale]) {
      test(`registers a new account with ${description} and redirects to login`, async ({ page }) => {
        await mockAuthRegister(page)
        await mockAuthRefresh(page, null)
        await page.goto(`/${locale}/register`)

        await page.getByLabel(/Full name|الاسم الكامل/i).fill(fullName)
        await page.getByLabel(/Email address|البريد الإلكتروني/i).fill(mockUser.email)
        await page.getByLabel(/^Password$|^كلمة المرور$/i).fill('Password123!')
        await page.getByLabel(/Confirm password|تأكيد كلمة المرور/i).fill('Password123!')

        const registerRequest = page.waitForRequest('**/auth/register')
        await page.getByRole('button', { name: /Create account|إنشاء الحساب/i }).click()

        const request = await registerRequest
        expect(request.postDataJSON().fullName).toBe(fullName)

        await expect(page).toHaveURL(new RegExp(`/${locale}/login`), { timeout: 10000 })
        await expect(page.getByRole('status')).toContainText(
          locale === 'ar' ? 'تم إنشاء الحساب' : 'Account created',
        )
        await expect(page.getByLabel(/Email address|البريد الإلكتروني/i)).toHaveValue(mockUser.email)
      })
    }

    test('logs in and redirects to dashboard', async ({ page }) => {
      await mockAuthLogin(page)
      await mockAuthRefresh(page)
      await mockAuthMe(page)
      await page.goto(`/${locale}/login`)

      await page.getByLabel(/Email address|البريد الإلكتروني/i).fill(mockUser.email)
      await page.getByLabel(/^Password$|^كلمة المرور$/i).fill('Password123!')
      await page.getByRole('button', { name: /Sign in|تسجيل الدخول/i }).click()

      await expect(page.getByRole('heading')).toContainText(
        locale === 'ar' ? 'ماركت مايند' : 'MarketMind',
        { timeout: 10000 },
      )
      await expect(page).toHaveURL(`/${locale}/dashboard`)
    })

    test('shows error for duplicate email', async ({ page }) => {
      await mockAuthRegister(page, { existingEmail: mockUser.email })
      await mockAuthRefresh(page, null)
      await page.goto(`/${locale}/register`)

      const name = locale === 'ar' ? 'أحمد حسن' : 'Ahmed Hassan'
      await page.getByLabel(/Full name|الاسم الكامل/i).fill(name)
      await page.getByLabel(/Email address|البريد الإلكتروني/i).fill(mockUser.email)
      await page.getByLabel(/^Password$|^كلمة المرور$/i).fill('Password123!')
      await page.getByLabel(/Confirm password|تأكيد كلمة المرور/i).fill('Password123!')

      await page.getByRole('button', { name: /Create account|إنشاء الحساب/i }).click()

      await expect(page.locator('form [role="alert"]')).toContainText(
        locale === 'ar' ? 'مسجل بهذا البريد' : 'already exists',
      )
    })

    test('shows error for invalid credentials', async ({ page }) => {
      await mockAuthLogin(page)
      await page.goto(`/${locale}/login`)

      await page.getByLabel(/Email address|البريد الإلكتروني/i).fill(mockUser.email)
      await page.getByLabel(/^Password$|^كلمة المرور$/i).fill('wrong-password')
      await page.getByRole('button', { name: /Sign in|تسجيل الدخول/i }).click()

      await expect(page.locator('form [role="alert"]')).toContainText(
        locale === 'ar' ? 'البريد الإلكتروني أو كلمة المرور' : 'Incorrect email or password',
      )
    })

    test('shows the unverified-account recovery link on EMAIL_NOT_VERIFIED', async ({ page }) => {
      await page.route('**/auth/login', async (route, request) => {
        if (request.method() !== 'POST') {
          await route.fallback()
          return
        }
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'EMAIL_NOT_VERIFIED' }),
        })
      })

await page.goto(`/${locale}/login`)
      await page.getByLabel(/Email address|البريد الإلكتروني/i).fill(mockUser.email)
      await page.getByLabel(/^Password$|^كلمة المرور$/i).fill('Password123!')
      await page.getByRole('button', { name: /Sign in|تسجيل الدخول/i }).click()

      await expect(page.locator('form [role="alert"]')).toContainText(
        locale === 'ar' ? 'تأكيد بريدك الإلكتروني' : 'Please verify your email',
      )
      await expect(
        page.getByRole('link', { name: /Resend verification email|إعادة إرسال رسالة التأكيد/ }),
      ).toHaveAttribute('href', new RegExp(`/${locale}/resend-verification`))
    })

    test('shows validation errors for empty form submission', async ({ page }) => {
      await page.goto(`/${locale}/login`)
      await page.getByRole('button', { name: /Sign in|تسجيل الدخول/i }).click()

      const requiredText = locale === 'ar' ? 'مطلوب' : 'required'
      await expect(page.locator(`text=${requiredText}`).first()).toBeVisible()
    })
  })
}
