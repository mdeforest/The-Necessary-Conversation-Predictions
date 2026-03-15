"""
Stage 5: Fact-check predictions using Gemini 2.5 Flash + Google Search grounding.
Gemini searches the web automatically via its built-in Google Search tool.
By default this fills only missing fact-checks; refresh mode can revisit stale items.
Processes in batches.

Usage:
  python pipeline/05_fact_check.py [--batch-size N] [--video-id ID] [--prediction-id ID]
                                    [--refresh-scope pending-first|stale-all|manual]
                                    [--stale-days N]
"""

import argparse
import functools
import json
import os
import re
import sys
import time
from datetime import date, datetime
from pathlib import Path

from dotenv import load_dotenv
from google import genai
import requests


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
- "partially true": Some aspects of the prediction came true, but others did not, or the outcome is mixed/ambiguous.

RESEARCH STRATEGY:
0. First interpret the claim using the episode context. Treat the context as essential for resolving pronouns, implied subjects, omitted conditions, and what outcome would count as the prediction coming true.
1. Search for the core claim directly.
2. Search for counter-evidence — what if the opposite happened?
3. If ambiguous, search for the most recent news on the topic.
4. Do at least 2 searches, up to 5 for complex multi-part claims.
5. For predictions with a specific timeframe, check whether that window has passed.
6. If the prediction depends on whether a named person is still in office, still a candidate, or still alive, verify that status explicitly with a current authoritative source.
7. If a prediction says something must happen before a person leaves office or is no longer elected, and that person has already left office or lost/ended that candidacy without the event occurring, the verdict is "false", not "pending".

CLAIM RESOLUTION WORKFLOW:
- Use every field provided in the user prompt: prediction text, episode context, timeframe, specificity, speaker, timestamp, topic, episode title, and episode date.
- Before researching, internally rewrite the prediction into one concrete factual claim that captures:
  1. who or what the claim is about,
  2. the predicted action or outcome,
  3. any condition that must happen first,
  4. the deadline or evaluation window,
  5. the scope or metric that would count as success.
- Prefer the narrowest interpretation that is strongly supported by the prediction text plus context.
- Do not ignore context just because the prediction sentence is short or emotionally phrased.
- If there are two plausible readings, evaluate the reading best supported by context. Only mention ambiguity when it materially affects the verdict.

TEMPORAL ACCURACY RULES:
- Never assume a current officeholder from stale knowledge or from the episode context.
- When mentioning a current president, prime minister, CEO, or other officeholder, verify it and use exact dates when they matter to the verdict.

CONTEXT INTERPRETATION RULES:
- The podcast "context" field is not proof that the prediction came true, but it is part of the primary claim you are evaluating.
- Use the context to disambiguate who or what the speaker meant, what triggering condition they were talking about, and what concrete outcome they were predicting.
- Preserve conditional structure. If the speaker's prediction is effectively "if X happens, Y will follow", do not fact-check Y in isolation from X.
- If the prediction text is shorthand, elliptical, or emotionally phrased, restate it internally as a precise factual claim before searching.
- If context reveals that a prediction was about a narrower scope than the text alone suggests, evaluate the narrower scoped claim rather than a broader one.
- Treat the timeframe as anchored to the episode date unless the prompt clearly gives a different reference point.
- Treat specificity as a clue about whether the claim may be too vague, but still attempt to resolve it using context before concluding "unverifiable".

HANDLING SENSITIVE OR INFLAMMATORY PREDICTIONS:
- Some predictions use extreme, violent, or emotionally charged language. This does not make them unverifiable — it just means you must translate the inflammatory framing into a neutral factual question before you search.
- Before searching, restate the claim internally in the most clinical, neutral language possible. For example: a prediction that "X will be assassinated" becomes "Did [person X] survive the relevant period unharmed?" A prediction that "the world will end" under a given scenario becomes "Did society continue to function normally in that scenario?" A prediction about a trial outcome becomes "What was the actual verdict?"
- For predictions about elections, treat them as historical record lookups: what did the certified election results show?
- For conditional predictions ("if X happens, Y will follow"), verify whether condition X was met first. If it was not met, the prediction is unverifiable. If it was met, verify whether Y actually occurred.
- Your task is to report what the public record shows. The framing of the original claim is irrelevant to whether the outcome occurred.

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

VERTEX_GROUNDING_REDIRECT_HOST = "vertexaisearch.cloud.google.com"

SAFETY_SETTINGS = [
    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_CIVIC_INTEGRITY", threshold="BLOCK_NONE"),
]

