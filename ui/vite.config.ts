import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'node:fs'

const DATA_DIR = path.resolve(__dirname, '../data')
const OVERRIDES_PATH = path.join(DATA_DIR, 'prediction_speaker_overrides.json')
const CORRECTIONS_PATH = path.join(DATA_DIR, 'speaker_corrections.json')
const TRANSCRIPTS_DIR = path.join(DATA_DIR, 'transcripts')
const VIDEOS_PATH = path.join(DATA_DIR, 'videos.json')
const REVIEW_STATUS_PATH = path.join(DATA_DIR, 'review_status.json')
const PREDICTIONS_DIR = path.join(DATA_DIR, 'predictions')
const FACT_CHECKS_DIR = path.join(DATA_DIR, 'fact_checks')

const PODCAST_DESCRIPTION = (
  "The Necessary Conversation is a podcast that explores deep political and ideological divides within a single family — "
  + "often described as 'family therapy through politics.' It is hosted by novelist Chad Kultgen and his sister Haley Popp, "
  + "who engage in recurring, unfiltered, and often heated debates with their conservative parents, Mary Lou and Bob Kultgen. "
  + "Topics typically include US politics, culture war issues, religion, and social policy."
)

const EXTRACTION_SYSTEM_PROMPT = `You are an expert analyst identifying falsifiable predictions in podcast transcripts.

ABOUT THE PODCAST:
${PODCAST_DESCRIPTION}

WHAT COUNTS AS A PREDICTION:
A prediction is a specific, forward-looking claim that can eventually be proven true or false. It must assert that something WILL happen (or will NOT happen).

✓ Good examples:
- "I think the Fed will cut rates at least twice before the end of 2024"
- "Tesla's stock will hit $400 within 18 months"
- "There will be a recession by mid-2025"

✗ Exclude these:
- Opinions with no falsifiable outcome: "I think the economy is doing poorly"
- Historical statements: "inflation peaked in 2022"
- General wishes or hopes: "we need to fix the healthcare system"
- Vague non-committal language: "things might get better eventually"
- Conditional hypotheticals with no stated belief: "if inflation rises, that COULD hurt markets"

HEDGING LANGUAGE GUIDE:
✓ Include predictions with: "I think X will...", "I expect...", "my bet is...", "I'm predicting...", "I believe X is going to...", "I'd be surprised if X doesn't..."
✗ Exclude speculation framed as: "I wonder if...", "what if...", "could we see...", "it's possible that...", "one scenario is...", "hypothetically..."

For conditional predictions ("if X, then Y"), only include them if the speaker clearly believes X will happen, or if the outcome Y is independently falsifiable.

You must return a JSON object with a "predictions" array. Each prediction must have:
- "speaker": the name of the person making the prediction (or "Unknown" if unclear)
- "timestamp_seconds": the integer timestamp in seconds from the [Xs] marker on the line where the prediction begins — copy it exactly, do not estimate
- "prediction": the prediction stated clearly and concisely in 1-3 sentences, in the speaker's voice
- "context": 1-2 sentences of surrounding context explaining WHY the speaker made this prediction
- "topic": one of: politics, economy, tech, sports, culture, science, geopolitics, other
- "timeframe": when the speaker expects this to resolve — e.g. "by end of 2024", "within 5 years", "before next election", "unspecified"
- "specificity": one of: "high" (clear measurable outcome), "medium" (directional but vague), "low" (very vague — borderline)

Only include "low" specificity predictions if they are still genuinely falsifiable. When in doubt, leave it out — prefer precision over recall. It is better to miss a borderline prediction than to include a non-falsifiable opinion.

SPEAKER NAMES: Use the most complete version of the name you can infer from context (e.g., "John Smith" not "John" or "the guest"). If the transcript has no speaker labels, infer speaker identity from context. Use "Host" or "Guest" as a last resort, not "Unknown".

DEDUPLICATION: If the same prediction is made more than once, include it only once. Use the earliest timestamp.

Return ONLY the JSON object, no other text.`

const EXTRACTION_PROMPT_TEMPLATE = `Analyze the following podcast transcript and extract all genuine predictions. Remember: only include claims that are forward-looking, specific enough to eventually verify, and where the speaker is asserting their actual belief — not just exploring a hypothetical.

When filling in the "timeframe" field, anchor relative dates to the episode's recording date. For example, if the episode was recorded in March 2023 and the speaker says "by next year", the timeframe should be "by end of 2024".

{speaker_note}

Episode: {title}
Recorded: {date}

Transcript:
{transcript}`

