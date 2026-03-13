import type { MasterRecord } from '@/types'
import { KNOWN_SPEAKERS } from '@/types'
import { SpeakerCard } from './SpeakerCard'

interface SpeakersTabProps {
  predictions: MasterRecord[]
  onBrowseSpeaker?: (speaker: string) => void
}

export function SpeakersTab({ predictions, onBrowseSpeaker }: SpeakersTabProps) {
  if (predictions.length === 0) {
    return (
      <div className="text-center py-20 text-gray-400 dark:text-zinc-600">
        <p>No prediction data yet — pipeline still running.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {KNOWN_SPEAKERS.map(name => (
        <SpeakerCard
          key={name}
          name={name}
          predictions={predictions}
          onBrowse={onBrowseSpeaker ? () => onBrowseSpeaker(name) : undefined}
        />
      ))}
    </div>
  )
}
