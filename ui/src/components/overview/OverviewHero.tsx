import type { MasterRecord } from '@/types'
import { getAccuracyFromCounts } from '@/types'
import { getSpeakerDisplayName } from '@/components/shared/getSpeakerDisplayName'
import { topicOverviewData } from '@/hooks/usePredictions'

interface OverviewHeroProps {
  predictions: MasterRecord[]
  episodeCount: number
}

function formatEpisodeDate(value: string | undefined) {
  if (!value) return 'No episode date yet'

  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function OverviewHero({ predictions, episodeCount }: OverviewHeroProps) {
  const total = predictions.length
  const trueCount = predictions.filter(p => p.verdict === 'true').length
  const partialCount = predictions.filter(p => p.verdict === 'partially true').length
  const falseCount = predictions.filter(p => p.verdict === 'false').length
  const pendingCount = predictions.filter(p => p.verdict === 'pending').length
  const accuracy = getAccuracyFromCounts({
    true: trueCount,
    'partially true': partialCount,
    false: falseCount,
  })

  const latestEpisodeDate = predictions
    .map(p => p.episode_date)
    .sort((a, b) => b.localeCompare(a))[0]

  const speakerCounts: Record<string, number> = {}
  for (const prediction of predictions) {
    speakerCounts[prediction.speaker] = (speakerCounts[prediction.speaker] ?? 0) + 1
  }

  const mostActiveSpeaker = Object.entries(speakerCounts)
    .sort((a, b) => b[1] - a[1])[0]

  const topTopic = topicOverviewData(predictions)[0]
  const resolutionRate = total > 0 ? Math.round(((trueCount + partialCount + falseCount) / total) * 100) : 0

  const heroStats = [
    { label: 'Resolved', value: `${resolutionRate}%`, hint: `${total - pendingCount} of ${total} judged` },
    { label: 'Accuracy', value: accuracy !== null ? `${accuracy}%` : '—', hint: `${trueCount + partialCount} right or partial` },
    { label: 'Most Active', value: mostActiveSpeaker ? getSpeakerDisplayName(mostActiveSpeaker[0]) : '—', hint: mostActiveSpeaker ? `${mostActiveSpeaker[1]} predictions logged` : 'No speaker data yet' },
    { label: 'Top Topic', value: topTopic?.topic ?? '—', hint: topTopic ? `${topTopic.total} predictions tracked` : 'No topic data yet' },
  ]

  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(178,34,52,0.18),_transparent_28%),linear-gradient(135deg,_#fff8f0_0%,_#ffffff_42%,_#eef4ff_100%)] p-5 shadow-sm dark:border-[#1E3A60] dark:bg-[radial-gradient(circle_at_top_left,_rgba(178,34,52,0.22),_transparent_28%),linear-gradient(135deg,_#10214a_0%,_#162244_46%,_#0d1835_100%)] sm:p-6">
      <div className="absolute -right-10 top-0 h-32 w-32 rounded-full bg-[#B22234]/10 blur-3xl dark:bg-[#B22234]/20" />
      <div className="absolute bottom-0 left-1/3 h-28 w-28 rounded-full bg-sky-400/10 blur-3xl dark:bg-sky-300/10" />

      <div className="relative grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
        <div className="space-y-4">
          <div className="inline-flex rounded-full border border-[#B22234]/20 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#B22234] backdrop-blur dark:border-blue-300/10 dark:bg-white/5 dark:text-blue-200">
            Overview
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight text-[#13295a] dark:text-white sm:text-3xl">
              A clearer view of prediction trends and outcomes.
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-blue-100/80">
              {episodeCount.toLocaleString()} episodes have produced {total.toLocaleString()} tracked predictions. The latest episode in this dataset is from {formatEpisodeDate(latestEpisodeDate)}.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {heroStats.map(stat => (
              <div key={stat.label} className="rounded-xl border border-slate-200/80 bg-white/70 p-4 backdrop-blur dark:border-white/10 dark:bg-white/5">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500 dark:text-blue-100/60">{stat.label}</p>
                <p className="mt-2 text-xl font-semibold text-[#13295a] dark:text-white">{stat.value}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-blue-100/70">{stat.hint}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <div className="rounded-xl border border-slate-200/80 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-blue-100/60">Call Quality</p>
            <p className="mt-2 text-3xl font-semibold text-[#13295a] dark:text-white">{trueCount + partialCount}</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-blue-100/75">predictions were at least directionally right</p>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-blue-100/60">Misses</p>
            <p className="mt-2 text-3xl font-semibold text-[#13295a] dark:text-white">{falseCount}</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-blue-100/75">predictions were clearly wrong</p>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-blue-100/60">Still Open</p>
            <p className="mt-2 text-3xl font-semibold text-[#13295a] dark:text-white">{pendingCount}</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-blue-100/75">predictions are waiting on enough evidence</p>
          </div>
        </div>
      </div>
    </section>
  )
}