const SPEAKER_NOTE_LABELED = `SPEAKER LABELS: This transcript has been speaker-diarized. Each line is prefixed with [Speaker Name]. Use these labels directly for the "speaker" field — do not guess or infer from context when a label is present. The known speakers are Chad Kultgen, Haley Popp, Mary Lou Kultgen, and Bob Kultgen.`
const SPEAKER_NOTE_UNLABELED = `SPEAKER LABELS: This transcript has no speaker labels. Infer speaker identity from context: names used in conversation, topic stances (Chad and Haley are progressive hosts; Mary Lou and Bob Kultgen are conservative parents). Use full names when inferable.`

const FACT_CHECK_JSON_REMINDER = (
  '\n\nYou MUST respond with ONLY a JSON object in exactly this format, no other text:\n'
  + '{"verdict": "true|partially true|false|pending|unverifiable", "confidence": "high|medium|low", '
  + '"explanation": "3-5 sentences", "sources": ["url1", "url2"]}'
)

function buildFactCheckSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10)
  return `You are a rigorous fact-checker verifying predictions made on a podcast.
Today's date is ${today}. Use this to determine whether a prediction's timeframe has elapsed.

ABOUT THE PODCAST:
${PODCAST_DESCRIPTION}

VERDICTS — use exactly one:
- "true": The prediction clearly came true. There is solid evidence it happened as stated.
- "false": The prediction clearly did not come true. There is solid evidence against it.
- "pending": The prediction's timeframe has not yet passed, OR the outcome is expected but not yet known.
- "unverifiable": The prediction is too vague to assess, or no reliable public evidence exists.
- "partially true": Some aspects came true, but others did not, or the outcome is mixed.

RESEARCH STRATEGY:
1. Search for the core claim directly.
2. Search for counter-evidence.
3. If ambiguous, search for the most recent news on the topic.
4. Do at least 2 searches, up to 5 for complex claims.
5. For predictions with a specific timeframe, check whether that window has passed.
6. If a prediction depends on whether a named person is still in office, still a candidate, or still alive, verify that explicitly.
7. If something had to happen before a person left office and did not, the verdict is "false", not "pending".

TEMPORAL ACCURACY RULES:
- Never assume a current officeholder from stale knowledge or from the episode context.
- When mentioning a current officeholder, verify it and use exact dates when they matter.

CONFIDENCE:
- "high": Multiple reliable sources agree. The outcome is clear-cut.
- "medium": Some evidence, but sources conflict or evidence is indirect.
- "low": Limited or ambiguous evidence.

SOURCE QUALITY:
- High reliability: Official sources, Reuters, AP, BBC, major newspapers, peer-reviewed publications
- Medium reliability: Regional news, trade publications, established data sites
- Low reliability: Blogs, opinion pieces, social media, forums

After researching, return a JSON object with:
- "verdict": one of "true", "partially true", "false", "pending", "unverifiable"
- "confidence": one of "high", "medium", "low"
- "explanation": 3-5 sentences
- "sources": list of URLs that directly support your verdict

Return ONLY the JSON object, no other text.`
}

function buildFactCheckUserPrompt(prediction: any, video: any, neutral = false): string {
  const episodeDate = video?.published_at ?? 'Unknown date'
  const timeframe = prediction?.timeframe ?? 'unspecified'
  const topic = prediction?.topic ?? ''
  const specificity = prediction?.specificity ?? ''
  const text = prediction?.prediction ?? ''

  if (neutral) {
    return (
      "For journalism fact-checking research, please verify whether the following claim came true.\n"
      + `Date the claim was made: ${episodeDate}\n`
      + `Topic area: ${topic}\n`
      + `Predicted timeframe: ${timeframe}\n`
      + `Claim: ${text}\n\n`
      + "Search for factual evidence about whether this occurred. Focus only on verifiable public facts."
      + FACT_CHECK_JSON_REMINDER
    )
  }

  return (
    `Prediction from podcast episode recorded on ${episodeDate}:\n`
    + `Speaker: ${prediction?.speaker ?? 'Unknown'}\n`
    + `Topic: ${topic}\n`
    + `Predicted timeframe: ${timeframe}\n`
    + `Specificity: ${specificity}\n`
    + `Prediction: ${text}\n`
    + `Context: ${prediction?.context ?? ''}\n\n`
    + "Search the web to determine whether this prediction came true. "
    + "Consider whether the predicted timeframe has passed. "
    + "Search for both supporting and contradicting evidence. "
    + "If specificity is 'low', consider whether the prediction is verifiable at all before searching."
    + FACT_CHECK_JSON_REMINDER
  )
}

