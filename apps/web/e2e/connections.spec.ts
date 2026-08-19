import { expect, test } from '@playwright/test'
import { mockAuthMe, mockAuthRefresh } from './fixtures/auth'

const CONNECTED = {
  provider: 'facebook',
  pageName: 'Koshary Corner',
  isValid: true,
  connectedAt: '2026-08-01T12:00:00.000Z',
  lastTestedAt: null,
  expiresAt: null,
}

for (const locale of ['en', 'ar'] as const) {
  test(`returns to the disconnected empty state after reload (${locale})`, async ({
    page,
  }) => {
    await mockAuthRefresh(page)
    await mockAuthMe(page)

    let disconnected = false
    await page.route('**/api/v1/connections', async (route, request) => {
      if (request.method() !== 'GET') {
        await route.fallback()
        return
      }

      if (disconnected) {
        await route.fulfill({ status: 200, body: '' })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(CONNECTED),
      })
    })
    await page.route(
      '**/api/v1/connections/facebook',
      async (route, request) => {
        if (request.method() !== 'DELETE') {
          await route.fallback()
          return
        }

        disconnected = true
        await route.fulfill({ status: 204, body: '' })
      },
    )

    await page.goto(`/${locale}/connections`)
    await expect(
      page.getByRole('heading', { name: 'Koshary Corner', exact: true }),
    ).toBeVisible()

    await page
      .getByRole('button', {
        name: locale === 'ar' ? 'فصل الحساب' : 'Disconnect',
        exact: true,
      })
      .click()
    await page
      .getByRole('button', {
        name: locale === 'ar' ? 'نعم، اقطع الاتصال' : 'Yes, disconnect',
        exact: true,
      })
      .click()

    await expect(
      page.getByRole('heading', {
        name:
          locale === 'ar' ? 'اربط صفحة فيسبوك' : 'Connect your Facebook Page',
        exact: true,
      }),
    ).toBeVisible()

    await page.reload()

    await expect(
      page.getByRole('heading', {
        name:
          locale === 'ar' ? 'اربط صفحة فيسبوك' : 'Connect your Facebook Page',
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page.getByText(
        locale === 'ar'
          ? 'تعذّر تحميل حالة الاتصال. حاول مرة أخرى.'
          : 'We could not load your connection status. Try again.',
        { exact: true },
      ),
    ).not.toBeVisible()
  })
}
