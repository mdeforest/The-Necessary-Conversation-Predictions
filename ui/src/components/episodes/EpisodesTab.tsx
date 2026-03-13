import { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react'
import type { MasterRecord, Video } from '@/types'
import { SPEAKER_COLORS, VERDICT_COLORS, VERDICT_LABELS, KNOWN_SPEAKERS, VERDICTS, getAccuracyFromCounts } from '@/types'
import { ConfidenceBadge } from '../browse/ConfidenceBadge'
import { VerdictBadge } from '../browse/VerdictBadge'
import { formatFactCheckDate } from '../shared/formatFactCheckDate'
import { getPlaybackStartSeconds } from '../shared/YouTubePlayer'
import { censorText } from '../shared/censorText'

interface EpisodesTabProps {
  videos: Video[]
  predictions: MasterRecord[]
  selectedId: string | null
  onSelectId: (id: string | null) => void
}

const SEEK_SCROLL_THRESHOLD_SECONDS = 3

// Speaker choices for the inline editor (dev only)
const SPEAKER_OPTIONS = [...KNOWN_SPEAKERS, 'Unknown'] as const

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function extractVideoId(url: string): string | null {
  try {
    return new URL(url).searchParams.get('v')
  } catch {
    return null
  }
}

// ─── YouTube IFrame API loader (singleton) ────────────────────────────────────

let ytApiPromise: Promise<void> | null = null

function loadYTApi(): Promise<void> {
  if ((window as any).YT?.Player) return Promise.resolve()
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise<void>(resolve => {
    const prev = (window as any).onYouTubeIframeAPIReady
    ;(window as any).onYouTubeIframeAPIReady = () => { prev?.(); resolve() }
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    }
  })
  return ytApiPromise
}

// ─── Episode-scoped prediction row ───────────────────────────────────────────

interface PredRowProps {
  pred: MasterRecord
  isActive: boolean
  isFlashing: boolean
  onSeek: (pred: MasterRecord) => void
  // Dev-only speaker editing
  isDev: boolean
  isEditing: boolean
  onEditStart: () => void
  onEditSave: (speaker: string) => void
  onEditCancel: () => void
}

