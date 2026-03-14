export type Verdict = 'true' | 'false' | 'partially true' | 'pending' | 'unverifiable'
export type Confidence = 'high' | 'medium' | 'low'
export type Specificity = 'high' | 'medium' | 'low'

export interface Video {
  id: string
  title: string
  url: string
  published_at: string // ISO date string
  duration_seconds: number
  pipeline_stage?: 'download' | 'transcribe' | 'diarize' | 'extract' | 'fact_check' | 'review' | 'complete'
  pipeline_stage_label?: string
  has_audio?: boolean
  has_transcript?: boolean
  is_diarized?: boolean
  has_predictions?: boolean
  has_fact_checks?: boolean
  reviewed?: boolean
  flagged_for_review?: boolean
  review_notes?: string
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
  speaker?: string
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
  date_generated: string
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
  date_generated?: string | null
  verdict: Verdict
  confidence: Confidence
  explanation: string
  sources: string[]
  timestamp_seconds?: number | null
}

export const KNOWN_SPEAKERS = ['Chad Kultgen', 'Haley Popp', 'Mary Lou Kultgen', 'Bob Kultgen'] as const
export type KnownSpeaker = (typeof KNOWN_SPEAKERS)[number]
export const VERDICTS: Verdict[] = ['true', 'partially true', 'false', 'pending', 'unverifiable']

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
  'partially true': '#06b6d4',
  pending: '#f59e0b',
  unverifiable: '#6b7280',
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  true: 'Correct',
  false: 'Wrong',
  'partially true': 'Partially True',
  pending: 'Pending',
  unverifiable: 'Unverifiable',
}

export function getAccuracyFromCounts(counts: Partial<Record<Verdict, number>>): number | null {
  const correct = counts.true ?? 0
  const partial = counts['partially true'] ?? 0
  const wrong = counts.false ?? 0
  const decided = correct + partial + wrong

  if (decided === 0) return null
  return Math.round(((correct + partial) / decided) * 100)
}
