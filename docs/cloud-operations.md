# Cloud Operations

This is the day-to-day runbook for using the pipeline after deployment.

## Normal Weekly Workflow

1. Let the weekly Modal schedule run or trigger it manually:

```bash
modal run infra/pipeline_app.py --action run_incremental --batch-size 2 --prediction-batch-size 25 --max-new-videos 3
```

2. Pull the published outputs back into the repo:

```bash
python3 -m infra.r2_sync pull exports
```

3. Review the updated tracked files:

- [data/videos.json](/Users/mdeforest/Documents/Personal/Projects/necessary-conversation/data/videos.json)
- [predictions_master.json](/Users/mdeforest/Documents/Personal/Projects/necessary-conversation/predictions_master.json)

4. Commit and publish through the existing GitHub workflow.

## Run One Video End To End

Use this when debugging a specific episode:

```bash
modal run infra/pipeline_app.py --action run_stage --stage 2 --video-id VIDEO_ID
modal run infra/pipeline_app.py --action run_stage --stage 3 --video-id VIDEO_ID
modal run infra/pipeline_app.py --action run_stage --stage 3b --video-id VIDEO_ID
modal run infra/pipeline_app.py --action run_stage --stage 4 --video-id VIDEO_ID
modal run infra/pipeline_app.py --action run_stage --stage 5 --video-id VIDEO_ID
modal run infra/pipeline_app.py --action run_stage --stage 6
```

If stage `4` succeeded, it ran `04_extract_predictions.py` only.
Timestamp snapping stays separate as stage `4b` and should only be run manually if you explicitly want to resnap timestamps.

If you are using hosted pyannote, stage `03b` calls the pyannote API with a presigned R2 URL for the episode audio and then applies the existing local speaker-name matching flow.

## Run A Backfill Batch

Example:

```bash
modal run infra/pipeline_app.py --action run_full --start-stage 1 --batch-size 3 --prediction-batch-size 50 --offset 0
```

Use `offset` to continue through the backlog in small chunks:

```bash
modal run infra/pipeline_app.py --action run_full --start-stage 1 --batch-size 3 --prediction-batch-size 50 --offset 3
modal run infra/pipeline_app.py --action run_full --start-stage 1 --batch-size 3 --prediction-batch-size 50 --offset 6
```

## Monthly Fact-Check Refresh

The monthly schedule is intended to refresh only stale:

- `pending`
- `unverifiable`
- low-confidence items

Manual command:

```bash
modal run infra/pipeline_app.py --action run_fact_check_refresh --prediction-batch-size 100 --refresh-scope pending-first --stale-days 30
```

After refresh completes:

```bash
python3 -m infra.r2_sync pull exports
```

Then publish the updated tracked files through GitHub.

### Targeted Refreshes

Refresh one specific prediction:

```bash
modal run infra/pipeline_app.py --action run_fact_check_refresh --prediction-id PREDICTION_UUID --refresh-scope manual
```

Refresh every stale fact-check for one episode:

```bash
modal run infra/pipeline_app.py --action run_fact_check_refresh --video-id VIDEO_ID --refresh-scope stale-all --stale-days 30
```

### Future Reminder

Planned follow-up:

- add an explicit fact-check expiration policy so older fact-checks automatically become eligible for periodic recheck even if they are not currently `pending`
- likely implementation: store an expiration or next-review date per fact-check and let the refresh job target expired items first

## Local Speaker Review Workflow

Keep this local. Do not try to edit speaker files directly in R2.

1. Pull the latest control files:

```bash
python3 scripts/control_sync.py pull
```

2. Run the local dev UI:

```bash
cd ui
npm run dev
```

3. Make speaker corrections using the existing dev flow.

4. Push the control files back to R2:

```bash
python3 scripts/control_sync.py push
```

5. Re-run the affected pipeline stages in cloud:

- if only `prediction_speaker_overrides.json` changed:

```bash
modal run infra/pipeline_app.py --action run_stage --stage 6
```

- if embeddings or transcript speaker corrections changed:

```bash
modal run infra/pipeline_app.py --action run_stage --stage 3b --video-id VIDEO_ID
modal run infra/pipeline_app.py --action run_stage --stage 4 --video-id VIDEO_ID
modal run infra/pipeline_app.py --action run_stage --stage 5 --video-id VIDEO_ID
modal run infra/pipeline_app.py --action run_stage --stage 6
```

