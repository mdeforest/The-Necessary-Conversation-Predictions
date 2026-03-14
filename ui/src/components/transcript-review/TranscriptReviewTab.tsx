import { useEffect, useMemo, useState } from 'react'
import type { TranscriptSegment, Video } from '@/types'
import { KNOWN_SPEAKERS } from '@/types'

interface TranscriptReviewTabProps {
  videos: Video[]
}

interface ReviewVideoSummary {
  id: string
  title: string
  published_at: string
  has_transcript?: boolean
  diarized: boolean
  unknown_labels: string[]
}

interface ReviewDetail {
  video: Video | null
  transcript: {
    exists?: boolean
    diarized: boolean
    segments: TranscriptSegment[]
  }
  corrections: Record<string, string>
}

const SPEAKER_OPTIONS = [...KNOWN_SPEAKERS, 'Unknown'] as const

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function TranscriptReviewTab({ videos }: TranscriptReviewTabProps) {
  const [items, setItems] = useState<ReviewVideoSummary[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [detail, setDetail] = useState<ReviewDetail | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<string>('')
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadingList(true)
    fetch('/api/transcript-review')
      .then(res => res.json())
      .then((data: { videos?: ReviewVideoSummary[] }) => {
        if (cancelled) return
        const nextItems = (data.videos ?? []).sort((a, b) => {
          if (a.published_at === b.published_at) return a.title.localeCompare(b.title)
          return a.published_at.localeCompare(b.published_at)
        })
        setItems(nextItems)
        if (!selectedId && nextItems.length > 0) setSelectedId(nextItems[0].id)
      })
      .catch(() => {
        if (!cancelled) setStatus('Failed to load transcript list.')
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    setLoadingDetail(true)
    setStatus('')
    fetch(`/api/transcript-review?video_id=${encodeURIComponent(selectedId)}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load transcript')
        return res.json()
      })
      .then((data: ReviewDetail) => {
        if (cancelled) return
        setDetail(data)
        setDraft(data.corrections ?? {})
      })
      .catch(() => {
        if (!cancelled) setStatus('Failed to load transcript details.')
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false)
      })
    return () => { cancelled = true }
  }, [selectedId])

  const selectedVideo = useMemo(
    () => {
      const fromApi = items.find(item => item.id === selectedId)
      if (fromApi) return fromApi
      const fromProps = videos.find(video => video.id === selectedId)
      if (fromProps) return { id: fromProps.id, title: fromProps.title, published_at: fromProps.published_at }
      return null
    },
    [items, selectedId, videos],
  )

  const unknownLabels = useMemo(() => {
    if (!detail) return []
    const labels = new Set<string>()
    for (const segment of detail.transcript.segments) {
      if (segment.speaker && /^SPEAKER_\d+$/.test(segment.speaker)) labels.add(segment.speaker)
    }
    return Array.from(labels).sort()
  }, [detail])

  const save = async () => {
    if (!selectedId) return
    setStatus('Saving...')
    try {
      const res = await fetch('/api/transcript-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: selectedId, corrections: draft }),
      })
      if (!res.ok) throw new Error('save failed')
      setStatus('Saved to speaker_corrections.json')
    } catch {
      setStatus('Failed to save corrections.')
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px,1fr] gap-5">
      <aside className="rounded-xl border border-gray-200 bg-white dark:border-[#1E3A60] dark:bg-[#162244]/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-[#1E3A60]">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Transcript Review</h2>
          <p className="text-xs text-gray-500 dark:text-zinc-400">Dev-only editor for speaker_corrections.json</p>
        </div>
        <div className="p-3">
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
          >
            {items.map(item => (
              <option key={item.id} value={item.id}>
                {item.published_at} · {item.title}
              </option>
            ))}
          </select>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-3 pb-3 space-y-2">
          {loadingList && <p className="text-xs text-gray-500 dark:text-zinc-400 px-1">Loading episodes...</p>}
          {items.map(item => {
            const selected = item.id === selectedId
            return (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={[
                  'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                  selected
                    ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/20'
                    : 'border-gray-100 bg-gray-50 hover:border-gray-200 dark:border-[#1E3A60] dark:bg-[#0F1B38] dark:hover:border-zinc-700',
                ].join(' ')}
              >
                <div className="text-xs text-gray-500 dark:text-zinc-400">{item.published_at}</div>
                <div className="text-sm font-medium text-gray-900 dark:text-zinc-100 leading-snug">{item.title}</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                  {!item.has_transcript
                    ? 'No transcript yet'
                    : item.diarized
                      ? `${item.unknown_labels.length} anonymous labels`
                      : 'Not diarized'}
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      <section className="space-y-4">
        <div className="rounded-xl border border-gray-200 bg-white dark:border-[#1E3A60] dark:bg-[#162244]/60">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-[#1E3A60]">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-zinc-100">
                  {selectedVideo?.title ?? 'Select an episode'}
                </h3>
                {selectedVideo && (
                  <p className="text-xs text-gray-500 dark:text-zinc-400">
                    {selectedVideo.published_at} · {selectedId}
                  </p>
                )}
              </div>
              <button
                onClick={save}
                disabled={!selectedId || loadingDetail}
                className="rounded-lg bg-[#B22234] px-3 py-2 text-sm font-semibold text-white hover:bg-[#9d1e2e] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save Corrections
              </button>
            </div>
            {status && <p className="mt-2 text-xs text-gray-500 dark:text-zinc-400">{status}</p>}
          </div>

          <div className="p-4 space-y-4">
            {loadingDetail && <p className="text-sm text-gray-500 dark:text-zinc-400">Loading transcript...</p>}
            {!loadingDetail && detail && (
              <>
                {!detail.transcript.exists && (
                  <p className="text-sm text-gray-500 dark:text-zinc-400">
                    This episode is in the queue but does not have a transcript yet.
                  </p>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {unknownLabels.map(label => (
                    <label
                      key={label}
                      className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-[#1E3A60] dark:bg-[#0F1B38]"
                    >
                      <div className="text-xs font-mono text-gray-500 dark:text-zinc-400">{label}</div>
                      <select
                        value={draft[label] ?? ''}
                        onChange={e => setDraft(prev => ({ ...prev, [label]: e.target.value }))}
                        className="mt-2 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
                      >
                        <option value="">Unassigned</option>
                        {SPEAKER_OPTIONS.map(speaker => (
                          <option key={speaker} value={speaker}>{speaker}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>

                {detail.transcript.exists && !detail.transcript.diarized && (
                  <p className="text-sm text-amber-700 dark:text-amber-400">This transcript is not marked as diarized yet.</p>
                )}

                <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-gray-100 dark:border-[#1E3A60]">
                  <div className="divide-y divide-gray-100 dark:divide-[#1E3A60]">
                    {detail.transcript.segments.map((segment, index) => {
                      const speaker = segment.speaker ?? 'Unknown'
                      const corrected = /^SPEAKER_\d+$/.test(speaker) ? (draft[speaker] || '') : ''
                      return (
                        <div key={`${index}-${segment.start}`} className="px-4 py-3">
                          <div className="flex items-center gap-2 flex-wrap text-xs">
                            <span className="font-mono text-blue-500 dark:text-blue-400">{formatTime(segment.start)}</span>
                            <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-gray-600 dark:bg-zinc-800 dark:text-zinc-300">
                              {speaker}
                            </span>
                            {corrected && (
                              <span className="rounded bg-green-50 px-2 py-0.5 text-green-700 dark:bg-green-950/30 dark:text-green-400">
                                {corrected}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-sm leading-relaxed text-gray-800 dark:text-zinc-200">{segment.text}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
