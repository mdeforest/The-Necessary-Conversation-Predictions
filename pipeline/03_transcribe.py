"""
Stage 3: Transcribe audio files using local OpenAI Whisper.
Skips videos already transcribed. Processes in batches.

Usage:
  python pipeline/03_transcribe.py [--batch-size N] [--offset N] [--video-id ID] [--model MODEL]
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from tqdm import tqdm


def log(msg: str, **kwargs):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", **kwargs)

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
AUDIO_DIR = DATA_DIR / "audio"
TRANSCRIPTS_DIR = DATA_DIR / "transcripts"

load_dotenv(ROOT / ".env")


def transcribe_audio(video_id: str, model) -> dict | None:
    audio_path = AUDIO_DIR / f"{video_id}.mp3"
    out_path = TRANSCRIPTS_DIR / f"{video_id}.json"

    if out_path.exists():
        log(f"  [skip] {video_id} — transcript already exists")
        return None

    if not audio_path.exists():
        log(f"  [skip] {video_id} — audio file not found", file=sys.stderr)
        return None

    size_mb = audio_path.stat().st_size / 1_000_000
    log(f"  [transcribe] {video_id} — {size_mb:.1f} MB audio ...")
    t0 = time.time()
    result = model.transcribe(str(audio_path), verbose=False)
    elapsed = time.time() - t0

    segments = [
        {"start": seg["start"], "end": seg["end"], "text": seg["text"].strip()}
        for seg in result["segments"]
    ]
    duration = segments[-1]["end"] if segments else 0
    chars = sum(len(s["text"]) for s in segments)

    transcript = {
        "video_id": video_id,
        "language": result.get("language", "en"),
        "segments": segments,
        "full_text": " ".join(seg["text"] for seg in segments),
    }

    out_path.write_text(json.dumps(transcript, indent=2))
    log(f"  [done]  {video_id} — {len(segments)} segments, {duration/60:.1f}m audio, {chars:,} chars, took {elapsed:.0f}s")
    return transcript


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=int(os.getenv("BATCH_SIZE", 5)))
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--video-id", help="Transcribe a single specific video ID")
    parser.add_argument("--model", default=os.getenv("WHISPER_MODEL", "medium"),
                        choices=["tiny", "base", "small", "medium", "large"])
    args = parser.parse_args()

    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)

    videos_path = DATA_DIR / "videos.json"
    if not videos_path.exists():
        log("data/videos.json not found. Run 01_fetch_videos.py first.", file=sys.stderr)
        sys.exit(1)

    videos = json.loads(videos_path.read_text())

    if args.video_id:
        batch = [v for v in videos if v["id"] == args.video_id]
        if not batch:
            log(f"Video ID {args.video_id} not found in videos.json", file=sys.stderr)
            sys.exit(1)
    else:
        batch = videos[args.offset: args.offset + args.batch_size]

    # Filter to only videos that have audio and aren't already transcribed
    to_process = [
        v for v in batch
        if (AUDIO_DIR / f"{v['id']}.mp3").exists()
        and not (TRANSCRIPTS_DIR / f"{v['id']}.json").exists()
    ]
    skipped = len(batch) - len(to_process)
    if skipped:
        log(f"Skipping {skipped} already-transcribed or missing-audio videos.")

    if not to_process:
        log("Nothing to transcribe.")
        return

    log(f"Loading Whisper '{args.model}' model ...")
    import whisper
    model = whisper.load_model(args.model)
    log(f"Model loaded. Transcribing {len(to_process)} videos ...")

    for i, video in enumerate(to_process, 1):
        log(f"[{i}/{len(to_process)}] {video.get('published_at', '?')} — {video['title'][:70]}")
        transcribe_audio(video["id"], model)

    log("All done.")


if __name__ == "__main__":
    main()
