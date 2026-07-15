import { test, expect } from '@playwright/test'
import type {
  DiscoveryStatusResponse,
  DiscoveryMessage,
  BusinessProfileDraft,
} from '@marketmind/contracts'
import { mockAuthRefresh, mockAuthMe, mockUser, mockAccessToken } from './fixtures/auth'

const sessionId = 'test-session-interview'

function makeMessage(overrides: Partial<DiscoveryMessage> = {}): DiscoveryMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role: 'assistant',
    content: 'What is your business name?',
    language: 'en',
    source: 'chat',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function baseStatus(overrides: Partial<DiscoveryStatusResponse> = {}): DiscoveryStatusResponse {
  return {
    session_id: sessionId,
    status: 'in_progress',
    language_mode: 'en',
    current_question: 'What is your best selling product?',
    current_suggested_answers: ['Espresso', 'I am not sure yet'],
    intake_summary: { business_name: 'Test Cafe', business_type: 'Cafe', city: 'Cairo' },
    intelligence: {
      status: 'complete',
      search_mode: 'free_search',
      source_refs: [
        {
          id: 'source-1',
          source_type: 'search_result',
          url: 'https://example.com/cafe',
          title: 'Example Cafe',
          snippet: 'A nice cafe in Cairo',
          confidence: 0.8,
          metadata: {},
        },
      ],
      research_observations: [
        {
          id: 'obs-1',
          source_ref_id: 'source-1',
          kind: 'market_context',
          statement: 'Cairo cafe market growing',
          confidence: 0.8,
          visibility: 'owner_visible',
          status: 'accepted',
          metadata: {},
        },
      ],
      conversation_hooks: [],
      knowledge_gaps: [],
    },
    messages: [
      makeMessage({ id: 'msg-1', role: 'assistant', content: 'Welcome! What is your best selling product?' }),
    ],
    profile_state: {
      known_facts: {
        identity: { business_name: 'Test Cafe', business_type: 'Cafe', city: 'Cairo' },
        offer: { core_offerings: ['Coffee'], best_sellers: [], purchase_occasions: [] },
        customers: { primary_segments: [], visit_or_order_occasions: [], peak_periods: [], customer_needs: [] },
        differentiation: { owner_claimed_strengths: [], customer_choice_reasons: [], proof_points: [] },
        current_marketing: { active_channels: [], current_activities: [], delivery_platforms: [], available_assets: [] },
        goals_and_constraints: { growth_goals: [], operational_constraints: [] },
      },
      uncertainties: [
        {
          field_key: 'best_sellers',
          domain: 'offer',
          description: 'Best selling items unknown',
          severity: 'medium',
          category: 'missing_information',
          source: 'owner_unknown',
        },
      ],
      readiness: {
        ready: false,
        llm_recommended: false,
        profile_readiness: 0.45,
        domain_scores: {
          identity: 1,
          offer: 0.4,
          customers: 0.3,
          differentiation: 0.2,
          current_marketing: 0.3,
          goals_and_constraints: 0.3,
          market_context: 0.5,
          research_confidence: 0.5,
          profile_readiness: 0.45,
        },
        blocking_domains: ['offer', 'customers', 'differentiation', 'current_marketing', 'goals_and_constraints'],
        owner_turn_count: 1,
        max_owner_turns: 15,
      },
    },
    progress_events: [],
    strategy_locked: true,
    ...overrides,
  }
}

