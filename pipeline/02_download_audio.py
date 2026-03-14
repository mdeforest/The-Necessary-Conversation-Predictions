"""
Stage 2: Download audio (mp3) for each video in data/videos.json.
Skips videos already downloaded. Processes in batches.

Usage:
  python pipeline/02_download_audio.py [--batch-size N] [--offset N] [--video-id ID]
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv


def log(msg: str, **kwargs):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", **kwargs)

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
AUDIO_DIR = DATA_DIR / "audio"

load_dotenv(ROOT / ".env")


def download_audio(
    video: dict,
    cookies_from_browser: str | None = None,
    cookies_file: str | None = None,
) -> bool:
    video_id = video["id"]
    out_path = AUDIO_DIR / f"{video_id}.mp3"

    if out_path.exists():
        log(f"  [skip] {video_id} — already downloaded")
        return True

    url = video["url"]
    duration_min = f"{video.get('duration_seconds', 0) // 60}m" if video.get("duration_seconds") else "?m"
    cmd = [
        "yt-dlp",
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "--remote-components", "ejs:github",  # solves YouTube JS challenges (requires deno)
        "-o", str(AUDIO_DIR / "%(id)s.%(ext)s"),
    ]
    if cookies_from_browser:
        cmd += ["--cookies-from-browser", cookies_from_browser]
    if cookies_file:
        cmd += ["--cookies", cookies_file]
    cmd.append(url)
    log(f"  [download] {video_id} — {video['title'][:60]} ({duration_min})")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        log(f"  [error] {video_id}: {result.stderr[-300:]}", file=sys.stderr)
        return False

    size_mb = out_path.stat().st_size / 1_000_000 if out_path.exists() else 0
    log(f"  [done]  {video_id} — {size_mb:.1f} MB saved")
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--offset", type=int, default=0, help="Start from this index in videos.json")
    parser.add_argument("--video-id", help="Download a single specific video ID")
    parser.add_argument("--cookies-from-browser", metavar="BROWSER",
                        help="Pass cookies from browser to yt-dlp (e.g. chrome, safari, firefox). "
                             "Required when YouTube demands authentication.")
    parser.add_argument("--cookies-file",
                        default=os.getenv("YTDLP_COOKIES_FILE"),
                        help="Path to a Netscape-format cookies.txt file for yt-dlp. "
                             "Useful for cloud jobs where --cookies-from-browser is unavailable.")
    args = parser.parse_args()

    if args.cookies_from_browser and args.cookies_file:
        log("Use either --cookies-from-browser or --cookies-file, not both.", file=sys.stderr)
        sys.exit(1)

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)

    videos_path = DATA_DIR / "videos.json"
    if not videos_path.exists():
        log("data/videos.json not found. Run 01_fetch_videos.py first.", file=sys.stderr)
        sys.exit(1)

    videos = json.loads(videos_path.read_text())
    log(f"Loaded {len(videos)} videos from videos.json")

    if args.video_id:
        batch = [v for v in videos if v["id"] == args.video_id]
        if not batch:
            log(f"Video ID {args.video_id} not found in videos.json", file=sys.stderr)
            sys.exit(1)
    else:
        batch = videos[args.offset: args.offset + args.batch_size]

    already_done = sum(1 for v in batch if (AUDIO_DIR / f"{v['id']}.mp3").exists())
    log(f"Batch: {len(batch)} videos ({already_done} already downloaded, {len(batch) - already_done} to fetch)")
    log(f"Offset: {args.offset}, batch size: {args.batch_size}")
    ok = fail = 0
    for i, video in enumerate(batch, 1):
        log(f"[{i}/{len(batch)}] {video.get('published_at', '?')} — {video['title'][:70]}")
        success = download_audio(
            video,
            cookies_from_browser=args.cookies_from_browser,
            cookies_file=args.cookies_file,
        )
        if success:
            ok += 1
        else:
            fail += 1

    log(f"Done. {ok} succeeded, {fail} failed.")
    if fail:
        sys.exit(1)


if __name__ == "__main__":
    main()
