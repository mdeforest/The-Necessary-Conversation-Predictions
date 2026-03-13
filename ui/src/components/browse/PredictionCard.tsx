import { useState } from 'react'
import type { MasterRecord } from '@/types'
import { SPEAKER_COLORS } from '@/types'
import { VerdictBadge } from './VerdictBadge'
import { ConfidenceBadge } from './ConfidenceBadge'
import { YouTubeInlinePlayer } from '@/components/shared/YouTubePlayer'
import { formatFactCheckDate } from '@/components/shared/formatFactCheckDate'

interface PredictionCardProps {
  record: MasterRecord
  onNavigateToEpisode?: (videoId: string) => void
}

export function PredictionCard({ record, onNavigateToEpisode }: PredictionCardProps) {
  const [expanded, setExpanded] = useState(false)
  const color = SPEAKER_COLORS[record.speaker] ?? '#6b7280'
  const generatedLabel = formatFactCheckDate(record.date_generated)

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors dark:bg-[#162244] dark:border-[#1E3A60] dark:hover:border-zinc-700">
      <div className="flex items-start gap-3">
        <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-xs font-semibold" style={{ color }}>
              {record.speaker}
            </span>
            <span className="text-xs text-gray-300 dark:text-zinc-600">·</span>
            <button
              onClick={() => onNavigateToEpisode?.(record.video_id)}
              className="text-xs text-gray-500 hover:text-blue-500 transition-colors dark:text-zinc-500 dark:hover:text-blue-400"
              title="Go to episode"
            >
              {record.episode_date}
            </button>
            <span className="text-xs text-gray-300 dark:text-zinc-600">·</span>
            <span className="text-xs text-gray-500 capitalize dark:text-zinc-500">{record.topic}</span>
            <VerdictBadge verdict={record.verdict} />
          </div>

          <p className="text-sm text-gray-800 leading-relaxed dark:text-zinc-200">{record.prediction}</p>

          {expanded && (
            <div className="mt-3 space-y-3">
              {record.context && (
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1 dark:text-zinc-500">Context</p>
                  <p className="text-xs text-gray-600 dark:text-zinc-400">{record.context}</p>
                </div>
              )}
              {record.explanation && (
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="text-xs text-gray-400 uppercase tracking-wider dark:text-zinc-500">Fact-check</p>
                    <ConfidenceBadge confidence={record.confidence} />
                  </div>
                  <p className="text-xs text-gray-600 dark:text-zinc-400">{record.explanation}</p>
                  {generatedLabel && (
                        <p className="text-xs italic text-gray-500 dark:text-zinc-400 pt-4">Generated {generatedLabel}</p>
                  )}
                </div>
              )}
              {record.timeframe && (
                <p className="text-xs text-gray-500 dark:text-zinc-500">
                  <span className="text-gray-400 dark:text-zinc-600">Timeframe: </span>
                  {record.timeframe}
                </p>
              )}
              {record.sources?.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1 dark:text-zinc-500">Sources</p>
                  <div className="flex flex-col gap-1">
                    {record.sources.map((s, i) => (
                      <a
                        key={i}
                        href={s}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:text-blue-600 truncate dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        {s}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <YouTubeInlinePlayer url={record.video_url} title={record.video_title} startSeconds={record.timestamp_seconds} />
            </div>
          )}

          <button
            onClick={() => setExpanded(e => !e)}
            className="mt-2 text-xs text-gray-400 hover:text-gray-600 transition-colors dark:text-zinc-600 dark:hover:text-zinc-400"
          >
            {expanded ? 'Show less ↑' : 'Show more ↓'}
          </button>
        </div>
      </div>
    </div>
  )
}
