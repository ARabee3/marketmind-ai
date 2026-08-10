import { expect, test, type Page, type Route } from '@playwright/test'
import type {
  CurrentJourneyResponse,
  RetrievedKnowledgePack,
  StrategyBrief,
  StrategyPlan,
  StrategyProgressEvent,
  StrategyVersionSummary,
} from '@marketmind/contracts'
import { mockAccessToken, mockAuthMe, mockAuthRefresh } from './fixtures/auth'
import { responseWithConfirmedProfile } from './fixtures/dashboard'
import { getStrategyDemoFixture } from '../src/features/strategy/lib/strategy-fixtures'
import arabicPlanJson from '../../../packages/contracts/examples/strategy-plan.example.json' with { type: 'json' }

const STRATEGY_ID = '11111111-1111-4111-8111-111111111111'
const VERSION_ID = '88888888-8888-4888-8888-888888888888'
const PROFILE_ID = 'profile-version-id'

const fixture = getStrategyDemoFixture('draftReady')
const rawPlan = fixture.resource.latest_plan!
const plan = {
  ...(rawPlan as StrategyPlan),
  profile_version: {
    ...rawPlan.profile_version,
    business_profile_version_id: PROFILE_ID,
  },
} satisfies StrategyPlan
const brief = fixture.resource.brief!
const arabicPlan = {
  ...(arabicPlanJson as unknown as StrategyPlan),
  id: VERSION_ID,
  strategy_id: STRATEGY_ID,
  brief_id: brief.id,
  profile_version: {
    business_profile_version_id: PROFILE_ID,
    confirmed_at: '2026-07-17T10:05:00.000Z',
    version: 2,
  },
  retrieval_run_id: plan.retrieval_run_id,
} satisfies StrategyPlan

