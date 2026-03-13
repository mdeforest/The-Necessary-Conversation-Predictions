import type { MasterRecord } from '@/types'

interface StatsBarProps {
  predictions: MasterRecord[]
  episodeCount: number
}

export function StatsBar({ predictions, episodeCount }: StatsBarProps) {
  const total = predictions.length
  const trueCount = predictions.filter(p => p.verdict === 'true').length
  const pendingCount = predictions.filter(p => p.verdict === 'pending').length
  const accuracy = total > 0 ? Math.round((trueCount / total) * 100) : 0

  const speakerTotals: Record<string, number> = {}
  for (const p of predictions) {
    speakerTotals[p.speaker] = (speakerTotals[p.speaker] ?? 0) + 1
  }
  const topSpeaker = Object.entries(speakerTotals).sort((a, b) => b[1] - a[1])[0]

  const stats = [
    { label: 'Episodes', value: episodeCount.toLocaleString() },
    { label: 'Predictions', value: total.toLocaleString() },
    { label: 'Accuracy', value: total > 0 ? `${accuracy}%` : '—' },
    { label: 'Pending', value: total > 0 ? pendingCount.toLocaleString() : '—' },
    { label: 'Top Predictor', value: topSpeaker ? topSpeaker[0].split(' ')[0] : '—' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {stats.map(s => (
        <div key={s.label} className="bg-white border border-gray-200 border-l-[3px] border-l-[#B22234] rounded-lg p-4 dark:bg-[#162244] dark:border-[#1E3A60] dark:border-l-[#B22234]">
          <p className="text-xs text-gray-500 uppercase tracking-wider dark:text-zinc-500">{s.label}</p>
          <p className="text-2xl font-bold text-[#1B2A5E] mt-1 dark:text-zinc-100">{s.value}</p>
        </div>
      ))}
    </div>
  )
}
