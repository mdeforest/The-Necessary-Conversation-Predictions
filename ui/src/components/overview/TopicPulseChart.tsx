import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MasterRecord } from '@/types'
import { topicOverviewData } from '@/hooks/usePredictions'
import { useThemeContext, useTooltipStyle } from '@/context/ThemeContext'

interface TopicPulseChartProps {
  predictions: MasterRecord[]
}

function getTopicFill(accuracy: number | null) {
  if (accuracy === null) return '#94a3b8'
  if (accuracy >= 60) return '#22c55e'
  if (accuracy >= 40) return '#f59e0b'
  return '#ef4444'
}

export function TopicPulseChart({ predictions }: TopicPulseChartProps) {
  const { isDark } = useThemeContext()
  const tooltip = useTooltipStyle(isDark)
  const axisColor = isDark ? '#7da5d8' : '#64748b'
  const gridColor = isDark ? '#1E3A60' : '#e2e8f0'
  const data = topicOverviewData(predictions)
    .slice(0, 8)
    .map(row => ({
      ...row,
      shortTopic: row.topic.length > 16 ? `${row.topic.slice(0, 16)}…` : row.topic,
      fill: getTopicFill(row.accuracy),
    }))

  if (data.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-center h-[320px] dark:bg-[#162244] dark:border-[#1E3A60]">
        <p className="text-gray-400 dark:text-zinc-600 text-sm">No topic data yet</p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 dark:bg-[#162244] dark:border-[#1E3A60]">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[#1B2A5E] uppercase tracking-wider dark:text-blue-300">
          Topic Pulse
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-blue-100/65">
          The busiest topics, colored by how often they ended up right.
        </p>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 12 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="shortTopic" tick={{ fill: axisColor, fontSize: 11 }} tickLine={false} axisLine={false} interval={0} angle={-18} textAnchor="end" height={52} />
          <YAxis tick={{ fill: axisColor, fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={tooltip.contentStyle}
            labelStyle={tooltip.labelStyle}
            itemStyle={tooltip.itemStyle}
            formatter={(value, name, item) => {
              if (name === 'Predictions') return [value, name]
              if (name === 'Accuracy') return [`${value}%`, name]
              if (item?.payload?.pendingShare !== undefined) return [`${value}%`, name]
              return [value, name]
            }}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.topic ?? ''}
          />
          <Bar dataKey="total" name="Predictions" radius={[6, 6, 0, 0]}>
            {data.map(entry => (
              <Cell key={entry.topic} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {data.slice(0, 4).map(topic => (
          <div key={topic.topic} className="rounded-lg border border-slate-200 p-3 dark:border-[#1E3A60]">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-slate-800 dark:text-zinc-100">{topic.topic}</p>
              <span className="text-xs text-slate-500 dark:text-blue-100/60">{topic.total} total</span>
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 dark:text-blue-100/65">
              <span>{topic.accuracy !== null ? `${topic.accuracy}% accurate` : 'No judged calls yet'}</span>
              <span>{topic.pendingShare}% pending</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