function buildExtractionUserPrompt(video: any, transcript: any): string {
  const isDiarized = transcript?.diarized === true
  const speakerNote = isDiarized ? SPEAKER_NOTE_LABELED : SPEAKER_NOTE_UNLABELED
  const segments = Array.isArray(transcript?.segments) ? transcript.segments : []
  let transcriptText = ''

  if (segments.length > 0) {
    const lines = []
    for (const segment of segments) {
      const t = Number(segment?.start ?? 0) | 0
      const speaker = typeof segment?.speaker === 'string' ? segment.speaker : ''
      const text = String(segment?.text ?? '').trim()
      if (!text) continue
      const prefix = speaker ? `[${speaker}] ` : ''
      lines.push(`[${t}s] ${prefix}${text}`)
    }
    transcriptText = lines.join('\n').slice(0, 150000)
  } else {
    transcriptText = String(transcript?.full_text ?? '').slice(0, 150000)
  }

  return EXTRACTION_PROMPT_TEMPLATE
    .replace('{speaker_note}', speakerNote)
    .replace('{title}', video?.title ?? '')
    .replace('{date}', video?.published_at ?? 'Unknown')
    .replace('{transcript}', transcriptText)
}

function normalizeReviewEntry(entry: unknown): { reviewed: boolean; flagged: boolean; notes: string } {
  if (entry === true) return { reviewed: true, flagged: false, notes: '' }
  if (!entry || typeof entry !== 'object') return { reviewed: false, flagged: false, notes: '' }

  const value = entry as { reviewed?: unknown; flagged?: unknown; notes?: unknown }
  return {
    reviewed: value.reviewed === true,
    flagged: value.flagged === true,
    notes: typeof value.notes === 'string' ? value.notes : '',
  }
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}

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
                    readJson<Record<string, Record<string, string>>>(CORRECTIONS_PATH, {})
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

function transcriptReviewPlugin(): Plugin {
  return {
    name: 'transcript-review',
    configureServer(server) {
      server.middlewares.use('/api/transcript-review', (req: any, res: any) => {
        const url = new URL(req.url ?? '/', 'http://localhost')

        if (req.method === 'GET') {
          const videoId = url.searchParams.get('video_id')

          if (!videoId) {
            const videos = readJson<any[]>(VIDEOS_PATH, [])
            const entries = videos
              .map(v => {
                const transcriptPath = path.join(TRANSCRIPTS_DIR, `${v.id}.json`)
                const transcript = readJson<any>(transcriptPath, {})
                const segments = Array.isArray(transcript.segments) ? transcript.segments : []
                const unknownLabels = Array.from(new Set(
                  segments
                    .map((s: any) => s?.speaker)
                    .filter((speaker: unknown) => typeof speaker === 'string' && /^SPEAKER_\d+$/.test(speaker as string)),
                ))
                return {
                  id: v.id,
                  title: v.title,
                  published_at: v.published_at,
                  has_transcript: fs.existsSync(transcriptPath),
                  diarized: transcript.diarized === true,
                  unknown_labels: unknownLabels,
                }
              })

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ videos: entries }))
            return
          }

          const transcriptPath = path.join(TRANSCRIPTS_DIR, `${videoId}.json`)
          const transcript = readJson<any>(transcriptPath, {})
          const corrections = readJson<Record<string, Record<string, string>>>(CORRECTIONS_PATH, {})
          const video = readJson<any[]>(VIDEOS_PATH, []).find(v => v.id === videoId) ?? null

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            video,
            transcript: {
              exists: fs.existsSync(transcriptPath),
              diarized: transcript.diarized === true,
              segments: Array.isArray(transcript.segments) ? transcript.segments : [],
            },
            corrections: corrections[videoId] ?? {},
          }))
          return
        }

        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString() })
          req.on('end', () => {
            try {
              const { video_id, corrections } = JSON.parse(body) as {
                video_id: string
                corrections: Record<string, string>
              }

              if (!video_id || !corrections || typeof corrections !== 'object') {
                throw new Error('video_id and corrections are required')
              }

              const allCorrections = readJson<Record<string, Record<string, string>>>(CORRECTIONS_PATH, {})
              allCorrections[video_id] = Object.fromEntries(
                Object.entries(corrections)
                  .filter(([label]) => /^SPEAKER_\d+$/.test(label))
                  .map(([label, speaker]) => [label, String(speaker ?? '').trim()]),
              )
              fs.writeFileSync(CORRECTIONS_PATH, JSON.stringify(allCorrections, null, 2))

              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true }))
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