function PredRow({
  pred, isActive, isFlashing, onSeek,
  isDev, isEditing, onEditStart, onEditSave, onEditCancel,
}: PredRowProps) {
  const [expanded, setExpanded] = useState(false)
  const selectRef = useRef<HTMLSelectElement>(null)
  const color = SPEAKER_COLORS[pred.speaker] ?? '#6b7280'
  const firstName = pred.speaker.split(' ')[0]
  const hasDetails = Boolean(pred.context || pred.explanation)
  const generatedLabel = formatFactCheckDate(pred.date_generated)
  const prediction = censorText(pred.prediction)
  const context = censorText(pred.context)
  const explanation = censorText(pred.explanation)

  return (
    <div
      data-pred-id={pred.prediction_id}
      className={[
        'rounded-lg border transition-colors',
        isFlashing ? 'pred-flash' : '',
        isActive
          ? 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40'
          : 'border-gray-100 bg-white hover:border-gray-200 dark:border-[#1E3A60] dark:bg-[#162244]/60 dark:hover:border-zinc-700',
      ].join(' ')}
    >
      <div className="px-3 py-2.5">
        {/* Timestamp · speaker · verdict */}
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          {pred.timestamp_seconds != null ? (
            <button
              onClick={() => onSeek(pred)}
              className="text-xs font-mono text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 flex-shrink-0 transition-colors tabular-nums"
              title="Jump to this moment"
            >
              {formatTime(pred.timestamp_seconds)}
            </button>
          ) : (
            <span className="text-xs font-mono text-gray-300 dark:text-zinc-700 flex-shrink-0 select-none">
              —:——
            </span>
          )}
          <span className="w-px h-3 bg-gray-200 dark:bg-zinc-700 flex-shrink-0" />

          {/* Speaker: normal display or inline editor (dev only) */}
          {isDev && isEditing ? (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <select
                ref={selectRef}
                defaultValue={pred.speaker}
                autoFocus
                className="text-xs rounded border border-gray-300 bg-white px-1.5 py-0.5 dark:bg-zinc-800 dark:border-zinc-600 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {SPEAKER_OPTIONS.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button
                onClick={() => onEditSave(selectRef.current?.value ?? pred.speaker)}
                className="text-xs font-semibold text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 transition-colors"
                title="Save"
              >
                ✓
              </button>
              <button
                onClick={onEditCancel}
                className="text-xs text-gray-400 hover:text-gray-600 dark:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
                title="Cancel"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="group/speaker flex items-center gap-1 flex-shrink-0">
              <span className="text-xs font-semibold" style={{ color }}>
                {firstName}
              </span>
              {isDev && (
                <button
                  onClick={onEditStart}
                  className="opacity-0 group-hover/speaker:opacity-100 text-gray-300 hover:text-gray-500 dark:text-zinc-700 dark:hover:text-zinc-400 transition-opacity"
                  title="Edit speaker"
                >
                  {/* Pencil icon */}
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                    <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z" />
                  </svg>
                </button>
              )}
            </div>
          )}

          <VerdictBadge verdict={pred.verdict} />
        </div>

        {/* Prediction text */}
        <p className="text-sm text-gray-800 dark:text-zinc-200 leading-snug">{prediction}</p>

        {/* Expandable details */}
        {hasDetails && (
          <>
            {expanded && (
              <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-[#1E3A60] space-y-2">
                {pred.context && (
                  <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">{context}</p>
                )}
                {pred.explanation && (
                  <div>
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <p className="text-xs text-gray-400 uppercase tracking-wider dark:text-zinc-600">
                        Fact-check
                      </p>
                      <ConfidenceBadge confidence={pred.confidence} />

                    </div>
                    <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">{explanation}</p>
                    {generatedLabel && (
                        <p className="text-xs italic text-gray-500 dark:text-zinc-400 pt-3">Generated {generatedLabel}</p>
                    )}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => setExpanded(e => !e)}
              className="mt-1.5 text-xs text-gray-400 hover:text-gray-600 dark:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
            >
              {expanded ? 'Less ↑' : 'More ↓'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Episode detail view ─────────────────────────────────────────────────────

interface EpisodeDetailProps {
  video: Video
  preds: MasterRecord[]
  onBack: () => void
  onPrevious: (() => void) | null
  onNext: (() => void) | null
}

function EpisodeDetail({ video, preds, onBack, onPrevious, onNext }: EpisodeDetailProps) {
  const playerContainerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<any>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listContentRef = useRef<HTMLDivElement>(null)

  const [apiReady, setApiReady] = useState(() => !!(window as any).YT?.Player)
  const [showPlayer, setShowPlayer] = useState(false)
  const pendingStartRef = useRef<number | undefined>(undefined)

  const [currentTime, setCurrentTime] = useState<number | null>(null)
  const [flashPredId, setFlashPredId] = useState<string | null>(null)
  const prevActivePredIdRef = useRef<string | null>(null)
  const prevCurrentTimeRef = useRef<number | null>(null)
  const [listSpacerHeight, setListSpacerHeight] = useState(0)

  // Dev-only: speaker overrides (prediction_id → speaker name)
  const isDev = import.meta.env.DEV
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [editingPredId, setEditingPredId] = useState<string | null>(null)
  const [showRebuildHint, setShowRebuildHint] = useState(false)
  const videoTitle = censorText(video.title)

  const videoId = extractVideoId(video.url)

  // Load YT IFrame API
  useEffect(() => {
    if (apiReady) return
    let cancelled = false
    loadYTApi().then(() => { if (!cancelled) setApiReady(true) })
    return () => { cancelled = true }
  }, [apiReady])

  // Load speaker overrides from local Vite dev API (dev only)
  useEffect(() => {
    if (!isDev) return
    fetch('/api/speaker-overrides')
      .then(r => r.json())
      .then((data: Record<string, string>) => setOverrides(data))
      .catch(() => {}) // silently ignore — endpoint only exists during vite dev
  }, [isDev])

  // Destroy player and clear poll on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      playerRef.current?.destroy()
    }
  }, [])

  const startPolling = () => {
    if (pollRef.current) return
    pollRef.current = setInterval(() => {
      const t = playerRef.current?.getCurrentTime?.()
      if (typeof t === 'number') setCurrentTime(t)
    }, 300)
  }

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  // Create the YT player once the container div is in the DOM and the API is ready.
  useEffect(() => {
    if (!showPlayer || !apiReady || !playerContainerRef.current || playerRef.current || !videoId) return
    playerRef.current = new (window as any).YT.Player(playerContainerRef.current, {
      videoId,
      playerVars: { autoplay: 1, start: Math.floor(pendingStartRef.current ?? 0), rel: 0 },
      events: {
        onReady: (e: any) => {
          const iframe: HTMLElement = e.target.getIframe()
          Object.assign(iframe.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' })
        },
        onStateChange: (e: any) => {
          if (e.data === 1) startPolling()
          else stopPolling()
        },
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPlayer, apiReady])

  // Predictions sorted by timestamp (nulls last)
  const sortedPreds = useMemo(
    () =>
      [...preds].sort((a, b) => {
        if (a.timestamp_seconds == null && b.timestamp_seconds == null) return 0
        if (a.timestamp_seconds == null) return 1
        if (b.timestamp_seconds == null) return -1
        return a.timestamp_seconds - b.timestamp_seconds
      }),
    [preds],
  )

  // Merge in-session speaker overrides for display (overrides win over master data)
  const displayPreds = useMemo(
    () => sortedPreds.map(p =>
      overrides[p.prediction_id] !== undefined
        ? { ...p, speaker: overrides[p.prediction_id] }
        : p,
    ),
    [sortedPreds, overrides],
  )

  // Active prediction: most recent whose timestamp ≤ currentTime and within 60s
  const activePredId = useMemo(() => {
    if (currentTime == null) return null
    const withTime = sortedPreds.filter(p => p.timestamp_seconds != null)
    for (let i = withTime.length - 1; i >= 0; i--) {
      const ts = withTime[i].timestamp_seconds!
      if (ts <= currentTime && currentTime < ts + 60) return withTime[i].prediction_id
    }
    return null
  }, [currentTime, sortedPreds])

  // Fire a ring-flash animation when the active prediction changes
  useEffect(() => {
    if (activePredId && activePredId !== prevActivePredIdRef.current) {
      setFlashPredId(activePredId)
      const t = setTimeout(() => setFlashPredId(null), 1000)
      prevActivePredIdRef.current = activePredId
      return () => clearTimeout(t)
    }
    if (!activePredId) prevActivePredIdRef.current = null
  }, [activePredId])

  useEffect(() => {
    if (currentTime == null) {
      prevCurrentTimeRef.current = null
      return
    }

    const prevTime = prevCurrentTimeRef.current
    prevCurrentTimeRef.current = currentTime

    if (prevTime == null || !activePredId) return
    if (Math.abs(currentTime - prevTime) < SEEK_SCROLL_THRESHOLD_SECONDS) return

    scrollToPred(activePredId)
  }, [activePredId, currentTime])

  useLayoutEffect(() => {
    const container = listRef.current
    const content = listContentRef.current
    if (!container || !content || typeof ResizeObserver === 'undefined') return

    const updateSpacer = () => {
      if (container.clientHeight <= 0) {
        setListSpacerHeight(0)
        return
      }

      const predEls = content.querySelectorAll<HTMLElement>('[data-pred-id]')
      const lastPred = predEls[predEls.length - 1]
      if (!lastPred) {
        setListSpacerHeight(0)
        return
      }

      const trailingContentHeight = content.offsetHeight - lastPred.offsetTop
      setListSpacerHeight(Math.max(0, container.clientHeight - trailingContentHeight))
    }

    updateSpacer()

    const observer = new ResizeObserver(updateSpacer)
    observer.observe(container)
    observer.observe(content)
    return () => observer.disconnect()
  }, [displayPreds.length, editingPredId, showRebuildHint])

  const scrollToPred = (predId: string) => {
    const container = listRef.current
    if (!container) return
    const el = container.querySelector<HTMLElement>(`[data-pred-id="${predId}"]`)
    if (!el) return

    const containerCanScroll = container.scrollHeight > container.clientHeight + 1
    if (!containerCanScroll) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
      return
    }

    let top = 0
    let node: HTMLElement | null = el
    while (node && node !== container) {
      top += node.offsetTop
      node = node.offsetParent as HTMLElement | null
    }

    if (node !== container) {
      const containerRect = container.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      top = container.scrollTop + (elRect.top - containerRect.top)
    }

    container.scrollTo({ top, behavior: 'smooth' })
  }

  useEffect(() => {
    if (activePredId) scrollToPred(activePredId)
  }, [activePredId])

  const openAt = (startSeconds?: number) => {
    pendingStartRef.current = getPlaybackStartSeconds(startSeconds) ?? undefined
    setShowPlayer(true)
    if (startSeconds != null) setCurrentTime(startSeconds)
  }

  const handleSeek = (pred: MasterRecord) => {
    if (pred.timestamp_seconds == null) return
    const t = getPlaybackStartSeconds(pred.timestamp_seconds) ?? 0
    scrollToPred(pred.prediction_id)
    if (playerRef.current) {
      playerRef.current.seekTo(t, true)
      playerRef.current.playVideo()
      setCurrentTime(pred.timestamp_seconds)
    } else {
      openAt(pred.timestamp_seconds)
    }
  }

  // Save a speaker override — writes to prediction_speaker_overrides.json and
  // auto-updates speaker_corrections.json if a SPEAKER_XX exists at that timestamp.
  const handleSpeakerSave = async (pred: MasterRecord, speaker: string) => {
    setEditingPredId(null)
    try {
      await fetch('/api/speaker-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prediction_id: pred.prediction_id,
          speaker,
          video_id: pred.video_id,
          timestamp_seconds: pred.timestamp_seconds ?? null,
        }),
      })
      setOverrides(prev => ({ ...prev, [pred.prediction_id]: speaker }))
      setShowRebuildHint(true)
    } catch {
      // Silently ignore — only available during vite dev
    }
  }

  const counts = useMemo(
    () => VERDICTS.reduce<Record<string, number>>((acc, v) => {
      acc[v] = preds.filter(p => p.verdict === v).length; return acc
    }, {}),
    [preds],
  )

  return (
    <div className="space-y-4">
      {/* Flash animation — ring expands out from the card */}
      <style>{`
        @keyframes pred-flash {
          0%   { box-shadow: 0 0 0 0px rgba(59,130,246,0.55); }
          60%  { box-shadow: 0 0 0 8px rgba(59,130,246,0); }
          100% { box-shadow: 0 0 0 0px rgba(59,130,246,0); }
        }
        .pred-flash { animation: pred-flash 0.9s ease-out; }
      `}</style>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={onBack}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          ← All Episodes
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onPrevious ?? undefined}
            disabled={!onPrevious}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800 disabled:cursor-not-allowed disabled:border-gray-100 disabled:text-gray-300 dark:border-[#1E3A60] dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200 dark:disabled:border-[#1E3A60]/60 dark:disabled:text-zinc-700"
          >
            ← Previous
          </button>
          <button
            onClick={onNext ?? undefined}
            disabled={!onNext}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800 disabled:cursor-not-allowed disabled:border-gray-100 disabled:text-gray-300 dark:border-[#1E3A60] dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200 dark:disabled:border-[#1E3A60]/60 dark:disabled:text-zinc-700"
          >
            Next →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">

        {/* ── Left: sticky video + metadata ── */}
        <div className="lg:col-span-3 lg:sticky lg:top-4 space-y-3">

          {videoId ? (
            <div className="relative w-full aspect-video rounded-xl overflow-hidden shadow-md bg-black">
              {showPlayer ? (
                <div ref={playerContainerRef} className="absolute inset-0" />
              ) : (
                <button
                  onClick={() => openAt()}
                  className="group absolute inset-0 flex items-center justify-center"
                  aria-label={`Play ${videoTitle}`}
                >
                  <img
                    src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
                    alt={videoTitle}
                    className="w-full h-full object-cover opacity-90 group-hover:opacity-70 transition-opacity"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full bg-black/60 flex items-center justify-center group-hover:bg-red-600 transition-colors">
                      <svg viewBox="0 0 24 24" fill="white" className="w-7 h-7 ml-1">
                        <polygon points="5,3 19,12 5,21" />
                      </svg>
                    </div>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 px-4 py-3 bg-gradient-to-t from-black/80 to-transparent">
                    <p className="text-white text-sm font-medium truncate">{videoTitle}</p>
                  </div>
                </button>
              )}
            </div>
          ) : (
            <a
              href={video.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center w-full aspect-video rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-zinc-600 text-sm"
            >
              Watch on YouTube ↗
            </a>
          )}

          <div className="px-1">
            <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100 leading-snug">
              {videoTitle}
            </h2>
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 dark:text-zinc-500">
              <span>{video.published_at}</span>
              <span className="text-gray-300 dark:text-zinc-700">·</span>
              <span>{Math.round(video.duration_seconds / 60)} min</span>
              {preds.length > 0 && (
                <>
                  <span className="text-gray-300 dark:text-zinc-700">·</span>
                  <span>{preds.length} predictions</span>
                </>
              )}
            </div>
          </div>

          {preds.length > 0 && (
            <div className="hidden lg:flex gap-2 flex-wrap px-1">
              {VERDICTS.filter(v => counts[v] > 0).map(v => (
                <div key={v} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-gray-50 dark:bg-zinc-800/60">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: VERDICT_COLORS[v] }} />
                  <span className="text-gray-600 dark:text-zinc-400">{counts[v]} {VERDICT_LABELS[v]}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Right: predictions timeline ── */}
        <div ref={listRef} className="scrollbar-hidden lg:col-span-2 lg:sticky lg:top-4 lg:min-h-0 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1">
          {preds.length === 0 ? (
            <p className="text-center py-12 text-gray-400 dark:text-zinc-600 text-sm">
              No predictions extracted for this episode yet.
            </p>
          ) : (
            <>
              <div ref={listContentRef} className="space-y-2">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-[#1B2A5E] uppercase tracking-wider dark:text-zinc-500">
                    Predictions · {preds.length}
                  </p>
                  {sortedPreds.some(p => p.timestamp_seconds != null) && !showPlayer && (
                    <p className="text-xs text-gray-400 dark:text-zinc-600">Play video to follow along</p>
                  )}
                  {sortedPreds.some(p => p.timestamp_seconds != null) && showPlayer && (
                    <p className="text-xs text-gray-400 dark:text-zinc-600">Click timestamp to jump</p>
                  )}
                </div>

                {/* Dev-only: rebuild hint shown after saving any speaker override */}
                {isDev && showRebuildHint && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800/40 dark:bg-amber-900/20">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                          Speaker override saved
                        </p>
                        <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-500">
                          Run to persist to master:
                        </p>
                        <code className="mt-1 block font-mono text-xs text-amber-700 dark:text-amber-400">
                          python pipeline/06_build_master.py
                        </code>
                      </div>
                      <button
                        onClick={() => setShowRebuildHint(false)}
                        className="flex-shrink-0 text-xs leading-none text-amber-400 hover:text-amber-600 dark:text-amber-600 dark:hover:text-amber-400"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}

                {displayPreds.map(pred => (
                  <PredRow
                    key={pred.prediction_id}
                    pred={pred}
                    isActive={pred.prediction_id === activePredId}
                    isFlashing={pred.prediction_id === flashPredId}
                    onSeek={handleSeek}
                    isDev={isDev}
                    isEditing={pred.prediction_id === editingPredId}
                    onEditStart={() => setEditingPredId(pred.prediction_id)}
                    onEditSave={speaker => handleSpeakerSave(pred, speaker)}
                    onEditCancel={() => setEditingPredId(null)}
                  />
                ))}
              </div>
              <div aria-hidden="true" className="hidden lg:block" style={{ height: listSpacerHeight }} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Episode list ─────────────────────────────────────────────────────────────

export function EpisodesTab({ videos, predictions, selectedId, onSelectId }: EpisodesTabProps) {

  const predsByVideo = new Map<string, MasterRecord[]>()
  for (const p of predictions) {
    const arr = predsByVideo.get(p.video_id) ?? []
    arr.push(p)
    predsByVideo.set(p.video_id, arr)
  }

  const sorted = [...videos].sort(
    (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
  )

  if (selectedId) {
    const selectedIndex = sorted.findIndex(video => video.id === selectedId)
    const video = selectedIndex >= 0 ? sorted[selectedIndex] : null
    const preds = predsByVideo.get(selectedId) ?? []
    const previousVideo = selectedIndex > 0 ? sorted[selectedIndex - 1] : null
    const nextVideo = selectedIndex >= 0 && selectedIndex < sorted.length - 1 ? sorted[selectedIndex + 1] : null

    if (video) {
      return (
        <EpisodeDetail
          key={video.id}
          video={video}
          preds={preds}
          onBack={() => onSelectId(null)}
          onPrevious={previousVideo ? () => onSelectId(previousVideo.id) : null}
          onNext={nextVideo ? () => onSelectId(nextVideo.id) : null}
        />
      )
    }
  }

  return (
    <div className="space-y-2">
      {sorted.map(video => {
        const preds = predsByVideo.get(video.id) ?? []
        const counts = VERDICTS.reduce<Record<string, number>>((acc, v) => {
          acc[v] = preds.filter(p => p.verdict === v).length
          return acc
        }, {})
        const accuracy = getAccuracyFromCounts(counts)
        const videoTitle = censorText(video.title)

        return (
          <button
            key={video.id}
            onClick={() => onSelectId(video.id)}
            className="w-full bg-white border border-gray-200 rounded-lg px-4 py-3 text-left hover:border-gray-300 transition-colors flex items-center gap-4 dark:bg-[#162244] dark:border-[#1E3A60] dark:hover:border-zinc-700"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate dark:text-zinc-200">{videoTitle}</p>
              <p className="text-xs text-gray-500 mt-0.5 dark:text-zinc-500">{video.published_at}</p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {preds.length > 0 ? (
                <>
                  {accuracy !== null && (
                    <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">{accuracy}%</span>
                  )}
                  <div className="flex gap-1 items-center">
                    {VERDICTS.filter(v => counts[v] > 0).map(v => (
                      <div key={v} className="flex items-center gap-0.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: VERDICT_COLORS[v] }} />
                        <span className="text-xs text-gray-400 dark:text-zinc-600">{counts[v]}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <span className="text-xs text-gray-300 dark:text-zinc-700">No data</span>
              )}
              <span className="text-gray-300 dark:text-zinc-700 text-xs">›</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
