import { expect, test, type Page, type Route } from '@playwright/test'
import { mockPackWorkspace } from '../src/features/content/review/fixtures/pack.fixtures'
import type { ContentDecisionResponse } from '@marketmind/contracts'
import type {
  BulkDecisionResponse,
  ContentPackWorkspace,
} from '../src/features/content/review/types/review.types'
import { mockAccessToken, mockAuthMe, mockAuthRefresh } from './fixtures/auth'

const packId = mockPackWorkspace.pack.id
const latestConflictVersionId = '55555555-5555-4555-8555-555555555599'

// Simulates another team member having advanced item 0 to version 3 while the
// owner was still looking at version 2.
function upgradeItemToVersionThree(
  workspace: ContentPackWorkspace,
): ContentPackWorkspace {
  const clone = structuredClone(workspace)
  const item = clone.items[0]
  item.current_version = {
    ...item.current_version,
    id: latestConflictVersionId,
    version: 3,
    version_checksum:
      'c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890a1b2c3d4e5',
  }
  return clone
}

type ContentReviewMockState = {
  workspace: ContentPackWorkspace
  conflictOnce: boolean
  decisionCalls: number
  bulkCalls: number
  workspaceGets: number
  lastDecisionBody: Record<string, unknown> | null
  lastBulkBody: Record<string, unknown> | null
  holdDecisionResponse: boolean
  releaseDecisionResponse: (() => void) | null
  holdWorkspaceGetAt: number | null
  releaseWorkspaceGet: (() => void) | null
  upgradeVersionOnSecondGet: boolean
}

function makeState(): ContentReviewMockState {
  return {
    workspace: structuredClone(mockPackWorkspace),
    conflictOnce: false,
    decisionCalls: 0,
    bulkCalls: 0,
    workspaceGets: 0,
    lastDecisionBody: null,
    lastBulkBody: null,
    holdDecisionResponse: false,
    releaseDecisionResponse: null,
    holdWorkspaceGetAt: null,
    releaseWorkspaceGet: null,
    upgradeVersionOnSecondGet: false,
  }
}

