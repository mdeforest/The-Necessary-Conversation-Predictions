export type Verdict = 'true' | 'false' | 'pending' | 'unverifiable'
export type Confidence = 'high' | 'medium' | 'low'
export type Specificity = 'high' | 'medium' | 'low'

export interface Video {
  id: string
  title: string
  url: string
  published_at: string // ISO date string
  duration_seconds: number
}

export interface Prediction {
  id: string
  speaker: string
  prediction: string
  topic: string
  timeframe: string
  specificity: Specificity
  context: string
}

export interface FactCheck {
  prediction_id: string
  verdict: Verdict
  confidence: Confidence
  explanation: string
  sources: string[]
}

/** Joined record from predictions_master.json */
export interface MasterRecord {
  prediction_id: string
  video_id: string
  video_title: string
  video_url: string
  episode_date: string
  speaker: string
  prediction: string
  context: string
  topic: string
  timeframe: string
  specificity: Specificity
  verdict: Verdict
  confidence: Confidence
  explanation: string
  sources: string[]
  timestamp_seconds?: number | null
}

export const KNOWN_SPEAKERS = ['Chad Kultgen', 'Haley Popp', 'Mary Lou Kultgen', 'Bob Kultgen'] as const
export type KnownSpeaker = (typeof KNOWN_SPEAKERS)[number]

export const SPEAKER_COLORS: Record<string, string> = {
  'Chad Kultgen': '#3b82f6',
  'Haley Popp': '#a855f7',
  'Mary Lou Kultgen': '#f97316',
  'Bob Kultgen': '#14b8a6',
  Unknown: '#6b7280',
}

export const VERDICT_COLORS: Record<Verdict, string> = {
  true: '#22c55e',
  false: '#ef4444',
  pending: '#f59e0b',
  unverifiable: '#6b7280',
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  true: 'Correct',
  false: 'Wrong',
  pending: 'Pending',
  unverifiable: 'Unverifiable',
}
