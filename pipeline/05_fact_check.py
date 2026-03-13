"""
Stage 5: Fact-check predictions using Gemini 2.0 Flash + Google Search grounding.
Gemini searches the web automatically via its built-in Google Search tool.
Skips already fact-checked predictions. Processes in batches.

Usage:
  python pipeline/05_fact_check.py [--batch-size N] [--video-id ID] [--prediction-id ID]
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import date, datetime
from pathlib import Path

from dotenv import load_dotenv
from google import genai


def log(msg: str, **kwargs):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", **kwargs)
from google.genai import types

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
PREDICTIONS_DIR = DATA_DIR / "predictions"
FACT_CHECKS_DIR = DATA_DIR / "fact_checks"

load_dotenv(ROOT / ".env")

client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])

PODCAST_DESCRIPTION = (
    "The Necessary Conversation is a podcast that explores deep political and ideological divides within a single family — "
    "often described as 'family therapy through politics.' It is hosted by novelist Chad Kultgen and his sister Haley Popp, "
    "who engage in recurring, unfiltered, and often heated debates with their conservative parents, Mary Lou and Bob Kultgen. "
    "Topics typically include US politics, culture war issues, religion, and social policy."
)


def _build_system_prompt() -> str:
    today = date.today().isoformat()
    return f"""You are a rigorous fact-checker verifying predictions made on a podcast.
Today's date is {today}. Use this to determine whether a prediction's timeframe has elapsed.

ABOUT THE PODCAST:
{PODCAST_DESCRIPTION}

VERDICTS — use exactly one:
- "true": The prediction clearly came true. There is solid evidence it happened as stated.
- "false": The prediction clearly did not come true. There is solid evidence against it.
- "pending": The prediction's timeframe has not yet passed, OR the outcome is expected but not yet known. Use this when the prediction is still live and could still resolve either way.
- "unverifiable": The prediction is too vague to assess, or the topic is one where no reliable public evidence exists regardless of timeframe.

RESEARCH STRATEGY:
1. Search for the core claim directly.
2. Search for counter-evidence — what if the opposite happened?
3. If ambiguous, search for the most recent news on the topic.
4. Do at least 2 searches, up to 5 for complex multi-part claims.
5. For predictions with a specific timeframe, check whether that window has passed.

CONFIDENCE:
- "high": Multiple reliable sources agree. The outcome is clear-cut.
- "medium": Some evidence, but sources conflict or the evidence is indirect.
- "low": Limited or ambiguous evidence; outcome is hard to pin down.

SOURCE QUALITY:
- High reliability: Official government/institutional sources, Reuters, AP, BBC, major newspapers (NYT, WSJ, FT), peer-reviewed publications
- Medium reliability: Regional news outlets, industry trade publications, established political/financial data sites
- Low reliability: Blogs, opinion pieces, social media posts, forums, aggregators
A "high" confidence verdict requires at least two high-reliability sources agreeing.

After researching, return a JSON object with:
- "verdict": one of "true", "partially true", "false", "pending", "unverifiable"
- "confidence": one of "high", "medium", "low"
- "explanation": 3-5 sentences — state the evidence found, what it shows, and why you chose this verdict. If the prediction had multiple parts, address each.
- "sources": list of URLs that directly support your verdict (include at least 1 if available)