async function authenticate(page: Page) {
  await mockAuthRefresh(page, mockAccessToken)
  await mockAuthMe(page)
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function mockContentReviewApi(page: Page, state: ContentReviewMockState) {
  await page.route('**/api/v1/content-packs/*/workspace', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    state.workspaceGets += 1
    if (state.upgradeVersionOnSecondGet && state.workspaceGets === 2) {
      state.workspace = upgradeItemToVersionThree(state.workspace)
    }
    if (state.workspaceGets === state.holdWorkspaceGetAt) {
      await new Promise<void>((resolve) => {
        state.releaseWorkspaceGet = resolve
      })
    }
    await json(route, state.workspace)
  })

  await page.route(
    '**/api/v1/content-packs/*/items/*/decisions',
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback()
        return
      }
      state.decisionCalls += 1
      state.lastDecisionBody = await route.request().postDataJSON()

      if (state.holdDecisionResponse) {
        await new Promise<void>((resolve) => {
          state.releaseDecisionResponse = resolve
        })
      }

      if (state.conflictOnce && state.decisionCalls === 1) {
        await json(
          route,
          {
            code: 'CONTENT_VERSION_CONFLICT',
            message: 'Stale version',
            latest_version_id: '55555555-5555-4555-8555-555555555599',
          },
          409,
        )
        return
      }

      const body = state.lastDecisionBody as {
        content_item_id: string
        content_item_version_id: string
        decision: string
        revision_notes?: string | null
      }
      const response: ContentDecisionResponse = {
        decision: {
          id: `dec-e2e-${state.decisionCalls}`,
          content_item_id: body.content_item_id,
          content_item_version_id: body.content_item_version_id,
          content_item_version: 2,
          content_item_version_checksum: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890a1b2c3d4',
          decision:
            body.decision === 'approved'
              ? 'approved'
              : body.decision === 'rejected'
                ? 'rejected'
                : 'revision_requested',
          revision_notes: body.revision_notes ?? null,
          decided_by_user_id: 'user-999',
          decided_at: '2026-08-02T12:00:00.000Z',
        },
        publication_candidate: body.decision === 'approved' ? {
          contract_version: 'publication-candidate-v1',
          candidate_id: 'cand-e2e-33333333-3333-4333-8333-333333333333',
          business_id: 'bus-111',
          strategy_id: '66666666-6666-4666-8666-666666666666',
          strategy_version: 4,
          content_cycle_id: mockPackWorkspace.pack.content_cycle_id,
          strategy_week_number: 3,
          content_pack_id: packId,
          content_item_id: body.content_item_id,
          content_item_version_id: body.content_item_version_id,
          content_item_version: 2,
          content_item_version_checksum: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890a1b2c3d4',
          target_channel: 'instagram',
          content_format: 'static_image_post',
          selected_locale: 'ar',
          caption: 'Approved caption',
          cta: null,
          hashtags: [],
          alt_text: 'alt',
          assets: [],
          recommended_publish_window: {
            starts_at: '2026-08-10T16:00:00.000Z',
            ends_at: '2026-08-10T19:00:00.000Z',
            timezone: 'Africa/Cairo',
          },
          approval: {
            decision_id: `dec-e2e-${state.decisionCalls}`,
            decision: 'approved',
            content_item_version_id: body.content_item_version_id,
            content_item_version_checksum: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890a1b2c3d4',
            decided_by_user_id: 'user-999',
            decided_at: '2026-08-02T12:00:00.000Z',
          },
          candidate_checksum: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890a1b2c3d4',
          created_at: '2026-08-02T12:00:00.000Z',
        } : null,
      }
      if (body.decision === 'approved') {
        const item = state.workspace.items.find(
          (i) => i.item.id === body.content_item_id,
        )
        if (item) {
          item.publication_candidate = response.publication_candidate
        }
      }
      await json(route, response)
    },
  )

  await page.route(
    '**/api/v1/content-packs/*/decisions/bulk',
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback()
        return
      }
      state.bulkCalls += 1
      state.lastBulkBody = await route.request().postDataJSON()

      const body = state.lastBulkBody as {
        decisions: Array<{
          content_item_id: string
          content_item_version_id: string
          content_item_version_checksum: string
          decision: string
          revision_notes: string | null
          idempotency_key: string
        }>
      }
      const results: BulkDecisionResponse = body.decisions.map((d) => ({
        item_id: d.content_item_id,
        status: 'approved',
      }))
      await json(route, results)
    },
  )

  await page.route('**/api/v1/content-assets/*', async (route) => {
    await json(route, { code: 'NOT_FOUND' }, 404)
  })
}

