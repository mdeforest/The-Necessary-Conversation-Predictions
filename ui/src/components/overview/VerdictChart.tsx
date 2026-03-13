import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { MasterRecord, Verdict } from '@/types'
import { VERDICT_COLORS, VERDICT_LABELS } from '@/types'
import { useThemeContext, useTooltipStyle } from '@/context/ThemeContext'

interface VerdictChartProps {
  predictions: MasterRecord[]
}

export function VerdictChart({ predictions }: VerdictChartProps) {
  const { isDark } = useThemeContext()
  const tooltip = useTooltipStyle(isDark)

  const counts: Record<Verdict, number> = { true: 0, false: 0, pending: 0, unverifiable: 0 }
  for (const p of predictions) counts[p.verdict]++

  const data = (Object.entries(counts) as [Verdict, number][])
    .filter(([, v]) => v > 0)
    .map(([verdict, value]) => ({ name: VERDICT_LABELS[verdict], value, verdict }))

  if (data.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-center h-[288px] dark:bg-[#162244] dark:border-[#1E3A60]">
        <p className="text-gray-400 dark:text-zinc-600 text-sm">No prediction data yet</p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 dark:bg-[#162244] dark:border-[#1E3A60]">
      <h3 className="text-sm font-semibold text-[#1B2A5E] uppercase tracking-wider mb-4 dark:text-blue-300">
        Verdict Breakdown
      </h3>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map(entry => (
              <Cell key={entry.verdict} fill={VERDICT_COLORS[entry.verdict]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltip.contentStyle} labelStyle={tooltip.labelStyle} itemStyle={tooltip.itemStyle} />
          <Legend
            formatter={(value) => (
              <span style={{ color: isDark ? '#93C5FD' : '#374151', fontSize: 13 }}>{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
