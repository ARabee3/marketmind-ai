import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getPackWorkspace,
  getItemVersionHistory,
  submitItemDecision,
  submitBulkDecisions,
  fetchAuthenticatedAssetBlob,
  getPublicationCandidate,
} from '../content-review'
import { apiRequest } from '../client'

vi.mock('../client', () => ({
  apiRequest: vi.fn(),
}))

describe('content-review API adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches pack workspace', async () => {
    const mockWorkspace = { pack: { id: 'pack-1' }, items: [] }
    vi.mocked(apiRequest).mockResolvedValueOnce(
      new Response(JSON.stringify(mockWorkspace), { status: 200 }),
    )

    const result = await getPackWorkspace('pack-1')
    expect(apiRequest).toHaveBeenCalledWith('/content-packs/pack-1/workspace')
    expect(result).toEqual(mockWorkspace)
  })

  it('fetches item version history', async () => {
    const mockVersions = [{ id: 'v-1', version: 1 }]
    vi.mocked(apiRequest).mockResolvedValueOnce(
      new Response(JSON.stringify(mockVersions), { status: 200 }),
    )

    const result = await getItemVersionHistory('pack-1', 'item-1')
    expect(apiRequest).toHaveBeenCalledWith(
      '/content-packs/pack-1/items/item-1/versions',
    )
    expect(result).toEqual(mockVersions)
  })

  it('submits exact item decision for approve', async () => {
    const mockDecisionRes = {
      decision: { id: 'dec-1', decision: 'approved' },
      publication_candidate: { id: 'cand-1' },
    }
    vi.mocked(apiRequest).mockResolvedValueOnce(
      new Response(JSON.stringify(mockDecisionRes), { status: 200 }),
    )

    const result = await submitItemDecision('pack-1', 'item-1', {
      item_id: 'item-1',
      version_id: 'v-1',
      checksum: 'a'.repeat(64),
      decision: 'approve',
      idempotency_key: 'key-123',
    })

    expect(apiRequest).toHaveBeenCalledWith(
      '/content-packs/pack-1/items/item-1/decisions',
      {
        method: 'POST',
        body: {
          content_item_id: 'item-1',
          content_item_version_id: 'v-1',
          content_item_version_checksum: 'a'.repeat(64),
          decision: 'approved',
          revision_notes: null,
          idempotency_key: 'key-123',
        },
      },
    )
    expect(result).toEqual(mockDecisionRes)
  })

  it('submits decision for revision and throws typed error on failure/conflict', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'CONTENT_VERSION_CONFLICT',
          message: 'Stale version',
          latest_version_id: 'v-2',
        }),
        { status: 409 },
      ),
    )

    await expect(
      submitItemDecision('pack-1', 'item-1', {
        item_id: 'item-1',
        version_id: 'v-1',
        checksum: 'a'.repeat(64),
        decision: 'revise',
        notes: 'Fix typos',
        idempotency_key: 'key-124',
      }),
    ).rejects.toMatchObject({
      code: 'CONTENT_VERSION_CONFLICT',
      latestVersionId: 'v-2',
    })
  })

  it('submits bulk decisions', async () => {
    const mockBulkRes = [
      { item_id: 'item-1', status: 'approved' },
      {
        item_id: 'item-2',
        status: 'ineligible',
        error: {
          code: 'CONTENT_ASSET_REQUIRED',
          message: 'Required assets are not ready.',
        },
      },
    ]
    vi.mocked(apiRequest).mockResolvedValueOnce(
      new Response(JSON.stringify(mockBulkRes), { status: 200 }),
    )

    const result = await submitBulkDecisions('pack-1', {
      decisions: [
        {
          content_item_id: 'item-1',
          content_item_version_id: 'v-1',
          content_item_version_checksum: 'a'.repeat(64),
          decision: 'approved',
          revision_notes: null,
          idempotency_key: 'bulk-key-1',
        },
        {
          content_item_id: 'item-2',
          content_item_version_id: 'v-1',
          content_item_version_checksum: 'b'.repeat(64),
          decision: 'approved',
          revision_notes: null,
          idempotency_key: 'bulk-key-2',
        },
      ],
    })

    expect(apiRequest).toHaveBeenCalledWith('/content-packs/pack-1/decisions/bulk', {
      method: 'POST',
      body: {
        decisions: [
          {
            content_item_id: 'item-1',
            content_item_version_id: 'v-1',
            content_item_version_checksum: 'a'.repeat(64),
            decision: 'approved',
            revision_notes: null,
            idempotency_key: 'bulk-key-1',
          },
          {
            content_item_id: 'item-2',
            content_item_version_id: 'v-1',
            content_item_version_checksum: 'b'.repeat(64),
            decision: 'approved',
            revision_notes: null,
            idempotency_key: 'bulk-key-2',
          },
        ],
      },
    })
    expect(result).toEqual(mockBulkRes)
  })

  it('fetches authenticated asset blob', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(
      new Response('fake image bytes', {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    )

    const result = await fetchAuthenticatedAssetBlob('asset-1')
    expect(apiRequest).toHaveBeenCalledWith('/content-assets/asset-1')
    expect(result.type).toBe('image/png')
    expect(await result.text()).toBe('fake image bytes')
  })

  it('fetches publication candidate', async () => {
    const mockCand = { id: 'cand-1', publication_candidate_id: 'cand-1' }
    vi.mocked(apiRequest).mockResolvedValueOnce(
      new Response(JSON.stringify(mockCand), { status: 200 }),
    )

    const result = await getPublicationCandidate('cand-1')
    expect(apiRequest).toHaveBeenCalledWith('/publication-candidates/cand-1')
    expect(result).toEqual(mockCand)
  })
})
