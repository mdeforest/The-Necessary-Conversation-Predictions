from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import modal

from infra.r2_sync import pull_artifacts, pull_control_files, pull_exports, push_artifacts, push_exports

APP_NAME = "necessary-conversation-pipeline"
APP_ROOT = Path("/app")
DATA_DIR = APP_ROOT / "data"
PIPELINE_DIR = APP_ROOT / "pipeline"
FULL_STAGE_ORDER = ["1", "2", "3", "3b", "4", "5", "6"]
SECRET_NAME = "necessary-conversation-pipeline"


def _build_image() -> modal.Image:
    return (
        modal.Image.debian_slim(python_version="3.11")
        .apt_install("ffmpeg", "git", "curl", "unzip")
        .add_local_file("requirements.txt", remote_path="/app/requirements.txt", copy=True)
        .run_commands(
            "curl -fsSL https://deno.land/install.sh | sh -s -- -y",
            "ln -sf /root/.deno/bin/deno /usr/local/bin/deno",
            "mkdir -p /app/data /app/exports",
        )
        .pip_install_from_requirements("requirements.txt")
        .add_local_dir("pipeline", remote_path="/app/pipeline", copy=True)
        .add_local_dir("infra", remote_path="/app/infra", copy=True)
        .add_local_dir("scripts", remote_path="/app/scripts", copy=True)
        .add_local_file(".env.example", remote_path="/app/.env.example", copy=True)
        .workdir("/app")
    )


app = modal.App(APP_NAME)
image = _build_image()
secret = modal.Secret.from_name(SECRET_NAME)


def log(message: str) -> None:
    print(f"[cloud] {message}")


def _stage_uses_gpu(stage: str) -> bool:
    if stage == "3":
        return True
    if stage == "3b":
        return os.environ.get("DIARIZATION_PROVIDER", "local").strip().lower() != "pyannote_api"
    return False


def _canonical_stage(stage: str | int) -> str:
    stage_str = str(stage).strip().lower()
    if stage_str not in {"1", "2", "3", "3b", "4", "4b", "5", "6"}:
        raise ValueError(f"Unsupported stage: {stage}")
    return stage_str


def _video_ids_from_batch(batch_size: int, offset: int, video_id: str | None) -> list[str]:
    if video_id:
        return [video_id]

    videos_path = DATA_DIR / "videos.json"
    if not videos_path.exists():
        return []

    videos = json.loads(videos_path.read_text())
    batch = videos[offset : offset + batch_size]
    return [video["id"] for video in batch]


def _pending_diarization_ids(batch_size: int, offset: int, video_id: str | None) -> list[str]:
    if video_id:
        return [video_id]

    transcript_dir = DATA_DIR / "transcripts"
    if not transcript_dir.exists():
        return []

    pending: list[str] = []
    for transcript_path in sorted(transcript_dir.glob("*.json")):
        transcript = json.loads(transcript_path.read_text())
        if not transcript.get("diarized"):
            pending.append(transcript_path.stem)
    return pending[offset : offset + batch_size]


def _cookies_args(stage: str) -> list[str]:
    if stage != "2":
        return []

    cookies_text = os.getenv("YTDLP_COOKIES_TEXT", "").strip()
    if not cookies_text:
        return []

    cookies_path = Path("/tmp/ytdlp.cookies.txt")
    cookies_path.write_text(cookies_text)
    return ["--cookies-file", str(cookies_path)]


