import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { MasterRecord } from '@/types'
import { VERDICT_COLORS } from '@/types'
import { topicData } from '@/hooks/usePredictions'
import { useThemeContext, useTooltipStyle } from '@/context/ThemeContext'

interface TopicsTabProps {
  predictions: MasterRecord[]
  onSelectTopic?: (topic: string) => void
}

export function TopicsTab({ predictions, onSelectTopic }: TopicsTabProps) {
  const { isDark } = useThemeContext()
  const tooltip = useTooltipStyle(isDark)
  const axisColor = isDark ? '#a1a1aa' : '#4A7AB5'
  const gridColor = isDark ? '#1E3A60' : '#e4e4e7'
  const data = topicData(predictions)

  if (data.length === 0) {
    return (
      <div className="text-center py-20 text-gray-400 dark:text-zinc-600">
        <p>No prediction data yet — pipeline still running.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg p-5 dark:bg-[#162244] dark:border-[#1E3A60]">
        <h3 className="text-sm font-semibold text-[#1B2A5E] uppercase tracking-wider mb-4 dark:text-blue-300">
          Predictions by Topic
        </h3>
        <ResponsiveContainer width="100%" height={Math.max(300, data.length * 40)}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ left: 8, right: 16, top: 0, bottom: 0 }}
            onClick={e => {
              if (e?.activeLabel && onSelectTopic) onSelectTopic(e.activeLabel as string)
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
            <XAxis type="number" tick={{ fill: axisColor, fontSize: 11 }} tickLine={false} />
            <YAxis
              type="category"
              dataKey="topic"
              tick={{ fill: axisColor, fontSize: 12 }}
              tickLine={false}
              width={140}
            />
            <Tooltip contentStyle={tooltip.contentStyle} cursor={tooltip.cursor} />
            <Legend
              formatter={v => (
                <span style={{ color: isDark ? '#93C5FD' : '#374151', fontSize: 13 }} className="capitalize">{v}</span>
              )}
            />
            <Bar dataKey="true" name="Correct" stackId="a" fill={VERDICT_COLORS.true} />
            <Bar dataKey="false" name="Wrong" stackId="a" fill={VERDICT_COLORS.false} />
            <Bar dataKey="pending" name="Pending" stackId="a" fill={VERDICT_COLORS.pending} />
            <Bar dataKey="unverifiable" name="Unverifiable" stackId="a" fill={VERDICT_COLORS.unverifiable} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {data.map(t => {
          const decided = t['true'] + t['false']
          const accuracy = decided > 0 ? Math.round((t['true'] / decided) * 100) : null
          return (
            <button
              key={t.topic}
              onClick={() => onSelectTopic?.(t.topic)}
              className="bg-white border border-gray-200 rounded-lg p-3 text-left hover:border-gray-300 transition-colors dark:bg-[#162244] dark:border-[#1E3A60] dark:hover:border-zinc-600"
            >
              <p className="text-sm font-medium text-gray-800 capitalize dark:text-zinc-200">{t.topic}</p>
              <p className="text-xs text-gray-500 mt-0.5 dark:text-zinc-500">{t.total} predictions</p>
              <p className="text-lg font-bold text-gray-700 mt-1 dark:text-zinc-300">
                {accuracy !== null ? `${accuracy}%` : '—'}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
