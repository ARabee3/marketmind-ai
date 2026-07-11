import { test, expect } from '@playwright/test'
import type {
  DiscoveryProgressEvent,
  DiscoverySessionStatus,
} from '@marketmind/contracts'
import { mockAuthRefresh, mockAuthMe, mockUser, mockAccessToken } from './fixtures/auth'

const fixtureStatus = (
  status: DiscoverySessionStatus,
  events: DiscoveryProgressEvent[] = [],
) => ({
  session_id: 'test-session-123',
  status,
  language_mode: 'mixed',
  intake_summary: {
    business_name: 'Test Cafe',
    business_type: 'Cafe',
    city: 'Cairo',
  },
  intelligence: { status: 'running', search_mode: 'metadata_only', source_refs: [], research_observations: [], conversation_hooks: [], knowledge_gaps: [] },
  messages: [],
  profile_state: {
    known_facts: {
      identity: { business_name: 'Test Cafe', business_type: 'Cafe', city: 'Cairo' },
      offer: { core_offerings: [], best_sellers: [], purchase_occasions: [] },
      customers: { primary_segments: [], visit_or_order_occasions: [], peak_periods: [], customer_needs: [] },
      differentiation: { owner_claimed_strengths: [], customer_choice_reasons: [], proof_points: [] },
      current_marketing: { active_channels: [], current_activities: [], delivery_platforms: [], available_assets: [] },
      goals_and_constraints: { growth_goals: [], operational_constraints: [] },
    },
    uncertainties: [],
    readiness: {
      ready: false,
      llm_recommended: false,
      profile_readiness: 0,
      domain_scores: {
        identity: 0,
        offer: 0,
        customers: 0,
        differentiation: 0,
        current_marketing: 0,
        goals_and_constraints: 0,
        market_context: 0,
        research_confidence: 0,
        profile_readiness: 0,
      },
      blocking_domains: [],
      owner_turn_count: 0,
      max_owner_turns: 15,
    },
  },
  progress_events: events,
  strategy_locked: true,
})

const queuedEvent: DiscoveryProgressEvent = {
  type: 'progress',
  session_id: 'test-session-123',
  seq: 1,
  stage: 'queued',
  status: 'started',
  message_key: 'discovery.session.accepted',
  message_text: 'Queued for research',
  payload: {},
  created_at: new Date().toISOString(),
}

test.describe('Discovery Intake & Progress Workflow', () => {
  test.beforeEach(async ({ page }) => {
    // Discovery is now a protected journey; provide an active session.
    await mockAuthRefresh(page, mockAccessToken)
    await mockAuthMe(page, mockUser)

    // Mock the POST /api/v1/discovery/start endpoint.
    await page.route('**/api/v1/discovery/start', async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: 'test-session-123',
          status: 'researching',
          progress_ws_url: '/ws/v1/discovery',
          status_url: '/api/v1/discovery/test-session-123/status',
          accepted_at: new Date().toISOString(),
        })
      })
    })

    // Mock the initial GET status endpoint with a real backend progress key.
    await page.route('**/api/v1/discovery/test-session-123/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixtureStatus('researching', [queuedEvent]))
      })
    })
  })

  test('sends the access token with authenticated Discovery requests', async ({ page }) => {
    const discoveryStartRequest = page.waitForRequest('**/api/v1/discovery/start')

    await page.goto('/en/discovery/new')

    await page.getByLabel('Business name *').fill('Test Cafe')
    await page.getByLabel('Business type *').fill('Cafe')
    await page.getByLabel('City *').fill('Cairo')
    await page.getByRole('button', { name: 'Start Discovery' }).click()

    const startRequest = await discoveryStartRequest
    expect(await startRequest.headerValue('Authorization')).toBe(`Bearer ${mockAccessToken}`)

    const statusRequest = page.waitForRequest('**/api/v1/discovery/test-session-123/status')
    await expect(page).toHaveURL(/\/en\/discovery\/test-session-123/)
    const statusReq = await statusRequest
    expect(await statusReq.headerValue('Authorization')).toBe(`Bearer ${mockAccessToken}`)
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
  })

  test('Handles partial research error and enters interview', async ({ page }) => {
    // Mock partial failure status
    await page.route('**/api/v1/discovery/test-session-456/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...fixtureStatus('partial_ready'),
          intelligence: { status: 'partial', search_mode: 'free_search', source_refs: [], research_observations: [], conversation_hooks: [], knowledge_gaps: [] },
        })
      })
    })

    await page.goto('/en/discovery/test-session-456')

    // Interview phase is shown for partial_ready with research warning visible
    await expect(page.getByText("Let's refine your profile")).toBeVisible()
    await expect(page.getByText('Some research sources could not be loaded')).toBeVisible()
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
          ...fixtureStatus('research_failed', [{
            type: 'progress',
            session_id: 'test-session-provider-fail',
            seq: 1,
            stage: 'ai_start',
            status: 'failed',
            message_key: 'discovery.ai.provider_unavailable',
            message_text: 'AI discovery provider is not available yet.',
            retryable: true,
            payload: {},
            created_at: new Date().toISOString(),
          }]),
          session_id: 'test-session-provider-fail',
          intelligence: { status: 'failed', search_mode: 'metadata_only', source_refs: [], research_observations: [], conversation_hooks: [], knowledge_gaps: [] },
        })
      })
    })

    await page.goto('/en/discovery/test-session-provider-fail')
    // Interview phase is shown for research_failed with the warning visible
    await expect(page.getByText("Let's refine your profile")).toBeVisible()
    await expect(page.getByText('Research could not complete. Your interview will proceed from your intake information.')).toBeVisible()
  })

  test('Handles enqueue/Redis failure', async ({ page }) => {
    await page.unroute('**/api/v1/discovery/start')
    await page.route('**/api/v1/discovery/start', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'DISCOVERY_QUEUE_UNAVAILABLE',
            message: 'Queue unavailable',
          },
        }),
      })
    })

    await page.goto('/en/discovery/new')
    await page.getByLabel('Business name *').fill('Test Cafe')
    await page.getByLabel('Business type *').fill('Cafe')
    await page.getByLabel('City *').fill('Cairo')
    await page.getByRole('button', { name: 'Start Discovery' }).click()

    await expect(page.getByText('Research could not be queued. Please try again.')).toBeVisible()
  })

  test('Recovers session status after network interruption via HTTP polling', async ({ page, context }) => {
    let statusCalls = 0
    await page.route('**/api/v1/discovery/test-session-123/status', async (route) => {
      statusCalls++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixtureStatus('researching', [queuedEvent]))
      })
    })

    await page.goto('/en/discovery/test-session-123')
    await expect(page.getByRole('heading', { name: 'Queued for research' })).toBeVisible()

    // Save the number of status calls made before disconnect
    const initialCalls = statusCalls

    // Disconnect network; HTTP status polls will fail but the hook keeps trying
    // every two seconds while the session is researching.
    await context.setOffline(true)
    await page.waitForTimeout(2500)

    // Reconnect network
    await context.setOffline(false)

    // The next poll should succeed and rehydrate the UI.
    await expect.poll(() => statusCalls).toBeGreaterThan(initialCalls)
    await expect(page.getByRole('heading', { name: 'Queued for research' })).toBeVisible()
  })
})