def _command_for_stage(
    stage: str,
    *,
    batch_size: int,
    prediction_batch_size: int,
    offset: int,
    video_id: str | None,
    prediction_id: str | None,
    refresh_scope: str | None,
    stale_days: int,
) -> list[list[str]]:
    python = sys.executable
    common_video_args = ["--video-id", video_id] if video_id else []
    common_prediction_args = ["--prediction-id", prediction_id] if prediction_id else []

    if stage == "1":
        return [[python, str(PIPELINE_DIR / "01_fetch_videos.py")]]
    if stage == "2":
        return [[
            python,
            str(PIPELINE_DIR / "02_download_audio.py"),
            "--batch-size",
            str(batch_size),
            "--offset",
            str(offset),
            *_cookies_args(stage),
            *common_video_args,
        ]]
    if stage == "3":
        return [[
            python,
            str(PIPELINE_DIR / "03_transcribe.py"),
            "--batch-size",
            str(batch_size),
            "--offset",
            str(offset),
            *common_video_args,
        ]]
    if stage == "3b":
        return [[
            python,
            str(PIPELINE_DIR / "03b_diarize.py"),
            "--batch-size",
            str(batch_size),
            "--offset",
            str(offset),
            *common_video_args,
        ]]
    if stage == "4":
        return [[
            python,
            str(PIPELINE_DIR / "04_extract_predictions.py"),
            "--batch-size",
            str(prediction_batch_size),
            "--offset",
            str(offset),
            *common_video_args,
        ]]
    if stage == "4b":
        return [[python, str(PIPELINE_DIR / "04b_snap_timestamps.py"), *common_video_args]]
    if stage == "5":
        refresh_args = []
        if refresh_scope:
            refresh_args = [
                "--refresh-scope",
                refresh_scope,
                "--stale-days",
                str(stale_days),
            ]
        return [[
            python,
            str(PIPELINE_DIR / "05_fact_check.py"),
            "--batch-size",
            str(prediction_batch_size),
            *refresh_args,
            *common_video_args,
            *common_prediction_args,
        ]]
    if stage == "6":
        return [[python, str(PIPELINE_DIR / "06_build_master.py")]]
    raise ValueError(f"Unhandled stage: {stage}")


def _pull_stage_inputs(stage: str, batch_size: int, offset: int, video_id: str | None) -> list[str]:
    if stage == "1":
        return []

    pull_exports()

    if stage == "2":
        return _video_ids_from_batch(batch_size, offset, video_id)

    if stage == "3":
        target_ids = _video_ids_from_batch(batch_size, offset, video_id)
        for target_id in target_ids:
            pull_artifacts(["audio", "transcripts"], video_id=target_id)
        return target_ids

    if stage == "3b":
        pull_control_files()
        pull_artifacts(["transcripts"])
        target_ids = _pending_diarization_ids(batch_size, offset, video_id)
        for target_id in target_ids:
            pull_artifacts(["audio"], video_id=target_id)
        return target_ids

    if stage in {"4", "4b"}:
        pull_artifacts(["transcripts", "predictions"])
        return [video_id] if video_id else []

    if stage == "5":
        pull_artifacts(["predictions", "fact_checks"])
        return [video_id] if video_id else []

    if stage == "6":
        pull_control_files()
        pull_artifacts(["predictions", "fact_checks"])
        return []

    return []


def _push_stage_outputs(stage: str, target_ids: list[str], video_id: str | None) -> None:
    if stage == "1":
        push_exports()
        return

    if stage == "2":
        if video_id:
            push_artifacts(["audio"], video_id=video_id)
        else:
            for target_id in target_ids:
                push_artifacts(["audio"], video_id=target_id)
        return

    if stage in {"3", "3b"}:
        if video_id:
            push_artifacts(["transcripts"], video_id=video_id)
        elif target_ids:
            for target_id in target_ids:
                push_artifacts(["transcripts"], video_id=target_id)
        else:
            push_artifacts(["transcripts"])
        return

    if stage in {"4", "4b"}:
        if video_id:
            push_artifacts(["predictions"], video_id=video_id)
        else:
            push_artifacts(["predictions"])
        return

    if stage == "5":
        if video_id:
            push_artifacts(["fact_checks"], video_id=video_id)
        else:
            push_artifacts(["fact_checks"])
        return

    if stage == "6":
        push_exports()


