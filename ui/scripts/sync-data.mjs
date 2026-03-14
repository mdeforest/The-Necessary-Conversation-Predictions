/**
 * Copies data files from ../data/ into public/data/ so Vite can serve them.
 * If a section has no real data, generates plausible fake data in its place.
 * Fake data is written ONLY to public/data/ — never to ../data/.
 * Run before `vite dev` or `vite build`.
 */
import { copyFile, readdir, writeFile, readFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_SRC = path.resolve(__dirname, '../../data')
const DATA_DEST = path.resolve(__dirname, '../public/data')

const FORCE_FAKE = process.argv.includes('--fake')
const LIFECYCLE_EVENT = process.env.npm_lifecycle_event ?? ''
const INCLUDE_IN_PROGRESS_VIDEOS = LIFECYCLE_EVENT.startsWith('dev')

await mkdir(DATA_DEST, { recursive: true })

// ─── Seeded pseudo-random (stable across re-runs) ────────────────────────────

let seed = 42
function seededRand() {
  seed = (seed * 1664525 + 1013904223) & 0xffffffff
  return (seed >>> 0) / 0xffffffff
}
function seededPick(arr) {
  return arr[Math.floor(seededRand() * arr.length)]
}
function seededInt(min, max) {
  return Math.floor(seededRand() * (max - min + 1)) + min
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SPEAKERS = ['Chad Kultgen', 'Haley Popp', 'Mary Lou Kultgen', 'Bob Kultgen']

const TOPICS = [
  'US Politics / Elections',
  'Economy / Finance',
  'Technology',
  'Foreign Policy',
  'Climate / Environment',
  'Culture / Society',
  'Criminal Justice',
  'Healthcare',
  'Education',
]

const VERDICTS = ['true', 'partially true', 'false', 'pending', 'unverifiable']
// Weighted: mostly pending for realism (pipeline not done), some true/false/partial
const VERDICT_WEIGHTS = [0.2, 0.12, 0.23, 0.3, 0.15]

const TIMEFRAMES = [
  'by end of 2024',
  'within 6 months',
  'by 2025',
  'before the next election',
  'within the next year',
  'in the next 90 days',
  'by the end of this administration',
  'within 2 years',
]

const SPECIFICITIES = ['high', 'medium', 'low']

const FAKE_PREDICTIONS = [
  'The Republican Party will shift significantly toward protectionist trade policies.',
  'Democrats will win the majority of swing-state gubernatorial races next cycle.',
  "Inflation will return to the Fed's 2% target within 18 months.",
  'A third-party candidate will receive more than 10% of the popular vote.',
  'The Supreme Court will overturn a major precedent on executive power.',
  'Congress will pass bipartisan infrastructure legislation before the midterms.',
  'The stock market will enter a bear market before the end of the year.',
  'Elon Musk will face significant regulatory action from the FTC or SEC.',
  'AI regulation will become a major federal legislative priority.',
  'A major US city will declare a climate emergency and enact binding policy.',
  'The United States will re-enter the Paris Climate Agreement provisions.',
  'Social media companies will face antitrust breakups within five years.',
  'Border crossing numbers will decline sharply after new policy changes.',
  'The filibuster will be reformed or eliminated in the next Senate session.',
  'A new major political party will form and win congressional seats.',
  'Gas prices will drop below $3 nationally by summer.',
  'Student loan forgiveness will be struck down completely by the courts.',
  'TikTok will be banned or forcibly sold in the United States.',
  'The unemployment rate will rise above 5% within a year.',
  'A major foreign policy crisis will dominate the election cycle.',
  'The housing market will see a significant correction in coastal cities.',
  'Prescription drug price controls will pass into law.',
  'A major tech company will collapse or be acquired under pressure.',
  'Voter turnout will break records in the next general election.',
  'The national debt ceiling will cause a government shutdown.',
]

const FAKE_CONTEXTS = [
  'During a heated debate about the future direction of the Republican Party.',
  'In response to recent polling data showing shifting voter priorities.',
  'After discussing the latest economic indicators and Fed announcements.',
  'Following a discussion about recent Supreme Court decisions.',
  'While analyzing the current state of bipartisan cooperation in Congress.',
  'After reviewing the latest geopolitical developments.',
  'During a broader conversation about generational political shifts.',
  'In the context of discussing recent protest movements and their impact.',
  'After debating the effectiveness of current economic policy.',
  'While discussing the implications of recent primary election results.',
]

const FAKE_EXPLANATIONS = {
  true: [
    'This prediction proved accurate. Subsequent reporting and official data confirmed the outcome as described.',
    'Events unfolded largely as predicted. Multiple credible sources corroborate this verdict.',
    'The prediction came true within the stated timeframe, supported by public record.',
  ],
  'partially true': [
    'Parts of this prediction were borne out, but other key details were missing, overstated, or incorrect.',
    'The evidence supports a mixed verdict: the central trend appeared, but not in the full form claimed.',
    'Some elements happened as predicted, while other parts were contradicted by later reporting and official data.',
  ],
  false: [
    'This did not come to pass. The evidence available indicates the opposite occurred.',
    'Subsequent events contradicted this prediction. Multiple sources confirm the outcome differed.',
    'The prediction was not borne out by events within the stated timeframe.',
  ],
  pending: [
    'The timeframe for this prediction has not yet elapsed. Outcome remains to be determined.',
    'Insufficient time has passed to evaluate this claim. Will be revisited when the deadline approaches.',
    'This prediction is still active — the stated conditions have not yet been met or failed.',
  ],
  unverifiable: [
    'This claim is too vague or subjective to definitively confirm or deny with available sources.',
    'The prediction lacks specific measurable criteria, making objective verification impossible.',
    'No authoritative source can confirm or deny this claim with sufficient confidence.',
  ],
}

function pickVerdict() {
  const r = seededRand()
  let cumulative = 0
  for (let i = 0; i < VERDICTS.length; i++) {
    cumulative += VERDICT_WEIGHTS[i]
    if (r < cumulative) return VERDICTS[i]
  }
  return 'pending'
}

// ─── videos.json ─────────────────────────────────────────────────────────────

const videosSrc = path.join(DATA_SRC, 'videos.json')
const reviewStatusSrc = path.join(DATA_SRC, 'review_status.json')
let videos = []

function normalizeReviewEntry(entry) {
  if (entry === true) return { reviewed: true, flagged: false, notes: '' }
  if (!entry || typeof entry !== 'object') return { reviewed: false, flagged: false, notes: '' }
  return {
    reviewed: entry.reviewed === true,
    flagged: entry.flagged === true,
    notes: typeof entry.notes === 'string' ? entry.notes : '',
  }
}

if (!FORCE_FAKE && existsSync(videosSrc)) {
  videos = JSON.parse(await readFile(videosSrc, 'utf-8'))
  const rawReviewStatus = existsSync(reviewStatusSrc)
    ? JSON.parse(await readFile(reviewStatusSrc, 'utf-8'))
    : {}
  const audioIds = new Set(
    (await readdir(path.join(DATA_SRC, 'audio')).catch(() => []))
      .filter(f => f.endsWith('.mp3'))
      .map(f => f.replace('.mp3', ''))
  )
  const transcriptIds = new Set()
  const diarizedIds = new Set()
  const predIds = new Set(
    (await readdir(path.join(DATA_SRC, 'predictions')).catch(() => []))
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
  )
  const fcIds = new Set(
    (await readdir(path.join(DATA_SRC, 'fact_checks')).catch(() => []))
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
  )

  const transcriptDir = path.join(DATA_SRC, 'transcripts')
  const transcriptFiles = await readdir(transcriptDir).catch(() => [])
  for (const f of transcriptFiles.filter(f => f.endsWith('.json'))) {
    const fallbackId = f.replace('.json', '')
    transcriptIds.add(fallbackId)
    try {
      const t = JSON.parse(await readFile(path.join(transcriptDir, f), 'utf-8'))
      const transcriptId = t.video_id ?? fallbackId
      transcriptIds.add(transcriptId)
      if (t.diarized === true) diarizedIds.add(transcriptId)
    } catch { /* skip unreadable files */ }
  }

  const getPipelineStage = videoId => {
    const reviewEntry = normalizeReviewEntry(rawReviewStatus[videoId])
    if (!audioIds.has(videoId)) return { code: 'download', label: 'Queued for download' }
    if (!transcriptIds.has(videoId)) return { code: 'transcribe', label: 'Transcribing' }
    if (!diarizedIds.has(videoId)) return { code: 'diarize', label: 'Diarizing' }
    if (!predIds.has(videoId)) return { code: 'extract', label: 'Extracting predictions' }
    if (!fcIds.has(videoId)) return { code: 'fact_check', label: 'Fact-checking' }
    if (reviewEntry.flagged) return { code: 'review', label: 'Flagged for review' }
    if (!reviewEntry.reviewed) return { code: 'review', label: 'Ready for review' }
    return { code: 'complete', label: 'Complete' }
  }

  videos = videos.map(video => {
    const stage = getPipelineStage(video.id)
    const reviewEntry = normalizeReviewEntry(rawReviewStatus[video.id])
    return {
      ...video,
      pipeline_stage: stage.code,
      pipeline_stage_label: stage.label,
      has_audio: audioIds.has(video.id),
      has_transcript: transcriptIds.has(video.id),
      is_diarized: diarizedIds.has(video.id),
      has_predictions: predIds.has(video.id),
      has_fact_checks: fcIds.has(video.id),
      reviewed: reviewEntry.reviewed,
      flagged_for_review: reviewEntry.flagged,
      review_notes: reviewEntry.notes,
    }
  })

  // Count which video IDs have complete data for reporting purposes. In dev we
  // keep all videos visible, while production exports only reviewed-complete
  // episodes.
  let completeIds = new Set()

  const masterForFilter = path.resolve(__dirname, '../../predictions_master.json')
  if (existsSync(masterForFilter)) {
    try {
      const raw = JSON.parse(await readFile(masterForFilter, 'utf-8'))
      if (Array.isArray(raw) && raw.length > 0) {
        for (const r of raw) if (r.video_id) completeIds.add(r.video_id)
      }
    } catch { /* ignore parse errors */ }
  }

  // If master didn't give us any IDs, fall back to checking subdirectory files
  if (completeIds.size === 0) {
    for (const id of predIds) if (fcIds.has(id) && diarizedIds.has(id)) completeIds.add(id)
  }

  const completeCount = videos.filter(v => v.reviewed === true && v.flagged_for_review !== true).length
  const exportedVideos = INCLUDE_IN_PROGRESS_VIDEOS
    ? videos
    : videos.filter(v => v.reviewed === true && v.flagged_for_review !== true)
  await writeFile(path.join(DATA_DEST, 'videos.json'), JSON.stringify(exportedVideos, null, 2))
  console.log(`  videos.json: ${videos.length} total episodes (${completeCount} complete, ${videos.length - completeCount} in progress, ${exportedVideos.length} exported)`)
} else {
  console.warn('  warning: videos.json not found — generating fake episode list')
  const startDate = new Date('2023-04-10')
  videos = Array.from({ length: 40 }, (_, i) => {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i * 7)
    return {
      id: `FAKE_${String(i).padStart(3, '0')}`,
      title: `The Necessary Conversation ${d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })}`,
      url: `https://www.youtube.com/watch?v=FAKE_${i}`,
      published_at: d.toISOString().slice(0, 10),
      duration_seconds: randInt(2800, 4200),
    }
  })
  await writeFile(path.join(DATA_DEST, 'videos.json'), JSON.stringify(videos, null, 2))
  console.log(`  generated fake videos.json (${videos.length} episodes)`)
}

// ─── speaker_profiles.json ────────────────────────────────────────────────────

const profilesSrc = path.join(DATA_SRC, 'speaker_profiles.json')
if (existsSync(profilesSrc)) {
  await copyFile(profilesSrc, path.join(DATA_DEST, 'speaker_profiles.json'))
  console.log('  copied speaker_profiles.json')
} else {
  console.warn('  warning: speaker_profiles.json not found, skipping')
}

// ─── predictions_master.json ──────────────────────────────────────────────────

const masterSrc = path.resolve(__dirname, '../../predictions_master.json')
let masterData = []
let usedFakeMaster = false

if (!FORCE_FAKE && existsSync(masterSrc)) {
  const raw = JSON.parse(await readFile(masterSrc, 'utf-8'))
  if (Array.isArray(raw) && raw.length > 0) {
    await copyFile(masterSrc, path.join(DATA_DEST, 'predictions_master.json'))
    console.log(`  copied predictions_master.json (${raw.length} records)`)
    masterData = raw
  } else {
    usedFakeMaster = true
  }
} else {
  usedFakeMaster = true
}

if (usedFakeMaster) {
  console.log('  predictions_master.json is empty — generating fake prediction data')

  // Use up to 60 episodes so fake data is rich but not huge
  const sampleVideos = videos.slice(0, Math.min(60, videos.length))

  for (const video of sampleVideos) {
    const numPreds = seededInt(2, 8)
    for (let i = 0; i < numPreds; i++) {
      const speaker = seededPick(SPEAKERS)
      const topic = seededPick(TOPICS)
      const verdict = pickVerdict()
      const predId = `${video.id}_${String(i + 1).padStart(3, '0')}`

      masterData.push({
        prediction_id: predId,
        video_id: video.id,
        video_title: video.title,
        video_url: video.url,
        episode_date: video.published_at,
        speaker,
        prediction: seededPick(FAKE_PREDICTIONS),
        context: seededPick(FAKE_CONTEXTS),
        topic,
        timeframe: seededPick(TIMEFRAMES),
        specificity: seededPick(SPECIFICITIES),
        verdict,
        confidence: seededPick(['high', 'medium', 'low']),
        explanation: seededPick(FAKE_EXPLANATIONS[verdict]),
        sources:
          verdict !== 'pending' && verdict !== 'unverifiable'
            ? ['https://apnews.com/example', 'https://reuters.com/example']
            : [],
        timestamp_seconds: video.duration_seconds > 120 ? seededInt(60, video.duration_seconds - 60) : null,
      })
    }
  }

  await writeFile(
    path.join(DATA_DEST, 'predictions_master.json'),
    JSON.stringify(masterData, null, 2),
  )
  console.log(
    `  generated fake predictions_master.json (${masterData.length} records across ${sampleVideos.length} episodes)`,
  )
}

// ─── predictions/ and fact_checks/ subdirectories ────────────────────────────

for (const subdir of ['predictions', 'fact_checks', 'transcripts']) {
  const srcDir = path.join(DATA_SRC, subdir)
  const destDir = path.join(DATA_DEST, subdir)
  if (!existsSync(srcDir)) continue
  await mkdir(destDir, { recursive: true })
  const files = (await readdir(srcDir)).filter(f => f.endsWith('.json'))
  for (const file of files) {
    await copyFile(path.join(srcDir, file), path.join(destDir, file))
  }
  if (files.length > 0) console.log(`  copied ${files.length} files from ${subdir}/`)
}

console.log('sync-data complete')
