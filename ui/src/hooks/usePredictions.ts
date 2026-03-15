import { useMemo, useState } from 'react'
import type { MasterRecord, Verdict, Confidence, Specificity } from '@/types'
import { getAccuracyFromCounts } from '@/types'

export interface Filters {
  speaker: string
  verdict: Verdict | ''
  topic: string
  confidence: Confidence | ''
  specificity: Specificity | ''
  search: string
}

export const DEFAULT_FILTERS: Filters = {
  speaker: '',
  verdict: '',
  topic: '',
  confidence: '',
  specificity: '',
  search: '',
}

export function usePredictions(all: MasterRecord[], initialFilters: Filters = DEFAULT_FILTERS) {
  const [filters, setFilters] = useState<Filters>(initialFilters)

  const filtered = useMemo(() => {
    return all.filter(p => {
      if (p.explanation?.includes('content filter')) return false
      if (filters.speaker && p.speaker !== filters.speaker) return false
      if (filters.verdict && p.verdict !== filters.verdict) return false
      if (filters.topic && p.topic !== filters.topic) return false
      if (filters.confidence && p.confidence !== filters.confidence) return false
      if (filters.specificity && p.specificity !== filters.specificity) return false
      if (filters.search) {
        const q = filters.search.toLowerCase()
        if (
          !p.prediction.toLowerCase().includes(q) &&
          !p.speaker.toLowerCase().includes(q) &&
          !p.topic.toLowerCase().includes(q)
        )
          return false
      }
      return true
    })
  }, [all, filters])

  const topics = useMemo(() => [...new Set(all.map(p => p.topic))].sort(), [all])
  const speakers = useMemo(() => [...new Set(all.map(p => p.speaker))].sort(), [all])

  return { filtered, filters, setFilters, topics, speakers }
}

/** Compute per-speaker verdict breakdown */
export function speakerStats(predictions: MasterRecord[]) {
  const map: Record<string, Record<string, number>> = {}
  for (const p of predictions) {
    if (!map[p.speaker]) map[p.speaker] = { true: 0, 'partially true': 0, false: 0, pending: 0, unverifiable: 0, total: 0 }
    map[p.speaker][p.verdict]++
    map[p.speaker].total++
  }
  return map
}

interface SpeakerPerformanceRow {
  speaker: string
  total: number
  true: number
  'partially true': number
  false: number
  pending: number
  unverifiable: number
  accuracy: number | null
}

export function speakerPerformanceData(predictions: MasterRecord[]): SpeakerPerformanceRow[] {
  const map: Record<string, SpeakerPerformanceRow> = {}

  for (const p of predictions) {
    if (!map[p.speaker]) {
      map[p.speaker] = {
        speaker: p.speaker,
        total: 0,
        true: 0,
        'partially true': 0,
        false: 0,
        pending: 0,
        unverifiable: 0,
        accuracy: null,
      }
    }

    map[p.speaker].total++
    map[p.speaker][p.verdict]++
  }

  return Object.values(map)
    .map(row => ({
      ...row,
      accuracy: getAccuracyFromCounts(row),
    }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total
      return a.speaker.localeCompare(b.speaker)
    })
}

/** Predictions per episode date, broken down by verdict (for timeline) */
export function timelineData(predictions: MasterRecord[]) {
  const map: Record<string, { date: string; total: number; true: number; 'partially true': number; false: number; pending: number; unverifiable: number }> = {}
  for (const p of predictions) {
    const d = p.episode_date
    if (!map[d]) map[d] = { date: d, total: 0, true: 0, 'partially true': 0, false: 0, pending: 0, unverifiable: 0 }
    map[d].total++
    map[d][p.verdict]++
  }
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date))
}

/** Predictions per episode date, broken down by speaker (for timeline) */
export function timelineDataBySpeaker(predictions: MasterRecord[]) {
  const empty = () => ({ date: '', total: 0, 'Chad Kultgen': 0, 'Haley Popp': 0, 'Mary Lou Kultgen': 0, 'Bob Kultgen': 0 })
  const map: Record<string, ReturnType<typeof empty>> = {}
  for (const p of predictions) {
    const d = p.episode_date
    if (!map[d]) map[d] = { ...empty(), date: d }
    map[d].total++
    if (p.speaker in map[d]) (map[d] as Record<string, number>)[p.speaker]++
  }
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date))
}

export function accuracyTimelineData(predictions: MasterRecord[]) {
  return timelineData(predictions).map(row => {
    const decided = row.true + row['partially true'] + row.false
    return {
      ...row,
      decided,
      accuracy: getAccuracyFromCounts(row),
    }
  })
}

interface TopicRow {
  topic: string
  true: number
  'partially true': number
  false: number
  pending: number
  unverifiable: number
  total: number
}

/** Topic breakdown */
export function topicData(predictions: MasterRecord[]): TopicRow[] {
  const map: Record<string, TopicRow> = {}
  for (const p of predictions) {
    if (!map[p.topic]) map[p.topic] = { topic: p.topic, true: 0, 'partially true': 0, false: 0, pending: 0, unverifiable: 0, total: 0 }
    map[p.topic][p.verdict]++
    map[p.topic].total++
  }
  return Object.values(map).sort((a, b) => b.total - a.total)
}

export function topicOverviewData(predictions: MasterRecord[]) {
  return topicData(predictions).map(row => {
    const decided = row.true + row['partially true'] + row.false
    return {
      ...row,
      decided,
      accuracy: getAccuracyFromCounts(row),
      pendingShare: row.total > 0 ? Math.round((row.pending / row.total) * 100) : 0,
    }
  })
}

export function confidenceSpecificityMatrix(predictions: MasterRecord[]) {
  const confidenceLevels: Confidence[] = ['high', 'medium', 'low']
  const specificityLevels: Specificity[] = ['high', 'medium', 'low']

  const matrix = confidenceLevels.map(confidence => ({
    confidence,
    high: 0,
    medium: 0,
    low: 0,
    total: 0,
  }))

  const indexByConfidence = Object.fromEntries(confidenceLevels.map((level, index) => [level, index])) as Record<Confidence, number>
  const isConfidence = (value: string | null | undefined): value is Confidence =>
    value === 'high' || value === 'medium' || value === 'low'
  const isSpecificity = (value: string | null | undefined): value is Specificity =>
    value === 'high' || value === 'medium' || value === 'low'
  let omitted = 0

  for (const prediction of predictions) {
    if (!isConfidence(prediction.confidence) || !isSpecificity(prediction.specificity)) {
      omitted++
      continue
    }

    const row = matrix[indexByConfidence[prediction.confidence]]
    row[prediction.specificity]++
    row.total++
  }

  return {
    omitted,
    included: predictions.length - omitted,
    rows: matrix.map(row => ({
      ...row,
      cells: specificityLevels.map(level => ({
        specificity: level,
        count: row[level],
        share: row.total > 0 ? Math.round((row[level] / row.total) * 100) : 0,
      })),
    })),
  }
}
