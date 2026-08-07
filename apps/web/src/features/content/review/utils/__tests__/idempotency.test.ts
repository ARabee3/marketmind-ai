import { describe, expect, it } from 'vitest'
import { generateIdempotencyKey } from '../idempotency'

describe('generateIdempotencyKey', () => {
  it('generates a unique key per call', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateIdempotencyKey()))
    expect(keys.size).toBe(100)
  })

  it('produces a usable transport-safe string', () => {
    const key = generateIdempotencyKey()
    expect(typeof key).toBe('string')
    expect(key.length).toBeGreaterThanOrEqual(16)
    expect(/[^a-zA-Z0-9._-]/.test(key)).toBe(false)
  })
})