## Recovery And Failure Handling

### Stage 02 download failures

Symptoms:

- `yt-dlp` auth errors
- YouTube anti-bot challenge errors
- partial or missing `.mp3` output

Response:

1. Retry the exact episode:

```bash
modal run infra/pipeline_app.py --action run_stage --stage 2 --video-id VIDEO_ID
```

2. If it still fails, update `YTDLP_COOKIES_TEXT` in Modal.
3. Redeploy:

```bash
modal deploy infra/pipeline_app.py
```

### Stage 03 or 03b timeouts or cost spikes

Response:

1. Re-run only the failed episode:

```bash
modal run infra/pipeline_app.py --action run_stage --stage 3 --video-id VIDEO_ID
modal run infra/pipeline_app.py --action run_stage --stage 3b --video-id VIDEO_ID
```

2. Reduce batch size for broader runs.
3. Compare runtime to your calibration worksheet.
4. If the projection is too high, pause and move only GPU-heavy stages to Runpod later.

If you are still on local diarization, switching stage `03b` to hosted pyannote is often a better next step than paying for a larger GPU tier. Update the secret with:

```bash
DIARIZATION_PROVIDER=pyannote_api
PYANNOTE_API_MODEL=precision-2
```

Then redeploy and rerun `03b`.

### Stage 04 or 05 API quota issues

Symptoms:

- DeepSeek request failures
- Gemini quota or rate-limit errors

Response:

1. Stop large backfill runs.
2. Resume later with the same command or a smaller batch.
3. For fact-checking, rerun targeted work only:

```bash
modal run infra/pipeline_app.py --action run_fact_check_refresh --video-id VIDEO_ID --refresh-scope manual
```

Because the pipeline is idempotent, completed files are skipped on rerun.

### Export mismatch

If `predictions_master.json` is out of sync with the artifacts:

```bash
modal run infra/pipeline_app.py --action run_stage --stage 6
python3 -m infra.r2_sync pull exports
```

## Cost Handling

Track cost at two levels:

- per-stage runtime from Modal logs
- total monthly spend from Modal billing

Use a simple worksheet:

| Date | Command | Videos | Stage 3 sec | Stage 3b sec | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| | | | | | |

Pause and review before continuing if either happens:

- a GPU stage is materially slower than calibration
- a monthly bill projection rises above your target

If GPU cost is the problem, keep the current orchestration and R2 layout and move only:

- stage `03`
- stage `03b`

Everything else can remain on Modal.

## Resume Strategy After Interrupted Runs

Use the smallest rerun that fixes the broken state.

- If download failed: rerun `02` for that `video_id`
- If transcription failed: rerun `03` for that `video_id`
- If diarization failed: rerun `03b` for that `video_id`
- If extraction failed: rerun `04` for that `video_id`
- If fact-check failed: rerun `05` or refresh manually for that `video_id`
- If export failed: rerun `06`

Examples:

```bash
modal run infra/pipeline_app.py --action run_stage --stage 4 --video-id VIDEO_ID
modal run infra/pipeline_app.py --action run_stage --stage 5 --video-id VIDEO_ID
modal run infra/pipeline_app.py --action run_stage --stage 6
```

Do not delete R2 data to recover from ordinary failures. The stage scripts are already written to skip existing outputs.

## Sanity Checks After Any Recovery

After a recovery run:

1. Pull the relevant exports:

```bash
python3 -m infra.r2_sync pull exports
```

2. Confirm the episode appears in:

- [data/videos.json](/Users/mdeforest/Documents/Personal/Projects/necessary-conversation/data/videos.json)
- [predictions_master.json](/Users/mdeforest/Documents/Personal/Projects/necessary-conversation/predictions_master.json)

3. If needed, inspect the per-stage local files after pulling artifacts with:

```bash
python3 -m infra.r2_sync pull transcripts predictions fact_checks --video-id VIDEO_ID
```

## Operational Defaults

Use these defaults unless there is a concrete reason to override them:

- backfill `batch_size=3`
- extraction/fact-check `prediction_batch_size=50`
- monthly refresh `refresh_scope=pending-first`
- monthly refresh `stale_days=30`
- incremental `max_new_videos=3` until runtime is well understood
