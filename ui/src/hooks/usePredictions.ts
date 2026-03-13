import { useMemo, useState } from 'react'
import type { MasterRecord, Verdict, Confidence, Specificity } from '@/types'

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

export function usePredictions(all: MasterRecord[]) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)

  const filtered = useMemo(() => {
    return all.filter(p => {
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
    if (!map[p.speaker]) map[p.speaker] = { true: 0, false: 0, pending: 0, unverifiable: 0, total: 0 }
    map[p.speaker][p.verdict]++
    map[p.speaker].total++
  }
  return map
}

/** Predictions per episode date (for timeline) */
export function timelineData(predictions: MasterRecord[]) {
  const map: Record<string, { date: string; total: number; true: number; false: number; pending: number; unverifiable: number }> = {}
  for (const p of predictions) {
    const d = p.episode_date
    if (!map[d]) map[d] = { date: d, total: 0, true: 0, false: 0, pending: 0, unverifiable: 0 }
    map[d].total++
    map[d][p.verdict]++
  }
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date))
}

interface TopicRow {
  topic: string
  true: number
  false: number
  pending: number
  unverifiable: number
  total: number
}

/** Topic breakdown */
export function topicData(predictions: MasterRecord[]): TopicRow[] {
  const map: Record<string, TopicRow> = {}
  for (const p of predictions) {
    if (!map[p.topic]) map[p.topic] = { topic: p.topic, true: 0, false: 0, pending: 0, unverifiable: 0, total: 0 }
    map[p.topic][p.verdict]++
    map[p.topic].total++
  }
  return Object.values(map).sort((a, b) => b.total - a.total)
}
