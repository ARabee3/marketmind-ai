import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'
import type { ContentDecisionResponse } from '@marketmind/contracts'
import { ContentReviewWorkspace } from '../ContentReviewWorkspace'
import { mockPackWorkspace } from '../../fixtures/pack.fixtures'
import * as api from '@/lib/api/content-review'

// Mock next-intl hooks
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => {
    const t = (key: string, params?: Record<string, unknown>) => {
      if (params) {
        let str = `${namespace}.${key}`
        Object.entries(params).forEach(([k, v]) => {
          str += ` ${k}:${v}`
        })
        return str
      }
      return `${namespace}.${key}`
    }
    t.has = () => true
    t.raw = (key: string) => `${namespace}.${key}`
    return t
  },
  useFormatter: () => ({
    dateTime: (date: Date, options: Intl.DateTimeFormatOptions = {}) =>
      new Intl.DateTimeFormat('en-US', options).format(date),
  }),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

// Mock api client methods
vi.mock('@/lib/api/content-review', () => ({
  getPackWorkspace: vi.fn(),
  submitItemDecision: vi.fn(),
  submitBulkDecisions: vi.fn(),
  fetchAuthenticatedAssetBlob: vi.fn(),
}))

describe('ContentReviewWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    if (!global.URL.createObjectURL) {
      global.URL.createObjectURL = vi.fn(() => 'blob:fake-object-url')
    } else {
      vi.spyOn(global.URL, 'createObjectURL').mockReturnValue('blob:fake-object-url')
    }
    if (!global.URL.revokeObjectURL) {
      global.URL.revokeObjectURL = vi.fn()
    } else {
      vi.spyOn(global.URL, 'revokeObjectURL').mockImplementation(() => {})
    }
    vi.mocked(api.getPackWorkspace).mockResolvedValue(mockPackWorkspace)
    vi.mocked(api.fetchAuthenticatedAssetBlob).mockResolvedValue(
      new Blob(['fake-image'], { type: 'image/jpeg' }),
    )
  })

  it('renders workspace with header, agenda, proof, decision rail, and provenance margin', async () => {
    render(<ContentReviewWorkspace packId={mockPackWorkspace.pack.id} />)

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1 }).textContent,
      ).toContain('ContentReview.header.title')
    })

    // Header checks
    expect(
      screen.getByText(/ContentReview\.header\.strategyVersion/i),
    ).toBeDefined()
    expect(
      screen.getByText(/ContentReview\.header\.backToCycle/i),
    ).toBeDefined()

    // Agenda checks
    expect(screen.getByText(/ContentReview\.agenda\.title/i)).toBeDefined()

    // Decision Rail checks
    expect(screen.getByText(/ContentReview\.decision\.title/i)).toBeDefined()
    expect(
      screen.getByText(/ContentReview\.decision\.consequence/i),
    ).toBeDefined()

    // Provenance Margin checks
    expect(
      screen.getByText(/ContentReview\.provenance\.title/i),
    ).toBeDefined()
  })

  it('allows requesting a revision and requires non-empty notes in dialog', async () => {
    render(<ContentReviewWorkspace packId={mockPackWorkspace.pack.id} />)

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1 }).textContent,
      ).toContain('ContentReview.header.title')
    })

    // Click request revision button
    const revisionBtn = screen.getByText(
      'ContentReview.decision.actions.requestRevision',
    )
    fireEvent.click(revisionBtn)

    // Dialog should open
    expect(
      screen.getByText('ContentReview.revisionDialog.title'),
    ).toBeDefined()

    // Try submitting without notes
    const submitBtn = screen.getByText('ContentReview.revisionDialog.submit')
    fireEvent.click(submitBtn)

    // Validation error should show
    expect(
      screen.getByText('ContentReview.revisionDialog.notesRequiredError'),
    ).toBeDefined()
    expect(api.submitItemDecision).not.toHaveBeenCalled()

    // Enter notes and submit
    const textarea = screen.getByPlaceholderText(
      'ContentReview.revisionDialog.notesPlaceholder',
    )
    fireEvent.change(textarea, {
      target: { value: 'Please update CTA with phone number' },
    })

    vi.mocked(api.submitItemDecision).mockResolvedValueOnce({
      decision: {
        id: 'dec-new',
        content_item_id: '33333333-3333-4333-8333-333333333331',
        content_item_version_id: '55555555-5555-4555-8555-555555555512',
        content_item_version: 2,
        content_item_version_checksum: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890a1b2c3d4',
        decision: 'revision_requested',
        revision_notes: 'Please update CTA with phone number',
        decided_by_user_id: 'user-999',
        decided_at: '2026-08-01T12:00:00.000Z',
      },
      publication_candidate: null,
    })

    await act(async () => {
      fireEvent.click(submitBtn)
    })

    await waitFor(() => {
      expect(api.submitItemDecision).toHaveBeenCalledWith(
        mockPackWorkspace.pack.id,
        mockPackWorkspace.items[0].item.id,
        expect.objectContaining({
          decision: 'revise',
          notes: 'Please update CTA with phone number',
        }),
      )
    })
  })

  it('handles explicit bulk decision selection and approval', async () => {
    render(<ContentReviewWorkspace packId={mockPackWorkspace.pack.id} />)

    await waitFor(() => {
      expect(screen.getByText('ContentReview.bulk.title')).toBeDefined()
    })

    // Click "Select all eligible"
    const selectAllBtn = screen.getByText(
      /ContentReview\.bulk\.selectAllEligible/i,
    )
    fireEvent.click(selectAllBtn)

    // Bulk approve button should show count of selected
    const bulkApproveBtn = screen.getByText(
      /ContentReview\.bulk\.approveSelected/i,
    )
    expect((bulkApproveBtn.closest('button') as HTMLButtonElement).disabled).toBe(false)

    vi.mocked(api.submitBulkDecisions).mockResolvedValueOnce([
      {
        item_id: mockPackWorkspace.items[0].item.id,
        status: 'approved',
      },
      {
        item_id: mockPackWorkspace.items[1].item.id,
        status: 'approved',
      },
    ])

    await act(async () => {
      fireEvent.click(bulkApproveBtn)
    })

    await waitFor(() => {
      expect(api.submitBulkDecisions).toHaveBeenCalledWith(
        mockPackWorkspace.pack.id,
        expect.objectContaining({
          decisions: expect.any(Array),
        }),
      )
    })
  })

  it('disables approval button for ineligible/blocked items', async () => {
    render(<ContentReviewWorkspace packId={mockPackWorkspace.pack.id} />)

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1 }).textContent,
      ).toContain('ContentReview.header.title')
    })

    // Select Item 4 (blocked)
    const selectAgendaItem4 = screen.getAllByRole('button', { name: /4\. Sun/i })[0]
    fireEvent.click(selectAgendaItem4)

    // Decision rail approve button should be disabled for item 4
    const approveBtn = screen.getByRole('button', {
      name: /ContentReview\.decision\.actions\.approveVersion/i,
    }) as HTMLButtonElement
    expect(approveBtn.disabled).toBe(true)
  })

  it('renders active publication candidate banner without scheduled or published wording', async () => {
    render(<ContentReviewWorkspace packId={mockPackWorkspace.pack.id} />)

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1 }).textContent,
      ).toContain('ContentReview.header.title')
    })

    // Select Item 3 (approved, active candidate)
    const selectAgendaItem3 = screen.getAllByRole('button', { name: /3\. Fri/i })[0]
    fireEvent.click(selectAgendaItem3)

    expect(
      screen.getByText('ContentReview.handoff.statusActive'),
    ).toBeDefined()
    expect(
      screen.getByText('ContentReview.handoff.openPublishing'),
    ).toBeDefined()
  })

  it('locks the decision rail for an item with an immutable publication candidate', async () => {
    render(<ContentReviewWorkspace packId={mockPackWorkspace.pack.id} />)

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1 }).textContent,
      ).toContain('ContentReview.header.title')
    })

    // Select Item 3 (approved, active candidate)
    const selectAgendaItem3 = screen.getAllByRole('button', { name: /3\. Fri/i })[0]
    fireEvent.click(selectAgendaItem3)

    // No approve / revise / reject controls may be offered for a frozen item.
    expect(
      screen.queryByRole('button', {
        name: /ContentReview\.decision\.actions\.approveVersion/i,
      }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', {
        name: /ContentReview\.decision\.actions\.requestRevision/i,
      }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', {
        name: /ContentReview\.decision\.actions\.rejectVersion/i,
      }),
    ).toBeNull()

    // Instead the rail explains the lock.
    expect(
      screen.getByText('ContentReview.decision.immutable.title'),
    ).toBeDefined()
    expect(
      screen.getByText('ContentReview.decision.immutable.body'),
    ).toBeDefined()
  })

  it('excludes candidate-frozen items from bulk selection and marks them approved', async () => {
    render(<ContentReviewWorkspace packId={mockPackWorkspace.pack.id} />)

    await waitFor(() => {
      expect(screen.getByText('ContentReview.bulk.title')).toBeDefined()
    })

    // Item 3 is frozen by a candidate: it must be disabled and labeled Approved
    // rather than selectable.
    const frozenItem = screen
      .getAllByRole('button', { name: /3\. Fri/i })
      .find((b) => b.textContent?.includes('ContentReview.bulk.approvedLabel')) as
      | HTMLButtonElement
      | undefined
    expect(frozenItem).toBeDefined()
    expect(frozenItem?.disabled).toBe(true)
    expect(screen.getByText('ContentReview.bulk.approvedLabel')).toBeDefined()

    fireEvent.click(
      screen.getByText(/ContentReview\.bulk\.selectAllEligible/i),
    )

    const bulkApproveBtn = screen.getByText(
      /ContentReview\.bulk\.approveSelected/i,
    )
    const selectedLabel = screen.getByText(
      /ContentReview\.bulk\.selectedCount/i,
    )
    expect(selectedLabel.textContent).toContain('2')
    expect((bulkApproveBtn.closest('button') as HTMLButtonElement).disabled).toBe(false)

    vi.mocked(api.submitBulkDecisions).mockResolvedValueOnce([
      { item_id: mockPackWorkspace.items[0].item.id, status: 'approved' },
      { item_id: mockPackWorkspace.items[1].item.id, status: 'approved' },
    ])

    await act(async () => {
      fireEvent.click(bulkApproveBtn)
    })

    await waitFor(() => {
      expect(api.submitBulkDecisions).toHaveBeenCalledWith(
        mockPackWorkspace.pack.id,
        expect.objectContaining({
          decisions: expect.any(Array),
        }),
      )
    })
    const payload = vi.mocked(api.submitBulkDecisions).mock.calls[0][1] as {
      decisions: Array<{ content_item_id: string }>
    }
    expect(payload.decisions.map((d) => d.content_item_id)).not.toContain(
      mockPackWorkspace.items[2].item.id,
    )
    expect(payload.decisions).toHaveLength(2)
  })

  it('refetches authoritative state and announces the change on a stale-version conflict', async () => {
    render(<ContentReviewWorkspace packId={mockPackWorkspace.pack.id} />)

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1 }).textContent,
      ).toContain('ContentReview.header.title')
    })

    vi.mocked(api.getPackWorkspace).mockClear()
    expect(api.getPackWorkspace).toHaveBeenCalledTimes(0)
    vi.mocked(api.submitItemDecision).mockRejectedValueOnce({
      code: 'CONTENT_VERSION_CONFLICT',
      message: 'Stale version',
      latestVersionId: '55555555-5555-4555-8555-555555555599',
    })

    const approveBtn = screen.getByRole('button', {
      name: /ContentReview\.decision\.actions\.approveVersion/i,
    }) as HTMLButtonElement
    expect(approveBtn.disabled).toBe(false)

    await act(async () => {
      fireEvent.click(approveBtn)
    })

    // The workspace must be refetched so the rail shows authoritative state
    // (the initial load was cleared, so the conflict refetch is the first call).
    await waitFor(() => {
      expect(api.getPackWorkspace).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(
        screen.getByText('ContentReview.decision.conflict.title'),
      ).toBeDefined()
    })
  })

  it('does not optimistically mark items approved before the server responds', async () => {
    render(<ContentReviewWorkspace packId={mockPackWorkspace.pack.id} />)

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1 }).textContent,
      ).toContain('ContentReview.header.title')
    })

    let resolveDecision: (value: ContentDecisionResponse) => void = () => {}
    vi.mocked(api.submitItemDecision).mockImplementationOnce(
      () =>
        new Promise<ContentDecisionResponse>((resolve) => {
          resolveDecision = resolve
        }),
    )

    const approveBtn = screen.getByRole('button', {
      name: /ContentReview\.decision\.actions\.approveVersion/i,
    }) as HTMLButtonElement
    fireEvent.click(approveBtn)

    // While pending, no optimistic approved state may appear.
    expect(
      screen.queryByText('ContentReview.decision.actions.success'),
    ).toBeNull()

    await act(async () => {
      resolveDecision({
        decision: {
          id: 'dec-x',
          content_item_id: mockPackWorkspace.items[0].item.id,
          content_item_version_id: 'v2',
          content_item_version: 2,
          content_item_version_checksum: 'x'.repeat(64),
          decision: 'approved',
          revision_notes: null,
          decided_by_user_id: 'user-999',
          decided_at: '2026-08-02T12:00:00.000Z',
        },
        publication_candidate: null,
      })
    })
    await waitFor(() => {
      expect(api.getPackWorkspace).toHaveBeenCalledTimes(2)
    })
  })
})
