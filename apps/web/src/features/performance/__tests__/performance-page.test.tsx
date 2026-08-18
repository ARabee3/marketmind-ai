import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  PerformanceOverviewV1,
  PerformancePostProjectionV1,
} from '@marketmind/contracts'
import { getPerformanceOverview, refreshPerformancePost } from '@/lib/api/performance'
import { PerformancePage } from '../performance-page'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values
      ? `${key}:${Object.entries(values)
          .map(([name, value]) => `${name}=${value}`)
          .join(',')}`
      : key,
  useFormatter: () => ({
    dateTime: (value: Date) => value.toISOString(),
    number: (value: number) => String(value),
  }),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/api/performance', () => ({
  getPerformanceOverview: vi.fn(),
  refreshPerformancePost: vi.fn(),
}))

const mockedGetPerformanceOverview = vi.mocked(getPerformanceOverview)
const mockedRefreshPerformancePost = vi.mocked(refreshPerformancePost)

const BUSINESS_ID = 'a1000000-0000-4000-8000-000000000001'
const CANDIDATE_ID = 'a1000000-0000-4000-8000-000000000002'
const RESULT_ID = 'a1000000-0000-4000-8000-000000000003'

function post(): PerformancePostProjectionV1 {
  return {
    contract_version: 'performance-v1',
    business_id: BUSINESS_ID,
    candidate_id: CANDIDATE_ID,
    publishing_result_id: RESULT_ID,
    provider: 'facebook',
    provider_object_id: 'page-1_post-1',
    published_at: '2026-08-18T08:00:00.000Z',
    snapshots: [
      {
        contract_version: 'performance-v1',
        snapshot_id: 'a1000000-0000-4000-8000-000000000004',
        business_id: BUSINESS_ID,
        publishing_result_id: RESULT_ID,
        provider: 'facebook',
        provider_object_id: 'page-1_post-1',
        window: '24h',
        published_at: '2026-08-18T08:00:00.000Z',
        observed_at: '2026-08-19T08:00:00.000Z',
        fetched_at: '2026-08-19T08:00:01.000Z',
        metrics: {
          post_media_view: { status: 'available', value: 12 },
          post_total_media_view_unique: { status: 'available', value: 0 },
          post_clicks: { status: 'unavailable', reason: 'not_returned' },
        },
      },
    ],
    sync_windows: [
      {
        contract_version: 'performance-v1',
        sync_window_id: 'a1000000-0000-4000-8000-000000000005',
        business_id: BUSINESS_ID,
        publishing_result_id: RESULT_ID,
        provider: 'facebook',
        window: '24h',
        due_at: '2026-08-19T08:00:00.000Z',
        state: 'succeeded',
        attempt_count: 1,
        next_attempt_at: null,
        lease_owner: null,
        lease_expires_at: null,
        last_error_code: null,
        created_at: '2026-08-18T08:00:00.000Z',
        updated_at: '2026-08-19T08:00:01.000Z',
      },
    ],
  }
}

function overview(posts: readonly PerformancePostProjectionV1[]): PerformanceOverviewV1 {
  return {
    contract_version: 'performance-v1',
    business_id: BUSINESS_ID,
    provider: 'facebook',
    generated_at: '2026-08-19T08:00:01.000Z',
    posts,
    baseline: {
      status: 'not_ready',
      observed_snapshot_count: 1,
      required_snapshot_count: 3,
      reason: 'insufficient_snapshots',
    },
    capability: {
      status: 'ready',
      blockers: [],
      last_successful_sync: '2026-08-19T08:00:01.000Z',
    },
  }
}

describe('PerformancePage', () => {
  afterEach(() => vi.clearAllMocks())

  it('renders real raw values and labels missing metrics unavailable', async () => {
    mockedGetPerformanceOverview.mockResolvedValue(overview([post()]))

    render(<PerformancePage />)

    expect(await screen.findByRole('heading', { name: 'title' })).not.toBeNull()
    expect(screen.getAllByText('metrics.names.post_media_view')).not.toHaveLength(0)
    expect(screen.getAllByText('12')).not.toHaveLength(0)
    expect(screen.getAllByText('0')).not.toHaveLength(0)
    expect(screen.getAllByText('metrics.unavailable').length).toBeGreaterThan(0)
    expect(screen.getByText(/baseline.count:observed=1,required=3/)).not.toBeNull()
  })

  it('shows a permission blocker and safe reconnect action without hiding evidence', async () => {
    const blocked: PerformanceOverviewV1 = {
      ...overview([post()]),
      capability: {
        status: 'blocked',
        blockers: ['read_insights_permission_missing'],
        last_successful_sync: null,
      },
    }
    mockedGetPerformanceOverview.mockResolvedValue(blocked)

    render(<PerformancePage />)

    expect(await screen.findByText('connection.blockers.read_insights_permission_missing')).not.toBeNull()
    const reconnectLinks = screen.getAllByRole('link', {
      name: 'connection.reconnectAction',
    })
    expect(reconnectLinks).toHaveLength(2)
    for (const link of reconnectLinks) {
      expect(link.getAttribute('href')).toBe('/connections')
    }
  })

  it('keeps the no-eligible-post state truthful', async () => {
    mockedGetPerformanceOverview.mockResolvedValue(overview([]))

    render(<PerformancePage />)

    expect(await screen.findByRole('heading', { name: 'empty.title' })).not.toBeNull()
    expect(screen.getByRole('link', { name: 'empty.action' }).getAttribute('href')).toBe(
      '/publishing',
    )
    expect(screen.queryByText('metrics.names.post_clicks')).toBeNull()
  })

  it('reports a queued refresh and reloads the evidence view', async () => {
    mockedGetPerformanceOverview
      .mockResolvedValueOnce(overview([post()]))
      .mockResolvedValueOnce(overview([post()]))
    mockedRefreshPerformancePost.mockResolvedValue({ status: 'queued', windows: [] })

    render(<PerformancePage />)

    await screen.findByRole('heading', { name: 'title' })
    fireEvent.click(screen.getByRole('button', { name: 'post.refresh' }))

    await waitFor(() => {
      expect(mockedRefreshPerformancePost).toHaveBeenCalledWith(RESULT_ID)
      expect(mockedGetPerformanceOverview).toHaveBeenCalledTimes(2)
    })
    expect(screen.getByText(/notices.queued/)).not.toBeNull()
  })

  it('reports refresh rate limiting without replacing the current evidence', async () => {
    mockedGetPerformanceOverview.mockResolvedValue(overview([post()]))
    mockedRefreshPerformancePost.mockRejectedValue(
      Object.assign(new Error('wait'), {
        status: 429,
        code: 'PERFORMANCE_PROVIDER_RATE_LIMITED',
      }),
    )

    render(<PerformancePage />)

    await screen.findByRole('heading', { name: 'title' })
    fireEvent.click(screen.getByRole('button', { name: 'post.refresh' }))

    expect((await screen.findByRole('alert')).textContent).toContain('notices.rateLimited')
    expect(mockedGetPerformanceOverview).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText('12')).not.toHaveLength(0)
  })
})
