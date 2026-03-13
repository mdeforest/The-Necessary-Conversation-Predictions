import { useEffect } from 'react'
import type { MasterRecord } from '@/types'
import { DEFAULT_FILTERS, type Filters, usePredictions } from '@/hooks/usePredictions'
import { FilterBar } from './FilterBar'
import { PredictionCard } from './PredictionCard'

interface BrowseTabProps {
  predictions: MasterRecord[]
  initialSpeaker?: string
  onMount?: () => void
  onNavigateToEpisode?: (videoId: string) => void
}

const PAGE_SIZE = 30
const STORAGE_KEY = 'nc-browse-filters'

function getInitialFilters(initialSpeaker?: string): Filters {
  if (typeof window === 'undefined') {
    return initialSpeaker ? { ...DEFAULT_FILTERS, speaker: initialSpeaker } : DEFAULT_FILTERS
  }

  if (initialSpeaker) return { ...DEFAULT_FILTERS, speaker: initialSpeaker }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_FILTERS

    const parsed = JSON.parse(raw) as Partial<Filters>
    return {
      ...DEFAULT_FILTERS,
      ...parsed,
    }
  } catch {
    return DEFAULT_FILTERS
  }
}

export function BrowseTab({ predictions, initialSpeaker, onMount, onNavigateToEpisode }: BrowseTabProps) {
  const { filtered, filters, setFilters, topics, speakers } = usePredictions(predictions, getInitialFilters(initialSpeaker))

  useEffect(() => {
    onMount?.()
  // Only run on mount — initialSpeaker is consumed once then cleared by App
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters))
  }, [filters])

  if (predictions.length === 0) {
    return (
      <div className="text-center py-20 text-gray-400 dark:text-zinc-600">
        <p>No prediction data yet — pipeline still running.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <FilterBar filters={filters} onChange={setFilters} speakers={speakers} topics={topics} />
      <p className="text-xs text-gray-500 dark:text-zinc-500">
        {filtered.length} prediction{filtered.length !== 1 ? 's' : ''} found
      </p>
      <div className="space-y-3">
        {filtered.slice(0, PAGE_SIZE).map(r => (
          <PredictionCard key={r.prediction_id} record={r} onNavigateToEpisode={onNavigateToEpisode} />
        ))}
        {filtered.length > PAGE_SIZE && (
          <p className="text-center text-xs text-gray-400 dark:text-zinc-600 py-4">
            Showing first {PAGE_SIZE} of {filtered.length} — use filters to narrow results
          </p>
        )}
      </div>
    </div>
  )
}
