import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionsPage } from '../connections-page'

const getConnectionMock = vi.hoisted(() => vi.fn())
const testConnectionMock = vi.hoisted(() => vi.fn())
const disconnectMock = vi.hoisted(() => vi.fn())
const connectMetaMock = vi.hoisted(() => vi.fn())

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: (date: Date) => date.toISOString().slice(0, 10),
  }),
}))

vi.mock('@/lib/api/facebook', () => ({
  getFacebookConnection: getConnectionMock,
  testFacebookConnection: testConnectionMock,
  disconnectFacebookConnection: disconnectMock,
  connectMeta: connectMetaMock,
}))

const CONNECTED = {
  provider: 'facebook',
  pageName: 'Koshary Corner',
  isValid: true,
  connectedAt: '2026-08-01T12:00:00Z',
  lastTestedAt: null,
  expiresAt: '2026-10-31T12:00:00Z',
}

describe('ConnectionsPage', () => {
  beforeEach(() => {
    getConnectionMock.mockReset()
    testConnectionMock.mockReset()
    disconnectMock.mockReset()
    connectMetaMock.mockReset()
  })

  it('prompts to connect when no connection exists', async () => {
    getConnectionMock.mockResolvedValue(null)

    render(<ConnectionsPage />)

    await waitFor(() => {
      expect(screen.getByText('emptyTitle')).toBeTruthy()
    })
    expect(screen.getByText('connectButton')).toBeTruthy()
  })

  it('shows the connected page details with test and disconnect actions', async () => {
    getConnectionMock.mockResolvedValue(CONNECTED)

    render(<ConnectionsPage />)

    await waitFor(() => {
      expect(screen.getByText('Koshary Corner')).toBeTruthy()
    })
    expect(screen.getByText('statusConnected')).toBeTruthy()
    expect(screen.getByText('neverTested')).toBeTruthy()
    expect(screen.getByText('testButton')).toBeTruthy()
    expect(screen.getByText('disconnectButton')).toBeTruthy()
  })

  it('shows the expired state with a reconnect action when the token is invalid', async () => {
    getConnectionMock.mockResolvedValue({ ...CONNECTED, isValid: false })

    render(<ConnectionsPage />)

    await waitFor(() => {
      expect(screen.getByText('expiredTitle')).toBeTruthy()
    })
    expect(screen.getByText('reconnectButton')).toBeTruthy()
  })

  it('connects a page via the popup flow and refreshes', async () => {
    getConnectionMock.mockResolvedValue(null)
    connectMetaMock.mockResolvedValue({ pageName: 'Koshary Corner' })

    render(<ConnectionsPage />)

    await waitFor(() => {
      expect(screen.getByText('connectButton')).toBeTruthy()
    })

    getConnectionMock.mockResolvedValue(CONNECTED)
    fireEvent.click(screen.getByText('connectButton'))

    await waitFor(() => {
      expect(screen.getByText('Koshary Corner')).toBeTruthy()
    })
    expect(connectMetaMock).toHaveBeenCalledTimes(1)
  })

  it('shows an error notice when the popup flow fails', async () => {
    getConnectionMock.mockResolvedValue(null)
    connectMetaMock.mockRejectedValue(new Error('The connection request expired.'))

    render(<ConnectionsPage />)

    await waitFor(() => {
      expect(screen.getByText('connectButton')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('connectButton'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
  })

  it('tests the connection and reports success', async () => {
    getConnectionMock.mockResolvedValue(CONNECTED)
    testConnectionMock.mockResolvedValue({ success: true, postId: 'post-1' })

    render(<ConnectionsPage />)

    await waitFor(() => {
      expect(screen.getByText('testButton')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('testButton'))

    await waitFor(() => {
      expect(screen.getByText('testSucceeded')).toBeTruthy()
    })
    expect(testConnectionMock).toHaveBeenCalledTimes(1)
  })

  it('reports an expired test result', async () => {
    getConnectionMock.mockResolvedValue(CONNECTED)
    testConnectionMock.mockResolvedValue({ success: false, reason: 'expired' })

    render(<ConnectionsPage />)

    await waitFor(() => {
      expect(screen.getByText('testButton')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('testButton'))

    await waitFor(() => {
      expect(screen.getByText('testExpired')).toBeTruthy()
    })
  })

  it('disconnects after an explicit confirmation and returns to the empty state', async () => {
    getConnectionMock.mockResolvedValue(CONNECTED)
    disconnectMock.mockResolvedValue(undefined)

    render(<ConnectionsPage />)

    await waitFor(() => {
      expect(screen.getByText('disconnectButton')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('disconnectButton'))
    expect(screen.getByText('disconnectConfirm')).toBeTruthy()

    getConnectionMock.mockResolvedValue(null)
    fireEvent.click(screen.getByText('disconnectConfirmAction'))

    await waitFor(() => {
      expect(screen.getByText('emptyTitle')).toBeTruthy()
    })
    expect(disconnectMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the connection when the disconnect confirmation is cancelled', async () => {
    getConnectionMock.mockResolvedValue(CONNECTED)

    render(<ConnectionsPage />)

    await waitFor(() => {
      expect(screen.getByText('disconnectButton')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('disconnectButton'))
    fireEvent.click(screen.getByText('cancelDisconnect'))

    expect(disconnectMock).not.toHaveBeenCalled()
    expect(screen.getByText('disconnectButton')).toBeTruthy()
  })

  it('shows a retry action when the initial load fails', async () => {
    getConnectionMock.mockRejectedValue(new Error('down'))

    render(<ConnectionsPage />)

    await waitFor(() => {
      expect(screen.getByText('loadFailed')).toBeTruthy()
    })
    expect(screen.getByText('retry')).toBeTruthy()
  })
})