test.describe('Content review workspace', () => {
  test('renders the editorial proof with agenda, provenance margin, and decision rail', async ({
    page,
  }) => {
    await authenticate(page)
    await mockContentReviewApi(page, makeState())

    await page.goto(`/en/content/packs/${packId}`)

    await expect(
      page.getByRole('heading', { name: 'Editorial Proof & Review' }),
    ).toBeVisible()
    await expect(
      page.getByText('Week 3 Content Pack', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText('Strategy v4')).toBeVisible()

    await expect(
      page.getByRole('heading', { name: 'Editorial Agenda' }),
    ).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Selected Content Proof' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Provenance Margin' }),
    ).toBeVisible()
    await expect(
      page.getByText('Exact Owner Decision', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(
        'Approving this item creates an immutable publication candidate. It does NOT publish or schedule content automatically.',
      ),
    ).toBeVisible()
  })

  test('links back to the owning cycle week route', async ({ page }) => {
    await authenticate(page)
    await mockContentReviewApi(page, makeState())

    await page.goto(`/en/content/packs/${packId}`)

    const backLink = page.getByRole('link', { name: 'Back to 12-week cycle' })
    await expect(backLink).toHaveAttribute(
      'href',
      `/en/content/${mockPackWorkspace.pack.content_cycle_id}/weeks/${mockPackWorkspace.pack.week_number}`,
    )
  })

  test('requires revision notes and submits the exact-version revision decision', async ({
    page,
  }) => {
    const state = makeState()
    await authenticate(page)
    await mockContentReviewApi(page, state)

    await page.goto(`/en/content/packs/${packId}`)

    await page.getByRole('button', { name: 'Request revision' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByText('Current version being revised: v2'),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Submit revision request' }).click()
    await expect(
      dialog.getByText('Revision notes are required before requesting a revision.'),
    ).toBeVisible()

    await dialog
      .getByPlaceholder(/Describe the required changes/)
      .fill('Add phone number explicitly in the caption.')
    await page.getByRole('button', { name: 'Submit revision request' }).click()
    await expect(dialog).toHaveCount(0)

    await expect.poll(() => state.decisionCalls).toBe(1)
    const body = state.lastDecisionBody as Record<string, string>
    expect(body.content_item_id).toBe(mockPackWorkspace.items[0].item.id)
    expect(body.content_item_version_id).toBe(
      mockPackWorkspace.items[0].current_version.id,
    )
    expect(body.content_item_version_checksum).toBe(
      mockPackWorkspace.items[0].current_version.version_checksum,
    )
    expect(body.decision).toBe('revision_requested')
    expect(body.revision_notes).toBe(
      'Add phone number explicitly in the caption.',
    )
    expect(body.idempotency_key).toBeTruthy()
  })

  test('approves the exact version and links the candidate without scheduling language', async ({
    page,
  }) => {
    const state = makeState()
    await authenticate(page)
    await mockContentReviewApi(page, state)

    await page.goto(`/en/content/packs/${packId}`)

    await page.getByRole('button', { name: 'Approve exact v2' }).click()

    await expect.poll(() => state.decisionCalls).toBe(1)
    const body = state.lastDecisionBody as Record<string, string>
    expect(body.decision).toBe('approved')
    expect(body.content_item_version_checksum).toBe(
      mockPackWorkspace.items[0].current_version.version_checksum,
    )
    expect(body.idempotency_key).toBeTruthy()

    const banner = page.getByText('Publication candidate active · Not scheduled')
    await expect(banner).toBeVisible()
    // No control may imply scheduling or publishing.
    await expect(
      page.getByRole('button', { name: /schedule/i }),
    ).toHaveCount(0)
    await expect(page.getByRole('link', { name: /schedule/i })).toHaveCount(0)
    await expect(
      page.getByText(/will be published|goes live/i),
    ).toHaveCount(0)

    const publishingLink = page.getByRole('link', {
      name: 'Open Publishing Workspace',
    })
    await expect(publishingLink).toHaveAttribute(
      'href',
      /\/en\/publishing\?candidate=/,
    )

    // The immutable candidate freezes the rail: no further decisions.
    await expect(page.getByText('Decision locked')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Approve exact v2' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Request revision' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Reject exact v2' }),
    ).toHaveCount(0)
  })

  test('prevents duplicate decisions while a submission is in flight', async ({
    page,
  }) => {
    const state = makeState()
    state.holdDecisionResponse = true
    await authenticate(page)
    await mockContentReviewApi(page, state)

    await page.goto(`/en/content/packs/${packId}`)

    const approveBtn = page.getByRole('button', { name: 'Approve exact v2' })
    await approveBtn.click()
    await expect(approveBtn).toBeDisabled()

    // A second (forced) click while the request is pending must not submit.
    await approveBtn.click({ force: true })
    await expect.poll(() => state.decisionCalls).toBe(1)

    state.releaseDecisionResponse?.()
    await expect(
      page.getByText('Publication candidate active · Not scheduled'),
    ).toBeVisible()
    await expect(page.getByText('Decision locked')).toBeVisible()
  })

  test('recovers from a stale-version conflict by refetching authoritative state', async ({
    page,
  }) => {
    const state = makeState()
    state.conflictOnce = true
    state.upgradeVersionOnSecondGet = true
    state.holdWorkspaceGetAt = 2
    await authenticate(page)
    await mockContentReviewApi(page, state)

    await page.goto(`/en/content/packs/${packId}`)

    await page.getByRole('button', { name: 'Approve exact v2' }).click()

    // While the authoritative refetch is in flight the rail announces the
    // refresh and must not accept a second decision on the stale version.
    await expect(page.getByText('Loading the latest version…')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Approve exact v2' }),
    ).toBeDisabled()
    await expect.poll(() => state.decisionCalls).toBe(1)

    // Release the refetch: fresh data lands, then the conflict is announced.
    state.releaseWorkspaceGet?.()
    await expect(page.getByText('Stale version conflict')).toBeVisible()
    await expect(page.getByText(/Exact version 3/)).toBeVisible()
    await expect.poll(() => state.workspaceGets).toBeGreaterThanOrEqual(2)

    // Focus returns to the refreshed item heading once authoritative data is
    // displayed, so the owner's next action targets the new version.
    const heading = page.locator(
      `#item-heading-${mockPackWorkspace.items[0].item.id}`,
    )
    await expect(heading).toBeFocused()
  })

  test('bulk approval submits only explicitly selected eligible versions and reports results', async ({
    page,
  }) => {
    const state = makeState()
    await authenticate(page)
    await mockContentReviewApi(page, state)

    await page.goto(`/en/content/packs/${packId}`)

    const blockedItem = page.getByRole('button', {
      name: /Sun · FACEBOOK Blocked/i,
    })
    await expect(blockedItem).toBeDisabled()
    await expect(blockedItem.getByText('Blocked')).toBeVisible()

    // Item 3 is frozen by an immutable publication candidate: it must be
    // excluded from bulk selection and labeled Approved, not Blocked.
    const frozenItem = page.getByRole('button', {
      name: /Fri · INSTAGRAM/i,
    })
    await expect(frozenItem).toBeDisabled()
    await expect(frozenItem.getByText('Approved')).toBeVisible()

    await page.getByRole('button', { name: 'Select all eligible (2)' }).click()
    await page.getByRole('button', { name: 'Approve selected (2)' }).click()

    await expect.poll(() => state.bulkCalls).toBe(1)
    const body = state.lastBulkBody as {
      decisions: Array<{
        content_item_id: string
        content_item_version_id: string
        content_item_version_checksum: string
        decision: string
        revision_notes: string | null
        idempotency_key: string
      }>
    }
    expect(body.decisions).toHaveLength(2)
    expect(body.decisions.map((d) => d.content_item_id)).not.toContain(
      mockPackWorkspace.items[3].item.id,
    )
    expect(body.decisions.map((d) => d.content_item_id)).not.toContain(
      mockPackWorkspace.items[2].item.id,
    )
    for (const decision of body.decisions) {
      expect(decision.decision).toBe('approved')
      expect(decision.revision_notes).toBeNull()
      expect(decision.idempotency_key).toBeTruthy()
    }

    await expect(
      page.getByText('Bulk approval completed: 2 of 2 items created publication candidates.'),
    ).toBeVisible()
  })

  test('renders the workspace in Arabic with RTL direction and protected Arabic captions', async ({
    page,
  }) => {
    await authenticate(page)
    await mockContentReviewApi(page, makeState())

    await page.goto(`/ar/content/packs/${packId}`)

    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(
      page.getByRole('heading', { name: 'مراجعة واعتماد المحتوى' }),
    ).toBeVisible()
    await expect(page.getByText('محتوى الأسبوع 3', { exact: true })).toBeVisible()
    await expect(page.getByText('الخطة التسويقية v4')).toBeVisible()

    const arabicCaption = page.getByText(/عروض كشري كورنر/)
    await expect(arabicCaption.first()).toBeVisible()
    await expect(arabicCaption.first().locator('..')).toHaveAttribute(
      'dir',
      'rtl',
    )
  })

  test('shows the shared mobile bottom navigation on mobile viewports', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'mobile-chrome',
      'The bottom nav is intentionally hidden on desktop.',
    )
    await authenticate(page)
    await mockContentReviewApi(page, makeState())
    await page.goto(`/en/content/packs/${packId}`)
    const nav = page.getByRole('navigation', { name: 'Mobile primary' })
    await expect(nav).toHaveClass(/fixed/)
    await expect(nav).toHaveClass(/bottom-0/)
  })
})
