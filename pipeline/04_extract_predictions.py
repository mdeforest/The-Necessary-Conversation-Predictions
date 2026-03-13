"""
Stage 4: Extract predictions from transcripts using Claude.
Skips videos already processed. Processes in batches.

Usage:
  python pipeline/04_extract_predictions.py [--batch-size N] [--offset N] [--video-id ID]
"""

import argparse
import json
import os
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path

from openai import OpenAI
from dotenv import load_dotenv
from tqdm import tqdm


def log(msg: str, **kwargs):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", **kwargs)

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
TRANSCRIPTS_DIR = DATA_DIR / "transcripts"
PREDICTIONS_DIR = DATA_DIR / "predictions"

load_dotenv(ROOT / ".env")

client = OpenAI(
    api_key=os.environ["DEEPSEEK_API_KEY"],
    base_url="https://api.deepseek.com",
)

PODCAST_DESCRIPTION = (
    "The Necessary Conversation is a podcast that explores deep political and ideological divides within a single family — "
    "often described as 'family therapy through politics.' It is hosted by novelist Chad Kultgen and his sister Haley Popp, "
    "who engage in recurring, unfiltered, and often heated debates with their conservative parents, Mary Lou and Bob Kultgen. "
    "Topics typically include US politics, culture war issues, religion, and social policy."
)

SYSTEM_PROMPT = f"""You are an expert analyst identifying falsifiable predictions in podcast transcripts.

ABOUT THE PODCAST:
{PODCAST_DESCRIPTION}

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

SPEAKER NAMES: Use the most complete version of the name you can infer from context (e.g., "John Smith" not "John" or "the guest"). If the transcript has no speaker labels, infer from context (host vs. guest, names used in conversation). Use "Host" or "Guest" as a last resort, not "Unknown".

DEDUPLICATION: If the same prediction is made more than once (e.g., restated for emphasis or revisited later), include it only once. Use the earliest timestamp.

Return ONLY the JSON object, no other text."""

EXTRACTION_PROMPT = """Analyze the following podcast transcript and extract all genuine predictions. Remember: only include claims that are forward-looking, specific enough to eventually verify, and where the speaker is asserting their actual belief — not just exploring a hypothetical.

When filling in the "timeframe" field, anchor relative dates to the episode's recording date. For example, if the episode was recorded in March 2023 and the speaker says "by next year", the timeframe should be "by end of 2024".

{speaker_note}

Episode: {title}
Recorded: {date}

Transcript:
{transcript}"""

SPEAKER_NOTE_LABELED = """SPEAKER LABELS: This transcript has been speaker-diarized. Each line is prefixed with [Speaker Name]. Use these labels directly for the "speaker" field — do not guess or infer from context when a label is present. The known speakers are Chad Kultgen, Haley Popp, Mary Lou Kultgen, and Bob Kultgen."""

SPEAKER_NOTE_UNLABELED = """SPEAKER LABELS: This transcript has no speaker labels. Infer speaker identity from context: names used in conversation, topic stances (Chad and Haley are progressive hosts; Mary Lou and Bob Kultgen are conservative parents). Use full names when inferable."""


def extract_predictions(video: dict, transcript: dict) -> list[dict]:
    is_diarized = transcript.get("diarized", False)
    speaker_note = SPEAKER_NOTE_LABELED if is_diarized else SPEAKER_NOTE_UNLABELED

    # Build timestamped transcript: "[830s] [Chad Kultgen] text..."
    segments = transcript.get("segments", [])
    if segments:
        lines = []
        for seg in segments:
            t = int(seg.get("start", 0))
            speaker = seg.get("speaker", "")
            text = seg.get("text", "").strip()
            if not text:
                continue
            prefix = f"[{speaker}] " if speaker else ""
            lines.append(f"[{t}s] {prefix}{text}")
        transcript_text = "\n".join(lines)[:150000]
    else:
        transcript_text = transcript.get("full_text", "")[:150000]

    prompt = EXTRACTION_PROMPT.format(
        title=video["title"],
        date=video.get("published_at", "Unknown"),
        speaker_note=speaker_note,
        transcript=transcript_text,
    )

    response = client.chat.completions.create(
        model="deepseek-chat",
        max_tokens=8192,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
    )

    raw = response.choices[0].message.content.strip()

    # Strip markdown code fences if Claude wrapped the JSON
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    parsed = json.loads(raw)
    predictions = parsed.get("predictions", [])

    # Assign stable UUIDs
    for p in predictions:
        p["id"] = str(uuid.uuid4())
        p["video_id"] = video["id"]

    return predictions


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=int(os.getenv("PREDICTION_BATCH_SIZE", 10)))
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--video-id", help="Process a single specific video ID")
    args = parser.parse_args()

    PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)

    videos_path = DATA_DIR / "videos.json"
    if not videos_path.exists():
        log("data/videos.json not found. Run 01_fetch_videos.py first.", file=sys.stderr)
        sys.exit(1)

    videos = json.loads(videos_path.read_text())
    video_map = {v["id"]: v for v in videos}

    if args.video_id:
        transcript_paths = [TRANSCRIPTS_DIR / f"{args.video_id}.json"]
        to_process = [
            p for p in transcript_paths
            if not (PREDICTIONS_DIR / p.name).exists()
            and json.loads(p.read_text()).get("diarized", False)
        ]
    else:
        # Filter to diarized-only first, then apply batch/offset so the
        # batch window doesn't get eaten by non-diarized transcripts.
        all_diarized = [
            p for p in sorted(TRANSCRIPTS_DIR.glob("*.json"))
            if json.loads(p.read_text()).get("diarized", False)
        ]
        already_done = [p for p in all_diarized if (PREDICTIONS_DIR / p.name).exists()]
        pending = [p for p in all_diarized if not (PREDICTIONS_DIR / p.name).exists()]
        if already_done:
            log(f"Skipping {len(already_done)} already-extracted episodes.")
        to_process = pending[args.offset: args.offset + args.batch_size]

    if not to_process:
        log("Nothing to extract.")
        return

    log(f"Extracting predictions from {len(to_process)} transcripts (using DeepSeek V3) ...")
    total_predictions = 0

    for i, transcript_path in enumerate(to_process, 1):
        video_id = transcript_path.stem
        video = video_map.get(video_id, {"id": video_id, "title": video_id, "published_at": "Unknown"})
        transcript = json.loads(transcript_path.read_text())
        chars = len(transcript.get("full_text", ""))
        log(f"\n[{i}/{len(to_process)}] {video.get('published_at', '?')} — {video['title'][:70]}")
        log(f"  Transcript: {chars:,} chars → sending to DeepSeek ...")

        t0 = time.time()
        try:
            predictions = extract_predictions(video, transcript)
        except Exception as e:
            log(f"  [error] {e}", file=sys.stderr)
            continue
        elapsed = time.time() - t0

        out = {"video_id": video_id, "predictions": predictions}
        (PREDICTIONS_DIR / f"{video_id}.json").write_text(json.dumps(out, indent=2))
        total_predictions += len(predictions)

        by_specificity = {}
        for p in predictions:
            s = p.get("specificity", "?")
            by_specificity[s] = by_specificity.get(s, 0) + 1
        spec_str = ", ".join(f"{k}:{v}" for k, v in sorted(by_specificity.items()))
        log(f"  [done] {len(predictions)} predictions in {elapsed:.1f}s [{spec_str}]")

    log(f"\nDone. {total_predictions} predictions extracted across {len(to_process)} videos.")


if __name__ == "__main__":
    main()
