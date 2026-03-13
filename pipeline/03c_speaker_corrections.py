"""
Stage 3c: Speaker corrections — manually identify SPEAKER_XX labels in diarized transcripts.

After running 03b_diarize.py, some speakers may remain as anonymous SPEAKER_XX labels
if the embedding similarity was below the threshold. This script helps you:
  1. Review which anonymous labels exist (with text excerpts to identify speakers)
  2. Generate a corrections template you fill in with real names
  3. Apply those corrections to the transcript files

Once corrections are applied, run:
  python pipeline/03b_diarize.py --update-embeddings
to rebuild speaker embeddings from the corrected segments, improving future episode matching.

Usage:
  # Step 1 — see what needs correcting
  python pipeline/03c_speaker_corrections.py --generate
  # → prints summary + writes data/speaker_corrections.json

  # Step 2 — edit data/speaker_corrections.json
  #   Fill in names for labels you recognize, leave "" for unknowns/guests

  # Step 3 — apply corrections to transcripts
  python pipeline/03c_speaker_corrections.py --apply

  # Step 4 — improve embeddings for future episodes
  python pipeline/03b_diarize.py --update-embeddings

  # Check remaining unknowns at any time (no file written)
  python pipeline/03c_speaker_corrections.py
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
TRANSCRIPTS_DIR = DATA_DIR / "transcripts"
CORRECTIONS_PATH = DATA_DIR / "speaker_corrections.json"

EXCERPT_LEN = 120


def log(msg: str, **kwargs):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", **kwargs)


def collect_unknowns(video_id: str | None) -> list[dict]:
    """
    Scan diarized transcripts for SPEAKER_XX labels still in use.
    Returns list of dicts: {video_id, label, count, total_dur, example_text}
    sorted by video_id then label.
    """
    if video_id:
        paths = [TRANSCRIPTS_DIR / f"{video_id}.json"]
    else:
        paths = sorted(TRANSCRIPTS_DIR.glob("*.json"))

    rows = []
    for path in paths:
        if not path.exists():
            continue
        transcript = json.loads(path.read_text())
        if not transcript.get("diarized"):
            continue

        vid = transcript.get("video_id", path.stem)
        segs = transcript.get("segments", [])

        by_label: dict[str, list[dict]] = {}
        for seg in segs:
            label = seg.get("speaker", "")
            if label.startswith("SPEAKER_"):
                by_label.setdefault(label, []).append(seg)

        for label, label_segs in sorted(by_label.items()):
            total_dur = sum(s["end"] - s["start"] for s in label_segs)
            # Use the longest text segment as the excerpt (most content-rich)
            longest = max(label_segs, key=lambda s: len(s.get("text", "")))
            example = longest.get("text", "").strip()
            rows.append({
                "video_id": vid,
                "label": label,
                "count": len(label_segs),
                "total_dur": total_dur,
                "example_text": example,
            })

    return rows


def print_summary(rows: list[dict]):
    """Print a table of unknown speaker labels with context."""
    if not rows:
        print("No SPEAKER_XX labels found in diarized transcripts. All speakers identified!")
        return

    # Column widths
    vid_w = max(len(r["video_id"]) for r in rows)
    vid_w = max(vid_w, 8)

    header = f"{'Video ID':<{vid_w}}  {'Speaker':<12}  {'Segs':>5}  {'Duration':>9}  Example text"
    print(header)
    print("-" * min(len(header) + EXCERPT_LEN, 160))

    for r in rows:
        excerpt = r["example_text"]
        if len(excerpt) > EXCERPT_LEN:
            excerpt = excerpt[:EXCERPT_LEN - 3] + "..."
        print(f"{r['video_id']:<{vid_w}}  {r['label']:<12}  {r['count']:>5}  {r['total_dur']:>8.1f}s  {excerpt}")

    n_episodes = len({r["video_id"] for r in rows})
    print(f"\n{len(rows)} unknown label(s) across {n_episodes} episode(s).")


def show_summary(video_id: str | None):
    """Default mode: print status table, no file written."""
    rows = collect_unknowns(video_id)
    print_summary(rows)
    if rows:
        print("Run with --generate to create data/speaker_corrections.json template.")


def generate_template(video_id: str | None):
    """Print summary AND write/merge corrections template."""
    rows = collect_unknowns(video_id)
    print_summary(rows)

    if not rows:
        return

    # Load existing corrections to preserve already-filled names
    if CORRECTIONS_PATH.exists():
        existing = json.loads(CORRECTIONS_PATH.read_text())
        log(f"Merging with existing {CORRECTIONS_PATH.name} (preserving filled names)")
    else:
        existing = {}

    template = {k: dict(v) for k, v in existing.items()}  # deep copy

    for r in rows:
        vid = r["video_id"]
        label = r["label"]
        if vid not in template:
            template[vid] = {}
        if label not in template[vid]:
            template[vid][label] = ""

    # Sort keys for readability
    template = {vid: dict(sorted(labels.items())) for vid, labels in sorted(template.items())}

    CORRECTIONS_PATH.write_text(json.dumps(template, indent=2))

    blank_count = sum(1 for labels in template.values() for v in labels.values() if v == "")
    print()
    log(f"Written to {CORRECTIONS_PATH}")
    log(f"  {blank_count} blank entries to fill in.")
    log('  Fill in speaker names (e.g. "Chad Kultgen") or leave "" for unknowns/guests.')
    log("  Then run: python pipeline/03c_speaker_corrections.py --apply")


def apply_corrections(video_id: str | None):
    """Apply filled-in corrections from the corrections file to transcript files."""
    if not CORRECTIONS_PATH.exists():
        log(f"No corrections file found at {CORRECTIONS_PATH}.", file=sys.stderr)
        log("Run with --generate to create it, fill in speaker names, then --apply.")
        sys.exit(1)

    all_corrections: dict[str, dict[str, str]] = json.loads(CORRECTIONS_PATH.read_text())

    if video_id:
        if video_id not in all_corrections:
            log(f"No corrections found for video_id={video_id}")
            return
        to_apply = {video_id: all_corrections[video_id]}
    else:
        to_apply = all_corrections

    if not to_apply:
        log("Corrections file is empty — nothing to apply.")
        return

    total_changed = 0
    for vid, label_map in sorted(to_apply.items()):
        # Only apply non-empty name mappings
        filled = {label: name for label, name in label_map.items() if name.strip()}
        if not filled:
            log(f"  [skip] {vid} — no names filled in")
            continue

        transcript_path = TRANSCRIPTS_DIR / f"{vid}.json"
        if not transcript_path.exists():
            log(f"  [skip] {vid} — transcript not found", file=sys.stderr)
            continue

        transcript = json.loads(transcript_path.read_text())
        if not transcript.get("diarized"):
            log(f"  [skip] {vid} — not diarized, skipping", file=sys.stderr)
            continue

        # Apply substitutions
        changed = 0
        segments = transcript["segments"]
        for seg in segments:
            old_label = seg.get("speaker", "")
            if old_label in filled:
                seg["speaker"] = filled[old_label]
                changed += 1

        if changed == 0:
            log(f"  [skip] {vid} — no matching SPEAKER_XX labels found (already applied?)")
            continue

        # Rebuild full_text to reflect new names (same format as 03b_diarize.py)
        transcript["full_text"] = "\n".join(
            f"[{seg['speaker']}] {seg['text']}"
            for seg in segments
            if seg.get("text", "").strip()
        )
        transcript["corrections_applied"] = True

        transcript_path.write_text(json.dumps(transcript, indent=2))

        applied_str = ", ".join(f"{k} → {v}" for k, v in filled.items())
        log(f"  [done] {vid} — replaced {changed} segments [{applied_str}]")
        total_changed += changed

    if total_changed:
        print()
        log(f"Done. {total_changed} segment(s) updated across all episodes.")
        log("Run 'python pipeline/03b_diarize.py --update-embeddings' to improve future recognition.")
    else:
        log("No changes made.")


def main():
    parser = argparse.ArgumentParser(
        description="Review and correct SPEAKER_XX labels in diarized transcripts.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Workflow:
  1. python pipeline/03c_speaker_corrections.py --generate
     → prints summary + writes data/speaker_corrections.json template

  2. Edit data/speaker_corrections.json
     → fill in names for labels you recognize, leave "" for unknowns/guests

  3. python pipeline/03c_speaker_corrections.py --apply
     → updates transcript files with real names

  4. python pipeline/03b_diarize.py --update-embeddings
     → rebuilds embeddings from corrected segments for better future matching

  Check remaining unknowns at any time (no file written):
    python pipeline/03c_speaker_corrections.py
""",
    )
    parser.add_argument(
        "--generate", action="store_true",
        help="Print summary and write data/speaker_corrections.json template",
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="Apply corrections from data/speaker_corrections.json to transcript files",
    )
    parser.add_argument(
        "--video-id",
        help="Limit to a single video ID (useful for inspecting or correcting one episode)",
    )
    args = parser.parse_args()

    if args.apply and args.generate:
        log("Error: use --generate or --apply, not both.", file=sys.stderr)
        sys.exit(1)

    if args.apply:
        apply_corrections(args.video_id)
    elif args.generate:
        generate_template(args.video_id)
    else:
        show_summary(args.video_id)


if __name__ == "__main__":
    main()
