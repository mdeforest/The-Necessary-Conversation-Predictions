import type { MasterRecord } from '@/types'
import { getAccuracyFromCounts } from '@/types'

interface StatsBarProps {
  predictions: MasterRecord[]
  episodeCount: number
}

export function StatsBar({ predictions, episodeCount }: StatsBarProps) {
  const total = predictions.length
  const trueCount = predictions.filter(p => p.verdict === 'true').length
  const partiallyTrueCount = predictions.filter(p => p.verdict === 'partially true').length
  const pendingCount = predictions.filter(p => p.verdict === 'pending').length
  const accuracy = getAccuracyFromCounts({
    true: trueCount,
    'partially true': partiallyTrueCount,
    false: predictions.filter(p => p.verdict === 'false').length,
  })

  const speakerTotals: Record<string, number> = {}
  const speakerCorrect: Record<string, number> = {}
  const speakerWrong: Record<string, number> = {}
  for (const p of predictions) {
    speakerTotals[p.speaker] = (speakerTotals[p.speaker] ?? 0) + 1
    if (p.verdict === 'true' || p.verdict === 'partially true') {
      speakerCorrect[p.speaker] = (speakerCorrect[p.speaker] ?? 0) + 1
    } else if (p.verdict === 'false') {
      speakerWrong[p.speaker] = (speakerWrong[p.speaker] ?? 0) + 1
    }
  }

  const topSpeaker = Object.keys(speakerTotals)
    .map(name => {
      const correct = speakerCorrect[name] ?? 0
      const wrong = speakerWrong[name] ?? 0
      const decided = correct + wrong
      const accuracy = getAccuracyFromCounts({ true: correct, false: wrong })

      return {
        name,
        total: speakerTotals[name],
        decided,
        accuracy,
      }
    })
    .filter(speaker => speaker.accuracy !== null)
    .sort((a, b) => {
      if (b.accuracy !== a.accuracy) return (b.accuracy ?? -1) - (a.accuracy ?? -1)
      if (b.decided !== a.decided) return b.decided - a.decided
      if (b.total !== a.total) return b.total - a.total
      return a.name.localeCompare(b.name)
    })[0]

  const stats = [
    { label: 'Episodes', value: episodeCount.toLocaleString() },
    { label: 'Predictions', value: total.toLocaleString() },
    { label: 'Accuracy', value: accuracy !== null ? `${accuracy}%` : '—' },
    { label: 'Pending', value: total > 0 ? pendingCount.toLocaleString() : '—' },
    { label: 'Top Predictor', value: topSpeaker ? topSpeaker.name.split(' ')[0] : '—' },
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
