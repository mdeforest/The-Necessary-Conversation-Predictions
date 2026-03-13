"""
Stage 6: Aggregate all predictions + fact-checks into predictions_master.json.
Also prints a summary breakdown.

Usage:
  python pipeline/06_build_master.py
"""

import json
from collections import Counter
from datetime import datetime
from pathlib import Path


def log(msg: str, **kwargs):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", **kwargs)

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
PREDICTIONS_DIR = DATA_DIR / "predictions"
FACT_CHECKS_DIR = DATA_DIR / "fact_checks"
OUT_PATH = ROOT / "predictions_master.json"


def main():
    videos_path = DATA_DIR / "videos.json"
    videos = {}
    if videos_path.exists():
        for v in json.loads(videos_path.read_text()):
            videos[v["id"]] = v

    # Load all fact-checks into a lookup by prediction_id
    fact_check_map: dict[str, dict] = {}
    for fc_file in FACT_CHECKS_DIR.glob("*.json"):
        data = json.loads(fc_file.read_text())
        for fc in data.get("fact_checks", []):
            fact_check_map[fc["prediction_id"]] = fc

    all_records = []
    for pred_file in sorted(PREDICTIONS_DIR.glob("*.json")):
        data = json.loads(pred_file.read_text())
        video_id = data["video_id"]
        video = videos.get(video_id, {"id": video_id, "title": "Unknown", "published_at": "Unknown", "url": ""})

        for pred in data.get("predictions", []):
            fc = fact_check_map.get(pred["id"], {})
            record = {
                "prediction_id": pred["id"],
                "video_id": video_id,
                "video_title": video.get("title", ""),
                "video_url": video.get("url", ""),
                "episode_date": video.get("published_at", ""),
                "speaker": pred.get("speaker", "Unknown"),
                "timestamp_seconds": pred.get("timestamp_seconds"),
                "prediction": pred.get("prediction", ""),
                "context": pred.get("context", ""),
                "topic": pred.get("topic", "other"),
                "verdict": fc.get("verdict"),
                "confidence": fc.get("confidence"),
                "explanation": fc.get("explanation"),
                "sources": fc.get("sources", []),
            }
            all_records.append(record)

    OUT_PATH.write_text(json.dumps(all_records, indent=2))
    log(f"Wrote {len(all_records)} predictions to {OUT_PATH}")

    # Summary stats
    fact_checked = [r for r in all_records if r["verdict"]]
    verdicts = Counter(r["verdict"] for r in fact_checked)
    topics = Counter(r["topic"] for r in all_records)

    log(f"\n=== Summary ===")
    log(f"Total predictions:   {len(all_records)}")
    log(f"Fact-checked:        {len(fact_checked)}")
    log(f"Pending fact-check:  {len(all_records) - len(fact_checked)}")
    log("")
    log("Verdicts:")
    for verdict, count in verdicts.most_common():
        log(f"  {verdict:15s} {count}")
    log("")
    log("By topic:")
    for topic, count in topics.most_common():
        log(f"  {topic:15s} {count}")


if __name__ == "__main__":
    main()
