export type DiscoveryStreamEventType = 'thinking' | 'token' | 'done' | 'error'

export interface DiscoveryThinkingEvent {
  type: 'thinking'
  session_id: string
}

export interface DiscoveryTokenEvent {
  type: 'token'
  session_id: string
  delta: string
}

export interface DiscoveryDoneEvent {
  type: 'done'
  session_id: string
  full_text?: string
}

export interface DiscoveryErrorEvent {
  type: 'error'
  session_id: string
  error?: string
}

export type DiscoveryStreamEvent =
  | DiscoveryThinkingEvent
  | DiscoveryTokenEvent
  | DiscoveryDoneEvent
  | DiscoveryErrorEvent
