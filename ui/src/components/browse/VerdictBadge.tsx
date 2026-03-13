import clsx from 'clsx'
import type { Verdict } from '@/types'
import { VERDICT_LABELS } from '@/types'

const CLASS: Record<Verdict, string> = {
  true: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-400 dark:border-green-800',
  false: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-400 dark:border-red-800',
  pending: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-400 dark:border-amber-800',
  unverifiable: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700',
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', CLASS[verdict])}>
      {VERDICT_LABELS[verdict]}
    </span>
  )
}
