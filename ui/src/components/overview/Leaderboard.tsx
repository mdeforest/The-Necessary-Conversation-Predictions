import clsx from 'clsx'
import type { MasterRecord } from '@/types'
import { KNOWN_SPEAKERS, SPEAKER_COLORS, VERDICT_COLORS, getAccuracyFromCounts } from '@/types'
import { getSpeakerDisplayName } from '@/components/shared/getSpeakerDisplayName'

interface LeaderboardProps {
  predictions: MasterRecord[]
  onSelectSpeaker?: (speaker: string) => void
}

interface SpeakerRow {
  name: string
  total: number
  correct: number
  partiallyTrue: number
  wrong: number
  pending: number
  unverifiable: number
  accuracy: number | null
}

export function Leaderboard({ predictions, onSelectSpeaker }: LeaderboardProps) {
  const rows: SpeakerRow[] = KNOWN_SPEAKERS.map(name => {
    const mine = predictions.filter(p => p.speaker === name)
    const correct = mine.filter(p => p.verdict === 'true').length
    const partiallyTrue = mine.filter(p => p.verdict === 'partially true').length
    const wrong = mine.filter(p => p.verdict === 'false').length
    const pending = mine.filter(p => p.verdict === 'pending').length
    const unverifiable = mine.filter(p => p.verdict === 'unverifiable').length
    const total = mine.length
    const accuracy = getAccuracyFromCounts({ true: correct, 'partially true': partiallyTrue, false: wrong })
    return { name, total, correct, partiallyTrue, wrong, pending, unverifiable, accuracy }
  })
    .filter(r => r.total > 0)
    .sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1))

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 dark:bg-[#162244] dark:border-[#1E3A60]">
        <h3 className="text-sm font-semibold text-[#1B2A5E] uppercase tracking-wider mb-3 dark:text-blue-300">
          Accuracy Leaderboard
        </h3>
        <p className="text-gray-400 dark:text-zinc-600 text-sm py-6 text-center">No data yet</p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 dark:bg-[#162244] dark:border-[#1E3A60]">
      <h3 className="text-sm font-semibold text-[#1B2A5E] uppercase tracking-wider mb-3 dark:text-blue-300">
        Accuracy Leaderboard
      </h3>
      <div className="space-y-3">
        {rows.map((row, i) => (
          <button
            key={row.name}
            onClick={() => onSelectSpeaker?.(row.name)}
            className="w-full text-left group"
          >
            <div className="flex items-center gap-3">
              <span className="text-gray-400 dark:text-zinc-600 text-xs w-4">{i + 1}</span>
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: SPEAKER_COLORS[row.name] }}
              />
              <span className="text-sm text-gray-700 flex-1 group-hover:text-gray-900 transition-colors dark:text-zinc-200 dark:group-hover:text-white">
                {getSpeakerDisplayName(row.name)}
              </span>
              <span className="text-xs text-gray-400 dark:text-zinc-500">{row.total} predictions</span>
              <span
                className={clsx(
                  'text-sm font-bold w-12 text-right',
                  row.accuracy !== null
                    ? row.accuracy >= 60
                      ? 'text-green-600 dark:text-green-400'
                      : row.accuracy >= 40
                        ? 'text-yellow-600 dark:text-yellow-400'
                        : 'text-red-600 dark:text-red-400'
                    : 'text-gray-300 dark:text-zinc-600',
                )}
              >
                {row.accuracy !== null ? `${row.accuracy}%` : '—'}
              </span>
            </div>
            <div className="flex mt-1.5 ml-7 h-1.5 rounded-full overflow-hidden gap-px">
              <div style={{ flex: row.correct, backgroundColor: VERDICT_COLORS.true }} className="rounded-l-full" />
              <div style={{ flex: row.partiallyTrue, backgroundColor: VERDICT_COLORS['partially true'] }} />
              <div style={{ flex: row.wrong, backgroundColor: VERDICT_COLORS.false }} />
              <div style={{ flex: row.pending, backgroundColor: VERDICT_COLORS.pending }} />
              <div style={{ flex: row.unverifiable, backgroundColor: VERDICT_COLORS.unverifiable }} className="rounded-r-full" />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
