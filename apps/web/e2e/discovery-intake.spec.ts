import { test, expect } from '@playwright/test'

test.describe('Discovery Intake & Progress Workflow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the POST /api/v1/discovery/start endpoint
    await page.route('**/api/v1/discovery/start', async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: 'test-session-123',
          status: 'researching',
          progress_ws_url: '/ws/v1/discovery',
          status_url: '/api/v1/discovery/test-session-123/status',
          accepted_at: new Date().toISOString()
        })
      })
    })

    // Mock the initial GET status endpoint
    await page.route('**/api/v1/discovery/test-session-123/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: 'test-session-123',
          status: 'researching',
          language_mode: 'mixed',
          intake_summary: {
            business_name: 'Test Cafe',
            business_type: 'Cafe',
            city: 'Cairo',
          },
          intelligence: { status: 'running' },
          messages: [],
          profile_state: {},
          progress_events: [
            { type: 'progress', seq: 1, stage: 'queued', status: 'started', message_key: '', message_text: 'Queued for research' }
          ],
          strategy_locked: true,
        })
      })
    })
  })

  test('English mode: validates and submits intake form', async ({ page }) => {
    await page.goto('/en/discovery/new')

    // Empty submit triggers validation
    await page.getByRole('button', { name: 'Start Discovery' }).click()
    await expect(page.getByText('Business name is required')).toBeVisible()

    // Fill form
    await page.getByLabel('Business name *').fill('Test Cafe')
    await page.getByLabel('Business type *').fill('Cafe')
    await page.getByLabel('City *').fill('Cairo')

    // Submit
    await page.getByRole('button', { name: 'Start Discovery' }).click()

    // Should navigate to session page
    await expect(page).toHaveURL(/\/en\/discovery\/test-session-123/)

    // Should display progress timeline (from mocked status)
    await expect(page.getByRole('heading', { name: 'Queued for research' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Researching your business' })).toBeVisible()
  })

  test('Arabic mode: submits intake with mixed language preference', async ({ page }) => {
    await page.goto('/ar/discovery/new')

    // Fill form (using AR labels)
    await page.getByLabel('اسم النشاط التجاري *').fill('مقهى الاختبار')
    await page.getByLabel('نوع النشاط *').fill('مقهى')
    await page.getByLabel('المدينة *').fill('القاهرة')

    // Explicitly choose mixed language
    await page.getByLabel('مختلطة (عربي + إنجليزي)').check()

    // Submit
    await page.getByRole('button', { name: 'بدء مرحلة الاستكشاف' }).click()

    // Should navigate to session page
    await expect(page).toHaveURL(/\/ar\/discovery\/test-session-123/)

    // Should display progress timeline
    await expect(page.getByText('Queued for research')).toBeVisible() // message text mocked in English
    await expect(page.getByText('جارٍ البحث عن معلومات نشاطك')).toBeVisible()
  })

  test('Handles partial research error and allows continue', async ({ page }) => {
    // Mock partial failure status
    await page.route('**/api/v1/discovery/test-session-456/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: 'test-session-456',
          status: 'partial_ready',
          language_mode: 'en',
          intake_summary: {},
          intelligence: { status: 'partial' },
          messages: [],
          profile_state: {},
          progress_events: [],
          strategy_locked: true,
        })
      })
    })

    await page.goto('/en/discovery/test-session-456')

    // Should show error banner for partial research
    await expect(page.getByText('Some research sources could not be loaded')).toBeVisible()

    // Should show Start Interview button
    await expect(page.getByRole('button', { name: 'Start interview' })).toBeVisible()
  })
})
