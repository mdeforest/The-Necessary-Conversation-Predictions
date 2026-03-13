"""
Stage 4b: Snap prediction timestamps by fuzzy-matching prediction text against transcript segments.
Updates timestamp_seconds in data/predictions/*.json. Safe to re-run.

Usage:
  python pipeline/04b_snap_timestamps.py [--video-id ID] [--min-score FLOAT] [--force]
"""

import argparse
import json
import string
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
PREDICTIONS_DIR = DATA_DIR / "predictions"
TRANSCRIPTS_DIR = DATA_DIR / "transcripts"

# Minimum word-overlap score (0–1) to accept a match. Below this → timestamp set to null.
DEFAULT_MIN_SCORE = 0.25

# Common words to ignore when scoring (they inflate overlap without helping locate the segment)
STOPWORDS = {
    "i", "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "is", "it", "that", "this", "he", "she", "they", "we", "you",
    "be", "will", "would", "could", "should", "going", "get", "go", "have",
    "has", "had", "are", "was", "were", "do", "does", "did", "not", "by",
    "as", "if", "from", "up", "about", "into", "so", "its", "his", "her",
    "their", "our", "my", "me", "him", "us", "there", "just", "been", "also",
}


def log(msg: str):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


def tokenize(text: str) -> set[str]:
    text = text.lower().translate(str.maketrans("", "", string.punctuation))
    return {w for w in text.split() if w not in STOPWORDS and len(w) > 2}


def normalize_text(text: str) -> str:
    return " ".join(
        text.lower().translate(str.maketrans("", "", string.punctuation)).split()
    )


def overlap_score(query_tokens: set[str], target_tokens: set[str]) -> float:
    if not query_tokens:
        return 0.0
    return len(query_tokens & target_tokens) / len(query_tokens)


def score_segment_window(
    prediction: dict, segments: list[dict], start_idx: int, window: int
) -> float:
    """Score a sliding window of segments against prediction text and context."""
    prediction_text = prediction.get("prediction", "")
    context_text = prediction.get("context", "")
    prediction_tokens = tokenize(prediction_text)
    context_tokens = tokenize(context_text)

    if not prediction_tokens and not context_tokens:
        return 0.0

    window_segments = segments[start_idx : start_idx + window]
    window_text = " ".join(s.get("text", "") for s in window_segments)
    seg_tokens = tokenize(window_text)
    prediction_overlap = overlap_score(prediction_tokens, seg_tokens)
    context_overlap = overlap_score(context_tokens, seg_tokens)

    # Prefer windows spoken by the predicted speaker when diarization exists.
    speaker = prediction.get("speaker")
    speaker_bonus = 0.0
    if speaker and any(s.get("speaker") == speaker for s in window_segments):
        speaker_bonus = 0.05

    normalized_prediction = normalize_text(prediction_text)
    normalized_window = normalize_text(window_text)
    phrase_bonus = 0.0
    if normalized_prediction and (
        normalized_prediction in normalized_window
        or normalized_window in normalized_prediction
    ):
        phrase_bonus = 0.15

    # Weight the prediction text more heavily than the descriptive context.
    return (
        (prediction_overlap * 0.75)
        + (context_overlap * 0.2)
        + speaker_bonus
        + phrase_bonus
    )


def best_segment_start_in_window(
    prediction: dict, window_segments: list[dict]
) -> float | None:
    """Within the best-matching window, anchor to the segment where the prediction begins."""
    prediction_text = prediction.get("prediction", "")
    prediction_tokens = tokenize(prediction_text)
    normalized_prediction = normalize_text(prediction_text)
    speaker = prediction.get("speaker")

    best_score = -1.0
    best_start = None

    for segment in window_segments:
        segment_text = segment.get("text", "")
        segment_tokens = tokenize(segment_text)
        normalized_segment = normalize_text(segment_text)

        score = overlap_score(prediction_tokens, segment_tokens)
        if speaker and segment.get("speaker") == speaker:
            score += 0.05
        if normalized_segment and (
            normalized_segment in normalized_prediction
            or normalized_prediction in normalized_segment
        ):
            score += 0.25

        if score > best_score:
            best_score = score
            best_start = segment.get("start")

    return best_start


