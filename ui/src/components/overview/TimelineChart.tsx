import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { MasterRecord } from '@/types'
import { VERDICT_COLORS } from '@/types'
import { timelineData } from '@/hooks/usePredictions'
import { useThemeContext, useTooltipStyle } from '@/context/ThemeContext'

const TIMELINE_VERDICTS = ['true', 'partially true', 'false', 'pending'] as const
const TIMELINE_GRADIENT_IDS = {
  true: 'grad-true',
  'partially true': 'grad-partially-true',
  false: 'grad-false',
  pending: 'grad-pending',
} as const

interface TimelineChartProps {
  predictions: MasterRecord[]
}

export function TimelineChart({ predictions }: TimelineChartProps) {
  const { isDark } = useThemeContext()
  const tooltip = useTooltipStyle(isDark)
  const data = timelineData(predictions)
  const axisColor = isDark ? '#4A7AB5' : '#a1a1aa'
  const gridColor = isDark ? '#1E3A60' : '#e4e4e7'

  if (data.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-center h-[288px] dark:bg-[#162244] dark:border-[#1E3A60]">
        <p className="text-gray-400 dark:text-zinc-600 text-sm">No timeline data yet</p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 dark:bg-[#162244] dark:border-[#1E3A60]">
      <h3 className="text-sm font-semibold text-[#1B2A5E] uppercase tracking-wider mb-4 dark:text-blue-300">
        Predictions Over Time
      </h3>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <defs>
            {TIMELINE_VERDICTS.map(v => (
              <linearGradient key={v} id={TIMELINE_GRADIENT_IDS[v]} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={VERDICT_COLORS[v]} stopOpacity={0.3} />
                <stop offset="95%" stopColor={VERDICT_COLORS[v]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis
            dataKey="date"
            tick={{ fill: axisColor, fontSize: 11 }}
            tickLine={false}
            tickFormatter={d => d.slice(0, 7)}
          />
          <YAxis tick={{ fill: axisColor, fontSize: 11 }} tickLine={false} />
          <Tooltip contentStyle={tooltip.contentStyle} labelStyle={tooltip.labelStyle} itemStyle={tooltip.itemStyle} />
          <Legend
            formatter={value => (
              <span style={{ color: isDark ? '#93C5FD' : '#374151', fontSize: 13 }} className="capitalize">{value}</span>
            )}
          />
          <Area type="monotone" dataKey="true" name="Correct" stackId="1" stroke={VERDICT_COLORS.true} fill={`url(#${TIMELINE_GRADIENT_IDS.true})`} />
          <Area type="monotone" dataKey="partially true" name="Partially True" stackId="1" stroke={VERDICT_COLORS['partially true']} fill={`url(#${TIMELINE_GRADIENT_IDS['partially true']})`} />
          <Area type="monotone" dataKey="false" name="Wrong" stackId="1" stroke={VERDICT_COLORS.false} fill={`url(#${TIMELINE_GRADIENT_IDS.false})`} />
          <Area type="monotone" dataKey="pending" name="Pending" stackId="1" stroke={VERDICT_COLORS.pending} fill={`url(#${TIMELINE_GRADIENT_IDS.pending})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
