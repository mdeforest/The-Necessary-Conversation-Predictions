import { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react'
import type { MasterRecord, Video } from '@/types'
import { SPEAKER_COLORS, VERDICT_COLORS, VERDICT_LABELS, KNOWN_SPEAKERS, VERDICTS, getAccuracyFromCounts } from '@/types'
import { ConfidenceBadge } from '../browse/ConfidenceBadge'
import { VerdictBadge } from '../browse/VerdictBadge'
import { formatFactCheckDate } from '../shared/formatFactCheckDate'
import { getPlaybackStartSeconds } from '../shared/YouTubePlayer'
import { censorText } from '../shared/censorText'
import { getSpeakerDisplayName } from '../shared/getSpeakerDisplayName'

interface EpisodesTabProps {
  videos: Video[]
  predictions: MasterRecord[]
  selectedId: string | null
  onSelectId: (id: string | null) => void
}

type ReviewEntry = {
  reviewed: boolean
  flagged: boolean
  notes: string
}
type ReviewStateMap = Record<string, ReviewEntry>
type RecordOverrideMap = Record<string, Partial<MasterRecord>>

const SEEK_SCROLL_THRESHOLD_SECONDS = 3
const isDev = import.meta.env.DEV
const TOPIC_OPTIONS = ['politics', 'economy', 'tech', 'sports', 'culture', 'science', 'geopolitics', 'other'] as const
const SPECIFICITY_OPTIONS = ['high', 'medium', 'low'] as const
const CONFIDENCE_OPTIONS = ['high', 'medium', 'low'] as const
const STATUS_OPTIONS = [
  { value: 'true', label: 'Correct' },
  { value: 'false', label: 'Wrong' },
  { value: 'partially true', label: 'Partially True' },
  { value: 'pending', label: 'Pending' },
  { value: 'unverifiable', label: 'Unverifiable' },
] as const

function parseSourceList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map(item => item.trim().replace(/^["']+|["']+$/g, ''))
    .filter(Boolean)
}

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

function getStageClasses(stage?: Video['pipeline_stage']): string {
  switch (stage) {
    case 'download':
      return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300'
    case 'transcribe':
      return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800/60 dark:bg-sky-950/30 dark:text-sky-300'
    case 'diarize':
      return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/30 dark:text-violet-300'
    case 'extract':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300'
    case 'fact_check':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-300'
    case 'review':
      return 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800/60 dark:bg-orange-950/30 dark:text-orange-300'
    case 'complete':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300'
    default:
      return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300'
  }
}

function getEffectiveStage(video: Video, reviewStatus: ReviewStateMap): { code: Video['pipeline_stage']; label: string } | null {
  const reviewEntry = reviewStatus[video.id] ?? {
    reviewed: video.reviewed ?? false,
    flagged: video.flagged_for_review ?? false,
    notes: video.review_notes ?? '',
  }

  if (!video.has_audio) return { code: 'download', label: 'Queued for download' }
  if (!video.has_transcript) return { code: 'transcribe', label: 'Transcribing' }
  if (!video.is_diarized) return { code: 'diarize', label: 'Diarizing' }
  if (!video.has_predictions) return { code: 'extract', label: 'Extracting predictions' }
  if (!video.has_fact_checks || video.has_pending_fact_checks) return { code: 'fact_check', label: 'Fact-checking' }
  if (reviewEntry.flagged) return { code: 'review', label: 'Flagged for review' }
  if (!reviewEntry.reviewed) return { code: 'review', label: 'Ready for review' }
  return { code: 'complete', label: 'Complete' }
}

function StageBadge({ stage }: { stage: { code: Video['pipeline_stage']; label: string } | null }) {
  if (!isDev || !stage?.label) return null

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${getStageClasses(stage.code)}`}
      title={`Current pipeline stage: ${stage.label}`}
    >
      {stage.label}
    </span>
  )
}

function getPredictionIdForTime(preds: MasterRecord[], time: number | null, lookAheadSeconds = 0): string | null {
  if (time == null) return null

  const effectiveTime = time + lookAheadSeconds
  const withTime = preds.filter(p => p.timestamp_seconds != null)
  for (let i = withTime.length - 1; i >= 0; i--) {
    const ts = withTime[i].timestamp_seconds!
    if (ts <= effectiveTime && effectiveTime < ts + 60) return withTime[i].prediction_id
  }

  return null
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
  onRecordSave: (predictionId: string, patch: Partial<MasterRecord>, options?: { reopenFactCheck?: boolean }) => Promise<{ reopened: boolean }>
  onRecordDelete: (predictionId: string) => Promise<void>
  onCopyPrompt: (type: 'extract' | 'fact_check', predictionId: string) => Promise<void>
}

function PredRow({
  pred, isActive, isFlashing, onSeek,
  isDev, isEditing, onEditStart, onEditSave, onEditCancel, onRecordSave, onRecordDelete, onCopyPrompt,
}: PredRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [isEditingRecord, setIsEditingRecord] = useState(false)
  const [isSavingRecord, setIsSavingRecord] = useState(false)
  const [editorStatus, setEditorStatus] = useState('')
  const selectRef = useRef<HTMLSelectElement>(null)
  const color = SPEAKER_COLORS[pred.speaker] ?? '#6b7280'
  const firstName = getSpeakerDisplayName(pred.speaker)
  const hasDetails = Boolean(pred.context || pred.explanation)
  const generatedLabel = formatFactCheckDate(pred.date_generated)
  const prediction = censorText(pred.prediction)
  const context = censorText(pred.context)
  const explanation = censorText(pred.explanation)
  const [draftPrediction, setDraftPrediction] = useState(pred.prediction)
  const [draftContext, setDraftContext] = useState(pred.context ?? '')
  const [draftTopic, setDraftTopic] = useState(pred.topic)
  const [draftTimeframe, setDraftTimeframe] = useState(pred.timeframe)
  const [draftSpecificity, setDraftSpecificity] = useState(pred.specificity)
  const [draftTimestamp, setDraftTimestamp] = useState(pred.timestamp_seconds != null ? String(pred.timestamp_seconds) : '')
  const [draftVerdict, setDraftVerdict] = useState(pred.verdict)
  const [draftConfidence, setDraftConfidence] = useState(pred.confidence)
  const [draftExplanation, setDraftExplanation] = useState(pred.explanation ?? '')
  const [draftSources, setDraftSources] = useState((pred.sources ?? []).join('\n'))

  useEffect(() => {
    setDraftPrediction(pred.prediction)
    setDraftContext(pred.context ?? '')
    setDraftTopic(pred.topic)
    setDraftTimeframe(pred.timeframe)
    setDraftSpecificity(pred.specificity)
    setDraftTimestamp(pred.timestamp_seconds != null ? String(pred.timestamp_seconds) : '')
    setDraftVerdict(pred.verdict)
    setDraftConfidence(pred.confidence)
    setDraftExplanation(pred.explanation ?? '')
    setDraftSources((pred.sources ?? []).join('\n'))
  }, [pred])

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
                {isDev && (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        onClick={() => {
                          setIsEditingRecord(value => !value)
                          setEditorStatus('')
                        }}
                        className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                      >
                        {isEditingRecord ? 'Close editor' : 'Edit prediction / fact-check'}
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await onCopyPrompt('extract', pred.prediction_id)
                          } catch (error) {
                            setEditorStatus(error instanceof Error ? error.message : 'Failed to copy extraction prompt.')
                          }
                        }}
                        className="text-xs text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
                      >
                        Copy extraction prompt
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await onCopyPrompt('fact_check', pred.prediction_id)
                          } catch (error) {
                            setEditorStatus(error instanceof Error ? error.message : 'Failed to copy fact-check prompt.')
                          }
                        }}
                        className="text-xs text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
                      >
                        Copy fact-check prompt
                      </button>
                    </div>
                    {editorStatus && (
                      <span className="text-xs text-gray-400 dark:text-zinc-500">{editorStatus}</span>
                    )}
                  </div>
                )}
                {pred.context && (
                  <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">{context}</p>
                )}
                {pred.timeframe && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs text-gray-400 uppercase tracking-wider dark:text-zinc-600">
                      Timeframe
                    </p>
                    <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">{pred.timeframe}</p>
                  </div>
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
                {isDev && isEditingRecord && (
                  <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-[#1E3A60] dark:bg-[#0F1B38]">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">Prediction</label>
                      <textarea value={draftPrediction} onChange={e => setDraftPrediction(e.target.value)} className="min-h-[72px] w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">Context</label>
                      <textarea value={draftContext} onChange={e => setDraftContext(e.target.value)} className="min-h-[72px] w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">Topic</span>
                        <select value={draftTopic} onChange={e => setDraftTopic(e.target.value as typeof pred.topic)} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                          {TOPIC_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">Specificity</span>
                        <select value={draftSpecificity} onChange={e => setDraftSpecificity(e.target.value as typeof pred.specificity)} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                          {SPECIFICITY_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">Timeframe</span>
                        <input value={draftTimeframe} onChange={e => setDraftTimeframe(e.target.value)} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">Timestamp Seconds</span>
                        <input value={draftTimestamp} onChange={e => setDraftTimestamp(e.target.value)} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
                      </label>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">Status</span>
                        <select value={draftVerdict} onChange={e => setDraftVerdict(e.target.value as typeof pred.verdict)} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                          {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">Confidence</span>
                        <select value={draftConfidence} onChange={e => setDraftConfidence(e.target.value as typeof pred.confidence)} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                          {CONFIDENCE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">Fact-check Explanation</label>
                      <textarea value={draftExplanation} onChange={e => setDraftExplanation(e.target.value)} className="min-h-[72px] w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">Sources</label>
                      <textarea value={draftSources} onChange={e => setDraftSources(e.target.value)} placeholder="One URL per line or comma-separated" className="min-h-[72px] w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          const confirmed = window.confirm('Delete this prediction and its fact-check?')
                          if (!confirmed) return
                          setIsSavingRecord(true)
                          setEditorStatus('')
                          try {
                            await onRecordDelete(pred.prediction_id)
                          } catch (error) {
                            setEditorStatus(error instanceof Error ? error.message : 'Failed to delete prediction.')
                            setIsSavingRecord(false)
                          }
                        }}
                        disabled={isSavingRecord}
                        className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:border-red-400 hover:bg-red-100 disabled:opacity-50 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300"
                      >
                        {isSavingRecord ? 'Saving…' : 'Delete prediction'}
                      </button>
                      <button
                        onClick={async () => {
                          setIsSavingRecord(true)
                          setEditorStatus('')
                          try {
                            const { reopened } = await onRecordSave(
                              pred.prediction_id,
                              {
                                prediction: draftPrediction,
                                context: draftContext,
                                topic: draftTopic,
                                timeframe: draftTimeframe,
                                specificity: draftSpecificity,
                                timestamp_seconds: draftTimestamp.trim() === '' ? null : Number(draftTimestamp),
                                verdict: draftVerdict,
                                confidence: draftConfidence,
                                explanation: draftExplanation,
                                sources: parseSourceList(draftSources),
                                date_generated: pred.date_generated ?? null,
                              },
                              { reopenFactCheck: true },
                            )
                            setEditorStatus(reopened ? 'Sent back to fact-checking.' : 'Saved.')
                            if (reopened) {
                              setDraftVerdict('pending')
                              setDraftConfidence('low')
                              setDraftExplanation('Prediction sent back for fact-checking.')
                              setDraftSources('')
                            }
                          } catch (error) {
                            setEditorStatus(error instanceof Error ? error.message : 'Failed to reopen fact-check.')
                          } finally {
                            setIsSavingRecord(false)
                          }
                        }}
                        disabled={isSavingRecord}
                        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:border-amber-400 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300"
                      >
                        {isSavingRecord ? 'Saving…' : 'Send to fact-check'}
                      </button>
                      <button
                        onClick={async () => {
                          setIsSavingRecord(true)
                          setEditorStatus('')
                          try {
                            const { reopened } = await onRecordSave(pred.prediction_id, {
                              prediction: draftPrediction,
                              context: draftContext,
                              topic: draftTopic,
                              timeframe: draftTimeframe,
                              specificity: draftSpecificity,
                              timestamp_seconds: draftTimestamp.trim() === '' ? null : Number(draftTimestamp),
                              verdict: draftVerdict,
                              confidence: draftConfidence,
                              explanation: draftExplanation,
                              sources: parseSourceList(draftSources),
                              date_generated: pred.date_generated ?? null,
                            })
                            setEditorStatus(reopened ? 'Prediction updated. Fact-check reopened.' : 'Saved.')
                            if (reopened) {
                              setDraftVerdict('pending')
                              setDraftConfidence('low')
                              setDraftExplanation('Prediction updated and needs to be fact-checked again.')
                              setDraftSources('')
                            }
                          } catch (error) {
                            setEditorStatus(error instanceof Error ? error.message : 'Failed to save changes.')
                          } finally {
                            setIsSavingRecord(false)
                          }
                        }}
                        disabled={isSavingRecord}
                        className="rounded-md bg-[#B22234] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#9d1e2e] disabled:opacity-50"
                      >
                        {isSavingRecord ? 'Saving…' : 'Save changes'}
                      </button>
                      <button
                        onClick={() => {
                          setIsEditingRecord(false)
                          setEditorStatus('')
                          setDraftPrediction(pred.prediction)
                          setDraftContext(pred.context ?? '')
                          setDraftTopic(pred.topic)
                          setDraftTimeframe(pred.timeframe)
                          setDraftSpecificity(pred.specificity)
                          setDraftTimestamp(pred.timestamp_seconds != null ? String(pred.timestamp_seconds) : '')
                          setDraftVerdict(pred.verdict)
                          setDraftConfidence(pred.confidence)
                          setDraftExplanation(pred.explanation ?? '')
                          setDraftSources((pred.sources ?? []).join('\n'))
                        }}
                        className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 dark:border-zinc-700 dark:text-zinc-300"
                      >
                        Cancel
                      </button>
                    </div>
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
  reviewStatus: ReviewStateMap
  onSaveReview: (videoId: string, review: ReviewEntry) => Promise<void>
  onSaveRecord: (videoId: string, predictionId: string, patch: Partial<MasterRecord>, options?: { reopenFactCheck?: boolean }) => Promise<{ reopened: boolean }>
  onDeleteRecord: (videoId: string, predictionId: string) => Promise<void>
  onCopyPrompt: (videoId: string, predictionId: string, type: 'extract' | 'fact_check') => Promise<void>
  onBack: () => void
  onPrevious: (() => void) | null
  onNext: (() => void) | null
}

function EpisodeDetail({ video, preds, reviewStatus, onSaveReview, onSaveRecord, onDeleteRecord, onCopyPrompt, onBack, onPrevious, onNext }: EpisodeDetailProps) {
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
  const [scrollOverridePredId, setScrollOverridePredId] = useState<string | null>(null)

  // Dev-only: speaker overrides (prediction_id → speaker name)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [editingPredId, setEditingPredId] = useState<string | null>(null)
  const [showRebuildHint, setShowRebuildHint] = useState(false)
  const [reviewSaving, setReviewSaving] = useState(false)
  const videoTitle = censorText(video.title)
  const stage = getEffectiveStage(video, reviewStatus)
  const reviewEntry = reviewStatus[video.id] ?? {
    reviewed: video.reviewed ?? false,
    flagged: video.flagged_for_review ?? false,
    notes: video.review_notes ?? '',
  }
  const [reviewNotes, setReviewNotes] = useState(reviewEntry.notes)

  const videoId = extractVideoId(video.url)

  useEffect(() => {
    setReviewNotes(reviewEntry.notes)
  }, [reviewEntry.notes, video.id])

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
    return getPredictionIdForTime(sortedPreds, currentTime)
  }, [currentTime, sortedPreds])

  const scrollOverridePred = useMemo(
    () => sortedPreds.find(pred => pred.prediction_id === scrollOverridePredId) ?? null,
    [scrollOverridePredId, sortedPreds],
  )

  const scrollPredId = useMemo(() => {
    if (scrollOverridePredId) return scrollOverridePredId
    return getPredictionIdForTime(sortedPreds, currentTime, SEEK_SCROLL_THRESHOLD_SECONDS)
  }, [currentTime, scrollOverridePredId, sortedPreds])

  useEffect(() => {
    if (!scrollOverridePred || scrollOverridePred.timestamp_seconds == null || currentTime == null) return
    if (currentTime >= scrollOverridePred.timestamp_seconds - SEEK_SCROLL_THRESHOLD_SECONDS) {
      setScrollOverridePredId(null)
    }
  }, [currentTime, scrollOverridePred])

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

    if (prevTime == null || !scrollPredId) return
    if (Math.abs(currentTime - prevTime) < SEEK_SCROLL_THRESHOLD_SECONDS) return

    scrollToPred(scrollPredId)
  }, [currentTime, scrollPredId])

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
    if (scrollPredId) scrollToPred(scrollPredId)
  }, [scrollPredId])

  const openAt = (startSeconds?: number) => {
    if (startSeconds == null) setScrollOverridePredId(null)
    pendingStartRef.current = getPlaybackStartSeconds(startSeconds) ?? undefined
    setShowPlayer(true)
    if (startSeconds != null) setCurrentTime(startSeconds)
  }

  const handleSeek = (pred: MasterRecord) => {
    if (pred.timestamp_seconds == null) return
    const t = getPlaybackStartSeconds(pred.timestamp_seconds) ?? 0
    setScrollOverridePredId(pred.prediction_id)
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
            {isDev && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <StageBadge stage={stage} />
                {video.has_fact_checks && !video.has_pending_fact_checks && (
                  <>
                    <button
                      onClick={async () => {
                        setReviewSaving(true)
                        try {
                          await onSaveReview(video.id, {
                            ...reviewEntry,
                            reviewed: !reviewEntry.reviewed,
                            flagged: reviewEntry.flagged && !reviewEntry.reviewed ? false : reviewEntry.flagged,
                            notes: reviewNotes,
                          })
                        } finally {
                          setReviewSaving(false)
                        }
                      }}
                      disabled={reviewSaving}
                      className={[
                        'rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
                        reviewEntry.reviewed && !reviewEntry.flagged
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                          : 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800/60 dark:bg-orange-950/30 dark:text-orange-300',
                        reviewSaving ? 'opacity-60 cursor-wait' : '',
                      ].join(' ')}
                      title={reviewEntry.reviewed ? 'Mark this episode as needing review again' : 'Mark this episode as reviewed'}
                    >
                      {reviewSaving ? 'Saving…' : reviewEntry.reviewed ? 'Reviewed' : 'Mark reviewed'}
                    </button>
                    <button
                      onClick={async () => {
                        setReviewSaving(true)
                        try {
                          await onSaveReview(video.id, {
                            ...reviewEntry,
                            flagged: !reviewEntry.flagged,
                            notes: reviewNotes,
                          })
                        } finally {
                          setReviewSaving(false)
                        }
                      }}
                      disabled={reviewSaving}
                      className={[
                        'rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
                        reviewEntry.flagged
                          ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300'
                          : 'border-gray-200 bg-gray-50 text-gray-700 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300',
                        reviewSaving ? 'opacity-60 cursor-wait' : '',
                      ].join(' ')}
                      title={reviewEntry.flagged ? 'Clear further review flag' : 'Flag this episode for further review'}
                    >
                      {reviewEntry.flagged ? 'Flagged' : 'Flag for review'}
                    </button>
                  </>
                )}
              </div>
            )}
            {isDev && video.has_fact_checks && !video.has_pending_fact_checks && (
              <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-[#1E3A60] dark:bg-[#0F1B38]">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500">
                    Review Notes
                  </p>
                  <button
                    onClick={async () => {
                      setReviewSaving(true)
                      try {
                        await onSaveReview(video.id, { ...reviewEntry, notes: reviewNotes })
                      } finally {
                        setReviewSaving(false)
                      }
                    }}
                    disabled={reviewSaving}
                    className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition-colors hover:border-gray-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600"
                  >
                    {reviewSaving ? 'Saving…' : 'Save notes'}
                  </button>
                </div>
                <textarea
                  value={reviewNotes}
                  onChange={e => setReviewNotes(e.target.value)}
                  placeholder="Add follow-up notes about why this episode needs another pass."
                  className="mt-2 min-h-[88px] w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                />
              </div>
            )}
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
                    onRecordSave={(predictionId, patch, options) => onSaveRecord(video.id, predictionId, patch, options)}
                    onRecordDelete={(predictionId) => onDeleteRecord(video.id, predictionId)}
                    onCopyPrompt={(type, predictionId) => onCopyPrompt(video.id, predictionId, type)}
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
  const [reviewStatus, setReviewStatus] = useState<ReviewStateMap>({})
  const [recordOverrides, setRecordOverrides] = useState<RecordOverrideMap>({})
  const [deletedPredictionIds, setDeletedPredictionIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!isDev) return
    fetch('/api/review-status')
      .then(r => r.json())
      .then((data: ReviewStateMap) => setReviewStatus(data))
      .catch(() => {})
  }, [])

  const handleSaveReview = async (videoId: string, review: ReviewEntry) => {
    if (!isDev) return
    await fetch('/api/review-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_id: videoId,
        reviewed: review.reviewed,
        flagged: review.flagged,
        notes: review.notes,
      }),
    })
    setReviewStatus(prev => ({ ...prev, [videoId]: review }))
  }

  const predsByVideo = new Map<string, MasterRecord[]>()
  for (const p of predictions) {
    if (deletedPredictionIds.has(p.prediction_id)) continue
    const next = recordOverrides[p.prediction_id] ? { ...p, ...recordOverrides[p.prediction_id] } : p
    const arr = predsByVideo.get(p.video_id) ?? []
    arr.push(next)
    predsByVideo.set(p.video_id, arr)
  }

  const handleSaveRecord = async (
    videoId: string,
    predictionId: string,
    patch: Partial<MasterRecord>,
    options?: { reopenFactCheck?: boolean },
  ) => {
    const predictionPayload = {
      prediction: patch.prediction,
      context: patch.context,
      topic: patch.topic,
      timeframe: patch.timeframe,
      specificity: patch.specificity,
      timestamp_seconds: patch.timestamp_seconds,
    }
    const factCheckPayload = {
      verdict: patch.verdict,
      confidence: patch.confidence,
      explanation: patch.explanation,
      sources: patch.sources ?? [],
      date_generated: patch.date_generated ?? null,
    }

    const response = await fetch('/api/prediction-editor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_id: videoId,
        prediction_id: predictionId,
        prediction: predictionPayload,
        fact_check: factCheckPayload,
        reopen_fact_check: options?.reopenFactCheck === true,
      }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? 'Failed to save prediction changes')

    setRecordOverrides(prev => ({
      ...prev,
      [predictionId]: {
        ...predictionPayload,
        ...data.fact_check,
      },
    }))
    if (data.reopened_for_fact_check) {
      setReviewStatus(prev => ({
        ...prev,
        [videoId]: {
          ...(prev[videoId] ?? { reviewed: false, flagged: false, notes: '' }),
          reviewed: false,
        },
      }))
    }
    return { reopened: Boolean(data.reopened_for_fact_check) }
  }

  const handleDeleteRecord = async (videoId: string, predictionId: string) => {
    const response = await fetch('/api/prediction-editor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_id: videoId,
        prediction_id: predictionId,
        delete_prediction: true,
      }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? 'Failed to delete prediction')

    setDeletedPredictionIds(prev => {
      const next = new Set(prev)
      next.add(predictionId)
      return next
    })
    setRecordOverrides(prev => {
      const next = { ...prev }
      delete next[predictionId]
      return next
    })
    setReviewStatus(prev => ({
      ...prev,
      [videoId]: {
        ...(prev[videoId] ?? { reviewed: false, flagged: false, notes: '' }),
        reviewed: false,
      },
    }))
  }

  const handleCopyPrompt = async (videoId: string, predictionId: string, type: 'extract' | 'fact_check') => {
    const params = new URLSearchParams({ video_id: videoId, type })
    if (type === 'fact_check') params.set('prediction_id', predictionId)
    const response = await fetch(`/api/prompt-preview?${params.toString()}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? 'Failed to build prompt')
    await navigator.clipboard.writeText(data.combined)
  }

  const sorted = [...videos].sort(
    (a, b) => new Date(a.published_at).getTime() - new Date(b.published_at).getTime(),
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
          reviewStatus={reviewStatus}
          onSaveReview={handleSaveReview}
          onSaveRecord={handleSaveRecord}
          onDeleteRecord={handleDeleteRecord}
          onCopyPrompt={handleCopyPrompt}
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
        const stage = getEffectiveStage(video, reviewStatus)

        return (
          <button
            key={video.id}
            onClick={() => onSelectId(video.id)}
            className="w-full bg-white border border-gray-200 rounded-lg px-4 py-3 text-left hover:border-gray-300 transition-colors flex items-center gap-4 dark:bg-[#162244] dark:border-[#1E3A60] dark:hover:border-zinc-700"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate dark:text-zinc-200">{videoTitle}</p>
              <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                <p className="text-xs text-gray-500 dark:text-zinc-500">{video.published_at}</p>
                <StageBadge stage={stage} />
              </div>
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