Return ONLY the JSON object, no other text."""


SYSTEM_PROMPT = _build_system_prompt()


JSON_FORMAT_REMINDER = (
    "\n\nYou MUST respond with ONLY a JSON object in exactly this format, no other text:\n"
    '{"verdict": "true|partially true|false|pending|unverifiable", "confidence": "high|medium|low", '
    '"explanation": "3-5 sentences", "sources": ["url1", "url2"]}'
)

SAFETY_SETTINGS = [
    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_CIVIC_INTEGRITY", threshold="BLOCK_NONE"),
]


def _build_prompt(prediction: dict, video: dict, neutral: bool = False) -> str:
    episode_date = video.get("published_at", "Unknown date")
    timeframe = prediction.get("timeframe", "unspecified")
    topic = prediction.get("topic", "")
    specificity = prediction.get("specificity", "")
    text = prediction["prediction"]

    if neutral:
        return (
            "For journalism fact-checking research, please verify whether the following claim came true.\n"
            f"Date the claim was made: {episode_date}\n"
            f"Topic area: {topic}\n"
            f"Predicted timeframe: {timeframe}\n"
            f"Claim: {text}\n\n"
            "Search for factual evidence about whether this occurred. "
            "Focus only on verifiable public facts."
            + JSON_FORMAT_REMINDER
        )

    return (
        f"Prediction from podcast episode recorded on {episode_date}:\n"
        f"Speaker: {prediction.get('speaker', 'Unknown')}\n"
        f"Topic: {topic}\n"
        f"Predicted timeframe: {timeframe}\n"
        f"Specificity: {specificity}\n"
        f"Prediction: {text}\n"
        f"Context: {prediction.get('context', '')}\n\n"
        "Search the web to determine whether this prediction came true. "
        "Consider whether the predicted timeframe has passed. "
        "Search for both supporting and contradicting evidence. "
        "If specificity is 'low', consider whether the prediction is verifiable at all before searching."
        + JSON_FORMAT_REMINDER
    )


def _call_model(prompt: str) -> tuple[str, object]:
    """Call Gemini with rate-limit retry. Returns (raw_text, response) — raw is '' if blocked."""
    max_retries = 4
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                    temperature=0.1,
                    safety_settings=SAFETY_SETTINGS,
                ),
            )
            try:
                raw = (response.text or "").strip()
            except Exception:
                raw = ""
            return raw, response
        except Exception as e:
            err = str(e)
            if "429" in err or "RESOURCE_EXHAUSTED" in err:
                if "free_tier" in err or attempt == max_retries - 1:
                    raise RuntimeError(
                        "Gemini free-tier daily quota exhausted. Add billing at "
                        "https://aistudio.google.com or wait ~24h for reset."
                    ) from e
                wait = 30 * (2 ** attempt)  # 30s, 60s, 120s
                log(f"  [rate limit] retrying in {wait}s (attempt {attempt + 1}/{max_retries - 1})...")
                time.sleep(wait)
            else:
                raise
    return "", None


def _parse_raw(raw: str) -> dict | None:
    """Strip fences and parse JSON. Returns None if unparseable."""
    if not raw:
        return None
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
        raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def fact_check_prediction(prediction: dict, video: dict) -> dict:
    # First attempt with full context
    raw, response = _call_model(_build_prompt(prediction, video, neutral=False))
    result = _parse_raw(raw)

    # If blocked or non-JSON, retry with neutral framing
    if result is None:
        log("  [retry] content filter triggered — retrying with neutral framing...")
        raw, response = _call_model(_build_prompt(prediction, video, neutral=True))
        result = _parse_raw(raw)

    if result is None:
        return {
            "prediction_id": prediction["id"],
            "date_generated": date.today().isoformat(),
            "verdict": "unverifiable",
            "confidence": "low",
            "explanation": "The model declined to process this prediction after two attempts (content filter). Unable to fact-check automatically.",
            "sources": [],
        }
    result["prediction_id"] = prediction["id"]
    result["date_generated"] = date.today().isoformat()

    # Extract source URLs from grounding metadata if available
    if not result.get("sources") and response is not None:
        sources = []
        try:
            chunks = response.candidates[0].grounding_metadata.grounding_chunks or []
            for chunk in chunks:
                if hasattr(chunk, "web") and chunk.web.uri:
                    sources.append(chunk.web.uri)
        except (AttributeError, IndexError, TypeError):
            pass
        if sources:
            result["sources"] = sources

    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=int(os.getenv("PREDICTION_BATCH_SIZE", 10)))
    parser.add_argument("--video-id", help="Only fact-check predictions from a specific video")
    parser.add_argument("--prediction-id", help="Fact-check a single specific prediction ID")
    args = parser.parse_args()

    FACT_CHECKS_DIR.mkdir(parents=True, exist_ok=True)

    videos_path = DATA_DIR / "videos.json"
    videos = {}
    if videos_path.exists():
        for v in json.loads(videos_path.read_text()):
            videos[v["id"]] = v

    # Gather all predictions to fact-check
    if args.video_id:
        pred_files = [PREDICTIONS_DIR / f"{args.video_id}.json"]
    else:
        pred_files = sorted(PREDICTIONS_DIR.glob("*.json"))

    # Load existing fact-checks to know what's done
    done_ids: set[str] = set()
    for fc_file in FACT_CHECKS_DIR.glob("*.json"):
        fc_data = json.loads(fc_file.read_text())
        for fc in fc_data.get("fact_checks", []):
            done_ids.add(fc["prediction_id"])

    # Build work queue
    queue: list[tuple[dict, dict]] = []
    for pred_file in pred_files:
        if not pred_file.exists():
            continue
        data = json.loads(pred_file.read_text())
        video_id = data["video_id"]
        video = videos.get(video_id, {"id": video_id, "published_at": "Unknown"})
        for pred in data.get("predictions", []):
            if args.prediction_id and pred["id"] != args.prediction_id:
                continue
            if pred["id"] not in done_ids:
                queue.append((pred, video))

    if not queue:
        log("Nothing to fact-check.")
        return

    batch = queue[: args.batch_size]
    remaining = len(queue) - len(batch)
    log(f"Fact-checking {len(batch)} predictions ({remaining} remaining after this batch)")
    log(f"Using Gemini 2.0 Flash + Google Search grounding\n")

    results_by_video: dict[str, list[dict]] = {}

    for i, (pred, video) in enumerate(batch, 1):
        video_id = video["id"]
        pred_preview = pred["prediction"][:80].replace("\n", " ")
        log(f"[{i}/{len(batch)}] {pred.get('speaker', '?')} ({video.get('published_at', '?')})")
        log(f"  \"{pred_preview}...\"" if len(pred["prediction"]) > 80 else f"  \"{pred['prediction']}\"")
        log(f"  Topic: {pred.get('topic', '?')} | Timeframe: {pred.get('timeframe', '?')} | Specificity: {pred.get('specificity', '?')}")
        t0 = time.time()
        try:
            fc = fact_check_prediction(pred, video)
            elapsed = time.time() - t0
            results_by_video.setdefault(video_id, []).append(fc)
            verdict_str = f"{fc['verdict'].upper()} ({fc['confidence']} confidence)"
            log(f"  → {verdict_str} in {elapsed:.0f}s")
            log(f"  {fc['explanation'][:120]}...")
        except Exception as e:
            log(f"  [error] {e}", file=sys.stderr)

    # Merge into existing fact-check files
    for video_id, new_fcs in results_by_video.items():
        fc_path = FACT_CHECKS_DIR / f"{video_id}.json"
        existing = json.loads(fc_path.read_text()) if fc_path.exists() else {"video_id": video_id, "fact_checks": []}
        existing["fact_checks"].extend(new_fcs)
        fc_path.write_text(json.dumps(existing, indent=2))

    total = sum(len(v) for v in results_by_video.values())
    log(f"\nDone. {total} predictions fact-checked and saved.")


if __name__ == "__main__":
    main()
