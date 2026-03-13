import type { MasterRecord, Video } from '@/types'

export interface AppData {
  predictions: MasterRecord[]
  videos: Video[]
  hasData: boolean
}

export async function loadData(): Promise<AppData> {
  const [videosRes, masterRes] = await Promise.all([
    fetch('/data/videos.json'),
    fetch('/data/predictions_master.json'),
  ])

  const videos: Video[] = videosRes.ok ? await videosRes.json() : []
  const raw: MasterRecord[] = masterRes.ok ? await masterRes.json() : []

  // Normalize speaker names — SPEAKER_XX labels → "Unknown"
  const predictions = raw.map(r => ({
    ...r,
    speaker: normalizeSpeaker(r.speaker),
  }))

  return {
    predictions,
    videos,
    hasData: predictions.length > 0,
  }
}

function normalizeSpeaker(name: string): string {
  if (!name || /^SPEAKER_\d+$/i.test(name)) return 'Unknown'
  return name
}