test.describe('Strategy owner journey', () => {
  test('saves a valid brief and starts generation only after the owner action', async ({ page }) => {
    await authenticate(page)
    await mockJourney(page, confirmedJourney(false))

    let savedBrief: Record<string, unknown> | null = null
    let generationCalls = 0
    await page.route(/\/strategies(?:\/.*)?$/, async (route, request) => {
      const path = new URL(request.url()).pathname
      if (path.endsWith('/strategies') && request.method() === 'POST') {
        await json(route, strategyResponse('needs_brief', null))
        return
      }
      if (path.endsWith(`/strategies/${STRATEGY_ID}/brief`) && request.method() === 'PUT') {
        savedBrief = await request.postDataJSON()
        await json(route, {
          id: brief.id,
          strategyId: STRATEGY_ID,
          businessProfileVersionId: PROFILE_ID,
        })
        return
      }
      if (path.endsWith(`/strategies/${STRATEGY_ID}/generate`) && request.method() === 'POST') {
        generationCalls += 1
        await json(route, { status: 'queued', correlationId: 'corr-1' })
        return
      }
      if (path.endsWith(`/strategies/${STRATEGY_ID}`) && request.method() === 'GET') {
        await json(route, strategyResponse('queued', null))
        return
      }
      if (path.endsWith(`/strategies/${STRATEGY_ID}/progress`)) {
        await json(route, progressEvents('queued'))
        return
      }
      await json(route, { code: 'NOT_FOUND' }, 404)
    })

    await page.goto('/en/strategy/new')
    // Step 1 — goal
    await page.getByLabel('Main objective').selectOption('conversion')
    await page.getByLabel('Start date').fill('2026-08-01')
    await expect(page.getByText('You have unsaved Strategy choices.')).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
    // Step 2 — channels: one primary, one supporting with an existing link
    await page.getByLabel('Main focus').first().check()
    await page.getByLabel('Supporting').nth(1).check()
    await page.getByRole('button', { name: 'Continue' }).click()
    // Step 3 — realistic: capacity preset + organic only
    await page.getByLabel('3–5 hours a week').check()
    await page.getByLabel('Paid media').selectOption('organic')
    await page.getByRole('button', { name: 'Generate plan' }).click()

    await expect.poll(() => generationCalls).toBe(1)
    expect(savedBrief).toMatchObject({
      businessProfileVersionId: PROFILE_ID,
      primaryObjective: 'conversion',
      planLanguage: 'en',
      paidMediaAllowed: false,
      externalBudgetMode: 'organic_only',
      weeklyCapacity: 'three_to_five_hours',
      channelChoices: expect.arrayContaining([
        expect.objectContaining({ channel: 'facebook', role: 'primary' }),
      ]),
    })
    await expect(page).toHaveURL(new RegExp(`/en/strategy/${STRATEGY_ID}$`))
  })

  test('reviews persisted evidence and records an explicit whole-plan approval', async ({ page }) => {
    await authenticate(page)
    await mockJourney(page, confirmedJourney(true))

    let decisionBody: Record<string, unknown> | null = null
    await mockStrategyApi(page, {
      status: 'draft',
      onDecision: (body) => { decisionBody = body },
    })

    await page.goto(`/en/strategy/${STRATEGY_ID}/review`)

    await expect(
      page.getByRole('heading', { name: 'Strategy draft review' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Diagnosis and plan summary' }),
    ).toBeVisible()
    await expect(page.getByText(plan.executive_summary.text).first()).toBeVisible()

    const evidence = page.locator('details').filter({
      hasText: 'Reviewed marketing guidance',
    }).first()
    await evidence.locator('summary').click()
    await expect(evidence.getByText('Open source reference')).toBeVisible()
    await expect(evidence.getByText('Egypt')).toBeVisible()

    const approve = page.getByRole('button', { name: 'Approve strategy' })
    await expect(approve).toBeEnabled()
    await approve.click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', { name: 'Approve the whole Strategy?' }),
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Confirm decision' }).click()

    await expect.poll(() => decisionBody).toMatchObject({
      versionId: VERSION_ID,
      action: 'approve',
    })
    // After approval the owner sees the approved panel instead of a blocked
    // decision rail, and the decision buttons disappear. The transient success
    // notice is replaced by the authoritative approved panel after refresh.
    await expect(
      page.getByRole('heading', { name: 'This strategy is approved' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Approve strategy' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('link', { name: 'Open Content workspace' }),
    ).toHaveCount(1)
  })

  test('records revision and rejection feedback once against the immutable version', async ({ page }) => {
    await authenticate(page)
    await mockJourney(page, confirmedJourney(true))

    const decisions: Record<string, unknown>[] = []
    await mockStrategyApi(page, {
      status: 'draft',
      decisionDelayMs: 100,
      onDecision: (body) => { decisions.push(body) },
    })

    await page.goto(`/en/strategy/${STRATEGY_ID}/review`)
    await page.getByRole('button', { name: 'Request revision' }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByLabel('Owner feedback').fill(
      'Use simpler owner-facing language and retain the same evidence.',
    )
    await dialog.getByRole('button', { name: 'Confirm decision' }).dblclick()

    await expect.poll(() => decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({
      versionId: VERSION_ID,
      action: 'revision_requested',
      feedback: 'Use simpler owner-facing language and retain the same evidence.',
    })
    await expect(
      page.getByText('Revision requested. The current draft remains available.'),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Reject draft' }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('Owner feedback').fill(
      'The direction does not match the owner objective.',
    )
    await dialog.getByRole('button', { name: 'Confirm decision' }).click()

    await expect.poll(() => decisions).toHaveLength(2)
    expect(decisions[1]).toMatchObject({
      versionId: VERSION_ID,
      action: 'reject',
      feedback: 'The direction does not match the owner objective.',
    })
  })

  test('surfaces a stale-version conflict without recording success', async ({ page }) => {
    await authenticate(page)
    await mockJourney(page, confirmedJourney(true))
    await mockStrategyApi(page, {
      status: 'draft',
      decisionError: {
        status: 409,
        message: 'This Strategy version is stale. Refresh before deciding.',
      },
    })

    await page.goto(`/en/strategy/${STRATEGY_ID}/review`)
    await page.getByRole('button', { name: 'Approve strategy' }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirm decision' })
      .click()

    await expect(
      page.getByText('This Strategy version is stale. Refresh before deciding.'),
    ).toBeVisible()
    await expect(
      page.getByText('Strategy approved by the owner.'),
    ).toHaveCount(0)
  })

  test('shows only server-eligible retry and preserves immutable history metadata', async ({ page }) => {
    await authenticate(page)
    await mockJourney(page, confirmedJourney(true))

    let retryCalls = 0
    await mockStrategyApi(page, {
      status: 'failed',
      retryable: true,
      onRetry: () => { retryCalls += 1 },
    })

    await page.goto(`/en/strategy/${STRATEGY_ID}/versions`)
    await expect(page.getByRole('heading', { name: 'Strategy history' })).toBeVisible()
    await expect(page.getByText('Immutable version ID')).toBeVisible()
    await expect(page.getByText(VERSION_ID)).toBeVisible()
    await expect(page.getByText(plan.retrieval_run_id)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open saved version' })).toHaveAttribute(
      'href',
      new RegExp(`/en/strategy/${STRATEGY_ID}/versions/1$`),
    )

    await page.goto(`/en/strategy/${STRATEGY_ID}`)
    await expect(page.getByText('Strategy preparation stopped')).toBeVisible()
    await page.getByRole('button', { name: 'Retry failed operation' }).click()
    await expect.poll(() => retryCalls).toBe(1)
  })

  test('keeps the review usable in Arabic RTL', async ({ page }, testInfo) => {
    await authenticate(page)
    await mockJourney(page, confirmedJourney(true))
    await mockStrategyApi(page, { status: 'draft', plan: arabicPlan })

    await page.goto(`/ar/strategy/${STRATEGY_ID}/review`)

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(
      page.getByRole('heading', { name: 'مراجعة مسودة الاستراتيجية' }),
    ).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'أقسام مراجعة الاستراتيجية' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'وافق على الاستراتيجية' }),
    ).toBeEnabled()
    await page.screenshot({
      path: testInfo.outputPath('strategy-review-ar.png'),
      fullPage: true,
    })
  })
})

async function authenticate(page: Page) {
  await mockAuthRefresh(page, mockAccessToken)
  await mockAuthMe(page)
}

async function mockJourney(page: Page, response: CurrentJourneyResponse) {
  await page.route('**/journey/current', async (route) => {
    await json(route, response)
  })
}

function confirmedJourney(active: boolean): CurrentJourneyResponse {
  const base = responseWithConfirmedProfile()
  if (!active) return base
  return {
    ...base,
    future_phase: {
      phase: 'strategy',
      availability: 'available',
      status: 'draft',
      reason: 'strategy_active',
      strategy_id: STRATEGY_ID,
      current_version_id: VERSION_ID,
      destination: `/strategy/${STRATEGY_ID}`,
      business: {
        business_name: 'Nile Sweets',
        business_type: 'dessert shop',
        city: 'Assiut',
        area: 'Assiut City',
        profile_version: 2,
      },
    },
    primary_action: {
      type: 'view_strategy',
      strategy_id: STRATEGY_ID,
      destination: `/strategy/${STRATEGY_ID}`,
    },
  }
}

function strategyResponse(
  status: string,
  latestPlan: StrategyPlan | null = plan,
) {
  return {
    id: STRATEGY_ID,
    businessId: 'business-id',
    status,
    ownerUserId: 'owner-id',
    currentVersionId: latestPlan ? VERSION_ID : null,
    createdAt: '2026-07-28T10:00:00.000Z',
    updatedAt: '2026-07-28T10:00:00.000Z',
    brief: {
      id: brief.id,
      strategyId: STRATEGY_ID,
      businessProfileVersionId: PROFILE_ID,
      businessProfileVersion: {
        id: PROFILE_ID,
        confirmedAt: '2026-07-17T10:05:00.000Z',
        version: 2,
      },
      primaryObjective: brief.primary_objective,
      startDate: brief.start_date,
      planLanguage: brief.plan_language,
      paidMediaAllowed: brief.paid_media_allowed,
      externalBudgetMode: brief.external_budget_mode,
      externalBudgetEgp: brief.external_budget_egp,
      teamCapacity: (brief as StrategyBrief).team_capacity,
      constraints: brief.constraints.join('\n'),
      clarificationAnswers: [],
      createdAt: brief.created_at,
      updatedAt: brief.updated_at,
    },
    latestPlan,
  }
}

function retrievalPack(sourcePlan: StrategyPlan = plan): RetrievedKnowledgePack {
  return {
    retrieval_run_id: sourcePlan.retrieval_run_id,
    query_summary: 'Egypt SME conversion guidance',
    query_context: {
      business_type: 'dessert shop',
      market: 'egypt',
      locale: 'en',
      objective: 'conversion',
      funnel_stage: 'conversion',
      active_channels: ['Facebook'],
      asset_capability: ['photo'],
      team_capacity: 'Owner plus one helper',
      budget_mode: 'scenario_only',
      industry: 'hospitality',
    },
    profile_version_id: PROFILE_ID,
    brief_id: brief.id,
    items: sourcePlan.citations.map((citation) => ({
        chunk_id: citation.chunk_id,
        entry_id: citation.entry_id,
        entry_version: citation.entry_version,
        title: citation.title,
        excerpt: citation.excerpt,
        kind: 'framework',
        tags: { markets: ['egypt'] },
        relevance_score: citation.relevance_score,
        source_quality: {
          evidence_tier: citation.evidence_tier,
          source_references: ['https://example.com/reviewed-guidance'],
          effective_at: '2026-01-01T00:00:00.000Z',
          expires_at: '2027-01-01T00:00:00.000Z',
          review_status: 'approved',
        },
        market_tier: 'Egypt',
        is_fallback: false,
        fallback_label: null,
      })),
    knowledge_gaps: [],
    retrieval_metadata: {
      embedding_provider: 'fake',
      embedding_model: 'fake-32',
      embedding_dimensions: 32,
      collection_name: 'marketmind-test',
      retrieval_latency_ms: 8,
    },
    retrieved_at: '2026-07-28T10:00:00.000Z',
  }
}

function progressEvents(
  status: 'queued' | 'draft' | 'failed',
  retryable = false,
): StrategyProgressEvent[] {
  const failed = status === 'failed'
  return [
    {
      type: 'strategy_progress',
      strategy_id: STRATEGY_ID,
      seq: 1,
      stage: failed ? 'failed' : status === 'queued' ? 'queued' : 'ready',
      status: failed ? 'failed' : status === 'queued' ? 'started' : 'complete',
      message_key: failed ? 'strategy.generating.failed' : 'strategy.ready',
      message_text: failed ? 'Generation failed safely.' : 'Strategy ready.',
      retryable: failed ? retryable : undefined,
      payload: failed ? { retryable } : {},
      created_at: '2026-07-28T10:00:00.000Z',
    },
  ]
}

function versions(status: 'draft' | 'failed'): StrategyVersionSummary[] {
  return [
    {
      version_id: VERSION_ID,
      strategy_id: STRATEGY_ID,
      version: 1,
      status: status === 'failed' ? 'draft' : status,
      brief_id: brief.id,
      retrieval_run_id: plan.retrieval_run_id,
      profile_version: plan.profile_version,
      prompt_config: {
        model: 'fake-provider',
        prompt_version: 'strategy-v2',
      },
      created_at: plan.created_at,
    },
  ]
}

async function mockStrategyApi(
  page: Page,
  options: {
    status: 'draft' | 'failed'
    retryable?: boolean
    onDecision?: (body: Record<string, unknown>) => void
    onRetry?: () => void
    plan?: StrategyPlan
    decisionDelayMs?: number
    decisionError?: {
      status: number
      message: string
    }
  },
) {
  let currentStatus: string = options.status
  await page.route(/\/strategies(?:\/.*)?$/, async (route, request) => {
    const path = new URL(request.url()).pathname
    const method = request.method()

    if (path.endsWith(`/strategies/${STRATEGY_ID}/decisions`) && method === 'POST') {
      const body = await request.postDataJSON() as Record<string, unknown>
      options.onDecision?.(body)
      if (options.decisionDelayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.decisionDelayMs),
        )
      }
      if (options.decisionError) {
        await json(
          route,
          {
            code: 'STRATEGY_VERSION_CONFLICT',
            message: options.decisionError.message,
          },
          options.decisionError.status,
        )
        return
      }
      if (body.action === 'approve') {
        currentStatus = 'approved'
      } else if (body.action === 'reject') {
        currentStatus = 'rejected'
      }      await json(route, {
        decision: { id: 'decision-1' },
        nextStatus:
          body.action === 'revision_requested'
            ? 'ready'
            : body.action === 'reject'
              ? 'rejected'
              : 'approved',
      })
      return
    }
    if (path.endsWith(`/strategies/${STRATEGY_ID}/retry`) && method === 'POST') {
      options.onRetry?.()
      await json(route, { status: 'queued', correlationId: 'corr-retry' })
      return
    }
    if (path.endsWith(`/strategies/${STRATEGY_ID}/retrieval`)) {
      await json(route, retrievalPack(options.plan))
      return
    }
    if (path.endsWith(`/strategies/${STRATEGY_ID}/progress`)) {
      await json(
        route,
        progressEvents(currentStatus === 'failed' ? 'failed' : 'draft', options.retryable),
      )
      return
    }
    if (path.endsWith(`/strategies/${STRATEGY_ID}/versions`)) {
      await json(route, versions(currentStatus === 'failed' ? 'failed' : 'draft'))
      return
    }
    if (path.endsWith(`/strategies/${STRATEGY_ID}/versions/1`)) {
      await json(route, plan)
      return
    }
    if (path.endsWith(`/strategies/${STRATEGY_ID}`)) {
      await json(route, strategyResponse(currentStatus, options.plan))
      return
    }
    await json(route, { code: 'NOT_FOUND' }, 404)
  })
}

async function json(
  route: Route,
  body: unknown,
  status = 200,
) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}
