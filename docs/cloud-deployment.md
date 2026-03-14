# Cloud Deployment

This project keeps the UI and GitHub Pages workflow as-is and moves only the pipeline to the cloud.

The cloud stack in this repo is:

- Modal for compute and schedules
- Cloudflare R2 for shared state and pipeline artifacts
- Local Vite dev server for speaker review and corrections

## What Gets Added

- [infra/pipeline_app.py](/Users/mdeforest/Documents/Personal/Projects/necessary-conversation/infra/pipeline_app.py): Modal entrypoint and scheduled jobs
- [infra/r2_sync.py](/Users/mdeforest/Documents/Personal/Projects/necessary-conversation/infra/r2_sync.py): Cloudflare R2 sync helpers and CLI
- [scripts/control_sync.py](/Users/mdeforest/Documents/Personal/Projects/necessary-conversation/scripts/control_sync.py): local control-file sync for speaker review

## Prerequisites

- A Modal account and CLI
- A Cloudflare account with R2 enabled
- Python 3 available locally
- Existing API keys for:
  - `DEEPSEEK_API_KEY`
  - `GOOGLE_API_KEY`
  - `HF_TOKEN`
- Optional hosted diarization key:
  - `PYANNOTE_API_KEY`
- Optional YouTube auth cookies if unauthenticated `yt-dlp` starts failing

## Required Secret Name

Create one Modal secret named `necessary-conversation-pipeline`.

Put these environment variables in that secret:

- `DEEPSEEK_API_KEY`
- `GOOGLE_API_KEY`
- `HF_TOKEN`
- `PYANNOTE_API_KEY` if using hosted diarization
- `DIARIZATION_PROVIDER` set to `local` or `pyannote_api`
- `PYANNOTE_API_MODEL` if using hosted diarization
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_ENDPOINT_URL`
- `YTDLP_COOKIES_TEXT` (optional)

Where they are used:

- `DEEPSEEK_API_KEY`: stage `04_extract_predictions.py`
- `GOOGLE_API_KEY`: stage `05_fact_check.py`
- `HF_TOKEN`: stage `03b_diarize.py`
- `PYANNOTE_API_KEY`: hosted pyannote diarization in stage `03b_diarize.py`
- `DIARIZATION_PROVIDER`: switches stage `03b` between local and hosted diarization
- `PYANNOTE_API_MODEL`: hosted pyannote model name such as `precision-2`
- `R2_*`: [infra/r2_sync.py](/Users/mdeforest/Documents/Personal/Projects/necessary-conversation/infra/r2_sync.py)
- `YTDLP_COOKIES_TEXT`: stage `02_download_audio.py` in cloud mode

## Diarization Provider

Stage `03b` supports two modes:

- `DIARIZATION_PROVIDER=local`
  - Uses local `pyannote.audio`
  - Requires `HF_TOKEN`
  - Uses a Modal GPU for stage `03b`
- `DIARIZATION_PROVIDER=pyannote_api`
  - Uses hosted pyannote diarization via API
  - Requires `PYANNOTE_API_KEY`
  - Uses presigned R2 audio URLs
  - Runs stage `03b` on CPU in the cloud wrapper

Recommended for cloud use:

```bash
DIARIZATION_PROVIDER=pyannote_api
PYANNOTE_API_MODEL=precision-2
```

## R2 Bucket Layout

Create one bucket and use these prefixes:

- `control/`
  - `speaker_profiles.json`
  - `speaker_corrections.json`
  - `prediction_speaker_overrides.json`
  - `speaker_embeddings.json`
- `artifacts/audio/`
- `artifacts/transcripts/`
- `artifacts/predictions/`
- `artifacts/fact_checks/`
- `exports/videos.json`
- `exports/predictions_master.json`

## Local Setup

Install or update Python dependencies locally:

```bash
pip install -r requirements.txt
```

Install the Modal CLI if you do not already have it:

```bash
python3 -m pip install modal
python3 -m modal setup
```

## Bootstrap The Bucket

Push the current local state into R2.

1. Ensure your local shell has the R2 variables set.
2. Push control files:

```bash
python3 scripts/control_sync.py push
```

3. Push artifacts and exports:

```bash
python3 -m infra.r2_sync push audio transcripts predictions fact_checks exports
```

If you want to also upload the committed control files in one command instead of using `control_sync.py`:

```bash
python3 -m infra.r2_sync push control
```

## Deploy Modal Jobs

Deploy the app once the secret exists:

```bash
modal deploy infra/pipeline_app.py
```

This registers:

- `run_stage`
- `run_full`
- `run_incremental`
- `run_fact_check_refresh`

It also registers schedules:

- weekly `run_incremental`
- monthly `run_fact_check_refresh`

## Manual Job Commands

Run one stage:

```bash
modal run infra/pipeline_app.py --action run_stage --stage 2 --video-id VIDEO_ID
```

Prediction extraction and timestamp snapping are split:

- stage `4`: extraction only
- stage `4b`: optional timestamp snapping only

Run a batched cloud pipeline pass:

```bash
modal run infra/pipeline_app.py --action run_full --start-stage 1 --batch-size 3 --prediction-batch-size 25
```

Run weekly-style incremental logic immediately:

```bash
modal run infra/pipeline_app.py --action run_incremental --batch-size 2 --prediction-batch-size 25 --max-new-videos 3
```

Run a fact-check refresh immediately:

```bash
modal run infra/pipeline_app.py --action run_fact_check_refresh --prediction-batch-size 100 --refresh-scope pending-first --stale-days 30
```

Refresh one specific prediction:

```bash
modal run infra/pipeline_app.py --action run_fact_check_refresh --prediction-id PREDICTION_UUID --refresh-scope manual
```

## Initial Migration Sequence

Use this exact order the first time:

1. Create the R2 bucket.
2. Create the `necessary-conversation-pipeline` Modal secret.
3. Push local `control/` files to R2.
4. Push local artifacts and exports to R2.
5. Deploy the Modal app with `modal deploy`.
6. Run a 3-video calibration batch.
7. Review GPU runtime and projected backlog cost.
8. If the projection is acceptable, start the real backfill in chunks.

If you switch to hosted pyannote later, update the Modal secret with:

- `DIARIZATION_PROVIDER=pyannote_api`
- `PYANNOTE_API_KEY`
- optionally `PYANNOTE_API_MODEL=precision-2`

Then redeploy:

```bash
modal deploy infra/pipeline_app.py
```

## Calibration Procedure

Before a full backfill, run three representative episodes:

- one short episode
- one average-length episode
- one long episode

The current repo already has `duration_seconds` in [data/videos.json](/Users/mdeforest/Documents/Personal/Projects/necessary-conversation/data/videos.json). Pick IDs directly from there.

Suggested calibration commands:

```bash
modal run infra/pipeline_app.py --action run_stage --stage 2 --video-id v_Qo7yO4oVs
modal run infra/pipeline_app.py --action run_stage --stage 3 --video-id v_Qo7yO4oVs
modal run infra/pipeline_app.py --action run_stage --stage 3b --video-id v_Qo7yO4oVs