function reviewStatusPlugin(): Plugin {
  return {
    name: 'review-status',
    configureServer(server) {
      server.middlewares.use('/api/review-status', (req: any, res: any) => {
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json')
          const raw = readJson<Record<string, unknown>>(REVIEW_STATUS_PATH, {})
          const normalized = Object.fromEntries(
            Object.entries(raw).map(([videoId, entry]) => [videoId, normalizeReviewEntry(entry)])
          )
          res.end(JSON.stringify(normalized))
          return
        }

        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString() })
          req.on('end', () => {
            try {
              const { video_id, reviewed, flagged, notes } = JSON.parse(body) as {
                video_id: string
                reviewed: boolean
                flagged?: boolean
                notes?: string
              }

              if (!video_id || typeof reviewed !== 'boolean') {
                throw new Error('video_id and reviewed are required')
              }

              const reviewStatus = readJson<Record<string, unknown>>(REVIEW_STATUS_PATH, {})
              const current = normalizeReviewEntry(reviewStatus[video_id])
              reviewStatus[video_id] = {
                reviewed,
                flagged: typeof flagged === 'boolean' ? flagged : current.flagged,
                notes: typeof notes === 'string' ? notes : current.notes,
              }
              fs.writeFileSync(REVIEW_STATUS_PATH, JSON.stringify(reviewStatus, null, 2))

              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, review: reviewStatus[video_id] }))
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

function predictionEditorPlugin(): Plugin {
  return {
    name: 'prediction-editor',
    configureServer(server) {
      server.middlewares.use('/api/prediction-editor', (req: any, res: any) => {
        const url = new URL(req.url ?? '/', 'http://localhost')

        if (req.method === 'GET') {
          const videoId = url.searchParams.get('video_id')
          if (!videoId) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'video_id is required' }))
            return
          }

          const predictionPath = path.join(PREDICTIONS_DIR, `${videoId}.json`)
          const factCheckPath = path.join(FACT_CHECKS_DIR, `${videoId}.json`)
          const predictionData = readJson<{ video_id?: string; predictions?: any[] }>(predictionPath, { video_id: videoId, predictions: [] })
          const factCheckData = readJson<{ video_id?: string; fact_checks?: any[] }>(factCheckPath, { video_id: videoId, fact_checks: [] })
          const factChecksById = new Map(
            (factCheckData.fact_checks ?? []).map(factCheck => [factCheck.prediction_id, factCheck]),
          )

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            video_id: videoId,
            predictions: (predictionData.predictions ?? []).map(prediction => ({
              prediction,
              fact_check: factChecksById.get(prediction.id) ?? null,
            })),
          }))
          return
        }

        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString() })
          req.on('end', () => {
            try {
              const { video_id, prediction_id, prediction, fact_check } = JSON.parse(body) as {
                video_id: string
                prediction_id: string
                prediction: Record<string, unknown>
                fact_check?: Record<string, unknown> | null
              }

              if (!video_id || !prediction_id || !prediction || typeof prediction !== 'object') {
                throw new Error('video_id, prediction_id, and prediction are required')
              }

              const predictionPath = path.join(PREDICTIONS_DIR, `${video_id}.json`)
              const factCheckPath = path.join(FACT_CHECKS_DIR, `${video_id}.json`)
              const predictionData = readJson<{ video_id?: string; predictions?: any[] }>(predictionPath, { video_id, predictions: [] })
              const factCheckData = readJson<{ video_id?: string; fact_checks?: any[] }>(factCheckPath, { video_id, fact_checks: [] })
              const predictionIndex = (predictionData.predictions ?? []).findIndex(item => item.id === prediction_id)
              if (predictionIndex < 0) throw new Error(`Prediction ${prediction_id} not found`)

              const existingPrediction = predictionData.predictions![predictionIndex]
              const nextPrediction = { ...existingPrediction, ...prediction, id: existingPrediction.id, video_id }
              const predictionChangedFields = ['prediction', 'context', 'topic', 'timeframe', 'specificity', 'timestamp_seconds']
              const predictionChanged = predictionChangedFields.some(field => JSON.stringify(existingPrediction[field]) !== JSON.stringify(nextPrediction[field]))
              predictionData.predictions![predictionIndex] = nextPrediction
              fs.writeFileSync(predictionPath, JSON.stringify(predictionData, null, 2))

              const nextFactChecks = [...(factCheckData.fact_checks ?? [])]
              const factCheckIndex = nextFactChecks.findIndex(item => item.prediction_id === prediction_id)
              let nextFactCheck: Record<string, unknown> | null = fact_check ? { ...fact_check, prediction_id } : (factCheckIndex >= 0 ? nextFactChecks[factCheckIndex] : null)

              if (predictionChanged) {
                nextFactCheck = {
                  prediction_id,
                  verdict: 'pending',
                  confidence: 'low',
                  explanation: 'Prediction updated and needs to be fact-checked again.',
                  sources: [],
                  date_generated: null,
                }
              } else if (nextFactCheck) {
                nextFactCheck = {
                  ...nextFactCheck,
                  prediction_id,
                  sources: Array.isArray(nextFactCheck.sources) ? nextFactCheck.sources : [],
                }
              }

              if (nextFactCheck) {
                if (factCheckIndex >= 0) nextFactChecks[factCheckIndex] = nextFactCheck
                else nextFactChecks.push(nextFactCheck)
              }

              fs.writeFileSync(factCheckPath, JSON.stringify({ video_id, fact_checks: nextFactChecks }, null, 2))

              if (predictionChanged) {
                const reviewStatus = readJson<Record<string, unknown>>(REVIEW_STATUS_PATH, {})
                const current = normalizeReviewEntry(reviewStatus[video_id])
                reviewStatus[video_id] = {
                  ...current,
                  reviewed: false,
                }
                fs.writeFileSync(REVIEW_STATUS_PATH, JSON.stringify(reviewStatus, null, 2))
              }

              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({
                ok: true,
                prediction: nextPrediction,
                fact_check: nextFactCheck,
                reopened_for_fact_check: predictionChanged,
              }))
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

function promptPreviewPlugin(): Plugin {
  return {
    name: 'prompt-preview',
    configureServer(server) {
      server.middlewares.use('/api/prompt-preview', (req: any, res: any) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end()
          return
        }

        try {
          const videoId = url.searchParams.get('video_id')
          const predictionId = url.searchParams.get('prediction_id')
          const type = url.searchParams.get('type')
          const neutral = url.searchParams.get('neutral') === '1'

          if (!videoId || !type) throw new Error('video_id and type are required')

          const videos = readJson<any[]>(VIDEOS_PATH, [])
          const video = videos.find(item => item.id === videoId) ?? { id: videoId, title: videoId, published_at: 'Unknown' }

          let system = ''
          let user = ''

          if (type === 'extract') {
            const transcriptPath = path.join(TRANSCRIPTS_DIR, `${videoId}.json`)
            const transcript = readJson<any>(transcriptPath, {})
            system = EXTRACTION_SYSTEM_PROMPT
            user = buildExtractionUserPrompt(video, transcript)
          } else if (type === 'fact_check') {
            if (!predictionId) throw new Error('prediction_id is required for fact_check')
            const predictionPath = path.join(PREDICTIONS_DIR, `${videoId}.json`)
            const predictionData = readJson<{ predictions?: any[] }>(predictionPath, { predictions: [] })
            const prediction = (predictionData.predictions ?? []).find(item => item.id === predictionId)
            if (!prediction) throw new Error(`Prediction ${predictionId} not found`)
            system = buildFactCheckSystemPrompt()
            user = buildFactCheckUserPrompt(prediction, video, neutral)
          } else {
            throw new Error(`Unsupported prompt type: ${type}`)
          }

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            system,
            user,
            combined: `[SYSTEM]\n${system}\n\n[USER]\n${user}`,
          }))
        } catch (err) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: String(err) }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), speakerOverridesPlugin(), transcriptReviewPlugin(), reviewStatusPlugin(), predictionEditorPlugin(), promptPreviewPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
