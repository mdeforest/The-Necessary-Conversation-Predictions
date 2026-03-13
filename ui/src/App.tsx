import { useEffect, useState } from 'react'
import { loadData, type AppData } from './data/loader'
import { Header } from './components/layout/Header'
import { TabNav, type Tab } from './components/layout/TabNav'
import { StatsBar } from './components/overview/StatsBar'
import { VerdictChart } from './components/overview/VerdictChart'
import { TimelineChart } from './components/overview/TimelineChart'
import { Leaderboard } from './components/overview/Leaderboard'
import { SpeakersTab } from './components/speakers/SpeakersTab'
import { TopicsTab } from './components/topics/TopicsTab'
import { BrowseTab } from './components/browse/BrowseTab'
import { EpisodesTab } from './components/episodes/EpisodesTab'
import { useTheme } from './hooks/useTheme'
import { ThemeContext } from './context/ThemeContext'

export default function App() {
  const [data, setData] = useState<AppData | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [browseSpeaker, setBrowseSpeaker] = useState<string>('')
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null)
  const { theme, toggle, isDark } = useTheme()

  useEffect(() => {
    loadData().then(setData).catch(console.error)
  }, [])

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-400 dark:text-zinc-600 text-sm">Loading…</div>
      </div>
    )
  }

  return (
    <ThemeContext.Provider value={{ isDark, toggle }}>
      <div className="min-h-screen flex flex-col">
        <Header theme={theme} onToggleTheme={toggle} />
        {!data.hasData && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs text-amber-700 text-center dark:bg-amber-900/20 dark:border-amber-800/40 dark:text-amber-400">
            Pipeline in progress — {data.videos.length} episodes indexed, predictions not yet extracted
          </div>
        )}
        <TabNav active={tab} onChange={setTab} />
        <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-6">
          {tab === 'overview' && (
            <div className="space-y-4">
              <StatsBar predictions={data.predictions} episodeCount={data.videos.length} />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2">
                  <TimelineChart predictions={data.predictions} />
                </div>
                <VerdictChart predictions={data.predictions} />
              </div>
              <Leaderboard
                predictions={data.predictions}
                onSelectSpeaker={() => { setTab('speakers') }}
              />
            </div>
          )}
          {tab === 'speakers' && (
            <SpeakersTab
              predictions={data.predictions}
              onBrowseSpeaker={speaker => { setBrowseSpeaker(speaker); setTab('browse') }}
            />
          )}
          {tab === 'topics' && (
            <TopicsTab
              predictions={data.predictions}
              onSelectTopic={() => setTab('browse')}
            />
          )}
          {tab === 'browse' && (
            <BrowseTab
              predictions={data.predictions}
              initialSpeaker={browseSpeaker}
              onMount={() => setBrowseSpeaker('')}
              onNavigateToEpisode={videoId => { setSelectedEpisodeId(videoId); setTab('episodes') }}
            />
          )}
          {tab === 'episodes' && (
            <EpisodesTab
              videos={data.videos}
              predictions={data.predictions}
              selectedId={selectedEpisodeId}
              onSelectId={setSelectedEpisodeId}
            />
          )}
        </main>
      </div>
    </ThemeContext.Provider>
  )
}
