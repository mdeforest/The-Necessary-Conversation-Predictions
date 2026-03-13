# The Necessary Conversation — Data Visualization UI

## What This Is

A web UI for exploring predictions made on the *The Necessary Conversation* podcast — a family political debate show hosted by Chad Kultgen and his sister Haley Popp, with their conservative parents Mary Lou and Bob Kultgen. The pipeline extracts predictions from episode transcripts, fact-checks them via Gemini + Google Search, and writes everything to JSON files in `../data/`.

The UI reads those JSON files and makes the data browsable and interesting.

## Data Available

All data lives in `../data/`. Nothing is in a database — it's flat JSON files.

### `../data/videos.json`
Array of all 173+ episodes:
```json
{
  "id": "DuUP_AqMsrA",
  "title": "The Necessary Conversation 4-10-23",
  "url": "https://www.youtube.com/watch?v=DuUP_AqMsrA",
  "published_at": "2023-04-12",
  "duration_seconds": 3472
}
```

### `../data/transcripts/{video_id}.json`
Whisper transcripts, optionally speaker-diarized:
```json
{
  "video_id": "DuUP_AqMsrA",
  "language": "en",
  "diarized": true,
  "segments": [
    { "start": 12.4, "end": 15.8, "text": "...", "speaker": "Chad Kultgen" }
  ],
  "full_text": "[Chad Kultgen] This will happen within 2 years.\n..."
}
```
`diarized` is only present/true if speaker diarization was run. If false/absent, `speaker` fields won't exist on segments.

### `../data/predictions/{video_id}.json`
Predictions extracted by DeepSeek V3:
```json
{
  "video_id": "DuUP_AqMsrA",
  "predictions": [
    {
      "id": "DuUP_AqMsrA_001",
      "speaker": "Chad Kultgen",
      "prediction": "Democrats will win the 2024 Senate runoff in Georgia.",
      "topic": "US Politics / Elections",
      "timeframe": "by end of 2024",
      "specificity": "high",
      "context": "During a discussion about Senate balance of power."
    }
  ]
}
```
`specificity` is `"high"`, `"medium"`, or `"low"`. `timeframe` is a free-text string extracted from context.

### `../data/fact_checks/{video_id}.json`
Fact-check results from Gemini 2.0 Flash + Google Search:
```json
{
  "video_id": "DuUP_AqMsrA",
  "fact_checks": [
    {
      "prediction_id": "DuUP_AqMsrA_001",
      "verdict": "true",
      "confidence": "high",
      "explanation": "Democrats won the Georgia runoff...",
      "sources": ["https://apnews.com/..."]
    }
  ]
}
```
`verdict` is one of: `"true"`, `"false"`, `"pending"`, `"unverifiable"`.
`confidence` is one of: `"high"`, `"medium"`, `"low"`.

### `../data/predictions_master.json`
Flattened array of all predictions + their fact-checks joined together. Built by `../pipeline/06_build_master.py`. Use this as the primary data source for the UI — it's pre-joined.

## Known Speakers

The four regulars:
- **Chad Kultgen** — host, liberal-leaning novelist
- **Haley Popp** — Chad's sister, co-host
- **Mary Lou Kultgen** — their mother, conservative
- **Bob Kultgen** — their father, conservative

Episodes occasionally have guests or listener call-ins. These show up as `SPEAKER_XX` anonymous labels if diarization couldn't match them to a known voice.

## UI Goals

Things worth visualizing:
- **Scorecard per speaker** — how often are each person's predictions true/false/pending?
- **Timeline** — predictions over episode history, filterable by verdict/speaker/topic
- **Topic breakdown** — which topics generate the most predictions? Which have the best accuracy?
- **Prediction browser** — searchable list with filters, linking to source episode timestamps
- **Episode view** — all predictions from a single episode, with fact-check status
- **Accuracy leaderboard** — who is most/least accurate overall?

## Tech Suggestions

No decisions made yet. Options:

- **Static site** (simplest): read JSON directly in the browser, no backend. Vite + React or plain HTML/JS. Deploy to GitHub Pages or Netlify.
- **Next.js** with static export: good if you want SSG per episode page.
- **Observable Framework / Observable Plot**: excellent for data-heavy dashboards, minimal setup.
- **Datasette**: zero-code option — convert JSON to SQLite and get a browse/filter/search UI instantly.

The data is small enough (173 episodes, hundreds of predictions) that everything can be loaded client-side with no API.

## Pipeline Context

The data is produced by `../pipeline/` in stages:

| Stage | Script | Output |
|-------|--------|--------|
| 1 | `01_fetch_videos.py` | `data/videos.json` |
| 2 | `02_download_audio.py` | `data/audio/*.mp3` |
| 3 | `03_transcribe.py` | `data/transcripts/*.json` |
| 3b | `03b_diarize.py` | adds `speaker` fields to transcripts |
| 4 | `04_extract_predictions.py` | `data/predictions/*.json` |
| 5 | `05_fact_check.py` | `data/fact_checks/*.json` |
| 6 | `06_build_master.py` | `data/predictions_master.json` |

Run `python pipeline/run_all.py` to run the full pipeline. Each stage is idempotent.

## Current Status (2026-03-13)

- Pipeline is partially complete: 17 transcripts done, diarization in progress
- Predictions and fact-checks not yet run at scale
- `predictions_master.json` is currently empty (`[]`)
- **UI is complete** — Vite + React + TS + Tailwind + Recharts, all 5 tabs built
- **Speaker editor** added to Episodes tab (dev-only, see below)

## Tech Stack Chosen

**Vite + React + TypeScript + Tailwind CSS + Recharts**

- `npm run dev` — starts dev server (runs sync-data first)
- `npm run build` — production build to `dist/`
- `scripts/sync-data.mjs` — copies `../data/*.json` into `public/data/` before builds

## UI Architecture

- **Single-page app**, tab navigation via React state (no router)
- Data loaded at startup via `fetch('/data/predictions_master.json')` + `videos.json`
- Graceful empty state when predictions_master.json is `[]` — shows pipeline banner and episode list
- 5 tabs: Overview · Speakers · Topics · Browse · Episodes

## Speaker Overrides (Dev Tool)

When running `npm run dev`, the Episodes tab has an inline speaker editor on every prediction row. Hover the speaker name to reveal a pencil icon — click it to open a dropdown with the four known speakers + Unknown.

**How it works:**
1. Override saved to `../data/prediction_speaker_overrides.json` via Vite dev middleware (`GET/POST /api/speaker-overrides`)
2. The UI merges overrides into the displayed predictions immediately in-session (no reload needed)
3. After setting overrides, run `python pipeline/06_build_master.py` to bake them into `predictions_master.json`
4. `06_build_master.py` always applies overrides as the last step — they survive re-extraction (stage 04) reruns

**Key file: `../data/prediction_speaker_overrides.json`**
```json
{
  "some-prediction-uuid": "Bob Kultgen",
  "another-uuid": "Mary Lou Kultgen"
}
```
This file is committed to git. It is never overwritten by pipeline stages — only the dev UI can write to it.

**The speaker editor is invisible in production builds** — guarded by `import.meta.env.DEV`. The Vite middleware is only registered in `configureServer`, which is dev-only.

## Conventions

- All components in `src/components/{tab}/`
- Types in `src/types.ts` — MasterRecord is the primary data shape
- Data loading in `src/data/loader.ts`
- Aggregation hooks in `src/hooks/usePredictions.ts`
- Speaker colors: Chad=blue, Haley=purple, Mary Lou=orange, Bob=teal
- Verdict colors: correct=green, wrong=red, pending=amber, unverifiable=gray
