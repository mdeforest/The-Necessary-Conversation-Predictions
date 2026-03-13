import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'node:fs'

const DATA_DIR = path.resolve(__dirname, '../data')
const OVERRIDES_PATH = path.join(DATA_DIR, 'prediction_speaker_overrides.json')
const CORRECTIONS_PATH = path.join(DATA_DIR, 'speaker_corrections.json')
const TRANSCRIPTS_DIR = path.join(DATA_DIR, 'transcripts')

/**
 * Given a diarized transcript and a timestamp, return the SPEAKER_XX label
 * for the segment that contains (or is nearest to) that timestamp.
 * Returns null if the transcript isn't diarized or no SPEAKER_XX exists there.
 */
function findSpeakerLabel(videoId: string, timestampSeconds: number): string | null {
  const transcriptPath = path.join(TRANSCRIPTS_DIR, `${videoId}.json`)
  if (!fs.existsSync(transcriptPath)) return null

  let transcript: any
  try { transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8')) } catch { return null }
  if (!transcript.diarized || !Array.isArray(transcript.segments)) return null

  const speakerSegs = transcript.segments.filter(
    (s: any) => typeof s.speaker === 'string' && /^SPEAKER_\d+$/.test(s.speaker),
  )
  if (!speakerSegs.length) return null

  // Prefer a segment that fully contains the timestamp
  const exact = speakerSegs.find((s: any) => timestampSeconds >= s.start && timestampSeconds <= s.end)
  if (exact) return exact.speaker

  // Fall back to closest segment boundary
  let best: any = null
  let bestDist = Infinity
  for (const seg of speakerSegs) {
    const dist = Math.min(Math.abs(seg.start - timestampSeconds), Math.abs(seg.end - timestampSeconds))
    if (dist < bestDist) { bestDist = dist; best = seg }
  }
  return best?.speaker ?? null
}

/**
 * Dev-only plugin: exposes a local API for reading/writing speaker overrides.
 * Only active during `vite dev` — not included in production builds.
 *
 * GET  /api/speaker-overrides
 *   → returns current prediction_speaker_overrides.json
 *
 * POST /api/speaker-overrides
 *   body: { prediction_id, speaker, video_id, timestamp_seconds }
 *   → writes prediction_speaker_overrides.json
 *   → also auto-updates speaker_corrections.json if a SPEAKER_XX label is
 *     found at that timestamp in the transcript (so 03c --apply + re-extract
 *     will produce the correct speaker without any manual JSON editing)
 */
function speakerOverridesPlugin(): Plugin {
  return {
    name: 'speaker-overrides',
    configureServer(server) {
      server.middlewares.use('/api/speaker-overrides', (req: any, res: any) => {
        if (req.method === 'GET') {
          const data = fs.existsSync(OVERRIDES_PATH)
            ? fs.readFileSync(OVERRIDES_PATH, 'utf-8')
            : '{}'
          res.setHeader('Content-Type', 'application/json')
          res.end(data)
          return
        }

        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString() })
          req.on('end', () => {
            try {
              const { prediction_id, speaker, video_id, timestamp_seconds } = JSON.parse(body) as {
                prediction_id: string
                speaker: string
                video_id?: string
                timestamp_seconds?: number | null
              }

              // 1. Write prediction_speaker_overrides.json
              const overrides: Record<string, string> = fs.existsSync(OVERRIDES_PATH)
                ? JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf-8'))
                : {}
              overrides[prediction_id] = speaker
              fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2))

              // 2. Auto-update speaker_corrections.json if we can identify the
              //    SPEAKER_XX label at this timestamp in the transcript.
              let correctionApplied = false
              if (video_id && timestamp_seconds != null) {
                const speakerLabel = findSpeakerLabel(video_id, timestamp_seconds)
                if (speakerLabel) {
                  const corrections: Record<string, Record<string, string>> =
                    fs.existsSync(CORRECTIONS_PATH)
                      ? JSON.parse(fs.readFileSync(CORRECTIONS_PATH, 'utf-8'))
                      : {}
                  if (!corrections[video_id]) corrections[video_id] = {}
                  corrections[video_id][speakerLabel] = speaker
                  fs.writeFileSync(CORRECTIONS_PATH, JSON.stringify(corrections, null, 2))
                  correctionApplied = true
                }
              }

              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, correctionApplied }))
            } catch (err) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: String(err) }))
            }
          })
          return
        }

        res.statusCode = 405
        res.end()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), speakerOverridesPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
