import { useState } from 'react'
import { censorText } from './censorText'

interface YouTubePlayerProps {
  url: string
  title: string
  startSeconds?: number | null
}

export const TIMESTAMP_LEAD_IN_SECONDS = 2

export function getPlaybackStartSeconds(startSeconds?: number | null): number | null {
  if (startSeconds == null) return null
  return Math.max(0, Math.floor(startSeconds) - TIMESTAMP_LEAD_IN_SECONDS)
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url)
    return u.searchParams.get('v')
  } catch {
    return null
  }
}

export function YouTubePlayer({ url, title }: YouTubePlayerProps) {
  const [open, setOpen] = useState(false)
  const videoId = extractVideoId(url)
  const censoredTitle = censorText(title)

  if (!videoId) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors dark:text-zinc-500 dark:hover:text-zinc-300"
      >
        ▶ {censoredTitle}
      </a>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="group relative w-full rounded-lg overflow-hidden bg-black aspect-video flex items-center justify-center"
        aria-label={`Play ${censoredTitle}`}
      >
        <img
          src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
          alt={censoredTitle}
          className="w-full h-full object-cover opacity-80 group-hover:opacity-60 transition-opacity"
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-black/70 flex items-center justify-center group-hover:bg-red-600 transition-colors">
            <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5 ml-0.5">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
          <p className="text-white text-xs truncate">{censoredTitle}</p>
        </div>
      </button>
    )
  }

  return (
    <div className="w-full rounded-lg overflow-hidden aspect-video relative">
      <iframe
        src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
        title={censoredTitle}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="w-full h-full"
      />
    </div>
  )
}

/** Compact inline trigger used in PredictionCard expanded view */
export function YouTubeInlinePlayer({ url, title, startSeconds }: YouTubePlayerProps) {
  const [open, setOpen] = useState(false)
  const videoId = extractVideoId(url)
  const censoredTitle = censorText(title)

  if (!videoId) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors dark:text-zinc-500 dark:hover:text-zinc-300"
      >
        ▶ {censoredTitle}
      </a>
    )
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors dark:text-zinc-500 dark:hover:text-zinc-300"
      >
        <span className={`inline-block w-3 h-3 rounded-full flex-shrink-0 ${open ? 'bg-red-500' : 'bg-gray-400 dark:bg-zinc-600'} flex items-center justify-center`}>
          {open
            ? <span className="block w-1.5 h-1.5 bg-white rounded-sm" />
            : <svg viewBox="0 0 24 24" fill="white" className="w-2 h-2 ml-px"><polygon points="5,3 19,12 5,21" /></svg>
          }
        </span>
        <span className="truncate max-w-[280px]">
          {open ? 'Close player' : startSeconds ? `${censoredTitle} · ${formatTime(startSeconds)}` : censoredTitle}
        </span>
      </button>
      {open && (
        <div className="w-full rounded-lg overflow-hidden aspect-video">
          <iframe
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1${startSeconds != null ? `&start=${getPlaybackStartSeconds(startSeconds)}` : ''}`}
            title={censoredTitle}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="w-full h-full"
          />
        </div>
      )}
    </div>
  )
}
