import clsx from 'clsx'
import type { Confidence } from '@/types'

const CLASS: Record<Confidence, string> = {
  high: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900',
  medium: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  low: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700',
}

function formatConfidence(confidence: Confidence): string {
  return `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)} confidence`
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', CLASS[confidence])}>
      {formatConfidence(confidence)}
    </span>
  )
}