def _run_stage_commands(
    stage: str,
    *,
    batch_size: int,
    prediction_batch_size: int,
    offset: int,
    video_id: str | None,
    prediction_id: str | None,
    refresh_scope: str | None,
    stale_days: int,
) -> dict:
    stage = _canonical_stage(stage)
    target_ids = _pull_stage_inputs(stage, batch_size, offset, video_id)
    started_at = time.time()
    commands = _command_for_stage(
        stage,
        batch_size=batch_size,
        prediction_batch_size=prediction_batch_size,
        offset=offset,
        video_id=video_id,
        prediction_id=prediction_id,
        refresh_scope=refresh_scope,
        stale_days=stale_days,
    )

    log(f"running stage {stage} (video_id={video_id or 'batch'}, targets={len(target_ids) or 'auto'})")
    for command in commands:
        log("exec: " + " ".join(command))
        subprocess.run(command, cwd=str(APP_ROOT), env={**os.environ, "PYTHONUNBUFFERED": "1"}, check=True)

    _push_stage_outputs(stage, target_ids, video_id)
    elapsed = time.time() - started_at
    result = {
        "stage": stage,
        "video_id": video_id,
        "prediction_id": prediction_id,
        "target_ids": target_ids,
        "elapsed_seconds": round(elapsed, 2),
    }
    log(f"completed stage {stage} in {elapsed:.1f}s")
    return result


@app.function(image=image, secrets=[secret], timeout=60 * 60 * 12, cpu=4, memory=8192)
def _run_cpu_stage(
    stage: str,
    batch_size: int = 5,
    prediction_batch_size: int = 10,
    offset: int = 0,
    video_id: str | None = None,
    prediction_id: str | None = None,
    refresh_scope: str | None = None,
    stale_days: int = 30,
) -> dict:
    return _run_stage_commands(
        stage,
        batch_size=batch_size,
        prediction_batch_size=prediction_batch_size,
        offset=offset,
        video_id=video_id,
        prediction_id=prediction_id,
        refresh_scope=refresh_scope,
        stale_days=stale_days,
    )


@app.function(image=image, secrets=[secret], timeout=60 * 60 * 12, cpu=8, memory=32768, gpu="L4")
def _run_gpu_stage(
    stage: str,
    batch_size: int = 5,
    prediction_batch_size: int = 10,
    offset: int = 0,
    video_id: str | None = None,
    prediction_id: str | None = None,
    refresh_scope: str | None = None,
    stale_days: int = 30,
) -> dict:
    return _run_stage_commands(
        stage,
        batch_size=batch_size,
        prediction_batch_size=prediction_batch_size,
        offset=offset,
        video_id=video_id,
        prediction_id=prediction_id,
        refresh_scope=refresh_scope,
        stale_days=stale_days,
    )


@app.function(image=image, secrets=[secret], timeout=60 * 60 * 24, cpu=2, memory=4096)
def run_stage(
    stage: str,
    batch_size: int = 5,
    prediction_batch_size: int = 10,
    offset: int = 0,
    video_id: str | None = None,
    prediction_id: str | None = None,
    refresh_scope: str | None = None,
    stale_days: int = 30,
) -> dict:
    stage = _canonical_stage(stage)
    target = _run_gpu_stage if _stage_uses_gpu(stage) else _run_cpu_stage
    return target.remote(
        stage=stage,
        batch_size=batch_size,
        prediction_batch_size=prediction_batch_size,
        offset=offset,
        video_id=video_id,
        prediction_id=prediction_id,
        refresh_scope=refresh_scope,
        stale_days=stale_days,
    )


@app.function(image=image, secrets=[secret], timeout=60 * 60 * 24, cpu=2, memory=4096)
def run_full(
    start_stage: str = "1",
    batch_size: int = 5,
    prediction_batch_size: int = 10,
    offset: int = 0,
    video_id: str | None = None,
) -> list[dict]:
    start_stage = _canonical_stage(start_stage)
    if start_stage not in FULL_STAGE_ORDER:
        raise ValueError(f"run_full start_stage must be one of {', '.join(FULL_STAGE_ORDER)}")

    started = False
    results: list[dict] = []
    for stage in FULL_STAGE_ORDER:
        if stage == start_stage:
            started = True
        if not started:
            continue
        results.append(
            run_stage.remote(
                stage=stage,
                batch_size=batch_size,
                prediction_batch_size=prediction_batch_size,
                offset=offset,
                video_id=video_id,
            )
        )
    return results


