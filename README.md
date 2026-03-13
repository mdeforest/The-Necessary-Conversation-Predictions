# The Necessary Conversation Predictions

A data pipeline and web dashboard for tracking predictions made on [*The Necessary Conversation*](https://www.youtube.com/channel/UCxyz) — a family political debate podcast hosted by Chad Kultgen and his sister Haley Popp, with their conservative parents Mary Lou and Bob Kultgen.

The pipeline downloads episodes, transcribes and diarizes them, extracts predictions via LLM, and fact-checks each prediction. The UI visualizes the results: who's most accurate, what topics generate the most predictions, and how they've fared over time.

---

## Pipeline

Each stage is idempotent — safe to re-run. Run all stages in sequence:

```bash
python pipeline/run_all.py
```

Or run stages individually:

| Stage | Script | What it does |
|-------|--------|--------------|
| 1 | `01_fetch_videos.py` | Fetches episode list from YouTube → `data/videos.json` |
| 2 | `02_download_audio.py` | Downloads audio for each episode → `data/audio/` |
| 3 | `03_transcribe.py` | Transcribes audio via Whisper → `data/transcripts/` |
| 3b | `03b_diarize.py` | Adds speaker labels to transcripts (pyannote) |
| 3c | `03c_speaker_corrections.py` | Applies manual speaker corrections from `data/speaker_corrections.json` |
| 4 | `04_extract_predictions.py` | Extracts predictions via LLM → `data/predictions/` |
| 4b | `04b_snap_timestamps.py` | Snaps predictions to transcript timestamps |
| 5 | `05_fact_check.py` | Fact-checks predictions via Gemini + Google Search → `data/fact_checks/` |
| 6 | `06_build_master.py` | Joins everything → `data/predictions_master.json` |

### Setup

```bash
pip install -r requirements.txt
cp .env.example .env  # fill in API keys
```

Required API keys (in `.env`):
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` — prediction extraction
- `GOOGLE_API_KEY` — Gemini fact-checking + Google Search
- `HF_TOKEN` — Hugging Face token for pyannote speaker diarization

---

## UI

A single-page React dashboard that reads the pipeline output.

```bash
cd ui
npm install
npm run dev       # starts dev server with live data
npm run dev:fake  # starts dev server with fake/sample data
npm run build     # production build → dist/
```

**Tabs:** Overview · Speakers · Topics · Browse · Episodes

**Tech stack:** Vite + React + TypeScript + Tailwind CSS + Recharts

---

## Data

```
data/
  videos.json              # episode metadata (committed)
  speaker_profiles.json    # speaker name mappings (committed)
  speaker_corrections.json # manual per-episode speaker corrections (committed)
  audio/                   # downloaded mp3s (gitignored)
  transcripts/             # Whisper transcripts (gitignored)
  predictions/             # per-episode extracted predictions (gitignored)
  fact_checks/             # per-episode fact-check results (gitignored)
  speaker_clips/           # audio clips for diarization training (gitignored)
  speaker_embeddings.json  # generated voice embeddings (gitignored)
predictions_master.json    # joined predictions + fact-checks (gitignored)
```

---

## Speakers

| Speaker | Role |
|---------|------|
| **Chad Kultgen** | Host, liberal-leaning |
| **Haley Popp** | Co-host, Chad's sister |
| **Mary Lou Kultgen** | Their mother, conservative |
| **Bob Kultgen** | Their father, conservative |
