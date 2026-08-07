import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VoiceNoteControl } from '../voice-note-control'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (params && 'time' in params) {
      return `${key} (${params.time}s)`
    }
    return key
  },
}))

vi.mock('@/lib/api/discovery', () => ({
  transcribeDiscoveryVoiceNote: vi.fn(),
}))

describe('VoiceNoteControl', () => {
  const originalMediaDevices = navigator.mediaDevices
  const originalAudioContext = window.AudioContext

  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn() },
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

  it('renders record voice note button when supported', () => {
    render(
      <VoiceNoteControl
        sessionId="session-1"
        onTranscriptReady={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    expect(screen.getByText('recordVoiceNote')).toBeDefined()
  })

  it('disables button when typed text exists', () => {
    render(
      <VoiceNoteControl
        sessionId="session-1"
        onTranscriptReady={vi.fn()}
        onDiscard={vi.fn()}
        hasTypedText={true}
      />,
    )

    const btn = screen.getByRole('button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(screen.getByText('voiceNoteDisabledWithText')).toBeDefined()
  })
})
