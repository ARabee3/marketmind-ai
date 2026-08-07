import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useVoiceNoteRecorder } from '../use-voice-note-recorder'

describe('useVoiceNoteRecorder', () => {
  const originalMediaDevices = navigator.mediaDevices
  const originalAudioContext = window.AudioContext

  beforeEach(() => {
    vi.restoreAllMocks()
    window.AudioContext = vi.fn().mockImplementation(() => ({
      createMediaStreamSource: vi
        .fn()
        .mockReturnValue({ connect: vi.fn(), disconnect: vi.fn() }),
      createScriptProcessor: vi.fn().mockReturnValue({
        connect: vi.fn(),
        disconnect: vi.fn(),
        onaudioprocess: null,
      }),
      createGain: vi.fn().mockReturnValue({
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: { value: 1 },
      }),
      close: vi.fn().mockResolvedValue(undefined),
      destination: {},
      sampleRate: 16000,
    })) as unknown as typeof AudioContext
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      writable: true,
      configurable: true,
    })
    window.AudioContext = originalAudioContext
  })

  it('detects isSupported when navigator.mediaDevices and AudioContext are present', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn() },
      writable: true,
      configurable: true,
    })

    const { result } = renderHook(() => useVoiceNoteRecorder())
    expect(result.current.isSupported).toBe(true)
  })

  it('handles mic permission denial gracefully', async () => {
    const getUserMediaMock = vi
      .fn()
      .mockRejectedValue(
        new DOMException('Permission denied', 'NotAllowedError'),
      )
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: getUserMediaMock },
      writable: true,
      configurable: true,
    })

    const { result } = renderHook(() => useVoiceNoteRecorder())

    await act(async () => {
      await result.current.startRecording()
    })

    expect(result.current.error).toBe('mic_denied')
    expect(result.current.state).toBe('idle')
  })

  it('resets recorder state and error on reset()', () => {
    const { result } = renderHook(() => useVoiceNoteRecorder())

    act(() => {
      result.current.reset()
    })

    expect(result.current.state).toBe('idle')
    expect(result.current.durationSeconds).toBe(0)
    expect(result.current.error).toBe(null)
  })

  it('cleans up the microphone when the maximum duration is reached', async () => {
    vi.useFakeTimers()
    const trackStop = vi.fn()
    const contextClose = vi.fn().mockResolvedValue(undefined)
    const stream = { getTracks: () => [{ stop: trackStop }] }
    const getUserMediaMock = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: getUserMediaMock },
      writable: true,
      configurable: true,
    })
    window.AudioContext = vi.fn().mockImplementation(() => ({
      createMediaStreamSource: vi
        .fn()
        .mockReturnValue({ connect: vi.fn(), disconnect: vi.fn() }),
      createScriptProcessor: vi.fn().mockReturnValue({
        connect: vi.fn(),
        disconnect: vi.fn(),
        onaudioprocess: null,
      }),
      createGain: vi.fn().mockReturnValue({
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: { value: 1 },
      }),
      close: contextClose,
      destination: {},
      sampleRate: 16000,
    })) as unknown as typeof AudioContext

    try {
      const { result } = renderHook(() => useVoiceNoteRecorder(1))

      await act(async () => {
        await result.current.startRecording()
      })
      expect(result.current.state).toBe('recording')

      await act(async () => {
        vi.advanceTimersByTime(1000)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(result.current.state).toBe('idle')
      expect(result.current.error).toBe('too_long')
      expect(trackStop).toHaveBeenCalled()
      expect(contextClose).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
