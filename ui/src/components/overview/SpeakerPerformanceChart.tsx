import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MasterRecord } from '@/types'
import { SPEAKER_COLORS } from '@/types'
import { speakerPerformanceData } from '@/hooks/usePredictions'
import { getSpeakerDisplayName } from '@/components/shared/getSpeakerDisplayName'
import { useThemeContext, useTooltipStyle } from '@/context/ThemeContext'

interface SpeakerPerformanceChartProps {
  predictions: MasterRecord[]
}

export function SpeakerPerformanceChart({ predictions }: SpeakerPerformanceChartProps) {
  const { isDark } = useThemeContext()
  const tooltip = useTooltipStyle(isDark)
  const axisColor = isDark ? '#7da5d8' : '#64748b'
  const gridColor = isDark ? '#1E3A60' : '#e2e8f0'
  const data = speakerPerformanceData(predictions).map(row => ({
    ...row,
    label: getSpeakerDisplayName(row.speaker),
    accuracyDisplay: row.accuracy ?? 0,
    fill: SPEAKER_COLORS[row.speaker] ?? SPEAKER_COLORS.Unknown,
  }))

  if (data.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-center h-[320px] dark:bg-[#162244] dark:border-[#1E3A60]">
        <p className="text-gray-400 dark:text-zinc-600 text-sm">No speaker performance data yet</p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 dark:bg-[#162244] dark:border-[#1E3A60]">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[#1B2A5E] uppercase tracking-wider dark:text-blue-300">
          Speaker Volume vs Accuracy
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-blue-100/65">
          Bars show prediction volume while the line tracks accuracy on judged calls.
        </p>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis yAxisId="left" tick={{ fill: axisColor, fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={value => `${value}%`} tick={{ fill: axisColor, fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={tooltip.contentStyle}
            labelStyle={tooltip.labelStyle}
            itemStyle={tooltip.itemStyle}
            formatter={(value, name) => {
              if (name === 'Accuracy') return [`${value}%`, name]
              return [value, name]
            }}
          />
          <Legend formatter={value => <span style={{ color: isDark ? '#93C5FD' : '#374151', fontSize: 13 }}>{value}</span>} />
          <Bar yAxisId="left" dataKey="total" name="Predictions" radius={[6, 6, 0, 0]}>
            {data.map(entry => (
              <Cell key={entry.speaker} fill={entry.fill} />
            ))}
          </Bar>
          <Line yAxisId="right" type="monotone" dataKey="accuracyDisplay" name="Accuracy" stroke="#B22234" strokeWidth={2.5} dot={{ r: 4, fill: '#B22234' }} activeDot={{ r: 6 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
