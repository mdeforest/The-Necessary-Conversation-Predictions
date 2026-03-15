import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { MasterRecord } from '@/types'
import { SPEAKER_COLORS, KNOWN_SPEAKERS } from '@/types'
import { timelineDataBySpeaker } from '@/hooks/usePredictions'
import { useThemeContext, useTooltipStyle } from '@/context/ThemeContext'
import { getSpeakerDisplayName } from '@/components/shared/getSpeakerDisplayName'

interface TimelineChartProps {
  predictions: MasterRecord[]
}

export function TimelineChart({ predictions }: TimelineChartProps) {
  const { isDark } = useThemeContext()
  const tooltip = useTooltipStyle(isDark)
  const data = timelineDataBySpeaker(predictions)
  const axisColor = isDark ? '#4A7AB5' : '#c4c4c8'

  if (data.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-center h-[288px] dark:bg-[#162244] dark:border-[#1E3A60]">
        <p className="text-gray-400 dark:text-zinc-600 text-sm">No timeline data yet</p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 dark:bg-[#162244] dark:border-[#1E3A60]">
      <h3 className="text-sm font-semibold text-[#1B2A5E] uppercase tracking-wider mb-3 dark:text-blue-300">
        Predictions Over Time
      </h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {KNOWN_SPEAKERS.map(speaker => {
          const color = SPEAKER_COLORS[speaker]
          const total = data.reduce((sum, row) => sum + ((row[speaker] as number) ?? 0), 0)

          return (
            <div key={speaker}>
              <div className="flex items-baseline justify-between mb-0.5 px-0.5">
                <span className="text-xs font-medium" style={{ color }}>
                  {getSpeakerDisplayName(speaker)}
                </span>
                <span className="text-xs text-gray-400 dark:text-zinc-500">{total} total</span>
              </div>
              <ResponsiveContainer width="100%" height={88}>
                <AreaChart data={data} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`grad-${speaker.replace(/\s+/g, '-')}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="10%" stopColor={color} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tick={{ fill: axisColor, fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={d => d.slice(2, 7)}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: axisColor, fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={tooltip.contentStyle}
                    labelStyle={tooltip.labelStyle}
                    itemStyle={{ ...tooltip.itemStyle, color }}
                    formatter={(value: number) => [value, getSpeakerDisplayName(speaker)]}
                  />
                  <Area
                    type="monotone"
                    dataKey={speaker}
                    stroke={color}
                    strokeWidth={1.5}
                    fill={`url(#grad-${speaker.replace(/\s+/g, '-')})`}
                    dot={false}
                    activeDot={{ r: 3, fill: color }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )
        })}
      </div>
    </div>
  )
}
