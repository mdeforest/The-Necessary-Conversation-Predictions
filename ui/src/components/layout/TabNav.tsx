import clsx from 'clsx'

export type Tab = 'overview' | 'speakers' | 'topics' | 'browse' | 'episodes' | 'transcript'

const TABS: { id: Tab; label: string; devOnly?: boolean }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'speakers', label: 'Speakers' },
  { id: 'topics', label: 'Topics' },
  { id: 'browse', label: 'Browse' },
  { id: 'episodes', label: 'Episodes' },
  { id: 'transcript', label: 'Transcript', devOnly: true },
]

interface TabNavProps {
  active: Tab
  onChange: (tab: Tab) => void
}

export function TabNav({ active, onChange }: TabNavProps) {
  const isDev = import.meta.env.DEV
  const tabs = TABS.filter(tab => isDev || !tab.devOnly)

  return (
    <nav className="border-b border-gray-200 bg-white px-6 dark:border-[#1E3A60] dark:bg-[#0C1A3A]">
      <div className="max-w-7xl mx-auto flex gap-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={clsx(
              'px-4 py-3 text-sm font-medium border-b-2 transition-colors',
              active === tab.id
                ? 'border-[#B22234] text-[#B22234] dark:border-red-500 dark:text-red-400'
                : 'border-transparent text-gray-500 hover:text-[#1B2A5E] hover:border-[#1B2A5E]/30 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:border-zinc-600',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </nav>
  )
}