@app.function(
    image=image,
    secrets=[secret],
    timeout=60 * 60 * 24,
    cpu=2,
    memory=4096,
    schedule=modal.Cron("0 9 * * 1", timezone="America/New_York"),
)
def run_incremental(
    batch_size: int = 5,
    prediction_batch_size: int = 50,
    max_new_videos: int = 10,
) -> dict:
    pull_exports()
    before_path = DATA_DIR / "videos.json"
    before_ids = set()
    if before_path.exists():
        before_ids = {video["id"] for video in json.loads(before_path.read_text())}

    run_stage.remote("1")

    pull_exports()
    after_ids = set()
    if before_path.exists():
        after_ids = {video["id"] for video in json.loads(before_path.read_text())}

    new_ids = sorted(after_ids - before_ids)
    if max_new_videos:
        new_ids = new_ids[:max_new_videos]

    log(f"incremental run discovered {len(new_ids)} new video(s)")
    results: list[dict] = []
    for new_id in new_ids:
        for stage in ["2", "3", "3b", "4", "5"]:
            results.append(
                run_stage.remote(
                    stage=stage,
                    batch_size=batch_size,
                    prediction_batch_size=prediction_batch_size,
                    video_id=new_id,
                )
            )

    if new_ids:
        results.append(run_stage.remote("6"))

    return {"new_video_ids": new_ids, "results": results}


@app.function(
    image=image,
    secrets=[secret],
    timeout=60 * 60 * 24,
    cpu=2,
    memory=4096,
    schedule=modal.Cron("0 10 1 * *", timezone="America/New_York"),
)
def run_fact_check_refresh(
    refresh_scope: str = "pending-first",
    stale_days: int = 30,
    batch_size: int = 200,
    video_id: str | None = None,
    prediction_id: str | None = None,
) -> dict:
    if refresh_scope not in {"pending-first", "stale-all", "manual"}:
        raise ValueError("refresh_scope must be one of: pending-first, stale-all, manual")

    refresh_result = run_stage.remote(
        stage="5",
        prediction_batch_size=batch_size,
        video_id=video_id,
        prediction_id=prediction_id,
        refresh_scope=refresh_scope,
        stale_days=stale_days,
    )
    build_result = run_stage.remote("6")
    return {"refresh": refresh_result, "build_master": build_result, "prediction_id": prediction_id}


@app.local_entrypoint()
def main(
    action: str = "run_full",
    stage: str = "1",
    start_stage: str = "1",
    batch_size: int = 5,
    prediction_batch_size: int = 10,
    offset: int = 0,
    video_id: str = "",
    prediction_id: str = "",
    refresh_scope: str = "",
    stale_days: int = 30,
    max_new_videos: int = 10,
) -> None:
    video_arg = video_id or None
    prediction_arg = prediction_id or None
    refresh_arg = refresh_scope or None

    if action == "run_stage":
        result = run_stage.remote(
            stage=stage,
            batch_size=batch_size,
            prediction_batch_size=prediction_batch_size,
            offset=offset,
            video_id=video_arg,
            prediction_id=prediction_arg,
            refresh_scope=refresh_arg,
            stale_days=stale_days,
        )
    elif action == "run_full":
        result = run_full.remote(
            start_stage=start_stage,
            batch_size=batch_size,
            prediction_batch_size=prediction_batch_size,
            offset=offset,
            video_id=video_arg,
        )
    elif action == "run_incremental":
        result = run_incremental.remote(
            batch_size=batch_size,
            prediction_batch_size=prediction_batch_size,
            max_new_videos=max_new_videos,
        )
    elif action == "run_fact_check_refresh":
        result = run_fact_check_refresh.remote(
            refresh_scope=refresh_arg or "pending-first",
            stale_days=stale_days,
            batch_size=prediction_batch_size,
            video_id=video_arg,
            prediction_id=prediction_arg,
        )
    else:
        raise ValueError("action must be one of: run_stage, run_full, run_incremental, run_fact_check_refresh")

    print(json.dumps(result, indent=2))
