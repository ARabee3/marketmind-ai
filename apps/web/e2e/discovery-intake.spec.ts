import { test, expect } from '@playwright/test'

test.describe('Discovery Intake & Progress Workflow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the POST /api/v1/discovery/start endpoint with Auth check
    await page.route('**/api/v1/discovery/start', async (route) => {
      const auth = route.request().headers()['authorization']
      if (!auth) {
        return route.fulfill({ status: 401, body: JSON.stringify({ error: { code: 'unauthorized', message: 'Missing token' } }) })
      }
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

    // Mock the initial GET status endpoint with Auth check
    await page.route('**/api/v1/discovery/test-session-123/status', async (route) => {
      const auth = route.request().headers()['authorization']
      if (!auth) {
        return route.fulfill({ status: 401, body: JSON.stringify({ error: { code: 'unauthorized', message: 'Missing token' } }) })
      }
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
    await expect(page.getByText('Researching your business').first()).toBeVisible()
  })

  test('Arabic mode: submits intake and verifies Arabic progress chrome', async ({ page }) => {
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

    // Should display Arabic translated progress timeline
    await expect(page.getByText('في طابور الانتظار').first()).toBeVisible()
    await expect(page.getByText('جارٍ البحث عن معلومات نشاطك').first()).toBeVisible()
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
          progress_events: [],
        })
      })
    })

    await page.goto('/en/discovery/test-session-456')

    await expect(page.getByText('Some research sources could not be loaded')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start interview' })).toBeVisible()
  })

  test('respects the maximum of 8 social links', async ({ page }) => {
    await page.goto('/en/discovery/new')

    const addButton = page.getByRole('button', { name: 'Add another link' })
    
    // Click "Add another link" 8 times
    for (let i = 0; i < 8; i++) {
      await addButton.click()
    }

    // After 8 clicks, the button should be hidden
    await expect(addButton).not.toBeVisible()
    await expect(page.getByLabel('URL')).toHaveCount(8)
  })

  test('Recovers session status on refresh', async ({ page }) => {
    await page.goto('/en/discovery/test-session-123')
    await expect(page.getByRole('heading', { name: 'Queued for research' })).toBeVisible()
    
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Queued for research' })).toBeVisible()
    await expect(page.getByText('Restored from saved state.')).toBeVisible()
  })

  test('Handles provider failure with retry state', async ({ page }) => {
    await page.route('**/api/v1/discovery/test-session-provider-fail/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: 'test-session-provider-fail',
          status: 'research_failed',
          language_mode: 'en',
          progress_events: [
            { type: 'progress', seq: 1, stage: 'ai_start', status: 'failed', message_key: 'errorProviderFailure', retryable: true }
          ]
        })
      })
    })

    await page.goto('/en/discovery/test-session-provider-fail')
    await expect(page.getByText('The AI provider is temporarily unavailable.')).toBeVisible()
    await expect(page.getByText('This step failed but will be retried automatically.')).toBeVisible()
  })

  test('Handles enqueue/Redis failure', async ({ page }) => {
    await page.route('**/api/v1/discovery/test-session-redis-fail/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: 'test-session-redis-fail',
          status: 'failed',
          language_mode: 'en',
          progress_events: [
            { type: 'progress', seq: 1, stage: 'queued', status: 'failed', message_key: 'errorRedisFailure', retryable: false }
          ]
        })
      })
    })

    await page.goto('/en/discovery/test-session-redis-fail')
    await expect(page.getByText('Research could not be queued. Please try again.')).toBeVisible()
  })

  test('Simulates socket disconnect and reconnect recovery', async ({ page, context }) => {
    // Mock socket.io handshake so the client thinks it's connected
    let pollCount = 0
    await page.route('**/ws/v1/discovery/?EIO=4&transport=polling*', async (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 200, body: 'ok' })
      }

      const url = new URL(route.request().url())
      if (!url.searchParams.has('sid')) {
        await route.fulfill({
          status: 200,
          // Short timeout to force quick disconnect on offline
          body: '0' + JSON.stringify({ sid: 'mock-sid', upgrades: [], pingInterval: 500, pingTimeout: 500 })
        })
      } else {
        pollCount++
        if (pollCount === 1) {
          // Send Socket.IO connect packet on first poll
          await route.fulfill({ status: 200, body: '40{"sid":"mock-sid"}' })
        } else {
          // Send ping (2) to keep connection alive
          await route.fulfill({ status: 200, body: '2' })
        }
      }
    })

    let statusCalls = 0
    await page.route('**/api/v1/discovery/test-session-123/status', async (route) => {
      statusCalls++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: 'test-session-123',
          status: 'researching',
          language_mode: 'mixed',
          progress_events: [
            { type: 'progress', seq: 1, stage: 'queued', status: 'started', message_key: '', message_text: 'Queued for research' }
          ]
        })
      })
    })

    await page.goto('/en/discovery/test-session-123')
    await expect(page.getByRole('heading', { name: 'Queued for research' })).toBeVisible()
    
    // Save the number of status calls made before disconnect
    const initialCalls = statusCalls

    // Disconnect network and wait for short ping timeout to trigger disconnect
    await context.setOffline(true)
    await page.waitForTimeout(1000)

    // Reconnect network
    await context.setOffline(false)
    await expect(page.getByRole('heading', { name: 'Queued for research' })).toBeVisible()

    // Verify rehydration occurred (status endpoint was called again)
    await expect.poll(() => statusCalls).toBeGreaterThan(initialCalls)
  })
})