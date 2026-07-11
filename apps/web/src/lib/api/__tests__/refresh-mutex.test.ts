import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startRefresh, getRefreshPromise } from '../refresh-mutex'

describe('refresh mutex', () => {
  beforeEach(() => {
    // If a previous test left a promise behind, wait for it to settle.
    const pending = getRefreshPromise()
    if (pending) return pending.catch(() => {})
  })

  it('runs the refresher exactly once for concurrent callers', async () => {
    const refresher = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return 'token'
    })

    const [first, second] = await Promise.all([
      startRefresh(refresher),
      startRefresh(refresher),
    ])

    expect(refresher).toHaveBeenCalledTimes(1)
    expect(first).toBe('token')
    expect(second).toBe('token')
  })

  it('allows a new refresh after the previous one settles', async () => {
    const refresher = vi.fn().mockResolvedValue('token-1')

    await startRefresh(refresher)
    const result = await startRefresh(refresher)

    expect(refresher).toHaveBeenCalledTimes(2)
    expect(result).toBe('token-1')
  })

  it('shares rejection with all concurrent callers', async () => {
    const refresher = vi.fn().mockRejectedValue(new Error('network down'))

    await expect(Promise.all([startRefresh(refresher), startRefresh(refresher)]))
      .rejects.toThrow('network down')

    expect(refresher).toHaveBeenCalledTimes(1)
  })
})