function makeDraft(overrides: Partial<BusinessProfileDraft> = {}): BusinessProfileDraft {
  return {
    id: 'draft-1',
    session_id: sessionId,
    version: 1,
    status: 'ready_for_confirmation',
    completeness: 'complete',
    completion_reason: 'sufficient',
    readiness: {
      ready: true,
      llm_recommended: true,
      profile_readiness: 0.85,
      domain_scores: {
        identity: 1,
        offer: 0.8,
        customers: 0.85,
        differentiation: 0.7,
        current_marketing: 0.7,
        goals_and_constraints: 0.8,
        market_context: 0.5,
        research_confidence: 0.5,
        profile_readiness: 0.85,
      },
      blocking_domains: [],
      owner_turn_count: 7,
      max_owner_turns: 15,
    },
    confirmed_facts: {
      identity: { business_name: 'Test Cafe', business_type: 'Cafe', city: 'Cairo' },
      offer: { core_offerings: ['Coffee', 'Tea'], best_sellers: ['Espresso'], price_range: '20-50 EGP', purchase_occasions: ['Morning', 'Evening'] },
      customers: { primary_segments: ['Students', 'Professionals'], visit_or_order_occasions: ['Morning'], peak_periods: ['8am-10am'], customer_needs: ['Quick service'] },
      differentiation: { owner_claimed_strengths: ['Fast service'], customer_choice_reasons: ['Quality'], proof_points: [] },
      current_marketing: { active_channels: ['Instagram'], current_activities: [], delivery_platforms: [], available_assets: [] },
      goals_and_constraints: { growth_goals: ['Increase customers'], operational_constraints: [] },
    },
    market_context: {
      competitor_landscape: [],
      local_demand_signals: [],
      digital_presence_signals: [
        { observation_id: 'obs-1', source_ref_id: 'source-1', statement: 'Strong Instagram presence', confidence: 0.8 },
      ],
      other_signals: [],
    },
    research_observations: [
      {
        id: 'obs-extra',
        source_ref_id: 'source-1',
        kind: 'market_context',
        statement: 'Extra observation not in market_context',
        confidence: 0.7,
        visibility: 'owner_visible',
        status: 'accepted',
        metadata: {},
      },
    ],
    uncertainties: [
      {
        field_key: 'budget',
        domain: 'goals_and_constraints',
        description: 'Marketing budget unknown',
        severity: 'low',
        category: 'owner_unknown',
        source: 'owner_unknown',
        resolved: false,
      },
    ],
    owner_goals: ['Increase daily customers'],
    strategy_relevant_notes: ['Focus on Instagram marketing'],
    raw_ai_output: {},
    ...overrides,
  }
}