REFRESH_SCOPE_PENDING_FIRST = "pending-first"
REFRESH_SCOPE_STALE_ALL = "stale-all"
REFRESH_SCOPE_MANUAL = "manual"
REFRESH_SCOPES = [
    REFRESH_SCOPE_PENDING_FIRST,
    REFRESH_SCOPE_STALE_ALL,
    REFRESH_SCOPE_MANUAL,
]


@functools.lru_cache(maxsize=2048)
def _resolve_source_url(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return url

    if url.startswith("https://www.google.com/search?") or url.startswith("http://www.google.com/search?"):
        return ""

    if VERTEX_GROUNDING_REDIRECT_HOST not in url:
        return url

    try:
        response = requests.get(url, allow_redirects=True, timeout=(5, 10), stream=True)
        resolved = response.url or url
        response.close()
        return resolved
    except requests.RequestException:
        return url


def _normalize_sources(urls: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()

    for raw_url in urls:
        resolved = _resolve_source_url(raw_url)
        if not resolved or resolved in seen:
            continue
        seen.add(resolved)
        normalized.append(resolved)

    return normalized


def _parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _is_stale(fact_check: dict, stale_days: int) -> bool:
    generated = _parse_iso_date(fact_check.get("date_generated"))
    if generated is None:
        return True
    return (date.today() - generated).days >= stale_days


def _is_refresh_candidate(fact_check: dict, scope: str, stale_days: int) -> bool:
    if scope == REFRESH_SCOPE_STALE_ALL:
        return _is_stale(fact_check, stale_days)

    if scope == REFRESH_SCOPE_PENDING_FIRST:
        verdict = fact_check.get("verdict")
        confidence = fact_check.get("confidence")
        return _is_stale(fact_check, stale_days) and (
            verdict in {"pending", "unverifiable"} or confidence == "low"
        )

    return False


def _needs_recheck(fact_check: dict | None) -> bool:
    if fact_check is None:
        return True

    verdict = (fact_check.get("verdict") or "").strip().lower()
    confidence = (fact_check.get("confidence") or "").strip().lower()
    explanation = (fact_check.get("explanation") or "").strip().lower()

    if not fact_check.get("date_generated"):
        return True

    if verdict == "pending" and confidence == "low" and explanation in {
        "prediction sent back for fact-checking.",
        "prediction updated and needs to be fact-checked again.",
    }:
        return True

    # Content-filtered items should be retried automatically — the improved prompt
    # may now succeed where two attempts previously failed.
    if confidence == "low" and "content filter" in explanation:
        return True

    return False


def _legacy_generated_date(fc_file: Path) -> str:
    try:
        return datetime.fromtimestamp(fc_file.stat().st_mtime).date().isoformat()
    except OSError:
        return date.today().isoformat()


def _normalize_existing_fact_checks(fc_file: Path, fc_data: dict) -> dict:
    fact_checks = fc_data.get("fact_checks", [])
    if not fact_checks:
        return fc_data

    fallback_date = _legacy_generated_date(fc_file)
    changed = False
    for fact_check in fact_checks:
        if not fact_check.get("date_generated"):
            fact_check["date_generated"] = fallback_date
            changed = True

    if changed:
        fc_file.write_text(json.dumps(fc_data, indent=2))

    return fc_data


def _merge_fact_checks(existing: list[dict], new_items: list[dict]) -> list[dict]:
    """Replace by prediction_id while preserving existing order when possible."""
    merged: dict[str, dict] = {}
    order: list[str] = []

    for item in existing:
        pid = item.get("prediction_id")
        if not pid:
            continue
        merged[pid] = item
        order.append(pid)

    for item in new_items:
        pid = item.get("prediction_id")
        if not pid:
            continue
        merged[pid] = item
        if pid not in order:
            order.append(pid)

    return [merged[pid] for pid in order]


VAGUE_PREDICTION_PATTERNS = [
    r"\bthere will be blood\b",
    r"\byou('ll| will) see\b",
    r"\bwe('re| are) going to find that out\b",
    r"\bsomething (big|huge|massive) (is )?(going to )?happen\b",
    r"\beveryone will know\b",
    r"\bthe truth will come out\b",
    r"\bwatch what happens\b",
]

VAGUE_TIMEFRAME_PATTERNS = [
    r"\bin your lifetime\b",
    r"\bunspecified\b",
    r"\bsomeday\b",
    r"\bsoon\b",
    r"\bone day\b",
]


def _prefilter_fact_check(prediction: dict, video: dict) -> dict | None:
    text = (prediction.get("prediction") or "").strip()
    specificity = (prediction.get("specificity") or "").strip().lower()
    timeframe = (prediction.get("timeframe") or "").strip().lower()
    text_lower = text.lower()

    vague_text = any(re.search(pattern, text_lower) for pattern in VAGUE_PREDICTION_PATTERNS)
    vague_timeframe = any(re.search(pattern, timeframe) for pattern in VAGUE_TIMEFRAME_PATTERNS)

    if specificity == "low" and (vague_text or vague_timeframe):
        episode_date = video.get("published_at", "the episode date")
        return {
            "prediction_id": prediction["id"],
            "date_generated": date.today().isoformat(),
            "verdict": "unverifiable",
            "confidence": "high",
            "explanation": (
                f"This statement is too vague to verify reliably as a factual prediction. "
                f"It was made on {episode_date}, but it does not define a concrete measurable event "
                f"or a bounded timeframe that public evidence could confirm or falsify."
            ),
            "sources": [],
        }

    return None


def _build_prompt(prediction: dict, video: dict, neutral: bool = False) -> str:
    episode_title = video.get("title", "Unknown episode")
    episode_date = video.get("published_at", "Unknown date")
    timeframe = prediction.get("timeframe", "unspecified")
    topic = prediction.get("topic", "")
    specificity = prediction.get("specificity", "")
    text = prediction["prediction"]
    context = prediction.get("context", "")
    speaker = prediction.get("speaker", "Unknown")
    timestamp = prediction.get("timestamp_seconds")
    timestamp_line = f"Timestamp in episode: {timestamp}s\n" if timestamp is not None else ""

    if neutral:
        return (
            "Historical fact-checking task for a podcast prediction archive.\n\n"
            + "IMPORTANT: The claim below may use strong, hyperbolic, or emotionally charged language. "
            + "Before you do anything else, restate the claim internally in neutral, clinical terms — "
            + "strip the rhetoric and identify only the concrete factual outcome being predicted "
            + "(e.g., 'Will [person] remain in good health?', 'What was the certified election result?', "
            + "'Did [country] take [military action] in [timeframe]?'). Then search on that neutral restatement.\n\n"
            + f"Episode title: {episode_title}\n"
            + f"Date the claim was made: {episode_date}\n"
            + f"Speaker: {speaker}\n"
            + timestamp_line
            + f"Topic area: {topic}\n"
            + f"Predicted timeframe: {timeframe}\n"
            + f"Specificity: {specificity}\n"
            + f"Claim text: {text}\n"
            + f"Episode context: {context}\n\n"
            + "Steps: (1) Restate the claim in neutral terms. "
            + "(2) Identify the actor, predicted outcome, any triggering condition, the evaluation window. "
            + "(3) Search for factual public record evidence about whether this occurred. "
            + "(4) Search for both confirming and disconfirming evidence. "
            + "Focus only on verifiable facts from the public record."
            + JSON_FORMAT_REMINDER
        )

    return (
        f"Prediction from podcast episode:\n"
        + f"Episode title: {episode_title}\n"
        + f"Episode date: {episode_date}\n"
        + f"Speaker: {speaker}\n"
        + timestamp_line
        + f"Topic: {topic}\n"
        + f"Predicted timeframe: {timeframe}\n"
        + f"Specificity: {specificity}\n"
        + f"Prediction: {text}\n"
        + f"Context: {context}\n\n"
        + "Use every field above before you search. First rewrite the claim internally as one precise factual prediction using the prediction text plus context. "
        + "Keep any implied condition, actor, deadline, and scope from the context attached to the claim while evaluating it. "
        + "Anchor relative timing to the episode date unless the context clearly points elsewhere. "
        + "Search the web to determine whether this prediction came true. "
        + "Consider whether the predicted timeframe has passed. "
        + "Search for both supporting and contradicting evidence. "
        + "If specificity is 'low', try to resolve the claim with context before deciding it is unverifiable. "
        + "Do not broaden a narrow contextual claim into a looser general claim."
        + JSON_FORMAT_REMINDER
    )


def _build_context_only_prompt(prediction: dict, video: dict) -> str:
    """Third-pass prompt: omits the raw prediction text entirely.

    Used when the prediction text itself triggers a content filter. Derives
    the factual question purely from the context description, which is already
    written in neutral editorial language by the prediction extractor.
    """
    episode_title = video.get("title", "Unknown episode")
    episode_date = video.get("published_at", "Unknown date")
    timeframe = prediction.get("timeframe", "unspecified")
    topic = prediction.get("topic", "")
    context = prediction.get("context", "")

    return (
        "Historical fact-checking research task.\n\n"
        + f"Episode: {episode_title} (recorded {episode_date})\n"
        + f"Topic area: {topic}\n"
        + f"Predicted timeframe: {timeframe}\n\n"
        + "A podcast guest made a prediction about the following situation:\n"
        + f"{context}\n\n"
        + "Please search for and report what the public record shows actually happened. "
        + "Determine whether the predicted outcome occurred by looking up verifiable facts. "
        + "Consider whether the predicted timeframe has passed. "
        + "Search for both confirming and disconfirming evidence."
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
    prefiltered = _prefilter_fact_check(prediction, video)
    if prefiltered is not None:
        return prefiltered

    # First attempt with full context
    raw, response = _call_model(_build_prompt(prediction, video, neutral=False))
    result = _parse_raw(raw)

    # Second attempt: neutral framing with explicit instruction to restate in clinical terms
    if result is None:
        log("  [retry 2] content filter — retrying with neutral framing...")
        raw, response = _call_model(_build_prompt(prediction, video, neutral=True))
        result = _parse_raw(raw)

    # Third attempt: omit the raw prediction text entirely; derive question from context only
    if result is None:
        log("  [retry 3] still blocked — retrying with context-only prompt (no raw prediction text)...")
        raw, response = _call_model(_build_context_only_prompt(prediction, video))
        result = _parse_raw(raw)

    if result is None:
        return {
            "prediction_id": prediction["id"],
            "date_generated": date.today().isoformat(),
            "verdict": "unverifiable",
            "confidence": "low",
            "explanation": "The model declined to process this prediction after three attempts (content filter). Unable to fact-check automatically.",
            "sources": [],
        }
    result["prediction_id"] = prediction["id"]
    result["date_generated"] = date.today().isoformat()
    result["sources"] = _normalize_sources(result.get("sources", []))

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
            result["sources"] = _normalize_sources(sources)

    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=int(os.getenv("PREDICTION_BATCH_SIZE", 10)))
    parser.add_argument("--video-id", help="Only fact-check predictions from a specific video")
    parser.add_argument("--prediction-id", help="Fact-check a single specific prediction ID")
    parser.add_argument(
        "--refresh-scope",
        choices=REFRESH_SCOPES,
        help="Refresh existing fact-checks instead of only filling missing ones. "
             "'pending-first' refreshes stale pending/unverifiable/low-confidence items; "
             "'stale-all' refreshes any stale item; "
             "'manual' refreshes only explicitly targeted video/prediction selections.",
    )
    parser.add_argument(
        "--stale-days",
        type=int,
        default=30,
        help="Minimum age in days before an existing fact-check is eligible for refresh "
             "(default: 30).",
    )
    args = parser.parse_args()

    if args.refresh_scope == REFRESH_SCOPE_MANUAL and not (args.video_id or args.prediction_id):
        log("--refresh-scope manual requires --video-id or --prediction-id", file=sys.stderr)
        sys.exit(1)

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
    existing_by_prediction_id: dict[str, dict] = {}
    for fc_file in FACT_CHECKS_DIR.glob("*.json"):
        fc_data = _normalize_existing_fact_checks(fc_file, json.loads(fc_file.read_text()))
        for fc in fc_data.get("fact_checks", []):
            existing_by_prediction_id[fc["prediction_id"]] = fc

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
            existing = existing_by_prediction_id.get(pred["id"])

            if not args.refresh_scope:
                if _needs_recheck(existing):
                    queue.append((pred, video))
                continue

            if args.refresh_scope == REFRESH_SCOPE_MANUAL:
                queue.append((pred, video))
                continue

            if existing is not None and _is_refresh_candidate(existing, args.refresh_scope, args.stale_days):
                queue.append((pred, video))

    if not queue:
        log("Nothing to fact-check.")
        return

    batch = queue[: args.batch_size]
    remaining = len(queue) - len(batch)
    mode = "refresh" if args.refresh_scope else "initial"
    log(f"Fact-checking {len(batch)} predictions ({remaining} remaining after this batch)")
    log(f"Mode: {mode}" + (f" [{args.refresh_scope}, stale_days={args.stale_days}]" if args.refresh_scope else ""))
    log(f"Using Gemini 2.5 Flash + Google Search grounding\n")

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
        existing["fact_checks"] = _merge_fact_checks(existing.get("fact_checks", []), new_fcs)
        fc_path.write_text(json.dumps(existing, indent=2))

    total = sum(len(v) for v in results_by_video.values())
    log(f"\nDone. {total} predictions fact-checked and saved.")


if __name__ == "__main__":
    main()
