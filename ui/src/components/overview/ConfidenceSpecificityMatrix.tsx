import { Fragment } from 'react'
import type { MasterRecord, Confidence, Specificity } from '@/types'
import { confidenceSpecificityMatrix } from '@/hooks/usePredictions'

interface ConfidenceSpecificityMatrixProps {
  predictions: MasterRecord[]
}

const SPECIFICITY_LABELS: Record<Specificity, string> = {
  high: 'High specificity',
  medium: 'Medium specificity',
  low: 'Low specificity',
}

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
}

function getCellTone(count: number, max: number) {
  if (max === 0) return 'bg-slate-100 text-slate-500 dark:bg-[#10214a] dark:text-blue-100/60'
  const intensity = count / max
  if (intensity > 0.66) return 'bg-[#B22234] text-white'
  if (intensity > 0.33) return 'bg-amber-100 text-amber-950 dark:bg-amber-400/20 dark:text-amber-100'
  return 'bg-sky-100 text-sky-950 dark:bg-sky-400/15 dark:text-sky-100'
}

export function ConfidenceSpecificityMatrix({ predictions }: ConfidenceSpecificityMatrixProps) {
  const { rows, omitted, included } = confidenceSpecificityMatrix(predictions)
  const maxCount = Math.max(...rows.flatMap(row => row.cells.map(cell => cell.count)), 0)

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 dark:bg-[#162244] dark:border-[#1E3A60]">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[#1B2A5E] uppercase tracking-wider dark:text-blue-300">
          Confidence vs Specificity
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-blue-100/65">
          A quick read on whether the strongest claims are also the most detailed.
        </p>
        {omitted > 0 && (
          <p className="mt-2 text-xs text-slate-500 dark:text-blue-100/60">
            Showing {included.toLocaleString()} records with both fields present. {omitted.toLocaleString()} were omitted.
          </p>
        )}
      </div>
      <div className="grid grid-cols-[auto_repeat(3,minmax(0,1fr))] gap-2 text-xs">
        <div />
        {(['high', 'medium', 'low'] as Specificity[]).map(level => (
          <div key={level} className="px-2 py-1 text-center font-medium text-slate-500 dark:text-blue-100/65">
            {SPECIFICITY_LABELS[level]}
          </div>
        ))}

        {rows.map(row => (
          <Fragment key={row.confidence}>
            <div key={`${row.confidence}-label`} className="flex items-center px-2 py-3 font-medium text-slate-600 dark:text-blue-100/75">
              {CONFIDENCE_LABELS[row.confidence]}
            </div>
            {row.cells.map(cell => (
              <div
                key={`${row.confidence}-${cell.specificity}`}
                className={`rounded-xl p-3 ${getCellTone(cell.count, maxCount)}`}
              >
                <p className="text-lg font-semibold">{cell.count}</p>
                <p className="mt-1 opacity-80">{cell.share}% of {row.confidence} confidence calls</p>
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
