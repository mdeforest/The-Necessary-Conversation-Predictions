"""
Run the full pipeline end-to-end in batches.
Each stage skips already-completed work, so this is safe to re-run.

Usage:
  python pipeline/run_all.py [--batch-size N] [--start-stage N] [--video-id ID]

Stages:
  1  - Fetch video list
  2  - Download audio
  3  - Transcribe
  3b - Speaker diarization (skipped if --skip-diarize)
  4  - Extract predictions
  5  - Fact-check
  6  - Build master JSON
"""

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
PIPELINE_DIR = Path(__file__).parent


def run_stage(script: str, extra_args: list[str] = []) -> bool:
    cmd = [sys.executable, str(PIPELINE_DIR / script)] + extra_args
    print(f"\n{'='*60}")
    print(f"Running: {' '.join(cmd)}")
    print("=" * 60)
    result = subprocess.run(cmd, cwd=str(ROOT))
    if result.returncode != 0:
        print(f"\n[FAILED] {script} exited with code {result.returncode}", file=sys.stderr)
        return False
    return True


def main():
    parser = argparse.ArgumentParser(description="Run the full prediction pipeline")
    parser.add_argument("--batch-size", type=int, default=5,
                        help="Number of videos to process per batch for stages 2-3")
    parser.add_argument("--prediction-batch-size", type=int, default=10,
                        help="Number of predictions to process per batch for stages 4-5")
    parser.add_argument("--offset", type=int, default=0,
                        help="Start from this video index (for stages 2-3)")
    parser.add_argument("--start-stage", type=int, default=1, choices=range(1, 7),
                        help="Skip stages before this number")
    parser.add_argument("--skip-diarize", action="store_true",
                        help="Skip stage 3b (speaker diarization). Use if pyannote not installed.")
    parser.add_argument("--video-id", help="Run pipeline for a single video ID only")
    args = parser.parse_args()

    stages = {
        1: ("01_fetch_videos.py", []),
        2: ("02_download_audio.py", [
            "--batch-size", str(args.batch_size),
            "--offset", str(args.offset),
        ] + (["--video-id", args.video_id] if args.video_id else [])),
        3: ("03_transcribe.py", [
            "--batch-size", str(args.batch_size),
            "--offset", str(args.offset),
        ] + (["--video-id", args.video_id] if args.video_id else [])),
        4: ("04_extract_predictions.py", [
            "--batch-size", str(args.prediction_batch_size),
            "--offset", str(args.offset),
        ] + (["--video-id", args.video_id] if args.video_id else [])),
        5: ("05_fact_check.py", [
            "--batch-size", str(args.prediction_batch_size),
        ] + (["--video-id", args.video_id] if args.video_id else [])),
        6: ("06_build_master.py", []),
    }

    for stage_num in range(args.start_stage, 7):
        # Stage 3b: diarization inserted between transcription and extraction
        # Stage 3b: diarization inserted between transcription and extraction.
        # After diarization, some speakers may remain as SPEAKER_XX labels if their
        # embedding similarity was below threshold. To correct these manually:
        #
        #   python pipeline/03c_speaker_corrections.py --generate   # review + create template
        #   # edit data/speaker_corrections.json — fill in real names
        #   python pipeline/03c_speaker_corrections.py --apply       # update transcripts
        #   python pipeline/03b_diarize.py --update-embeddings       # improve future matching
        #
        # Then continue the pipeline from stage 4.
        if stage_num == 4 and not args.skip_diarize:
            ok = run_stage("03b_diarize.py", [
                "--batch-size", str(args.batch_size),
                "--offset", str(args.offset),
            ] + (["--video-id", args.video_id] if args.video_id else []))
            if not ok:
                print("\nPipeline stopped at stage 3b (diarization).", file=sys.stderr)
                sys.exit(1)
        script, extra_args = stages[stage_num]
        ok = run_stage(script, extra_args)
        if not ok:
            print(f"\nPipeline stopped at stage {stage_num}.", file=sys.stderr)
            sys.exit(1)

    print("\n\nPipeline complete!")


if __name__ == "__main__":
    main()
