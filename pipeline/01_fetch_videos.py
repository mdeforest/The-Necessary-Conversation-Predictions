"""
Stage 1: Fetch all video metadata from the Necessary Conversation YouTube channel.
Writes data/videos.json with [{id, title, url, published_at, duration}].
Safe to re-run — overwrites with the latest full list.
"""

import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path


def log(msg: str, **kwargs):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", **kwargs)

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"

# Fetch from /videos (uploads) and /streams (lives) — excludes /shorts
CHANNEL_URLS = [
    "https://www.youtube.com/@TheNecessaryConversation/videos",
    "https://www.youtube.com/@TheNecessaryConversation/streams",
]


def fetch_video_ids(channel_url: str) -> list[dict]:
    """Phase 1: fast flat-playlist fetch to get IDs and titles."""
    cmd = [
        "yt-dlp",
        "--flat-playlist",
        "--print", "%(id)s\t%(title)s\t%(webpage_url)s",
        channel_url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print("yt-dlp error:", result.stderr, file=sys.stderr)
        sys.exit(1)

    videos = []
    for line in result.stdout.strip().splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        video_id, title, url = parts[:3]
        videos.append({"id": video_id, "title": title, "url": url})
    return videos


def fetch_video_metadata(video: dict) -> dict:
    """Phase 2: fetch date + duration for a single video."""
    cmd = [
        "yt-dlp",
        "--skip-download",
        "--no-write-info-json",
        "--print", "%(upload_date)s\t%(duration)s",
        video["url"],
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    upload_date, duration = "", ""
    if result.returncode == 0 and result.stdout.strip():
        parts = result.stdout.strip().split("\t")
        upload_date = parts[0] if parts else ""
        duration = parts[1] if len(parts) > 1 else ""

    published_at = None
    if upload_date and upload_date != "NA" and len(upload_date) == 8:
        published_at = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}"
    try:
        duration_seconds = int(float(duration))
    except (ValueError, TypeError):
        duration_seconds = None

    return {**video, "published_at": published_at, "duration_seconds": duration_seconds}


def fetch_videos(channel_urls: list[str], workers: int = 8) -> list[dict]:
    all_stubs: dict[str, dict] = {}  # keyed by id to deduplicate
    for url in channel_urls:
        log(f"Fetching video list from {url} ...")
        stubs = fetch_video_ids(url)
        log(f"  → {len(stubs)} videos found")
        for s in stubs:
            all_stubs[s["id"]] = s
    stubs = list(all_stubs.values())
    log(f"{len(stubs)} total unique videos. Fetching dates in parallel ({workers} workers) ...")

    videos = [None] * len(stubs)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_idx = {executor.submit(fetch_video_metadata, stub): i for i, stub in enumerate(stubs)}
        done = 0
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            video = future.result()
            videos[idx] = video
            done += 1
            log(f"  [{done}/{len(stubs)}] {video['id']} — {video['title'][:55]} ({video['published_at'] or 'no date'})")

    # Sort oldest-first
    videos.sort(key=lambda v: v["published_at"] or "")
    no_date = sum(1 for v in videos if not v["published_at"])
    if no_date:
        log(f"Warning: {no_date} videos had no date and will sort to the front.")
    return videos


def main():
    DATA_DIR.mkdir(exist_ok=True)
    videos = fetch_videos(CHANNEL_URLS)
    out_path = DATA_DIR / "videos.json"
    out_path.write_text(json.dumps(videos, indent=2))
    log(f"Saved {len(videos)} videos to {out_path}")
    if videos:
        log(f"Date range: {videos[0]['published_at']} → {videos[-1]['published_at']}")


if __name__ == "__main__":
    main()