def find_best_timestamp(
    prediction: dict, segments: list[dict], min_score: float, window: int = 5
) -> float | None:
    """Return the start time of the best-matching segment window, or None if below threshold."""
    prediction_text = prediction.get("prediction", "")
    context_text = prediction.get("context", "")
    if (not tokenize(prediction_text) and not tokenize(context_text)) or not segments:
        return None

    best_score = 0.0
    best_idx = None

    for i in range(len(segments)):
        score = score_segment_window(prediction, segments, i, window)
        if score > best_score:
            best_score = score
            best_idx = i

    if best_score >= min_score and best_idx is not None:
        return best_segment_start_in_window(
            prediction,
            segments[best_idx : best_idx + window],
        )
    return None


def snap_video(video_id: str, min_score: float, force: bool) -> tuple[int, int, int]:
    """Snap timestamps for all predictions in a video. Returns (updated, unchanged, nulled)."""
    pred_path = PREDICTIONS_DIR / f"{video_id}.json"
    transcript_path = TRANSCRIPTS_DIR / f"{video_id}.json"

    if not pred_path.exists():
        return 0, 0, 0

    pred_data = json.loads(pred_path.read_text())
    predictions = pred_data.get("predictions", [])

    if not predictions:
        return 0, 0, 0

    # Load transcript segments
    segments = []
    if transcript_path.exists():
        transcript = json.loads(transcript_path.read_text())
        segments = transcript.get("segments", [])

    updated = unchanged = nulled = 0

    for pred in predictions:
        already_snapped = pred.get("timestamp_snapped", False)
        has_timestamp = pred.get("timestamp_seconds") is not None

        if already_snapped and not force:
            unchanged += 1
            continue

        if not segments:
            # No transcript — clear any guessed timestamp
            if has_timestamp:
                pred["timestamp_seconds"] = None
                nulled += 1
            else:
                unchanged += 1
            continue

        best = find_best_timestamp(pred, segments, min_score)
        old = pred.get("timestamp_seconds")

        if best is not None:
            pred["timestamp_seconds"] = int(best)
            pred["timestamp_snapped"] = True
            if old != int(best):
                updated += 1
            else:
                unchanged += 1
        else:
            pred["timestamp_seconds"] = None
            pred["timestamp_snapped"] = True
            if old is not None:
                nulled += 1
            else:
                unchanged += 1

    pred_path.write_text(json.dumps(pred_data, indent=2))
    return updated, unchanged, nulled


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", help="Snap timestamps for a single video ID")
    parser.add_argument(
        "--min-score", type=float, default=DEFAULT_MIN_SCORE,
        help=f"Minimum word-overlap score to accept a match (default: {DEFAULT_MIN_SCORE})"
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-snap even predictions already marked as snapped"
    )
    args = parser.parse_args()

    if args.video_id:
        pred_files = [PREDICTIONS_DIR / f"{args.video_id}.json"]
    else:
        pred_files = sorted(PREDICTIONS_DIR.glob("*.json"))

    total_updated = total_unchanged = total_nulled = 0

    for pred_file in pred_files:
        video_id = pred_file.stem
        u, unch, n = snap_video(video_id, args.min_score, args.force)
        if u or n:
            log(f"{video_id}: {u} updated, {n} nulled (no match), {unch} unchanged")
        total_updated += u
        total_unchanged += unch
        total_nulled += n

    log(f"\nDone. {total_updated} timestamps snapped, {total_nulled} set to null (no confident match), {total_unchanged} unchanged.")


if __name__ == "__main__":
    main()
