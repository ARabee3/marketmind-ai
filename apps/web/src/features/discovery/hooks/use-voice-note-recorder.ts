'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

export type VoiceNoteRecorderState = 'idle' | 'recording' | 'transcribing'

export type VoiceNoteError =
  | 'mic_denied'
  | 'unavailable'
  | 'too_long'
  | 'failed'
  | null

export interface UseVoiceNoteRecorderReturn {
  readonly isSupported: boolean
  readonly state: VoiceNoteRecorderState
  readonly durationSeconds: number
  readonly error: VoiceNoteError
  readonly startRecording: () => Promise<void>
  readonly stopRecording: () => Promise<Blob | null>
  readonly reset: () => void
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i += 1) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i += 1, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null

  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ??
    null
  )
}

function detectRecorderSupport(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.navigator?.mediaDevices?.getUserMedia &&
    !!getAudioContextConstructor()
  )
}

const subscribeToRecorderSupport = () => () => {}
const recorderSupportServerSnapshot = () => false

export function useVoiceNoteRecorder(
  maxSeconds = 45,
): UseVoiceNoteRecorderReturn {
  const isSupported = useSyncExternalStore(
    subscribeToRecorderSupport,
    detectRecorderSupport,
    recorderSupportServerSnapshot,
  )
  const [state, setState] = useState<VoiceNoteRecorderState>('idle')
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [error, setError] = useState<VoiceNoteError>(null)

  const stateRef = useRef<VoiceNoteRecorderState>('idle')
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const monitorGainRef = useRef<GainNode | null>(null)
  const recordedChunksRef = useRef<Float32Array[]>([])
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const durationRef = useRef(0)

  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current)
      timerIntervalRef.current = null
    }
  }, [])

  const setRecorderState = useCallback((nextState: VoiceNoteRecorderState) => {
    stateRef.current = nextState
    setState(nextState)
  }, [])

  const detachAudioResources = useCallback((): AudioContext | null => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
    }

    if (audioSourceRef.current) {
      audioSourceRef.current.disconnect()
      audioSourceRef.current = null
    }

    if (audioProcessorRef.current) {
      audioProcessorRef.current.disconnect()
      audioProcessorRef.current.onaudioprocess = null
      audioProcessorRef.current = null
    }

    if (monitorGainRef.current) {
      monitorGainRef.current.disconnect()
      monitorGainRef.current = null
    }

    const context = audioContextRef.current
    audioContextRef.current = null
    return context
  }, [])

  const reset = useCallback(() => {
    stopTimer()
    const context = detachAudioResources()
    void context?.close().catch(() => {})
    recordedChunksRef.current = []
    durationRef.current = 0
    setDurationSeconds(0)
    setRecorderState('idle')
    setError(null)
  }, [detachAudioResources, setRecorderState, stopTimer])

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    stopTimer()

    if (!mediaStreamRef.current || stateRef.current !== 'recording') {
      return null
    }

    setRecorderState('transcribing')

    const sampleRate = audioContextRef.current?.sampleRate ?? 16000
    const context = detachAudioResources()
    await context?.close().catch(() => {})

    const chunks = recordedChunksRef.current
    recordedChunksRef.current = []
    if (chunks.length === 0) {
      setError('failed')
      setRecorderState('idle')
      return null
    }

    const totalSamples = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
    const merged = new Float32Array(totalSamples)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }

    const blob = encodeWav(merged, sampleRate)
    return blob
  }, [detachAudioResources, setRecorderState, stopTimer])

  const startRecording = useCallback(async () => {
    if (stateRef.current !== 'idle') return

    setError(null)
    recordedChunksRef.current = []
    durationRef.current = 0
    setDurationSeconds(0)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      mediaStreamRef.current = stream

      const AudioCtx = getAudioContextConstructor()
      if (!AudioCtx) {
        throw new Error('AudioContext is unavailable')
      }

      const ctx = new AudioCtx()
      audioContextRef.current = ctx

      const source = ctx.createMediaStreamSource(stream)
      const processor = ctx.createScriptProcessor(4096, 1, 1)
      const monitorGain = ctx.createGain()
      monitorGain.gain.value = 0
      audioSourceRef.current = source
      audioProcessorRef.current = processor
      monitorGainRef.current = monitorGain

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0)
        recordedChunksRef.current.push(new Float32Array(inputData))
      }

      source.connect(processor)
      // ScriptProcessorNode needs an output connection to receive callbacks,
      // but the captured microphone must never be routed back to speakers.
      processor.connect(monitorGain)
      monitorGain.connect(ctx.destination)

      setRecorderState('recording')

      timerIntervalRef.current = setInterval(() => {
        durationRef.current += 1
        setDurationSeconds(durationRef.current)

        if (durationRef.current >= maxSeconds) {
          stopTimer()
          void stopRecording()
            .then(() => {
              recordedChunksRef.current = []
              durationRef.current = 0
              setDurationSeconds(0)
              setError('too_long')
              setRecorderState('idle')
            })
            .catch(() => {
              setError('failed')
              setRecorderState('idle')
            })
        }
      }, 1000)
    } catch (err) {
      const context = detachAudioResources()
      void context?.close().catch(() => {})
      const isDenied =
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
      setError(isDenied ? 'mic_denied' : 'unavailable')
      setRecorderState('idle')
    }
  }, [
    detachAudioResources,
    maxSeconds,
    setRecorderState,
    stopRecording,
    stopTimer,
  ])

  useEffect(() => {
    return () => {
      stopTimer()
      const context = detachAudioResources()
      void context?.close().catch(() => {})
    }
  }, [detachAudioResources, stopTimer])

  return {
    isSupported,
    state,
    durationSeconds,
    error,
    startRecording,
    stopRecording,
    reset,
  }
}
