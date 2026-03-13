"""
Stage 3b: Speaker diarization — assigns speaker labels to Whisper transcript segments.

Two modes:
  --enroll  Run on one episode to extract reference clips per speaker. You then label
            them in data/speaker_profiles.json, and re-run to save embeddings.
            Only needs to be done once.

  (normal)  Diarize audio files, match anonymous speakers to known names via saved
            embeddings, and write speaker-labeled transcripts to data/transcripts/.

The output transcript format adds a "speaker" field to each segment:
  {"start": 12.4, "end": 15.8, "text": "...", "speaker": "Chad Kultgen"}

Requirements:
  pip install pyannote.audio torch pydub

You also need a HuggingFace token with access to:
  pyannote/speaker-diarization-3.1
  pyannote/embedding

Set HF_TOKEN in your .env file and accept the model license at huggingface.co.

Usage:
  # Step 1 — first time only: extract reference clips from first episode
  python pipeline/03b_diarize.py --enroll

  # Step 2 — label clips: edit data/speaker_profiles.json
  #   Maps speaker label → real name, e.g. {"SPEAKER_00": "Chad Kultgen", ...}

  # Step 3 — save embeddings (re-run enroll after labeling)
  python pipeline/03b_diarize.py --enroll --save-embeddings

  # Step 4 — diarize all transcribed episodes
  python pipeline/03b_diarize.py [--batch-size N] [--offset N] [--video-id ID]
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import numpy as np
from dotenv import load_dotenv


def log(msg: str, **kwargs):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", **kwargs)

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
AUDIO_DIR = DATA_DIR / "audio"
TRANSCRIPTS_DIR = DATA_DIR / "transcripts"
CLIPS_DIR = DATA_DIR / "speaker_clips"
PROFILES_PATH = DATA_DIR / "speaker_profiles.json"
EMBEDDINGS_PATH = DATA_DIR / "speaker_embeddings.json"
CORRECTIONS_PATH = DATA_DIR / "speaker_corrections.json"

load_dotenv(ROOT / ".env")

HF_TOKEN = os.environ.get("HF_TOKEN", "")
SIMILARITY_THRESHOLD = 0.64  # cosine similarity — tune if misidentifying speakers


def load_diarization_pipeline():
    from pyannote.audio import Pipeline
    if not HF_TOKEN:
        log("ERROR: HF_TOKEN not set in .env. Get a token at huggingface.co and accept the pyannote model license.", file=sys.stderr)
        sys.exit(1)
    log("Loading pyannote speaker-diarization-3.1 ...")
    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=HF_TOKEN,
    )
    return pipeline


def load_embedding_model():
    from pyannote.audio import Model, Inference
    model = Inference(
        Model.from_pretrained("pyannote/embedding", token=HF_TOKEN),
        window="whole",
    )
    return model


def diarize_audio(audio_path: Path, pipeline, max_duration_sec: float | None = None) -> list[dict]:
    """Run diarization, return list of {start, end, speaker} segments."""
    import torchaudio
    # Pass waveform dict to avoid pyannote's MP3 sample-count mismatch bug
    waveform, sample_rate = torchaudio.load(str(audio_path))
    duration_sec = waveform.shape[-1] / sample_rate
    if max_duration_sec and duration_sec > max_duration_sec:
        samples = int(max_duration_sec * sample_rate)
        waveform = waveform[:, :samples]
        log(f"    Trimmed to first {max_duration_sec/60:.0f} min for enrollment")
    duration_sec = waveform.shape[-1] / sample_rate
    log(f"    Audio loaded: {duration_sec/60:.1f} min, {sample_rate}Hz, shape={list(waveform.shape)}")

    # Progress hook — pyannote calls this periodically with completed/total
    last_pct = [-1]
    def progress_hook(*args, completed=0, total=0, **kwargs):
        pct = int(100 * completed / total) if total else 0
        if pct >= last_pct[0] + 10:
            last_pct[0] = pct
            elapsed = time.time() - _t0[0]
            eta = (elapsed / pct * (100 - pct)) if pct > 0 else 0
            log(f"    Diarizing ... {pct}% ({elapsed:.0f}s elapsed, ~{eta:.0f}s remaining)")

    _t0 = [time.time()]
    log(f"    Starting diarization (this takes a few minutes) ...")
    result = pipeline(
        {"waveform": waveform, "sample_rate": sample_rate},
        hook=progress_hook,
    )
    # Newer pyannote returns DiarizeOutput; older returns Annotation directly
    diarization = getattr(result, "speaker_diarization", result)
    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append({
            "start": round(turn.start, 3),
            "end": round(turn.end, 3),
            "speaker": speaker,
        })
    unique_speakers = len({s["speaker"] for s in segments})
    log(f"    Diarization complete: {len(segments)} turns, {unique_speakers} unique speakers")
    return segments


def merge_with_transcript(whisper_segments: list[dict], diarization: list[dict]) -> list[dict]:
    """
    For each Whisper segment, find the dominant speaker by overlap duration.
    Falls back to "Unknown" if no diarization segment overlaps.
    """
    result = []
    for seg in whisper_segments:
        s_start, s_end = seg["start"], seg["end"]
        seg_duration = s_end - s_start

        overlap_by_speaker: dict[str, float] = {}
        for d in diarization:
            overlap_start = max(s_start, d["start"])
            overlap_end = min(s_end, d["end"])
            if overlap_end > overlap_start:
                spk = d["speaker"]
                overlap_by_speaker[spk] = overlap_by_speaker.get(spk, 0) + (overlap_end - overlap_start)

        if overlap_by_speaker:
            dominant = max(overlap_by_speaker, key=overlap_by_speaker.get)
        else:
            dominant = "Unknown"

        result.append({**seg, "speaker": dominant})
    return result


def extract_speaker_clips(audio_path: Path, diarization: list[dict], video_id: str, clip_duration: float = 20.0):
    """
    For each unique speaker, find their longest contiguous segment and extract a clip.
    Saves clips to data/speaker_clips/{video_id}_{speaker}.mp3
    """
    from pydub import AudioSegment

    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    audio = AudioSegment.from_mp3(str(audio_path))

    # Find best (longest) segment per speaker
    best: dict[str, dict] = {}
    for seg in diarization:
        spk = seg["speaker"]
        dur = seg["end"] - seg["start"]
        if spk not in best or dur > (best[spk]["end"] - best[spk]["start"]):
            best[spk] = seg

    clip_paths = {}
    for spk, seg in best.items():
        # Take up to clip_duration seconds from the middle of the segment
        seg_dur = seg["end"] - seg["start"]
        if seg_dur > clip_duration:
            mid = (seg["start"] + seg["end"]) / 2
            clip_start = mid - clip_duration / 2
            clip_end = mid + clip_duration / 2
        else:
            clip_start, clip_end = seg["start"], seg["end"]

        clip = audio[int(clip_start * 1000): int(clip_end * 1000)]
        out_path = CLIPS_DIR / f"{video_id}_{spk}.mp3"
        clip.export(str(out_path), format="mp3")
        clip_paths[spk] = str(out_path)
        log(f"  Saved clip for {spk}: {out_path.name} ({clip_end - clip_start:.0f}s)")

    return clip_paths


def compute_embedding(audio_path: str, model) -> list[float]:
    """Compute a speaker embedding vector for an audio clip."""
    embedding = model(audio_path)
    return embedding.flatten().tolist()


def cosine_similarity(a: list[float], b: list[float]) -> float:
    a, b = np.array(a), np.array(b)
    norm_a, norm_b = np.linalg.norm(a), np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def load_reference_embeddings() -> dict[str, list[float]]:
    """Returns {speaker_name: embedding_vector}."""
    if not EMBEDDINGS_PATH.exists():
        return {}
    return json.loads(EMBEDDINGS_PATH.read_text())


def match_speakers(diarization: list[dict], embeddings_by_name: dict, audio_path: Path, embedding_model, threshold: float = SIMILARITY_THRESHOLD) -> dict[str, str]:
    """
    For each anonymous speaker label in this episode, compute its embedding
    and match to the closest known speaker name.
    Returns {SPEAKER_XX: "Chad Kultgen", ...}
    """
    if not embeddings_by_name:
        return {}

    # Get unique anonymous speakers from this episode
    speakers = list({seg["speaker"] for seg in diarization})

    # Find the longest segment per speaker for embedding computation
    best_seg: dict[str, dict] = {}
    for seg in diarization:
        spk = seg["speaker"]
        dur = seg["end"] - seg["start"]
        if spk not in best_seg or dur > (best_seg[spk]["end"] - best_seg[spk]["start"]):
            best_seg[spk] = seg

    from pydub import AudioSegment
    audio = AudioSegment.from_mp3(str(audio_path))
    CLIPS_DIR.mkdir(parents=True, exist_ok=True)

    log(f"    Computing embeddings for {len(best_seg)} anonymous speakers ...")
    mapping = {}
    for spk, seg in best_seg.items():
        seg_dur = seg["end"] - seg["start"]
        log(f"    [{spk}] best segment: {seg['start']:.1f}s–{seg['end']:.1f}s ({seg_dur:.1f}s)")
        # Extract a temp clip for embedding
        tmp_path = CLIPS_DIR / f"_tmp_{spk}.mp3"
        clip = audio[int(seg["start"] * 1000): int(seg["end"] * 1000)]
        clip.export(str(tmp_path), format="mp3")

        emb = compute_embedding(str(tmp_path), embedding_model)
        tmp_path.unlink(missing_ok=True)

        # Find closest reference speaker
        best_name, best_score = None, -1.0
        for name, ref_emb in embeddings_by_name.items():
            score = cosine_similarity(emb, ref_emb)
            if score > best_score:
                best_score = score
                best_name = name

        if best_score >= threshold:
            mapping[spk] = best_name
            log(f"    {spk} → {best_name} (similarity: {best_score:.2f})")
        else:
            mapping[spk] = spk  # keep anonymous label if no confident match
            log(f"    {spk} → (unmatched, best score {best_score:.2f}, threshold {threshold})")

    return mapping


def apply_speaker_mapping(diarization: list[dict], mapping: dict[str, str]) -> list[dict]:
    return [{**seg, "speaker": mapping.get(seg["speaker"], seg["speaker"])} for seg in diarization]


def enroll(video_id: str | None, save_embeddings: bool, enroll_minutes: float = 15.0):
    """
    Enrollment mode: extract reference clips from one episode.
    If speaker_profiles.json exists and --save-embeddings is set, compute and save embeddings.
    """
    # Pick first available audio file if not specified
    if video_id:
        audio_path = AUDIO_DIR / f"{video_id}.mp3"
    else:
        audio_files = sorted(AUDIO_DIR.glob("*.mp3"))
        if not audio_files:
            log("No audio files found. Run 02_download_audio.py first.", file=sys.stderr)
            sys.exit(1)
        audio_path = audio_files[0]
        video_id = audio_path.stem

    log(f"Enrollment mode — using audio: {audio_path.name}")

    # If --save-embeddings and clips already exist, skip re-diarizing
    existing_clips = list(CLIPS_DIR.glob(f"{video_id}_SPEAKER_*.mp3")) if CLIPS_DIR.exists() else []
    if save_embeddings and existing_clips and PROFILES_PATH.exists():
        log(f"  Clips already exist ({len(existing_clips)} found) — skipping diarization")
    else:
        pipeline = load_diarization_pipeline()
        log(f"\nDiarizing {audio_path.name} ...")
        t0 = time.time()
        diarization = diarize_audio(audio_path, pipeline, max_duration_sec=enroll_minutes * 60)
        log(f"Diarization done in {time.time() - t0:.0f}s. Found {len({s['speaker'] for s in diarization})} unique speakers.")

        clip_paths = extract_speaker_clips(audio_path, diarization, video_id)

        if not PROFILES_PATH.exists():
            template = {spk: "" for spk in clip_paths}
            PROFILES_PATH.write_text(json.dumps(template, indent=2))
            log(f"\nCreated template: {PROFILES_PATH}")
            log("Listen to the clips above and fill in the speaker names, e.g.:")
            log('  {"SPEAKER_00": "Chad Kultgen", "SPEAKER_01": "Mary Lou Kultgen", ...}')
            log(f"\nClips saved to: {CLIPS_DIR}/")
            log("Then re-run with --enroll --save-embeddings to compute voice embeddings.")
            return

    if save_embeddings:
        profiles = json.loads(PROFILES_PATH.read_text())
        unnamed = [spk for spk, name in profiles.items() if not name]
        if unnamed:
            log(f"  [skip] No name for {unnamed} — these will be ignored (guests/clips/unknown voices)")

        log("\nComputing voice embeddings ...")
        embedding_model = load_embedding_model()
        embeddings_by_name = {}
        for spk, name in profiles.items():
            if not name:
                continue
            clip_path = CLIPS_DIR / f"{video_id}_{spk}.mp3"
            if not clip_path.exists():
                log(f"  [skip] clip not found for {spk}: {clip_path}", file=sys.stderr)
                continue
            emb = compute_embedding(str(clip_path), embedding_model)
            embeddings_by_name[name] = emb
            log(f"  Embedded {name} ({len(emb)}-dim)")

        EMBEDDINGS_PATH.write_text(json.dumps(embeddings_by_name, indent=2))
        log(f"\nSaved embeddings to {EMBEDDINGS_PATH}")
        log("You can now run diarization on all episodes without --enroll.")


def diarize_video(video_id: str, pipeline, embedding_model, ref_embeddings: dict, threshold: float = SIMILARITY_THRESHOLD) -> bool:
    audio_path = AUDIO_DIR / f"{video_id}.mp3"
    transcript_path = TRANSCRIPTS_DIR / f"{video_id}.json"
    out_path = TRANSCRIPTS_DIR / f"{video_id}.json"  # overwrite in-place

    if not audio_path.exists():
        log(f"  [skip] {video_id} — audio not found", file=sys.stderr)
        return False
    if not transcript_path.exists():
        log(f"  [skip] {video_id} — transcript not found (run 03_transcribe.py first)", file=sys.stderr)
        return False

    transcript = json.loads(transcript_path.read_text())

    # Skip if already diarized
    if transcript.get("diarized"):
        log(f"  [skip] {video_id} — already diarized")
        return True

    log(f"  [diarize] {video_id} ...")
    t0 = time.time()
    diarization = diarize_audio(audio_path, pipeline)
    n_speakers = len({s["speaker"] for s in diarization})
    log(f"    Found {n_speakers} speakers in {time.time() - t0:.0f}s")

    # Map anonymous labels to real names if embeddings available
    if ref_embeddings:
        log(f"    Matching speakers to known voices (threshold={threshold}) ...")
        mapping = match_speakers(diarization, ref_embeddings, audio_path, embedding_model, threshold=threshold)
        diarization = apply_speaker_mapping(diarization, mapping)
    else:
        log(f"    No embeddings found — using anonymous speaker labels (run --enroll first)")

    # Merge diarization into transcript segments
    labeled_segments = merge_with_transcript(transcript["segments"], diarization)

    transcript["segments"] = labeled_segments
    transcript["diarized"] = True

    # Rebuild full_text with speaker labels for extraction stage
    transcript["full_text"] = "\n".join(
        f"[{seg['speaker']}] {seg['text']}"
        for seg in labeled_segments
        if seg.get("text", "").strip()
    )

    out_path.write_text(json.dumps(transcript, indent=2))
    speaker_counts = {}
    for seg in labeled_segments:
        spk = seg["speaker"]
        speaker_counts[spk] = speaker_counts.get(spk, 0) + 1
    counts_str = ", ".join(f"{k}: {v}" for k, v in sorted(speaker_counts.items()))
    log(f"  [done] {video_id} — labeled {len(labeled_segments)} segments [{counts_str}]")
    return True


def update_embeddings_from_corrections():
    """
    Read data/speaker_corrections.json and update speaker_embeddings.json by extracting
    audio from corrected transcript segments and averaging into stored reference embeddings.

    For each corrected speaker in each episode:
      - Finds the longest transcript segment attributed to that SPEAKER_XX label
      - Extracts that audio clip
      - Computes a 512-dim embedding
      - Averages it with the existing stored embedding (or adds as new speaker)

    This improves matching accuracy for all future episodes without re-enrolling from scratch.
    Run after: python pipeline/03c_speaker_corrections.py --apply
    """
    if not CORRECTIONS_PATH.exists():
        log("No speaker_corrections.json found.", file=sys.stderr)
        log("Run: python pipeline/03c_speaker_corrections.py --generate")
        log("Then fill in names and run: python pipeline/03c_speaker_corrections.py --apply")
        sys.exit(1)

    corrections: dict[str, dict[str, str]] = json.loads(CORRECTIONS_PATH.read_text())

    # Gather only filled-in corrections (non-empty names)
    filled_total = sum(1 for labels in corrections.values() for v in labels.values() if v.strip())
    if filled_total == 0:
        log("No filled-in corrections found in speaker_corrections.json — nothing to do.")
        log("Edit the file to assign speaker names, then re-run.")
        return

    embedding_model = load_embedding_model()
    ref_embeddings = load_reference_embeddings()

    CLIPS_DIR.mkdir(parents=True, exist_ok=True)

    from pydub import AudioSegment

    for video_id, label_map in sorted(corrections.items()):
        filled = {label: name for label, name in label_map.items() if name.strip()}
        if not filled:
            continue

        audio_path = AUDIO_DIR / f"{video_id}.mp3"
        transcript_path = TRANSCRIPTS_DIR / f"{video_id}.json"

        if not audio_path.exists():
            log(f"  [skip] {video_id} — audio not found", file=sys.stderr)
            continue
        if not transcript_path.exists():
            log(f"  [skip] {video_id} — transcript not found", file=sys.stderr)
            continue

        transcript = json.loads(transcript_path.read_text())
        segments = transcript.get("segments", [])

        log(f"  [{video_id}] processing {len(filled)} correction(s) ...")
        audio = AudioSegment.from_mp3(str(audio_path))

        for label, name in filled.items():
            # Find segments still carrying this anonymous label (pre-apply) or already replaced
            # We check both the raw label AND the name, in case --apply was already run
            matching = [s for s in segments if s.get("speaker") in (label, name)]
            if not matching:
                log(f"    [skip] {label} → {name}: no matching segments in transcript")
                continue

            # Use the longest segment for best embedding quality
            best = max(matching, key=lambda s: s["end"] - s["start"])
            seg_dur = best["end"] - best["start"]
            log(f"    {label} → {name}: extracting {seg_dur:.1f}s clip ({best['start']:.1f}s–{best['end']:.1f}s)")

            tmp_path = CLIPS_DIR / f"_emb_{video_id}_{label}.mp3"
            clip = audio[int(best["start"] * 1000): int(best["end"] * 1000)]
            clip.export(str(tmp_path), format="mp3")

            new_emb = compute_embedding(str(tmp_path), embedding_model)
            tmp_path.unlink(missing_ok=True)

            if name in ref_embeddings:
                # Average new embedding with existing (direction is what matters for cosine similarity)
                existing = np.array(ref_embeddings[name])
                averaged = ((existing + np.array(new_emb)) / 2).tolist()
                ref_embeddings[name] = averaged
                log(f"    Updated embedding for {name} (averaged with existing)")
            else:
                ref_embeddings[name] = new_emb
                log(f"    Added new embedding for {name}")

    EMBEDDINGS_PATH.write_text(json.dumps(ref_embeddings, indent=2))
    log(f"\nSaved updated embeddings to {EMBEDDINGS_PATH}")
    log(f"  Speakers: {', '.join(ref_embeddings.keys())}")
    log("You can now re-diarize undiarized episodes for improved speaker matching.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--enroll", action="store_true",
                        help="Extract reference clips from one episode for speaker labeling")
    parser.add_argument("--save-embeddings", action="store_true",
                        help="Used with --enroll: compute and save voice embeddings after labeling profiles")
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--video-id", help="Process a single specific video ID")
    parser.add_argument("--enroll-minutes", type=float, default=1.0,
                        help="For --enroll: only process first N minutes of audio (default: 1)")
    parser.add_argument("--threshold", type=float, default=SIMILARITY_THRESHOLD,
                        help=f"Cosine similarity threshold for speaker matching (default: {SIMILARITY_THRESHOLD}). "
                             "Lower to ~0.60–0.65 if known speakers are not being recognized.")
    parser.add_argument("--update-embeddings", action="store_true",
                        help="Read data/speaker_corrections.json and update speaker_embeddings.json "
                             "using audio from corrected transcript segments. "
                             "Run after: python pipeline/03c_speaker_corrections.py --apply")
    args = parser.parse_args()

    if args.update_embeddings:
        update_embeddings_from_corrections()
        return

    if args.enroll:
        enroll(args.video_id, args.save_embeddings, enroll_minutes=args.enroll_minutes)
        return

    # Normal diarization mode
    videos_path = DATA_DIR / "videos.json"
    if not videos_path.exists():
        log("data/videos.json not found. Run 01_fetch_videos.py first.", file=sys.stderr)
        sys.exit(1)

    videos = json.loads(videos_path.read_text())
    video_map = {v["id"]: v for v in videos}

    if args.video_id:
        to_process = [args.video_id]
    else:
        transcript_paths = sorted(TRANSCRIPTS_DIR.glob("*.json"))
        all_ids = [p.stem for p in transcript_paths]
        # Skip already diarized
        to_process = []
        for vid_id in all_ids:
            t = json.loads((TRANSCRIPTS_DIR / f"{vid_id}.json").read_text())
            if not t.get("diarized"):
                to_process.append(vid_id)
        to_process = to_process[args.offset: args.offset + args.batch_size]

    if not to_process:
        log("Nothing to diarize.")
        return

    ref_embeddings = load_reference_embeddings()
    if ref_embeddings:
        log(f"Loaded embeddings for: {', '.join(ref_embeddings.keys())}")
    else:
        log("No speaker embeddings found. Will use anonymous labels (SPEAKER_XX).")
        log("Run with --enroll to set up speaker identification.")

    pipeline = load_diarization_pipeline()
    embedding_model = load_embedding_model() if ref_embeddings else None

    log(f"Diarizing {len(to_process)} transcripts ...\n")
    for i, video_id in enumerate(to_process, 1):
        video = video_map.get(video_id, {"id": video_id, "title": video_id, "published_at": "?"})
        log(f"[{i}/{len(to_process)}] {video.get('published_at', '?')} — {video.get('title', video_id)[:70]}")
        diarize_video(video_id, pipeline, embedding_model, ref_embeddings, threshold=args.threshold)

    log("\nAll done.")


if __name__ == "__main__":
    main()
