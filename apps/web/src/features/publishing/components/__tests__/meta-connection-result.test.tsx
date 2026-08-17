import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MetaConnectionResult } from '../meta-connection-result'

const pendingSelectionMock = vi.hoisted(() => vi.fn())
const selectTargetsMock = vi.hoisted(() => vi.fn())
const pushMock = vi.hoisted(() => vi.fn())

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/lib/api/publishing', () => ({
  getMetaPendingSelection: pendingSelectionMock,
  selectMetaTargets: selectTargetsMock,
}))

describe('MetaConnectionResult', () => {
  it('requires linked Instagram when Strategy requested Instagram and returns selected targets', async () => {
    pendingSelectionMock.mockResolvedValue({
      contract_version: 'meta-connection-v1',
      connection_id: 'connection-1',
      requested_channel: 'instagram',
      requested_capability: 'static_image',
      expires_at: null,
      performance_capability: {
        status: 'supported',
        blockers: [],
      },
      options: [
        {
          page: {
            channel: 'facebook',
            account_id: 'page-1',
            display_name: 'Cairo Page',
            capability_status: 'supported',
            blockers: [],
          },
          instagram: {
            channel: 'instagram',
            account_id: 'ig-1',
            display_name: 'Cairo Instagram',
            capability_status: 'supported',
            blockers: [],
          },
        },
      ],
    })
    const targets = [
      {
        contract_version: 'publishing-target-v1',
        target_id: 'target-ig',
        version: 1,
        business_id: 'business-1',
        provider: 'meta',
        channel: 'instagram',
        external_account_id: 'ig-1',
        display_name: 'Cairo Instagram',
        connection_state: 'connected',
        capabilities: ['static_image'],
        last_verified_at: null,
      },
    ] as const
    selectTargetsMock.mockResolvedValue(targets)
    const onComplete = vi.fn()

    render(
      <MetaConnectionResult
        code="success"
        connectionId="connection-1"
        requiredChannel="instagram"
        onComplete={onComplete}
        backHref="/strategy/new"
        successHref="/strategy/new"
      />,
    )

    const checkbox = await screen.findByRole('checkbox')
    expect((checkbox as HTMLInputElement).checked).toBe(true)
    expect((checkbox as HTMLInputElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'selectButton' }))

    await waitFor(() => {
      expect(selectTargetsMock).toHaveBeenCalledWith({
        connectionId: 'connection-1',
        pageId: 'page-1',
        includeInstagram: true,
      })
    })
    expect(onComplete).toHaveBeenCalledWith(targets, {
      requestedChannel: 'instagram',
      includeInstagram: true,
    })
  })
})
