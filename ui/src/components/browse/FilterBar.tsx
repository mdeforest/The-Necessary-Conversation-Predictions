import { useState, useRef, useEffect } from 'react'
import type { Filters } from '@/hooks/usePredictions'
import { VERDICT_COLORS, VERDICT_LABELS, VERDICTS } from '@/types'
import type { Verdict } from '@/types'

interface FilterBarProps {
  filters: Filters
  onChange: (f: Filters) => void
  speakers: string[]
  topics: string[]
}

export function FilterBar({ filters, onChange, speakers, topics }: FilterBarProps) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })
  const hasFilters = !!(filters.search || filters.speaker || filters.verdict || filters.topic)

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {/* Search */}
      <div className="relative flex-1 min-w-48">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-zinc-600 pointer-events-none"
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M9 3a6 6 0 100 12A6 6 0 009 3zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
        </svg>
        <input
          type="text"
          placeholder="Search predictions…"
          value={filters.search}
          onChange={e => set({ search: e.target.value })}
          className="w-full bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 transition-colors dark:bg-[#162244] dark:border-[#1E3A60] dark:text-zinc-200 dark:placeholder:text-zinc-600 dark:focus:border-blue-600"
        />
      </div>

      {/* Dropdowns */}
      <FilterSelect
        value={filters.speaker}
        onChange={v => set({ speaker: v })}
        placeholder="Speaker"
        options={speakers.map(s => ({ value: s, label: s.split(' ')[0] }))}
      />
      <FilterSelect
        value={filters.verdict}
        onChange={v => set({ verdict: v as Verdict | '' })}
        placeholder="Verdict"
        options={VERDICTS.map(v => ({ value: v, label: VERDICT_LABELS[v], dot: VERDICT_COLORS[v] }))}
      />
      <FilterSelect
        value={filters.topic}
        onChange={v => set({ topic: v })}
        placeholder="Topic"
        options={topics.map(t => ({ value: t, label: t }))}
      />

      {/* Clear */}
      {hasFilters && (
        <button
          onClick={() => onChange({ speaker: '', verdict: '', topic: '', confidence: '', specificity: '', search: '' })}
          className="flex items-center gap-1 px-3 py-2 text-xs text-gray-500 hover:text-gray-700 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors dark:text-zinc-500 dark:hover:text-zinc-300 dark:border-[#1E3A60] dark:hover:border-zinc-600"
        >
          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
          Clear
        </button>
      )}
    </div>
  )
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  options: { value: string; label: string; dot?: string }[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isActive = !!value
  const selected = options.find(o => o.value === value)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={[
          'flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors whitespace-nowrap',
          isActive
            ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-950/40 dark:border-blue-700 dark:text-blue-300'
            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-800 dark:bg-[#162244] dark:border-[#1E3A60] dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200',
        ].join(' ')}
      >
        {selected?.dot && (
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: selected.dot }} />
        )}
        <span>{selected ? selected.label : placeholder}</span>
        <svg
          className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${isActive ? 'text-blue-500 dark:text-blue-400' : 'text-gray-400 dark:text-zinc-600'}`}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-20 top-full mt-1 left-0 min-w-full w-max bg-white border border-gray-200 rounded-lg shadow-lg py-1 dark:bg-[#0F1B36] dark:border-[#1E3A60]">
          {/* Clear option */}
          {value && (
            <>
              <button
                onClick={() => { onChange(''); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors dark:text-zinc-600 dark:hover:text-zinc-400 dark:hover:bg-white/5"
              >
                All {placeholder.toLowerCase()}s
              </button>
              <div className="my-1 border-t border-gray-100 dark:border-[#1E3A60]" />
            </>
          )}
          {options.map(o => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={[
                'w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left',
                o.value === value
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                  : 'text-gray-700 hover:bg-gray-50 dark:text-zinc-300 dark:hover:bg-white/5',
              ].join(' ')}
            >
              {o.dot && (
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: o.dot }} />
              )}
              {o.label}
              {o.value === value && (
                <svg className="w-3.5 h-3.5 ml-auto text-blue-500 dark:text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