modal run infra/pipeline_app.py --action run_stage --stage 2 --video-id LPGCSaOZKFI
modal run infra/pipeline_app.py --action run_stage --stage 3 --video-id LPGCSaOZKFI
modal run infra/pipeline_app.py --action run_stage --stage 3b --video-id LPGCSaOZKFI

modal run infra/pipeline_app.py --action run_stage --stage 2 --video-id 3FsYOI5IdJI
modal run infra/pipeline_app.py --action run_stage --stage 3 --video-id 3FsYOI5IdJI
modal run infra/pipeline_app.py --action run_stage --stage 3b --video-id 3FsYOI5IdJI
```

If `DIARIZATION_PROVIDER=pyannote_api`, the `03b` calibration is measuring hosted diarization plus the local speaker-name matching step, not local GPU diarization.

Record the stage logs in a worksheet like this:

| Video ID | Audio Hours | Stage 3 Seconds | Stage 3b Seconds | Notes |
| --- | ---: | ---: | ---: | --- |
| short | | | | |
| average | | | | |
| long | | | | |

Then compute:

- `stage_3_seconds_per_audio_hour`
- `stage_3b_seconds_per_audio_hour`
- total projected GPU hours for the remaining backlog
- estimated GPU spend using your Modal billing page

If the GPU projection looks too high, keep everything else as-is and move only stages `03` and `03b` to Runpod later. The rest of the orchestration and R2 layout do not need to change.

## Full Backfill Strategy

Do not try to backfill the entire backlog in one giant run first.

Use small batches:

```bash
modal run infra/pipeline_app.py --action run_full --start-stage 1 --batch-size 3 --prediction-batch-size 50
```

Then repeat with increasing offsets:

```bash
modal run infra/pipeline_app.py --action run_full --start-stage 1 --batch-size 3 --offset 3 --prediction-batch-size 50
modal run infra/pipeline_app.py --action run_full --start-stage 1 --batch-size 3 --offset 6 --prediction-batch-size 50
```

Keep batches small until you trust the runtime and quota behavior.

## Pulling Back Published Outputs

After a cloud run finishes, pull the export files back to your local repo:

```bash
python3 -m infra.r2_sync pull exports
```

That writes both:

- [exports/videos.json](/Users/mdeforest/Documents/Personal/Projects/necessary-conversation/exports/videos.json)
- [exports/predictions_master.json](/Users/mdeforest/Documents/Personal/Projects/necessary-conversation/exports/predictions_master.json)

It also refreshes:

- [data/videos.json](/Users/mdeforest/Documents/Personal/Projects/necessary-conversation/data/videos.json)
- [predictions_master.json](/Users/mdeforest/Documents/Personal/Projects/necessary-conversation/predictions_master.json)

Your GitHub UI workflow can keep using the tracked repo files.

## YouTube Authentication In Cloud Runs

If `yt-dlp` starts failing in the cloud:

1. Export cookies into Netscape `cookies.txt` format locally.
2. Put the file contents into `YTDLP_COOKIES_TEXT` in the Modal secret.
3. Redeploy with:

```bash
modal deploy infra/pipeline_app.py
```

The cloud wrapper writes that secret to a temp file and passes it into `02_download_audio.py` with `--cookies-file`.

## Verification Checklist

After the first deploy, verify these directly:

- `modal run ... --action run_stage --stage 1` refreshes `exports/videos.json`
- `modal run ... --action run_stage --stage 2 --video-id ...` writes `artifacts/audio/<id>.mp3`
- `modal run ... --action run_stage --stage 3 --video-id ...` writes `artifacts/transcripts/<id>.json`
- `modal run ... --action run_stage --stage 3b --video-id ...` rewrites the transcript with `diarized: true`
- `modal run ... --action run_stage --stage 4 --video-id ...` writes `artifacts/predictions/<id>.json`
- `modal run ... --action run_stage --stage 5 --video-id ...` writes `artifacts/fact_checks/<id>.json`
- `modal run ... --action run_stage --stage 6` refreshes `exports/predictions_master.json`
