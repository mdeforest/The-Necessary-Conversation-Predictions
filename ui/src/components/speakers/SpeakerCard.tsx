import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { MasterRecord, Verdict } from '@/types'
import { SPEAKER_COLORS, VERDICT_COLORS, VERDICT_LABELS, VERDICTS, getAccuracyFromCounts } from '@/types'
import { useThemeContext, useTooltipStyle } from '@/context/ThemeContext'
import { getSpeakerDisplayName } from '@/components/shared/getSpeakerDisplayName'

interface SpeakerCardProps {
  name: string
  predictions: MasterRecord[]
  onBrowse?: () => void
}

export function SpeakerCard({ name, predictions, onBrowse }: SpeakerCardProps) {
  const { isDark } = useThemeContext()
  const tooltip = useTooltipStyle(isDark)
  const axisColor = isDark ? '#4A7AB5' : '#a1a1aa'

  const mine = predictions.filter(p => p.speaker === name)
  const total = mine.length
  const counts = VERDICTS.reduce<Record<string, number>>((acc, v) => {
    acc[v] = mine.filter(p => p.verdict === v).length
    return acc
  }, {})
  const accuracy = getAccuracyFromCounts(counts)

  const chartData = VERDICTS.filter(v => counts[v] > 0).map(v => ({
    name: VERDICT_LABELS[v],
    count: counts[v],
    verdict: v,
  }))

  const color = SPEAKER_COLORS[name] ?? '#6b7280'
  const firstName = getSpeakerDisplayName(name)

  return (
    <div
      className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-4 dark:bg-[#162244] dark:border-[#1E3A60]"
      style={{ borderTopColor: color, borderTopWidth: 3 }}
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100">{firstName}</h3>
          <p className="text-xs text-gray-500 dark:text-zinc-500">{name}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold" style={{ color }}>
            {accuracy !== null ? `${accuracy}%` : '—'}
          </p>
          <p className="text-xs text-gray-500 dark:text-zinc-500">accuracy</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {VERDICTS.map(v => (
          <div key={v} className="bg-gray-50 rounded-lg px-3 py-2 dark:bg-zinc-800/60">
            <p className="text-xs text-gray-500 dark:text-zinc-500">{VERDICT_LABELS[v]}</p>
            <p className="text-xl font-semibold" style={{ color: VERDICT_COLORS[v] }}>
              {counts[v]}
            </p>
          </div>
        ))}
      </div>

      {chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 8 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" tick={{ fill: axisColor, fontSize: 11 }} tickLine={false} width={80} />
            <Tooltip contentStyle={tooltip.contentStyle} cursor={tooltip.cursor} />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {chartData.map(entry => (
                <Cell key={entry.verdict} fill={VERDICT_COLORS[entry.verdict as Verdict]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-zinc-500">{total} total predictions</p>
        {onBrowse && (
          <button
            onClick={onBrowse}
            className="text-xs text-blue-500 hover:text-blue-600 transition-colors dark:text-blue-400 dark:hover:text-blue-300"
          >
            Browse all →
          </button>
        )}
      </div>
    </div>
  )
}