test.describe('Discovery Interview & Review', () => {
  test.beforeEach(async ({ page }) => {
    // Discovery session pages are protected; provide an active session.
    await mockAuthRefresh(page, mockAccessToken)
    await mockAuthMe(page, mockUser)

    // Default status mock
    await page.route(`**/api/v1/discovery/${sessionId}/status`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(baseStatus()),
      })
    })
  })

  test('English interview → automatic complete review → confirm journey', async ({ page }) => {
    let turnCount = 1
    let currentStatus = 'in_progress'
    let summarizeCalls = 0

    await page.route(`**/api/v1/discovery/${sessionId}/status`, async (route) => {
      if (currentStatus === 'confirmed') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(baseStatus({
            status: 'confirmed',
            profile_draft: makeDraft(),
            strategy_locked: false,
          })),
        })
      } else if (currentStatus === 'summary_ready') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(baseStatus({
            status: 'summary_ready',
            profile_draft: makeDraft(),
            profile_state: {
              ...baseStatus().profile_state,
              readiness: { ...baseStatus().profile_state.readiness, owner_turn_count: turnCount, ready: true },
            },
          })),
        })
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(baseStatus({
            messages: [
              ...baseStatus().messages,
              makeMessage({ id: `owner-${turnCount}`, role: 'owner', content: `Answer ${turnCount}` }),
              makeMessage({ id: `assistant-${turnCount}`, role: 'assistant', content: `Question ${turnCount + 1}` }),
            ],
            profile_state: {
              ...baseStatus().profile_state,
              readiness: { ...baseStatus().profile_state.readiness, owner_turn_count: turnCount },
            },
          })),
        })
      }
    })

    await page.route(`**/api/v1/discovery/${sessionId}/respond`, async (route) => {
      turnCount++
      currentStatus = turnCount >= 2 ? 'summary_ready' : 'in_progress'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: sessionId,
          status: turnCount >= 2 ? 'summary_ready' : 'in_progress',
          assistant_message: makeMessage({ content: `Question ${turnCount + 1}` }),
          updated_known_facts: baseStatus().profile_state.known_facts,
          uncertainties: [],
          readiness: { ...baseStatus().profile_state.readiness, owner_turn_count: turnCount },
          profile_draft: turnCount >= 2 ? makeDraft() : undefined,
          strategy_locked: true,
        }),
      })
    })

    await page.route(`**/api/v1/discovery/${sessionId}/summarize`, async (route) => {
      summarizeCalls++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: sessionId,
          status: 'summary_ready',
          profile_draft: makeDraft(),
          strategy_locked: true,
        }),
      })
    })

    await page.route(`**/api/v1/discovery/${sessionId}/confirm-profile`, async (route) => {
      currentStatus = 'confirmed'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: sessionId,
          status: 'confirmed',
          business_profile_version_id: 'version-1',
          confirmed_at: new Date().toISOString(),
          strategy_locked: false,
        }),
      })
    })

    await page.goto(`/en/discovery/${sessionId}`)

    // Interview phase
    await expect(page.getByText('Welcome! What is your best selling product?')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Espresso' })).toBeVisible()

    await page.getByRole('button', { name: 'Espresso' }).click()
    await expect(page.getByPlaceholder('Type your answer here…')).toHaveValue('Espresso')
    await page.getByRole('button', { name: 'Submit' }).click()

    await expect.poll(() => turnCount).toBeGreaterThanOrEqual(2)

    // Review phase (after automatic summary_ready from respond)
    await expect(page.getByText('Review your Discovery results')).toBeVisible()
    await expect(page.getByText('Complete')).toBeVisible()

    // No summarize request should have been sent — respond triggered auto-summary
    expect(summarizeCalls).toBe(0)

    // Confirm
    await page.getByRole('button', { name: 'Confirm profile' }).click()

    // Confirmed success
    await expect(page.getByText('Strategy is now unlocked')).toBeVisible()
  })

  test('Arabic chrome journey with RTL structure', async ({ page }) => {
    await page.goto(`/ar/discovery/${sessionId}`)

    // Verify Arabic UI chrome
    await expect(page.getByText('تحديث الملف الشخصي')).toBeVisible()
    await expect(page.getByPlaceholder('اكتب إجابتك هنا…')).toBeVisible()

    // Verify RTL direction on html
    const dir = await page.locator('html').getAttribute('dir')
    expect(dir).toBe('rtl')
  })

  test('Arabic interview → automatic complete review → confirm journey', async ({ page }) => {
    let turnCount = 1
    let currentStatus = 'in_progress'

    await page.route(`**/api/v1/discovery/${sessionId}/status`, async (route) => {
      if (currentStatus === 'confirmed') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(baseStatus({
            status: 'confirmed',
            profile_draft: makeDraft(),
            strategy_locked: false,
          })),
        })
      } else if (currentStatus === 'summary_ready') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(baseStatus({
            status: 'summary_ready',
            profile_draft: makeDraft(),
            profile_state: {
              ...baseStatus().profile_state,
              readiness: { ...baseStatus().profile_state.readiness, owner_turn_count: turnCount, ready: true },
            },
          })),
        })
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(baseStatus({
            messages: [
              ...baseStatus().messages,
              makeMessage({ id: `owner-${turnCount}`, role: 'owner', content: 'إجابتي', language: 'ar-EG' }),
              makeMessage({ id: `assistant-${turnCount}`, role: 'assistant', content: 'سؤال تالي', language: 'ar-EG' }),
            ],
            profile_state: {
              ...baseStatus().profile_state,
              readiness: { ...baseStatus().profile_state.readiness, owner_turn_count: turnCount },
            },
          })),
        })
      }
    })

    await page.route(`**/api/v1/discovery/${sessionId}/respond`, async (route) => {
      turnCount++
      currentStatus = 'summary_ready'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: sessionId,
          status: 'summary_ready',
          assistant_message: makeMessage({ content: 'سؤال تالي', language: 'ar-EG' }),
          updated_known_facts: baseStatus().profile_state.known_facts,
          uncertainties: [],
          readiness: { ...baseStatus().profile_state.readiness, owner_turn_count: turnCount, ready: true },
          profile_draft: makeDraft(),
          strategy_locked: true,
        }),
      })
    })

    await page.route(`**/api/v1/discovery/${sessionId}/confirm-profile`, async (route) => {
      currentStatus = 'confirmed'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: sessionId,
          status: 'confirmed',
          business_profile_version_id: 'version-1',
          confirmed_at: new Date().toISOString(),
          strategy_locked: false,
        }),
      })
    })

    await page.goto(`/ar/discovery/${sessionId}`)

    // Verify RTL and Arabic chrome
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByPlaceholder('اكتب إجابتك هنا…')).toBeVisible()

    // Interview phase
    await expect(page.getByText('Welcome! What is your best selling product?')).toBeVisible()

    await page.getByPlaceholder('اكتب إجابتك هنا…').fill('إجابتي')
    await page.getByRole('button', { name: 'إرسال' }).click()

    await expect.poll(() => turnCount).toBeGreaterThanOrEqual(2)

    // Review phase (after automatic summary_ready from respond)
    await expect(page.getByText('مراجعة نتائج الاستكشاف')).toBeVisible()
    await expect(page.getByText('مكتمل')).toBeVisible()

    // Confirm
    await page.getByRole('button', { name: 'تأكيد الملف الشخصي' }).click()

    // Confirmed success
    await expect(page.getByText('الاستراتيجية متاحة الآن')).toBeVisible()
  })

  test('Arabic UI with mixed English conversation preserved', async ({ page }) => {
    await page.route(`**/api/v1/discovery/${sessionId}/status`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(baseStatus({
          messages: [
            makeMessage({ id: '1', role: 'assistant', content: 'Hello! مرحبا' }),
            makeMessage({ id: '2', role: 'owner', content: 'My answer: إجابتي' }),
          ],
        })),
      })
    })

    await page.goto(`/ar/discovery/${sessionId}`)

    // Mixed content should be preserved exactly
    await expect(page.getByText('Hello! مرحبا')).toBeVisible()
    await expect(page.getByText('My answer: إجابتي')).toBeVisible()
  })

  test('Continued questioning renders next assistant question', async ({ page }) => {
    let turnCount = 1

    await page.route(`**/api/v1/discovery/${sessionId}/status`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(baseStatus({
          messages: [
            makeMessage({ id: 'msg-1', role: 'assistant', content: 'Welcome! What is your best selling product?' }),
            makeMessage({ id: 'owner-1', role: 'owner', content: 'Espresso' }),
            makeMessage({ id: 'assistant-2', role: 'assistant', content: 'What are your opening hours?' }),
          ],
          profile_state: {
            ...baseStatus().profile_state,
            readiness: { ...baseStatus().profile_state.readiness, owner_turn_count: turnCount },
          },
        })),
      })
    })

    await page.route(`**/api/v1/discovery/${sessionId}/respond`, async (route) => {
      turnCount++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: sessionId,
          status: 'in_progress',
          assistant_message: makeMessage({ id: 'assistant-2', role: 'assistant', content: 'What are your opening hours?', language: 'en' }),
          updated_known_facts: baseStatus().profile_state.known_facts,
          uncertainties: [],
          readiness: { ...baseStatus().profile_state.readiness, owner_turn_count: turnCount },
          strategy_locked: true,
        }),
      })
    })

    await page.route(`**/api/v1/discovery/${sessionId}/summarize`, async (route) => {
      await route.fulfill({ status: 200, body: '{}' })
    })

    await page.goto(`/en/discovery/${sessionId}`)

    await expect(page.getByText('Welcome! What is your best selling product?')).toBeVisible()

    await page.getByPlaceholder('Type your answer here…').fill('Espresso')
    await page.getByRole('button', { name: 'Submit' }).click()

    // Next assistant question should appear without any summarize call
    await expect(page.getByText('What are your opening hours?')).toBeVisible()
  })

  test('Early finish → incomplete review → acknowledgement → confirm', async ({ page }) => {
    let currentStatus = 'in_progress'
    let summarizeCalls = 0

    await page.route(`**/api/v1/discovery/${sessionId}/summarize`, async (route) => {
      summarizeCalls++
      const body = await route.request().postDataJSON()
      expect(body.finish_anyway).toBe(true)
      currentStatus = 'summary_ready'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: sessionId,
          status: 'summary_ready',
          profile_draft: makeDraft({ completeness: 'incomplete', completion_reason: 'owner_finished_early' }),
          strategy_locked: true,
        }),
      })
    })

    await page.route(`**/api/v1/discovery/${sessionId}/status`, async (route) => {
      if (currentStatus === 'summary_ready') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(baseStatus({
            status: 'summary_ready',
            profile_draft: makeDraft({ completeness: 'incomplete', completion_reason: 'owner_finished_early' }),
            profile_state: {
              ...baseStatus().profile_state,
              readiness: { ...baseStatus().profile_state.readiness, ready: false },
            },
          })),
        })
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(baseStatus()),
        })
      }
    })

    await page.goto(`/en/discovery/${sessionId}`)

    // Click finish
    await page.getByRole('button', { name: 'Finish interview' }).click()

    // Dialog should show incomplete warning
    await expect(page.getByText('Finish interview?')).toBeVisible()
    await expect(page.getByText('Your profile is not complete')).toBeVisible()

    await page.getByRole('button', { name: 'Confirm finish interview' }).click()

    // Review phase with incomplete draft
    await expect(page.getByText('Review your Discovery results')).toBeVisible()
    await expect(page.getByText('Incomplete', { exact: true })).toBeVisible()

    // Confirm should be disabled until acknowledgement
    await expect(page.getByRole('button', { name: 'Confirm profile' })).toBeDisabled()

    await page.getByRole('checkbox').check()

    await page.route(`**/api/v1/discovery/${sessionId}/confirm-profile`, async (route) => {
      const body = await route.request().postDataJSON()
      expect(body.acknowledge_incomplete).toBe(true)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: sessionId,
          status: 'confirmed',
          business_profile_version_id: 'version-1',
          confirmed_at: new Date().toISOString(),
          strategy_locked: false,
        }),
      })
    })

    await page.getByRole('button', { name: 'Confirm profile' }).click()

    // Exactly one summarize call
    expect(summarizeCalls).toBe(1)
  })

  test('Fifteenth-turn automatic incomplete review', async ({ page }) => {
    let summarizeCalls = 0

    await page.route(`**/api/v1/discovery/${sessionId}/status`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(baseStatus({
          status: 'summary_ready',
          profile_draft: makeDraft({ completeness: 'incomplete', completion_reason: 'turn_limit' }),
          profile_state: {
            ...baseStatus().profile_state,
            readiness: { ...baseStatus().profile_state.readiness, owner_turn_count: 15, ready: false },
          },
        })),
      })
    })

    await page.route(`**/api/v1/discovery/${sessionId}/summarize`, async (route) => {
      summarizeCalls++
      await route.fulfill({ status: 200, body: '{}' })
    })

    await page.goto(`/en/discovery/${sessionId}`)

    await expect(page.getByText('Review your Discovery results')).toBeVisible()
    await expect(page.getByText('Maximum questions reached')).toBeVisible()

    // No summarize should have been triggered — status arrived pre-summarized
    expect(summarizeCalls).toBe(0)
  })

  test('Locale switch preserves session route and content', async ({ page }) => {
    await page.goto(`/en/discovery/${sessionId}`)
    await expect(page.getByText("Let's refine your profile")).toBeVisible()

    // Switch to Arabic using the language switcher button
    await page.getByRole('button', { name: /Language/ }).click()

    await expect(page).toHaveURL(/\/ar\/discovery\/test-session-interview/)
    await expect(page.getByText('تحديث الملف الشخصي')).toBeVisible()
  })

  test('Refresh at interview phase uses /status only', async ({ page }) => {
    let statusCalls = 0
    let postCalls = 0

    await page.route(`**/api/v1/discovery/${sessionId}/status`, async (route) => {
      statusCalls++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(baseStatus()),
      })
    })

    await page.route(`**/api/v1/discovery/${sessionId}/**`, async (route) => {
      if (route.request().method() !== 'GET') {
        postCalls++
      }
      await route.fallback()
    })

    await page.goto(`/en/discovery/${sessionId}`)
    await expect(page.getByText('Welcome! What is your best selling product?')).toBeVisible()

    const beforeRefresh = statusCalls
    await page.reload()

    await expect(page.getByText('Welcome! What is your best selling product?')).toBeVisible()
    // After refresh there should be exactly one more /status call and zero POSTs
    await expect.poll(() => statusCalls).toBe(beforeRefresh + 1)
    expect(postCalls).toBe(0)
  })

  test('Pending double action protection and recoverable failure', async ({ page }) => {
    let respondCalls = 0
    let resolveRespond = null as (() => void) | null
    const respondPromise = new Promise<void>((resolve) => {
      resolveRespond = resolve
    })

    await page.route(`**/api/v1/discovery/${sessionId}/respond`, async (route) => {
      respondCalls++
      if (respondCalls === 1) {
        // Hold the first request pending
        await respondPromise
        await route.fulfill({ status: 500, body: JSON.stringify({ code: 'server_error', message: 'fail' }) })
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session_id: sessionId,
            status: 'in_progress',
            assistant_message: makeMessage({ content: 'Next question' }),
            updated_known_facts: baseStatus().profile_state.known_facts,
            uncertainties: [],
            readiness: baseStatus().profile_state.readiness,
            strategy_locked: true,
          }),
        })
      }
    })

    await page.goto(`/en/discovery/${sessionId}`)

    const textarea = page.getByPlaceholder('Type your answer here…')
    await textarea.fill('Test answer')

    // Click submit — first request held pending
    await page.getByRole('button', { name: 'Submit' }).click()

    // Button should show disabled/sending state with ellipsis
    await expect(page.getByRole('button', { name: 'Sending…' })).toBeVisible()

    // Try to submit again while pending — should be ignored
    await page.getByRole('button', { name: 'Sending…' }).click({ force: true })

    // Only one POST should have been sent
    expect(respondCalls).toBe(1)

    // Release the pending request with a failure
    if (resolveRespond) resolveRespond()

    // After failure recovery, textarea should retain the value
    await expect(page.getByText('Retry')).toBeVisible()
    await expect(textarea).toHaveValue('Test answer')
  })

  test('Refresh at review phase uses GET /status only', async ({ page }) => {
    let statusCalls = 0
    let postCalls = 0

    await page.route(`**/api/v1/discovery/${sessionId}/status`, async (route) => {
      statusCalls++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(baseStatus({
          status: 'summary_ready',
          profile_draft: makeDraft(),
        })),
      })
    })

    await page.route(`**/api/v1/discovery/${sessionId}/**`, async (route) => {
      if (route.request().method() !== 'GET') {
        postCalls++
      }
      await route.fallback()
    })

    await page.goto(`/en/discovery/${sessionId}`)
    await expect(page.getByText('Review your Discovery results')).toBeVisible()

    const beforeRefresh = statusCalls
    await page.reload()

    await expect(page.getByText('Review your Discovery results')).toBeVisible()
    await expect.poll(() => statusCalls).toBe(beforeRefresh + 1)
    expect(postCalls).toBe(0)
  })

  test('Refresh at confirmed phase uses GET /status only', async ({ page }) => {
    let statusCalls = 0
    let postCalls = 0

    await page.route(`**/api/v1/discovery/${sessionId}/status`, async (route) => {
      statusCalls++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(baseStatus({
          status: 'confirmed',
          profile_draft: makeDraft(),
          strategy_locked: false,
        })),
      })
    })

    await page.route(`**/api/v1/discovery/${sessionId}/**`, async (route) => {
      if (route.request().method() !== 'GET') {
        postCalls++
      }
      await route.fallback()
    })

    await page.goto(`/en/discovery/${sessionId}`)
    await expect(page.getByText('Strategy is now unlocked')).toBeVisible()

    const beforeRefresh = statusCalls
    await page.reload()

    await expect(page.getByText('Strategy is now unlocked')).toBeVisible()
    await expect.poll(() => statusCalls).toBe(beforeRefresh + 1)
    expect(postCalls).toBe(0)
  })

  test('Regression: no duplicate /status calls on interview refresh after page settled', async ({ page }) => {
    let statusCalls = 0

    await page.route(`**/api/v1/discovery/${sessionId}/status`, async (route) => {
      statusCalls++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(baseStatus()),
      })
    })

    await page.goto(`/en/discovery/${sessionId}`)
    await expect(page.getByText('Welcome! What is your best selling product?')).toBeVisible()

    // Wait a bit for the page to fully settle
    await page.waitForTimeout(500)
    const settledCalls = statusCalls

    // No additional /status calls should have occurred after settling
    await page.waitForTimeout(500)
    expect(statusCalls).toBe(settledCalls)
  })

  test('Desktop layout at 1280px has no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`/en/discovery/${sessionId}`)

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth)
  })

  test('Mobile layout at 375px has no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto(`/en/discovery/${sessionId}`)

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth)
  })
})
