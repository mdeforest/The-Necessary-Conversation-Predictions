from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse, urlunparse

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
EXPORTS_DIR = ROOT / "exports"

CONTROL_PREFIX = "control"
ARTIFACTS_PREFIX = "artifacts"
EXPORTS_PREFIX = "exports"

load_dotenv(ROOT / ".env")


@dataclass(frozen=True)
class SyncTarget:
    name: str
    local_path: Path
    remote_key: str
    kind: str
    file_pattern: str | None = None


CONTROL_TARGETS: tuple[SyncTarget, ...] = (
    SyncTarget("speaker_profiles", DATA_DIR / "speaker_profiles.json", f"{CONTROL_PREFIX}/speaker_profiles.json", "file"),
    SyncTarget("speaker_corrections", DATA_DIR / "speaker_corrections.json", f"{CONTROL_PREFIX}/speaker_corrections.json", "file"),
    SyncTarget(
        "prediction_speaker_overrides",
        DATA_DIR / "prediction_speaker_overrides.json",
        f"{CONTROL_PREFIX}/prediction_speaker_overrides.json",
        "file",
    ),
    SyncTarget("speaker_embeddings", DATA_DIR / "speaker_embeddings.json", f"{CONTROL_PREFIX}/speaker_embeddings.json", "file"),
)

EXPORT_TARGETS: tuple[SyncTarget, ...] = (
    SyncTarget("videos_export", DATA_DIR / "videos.json", f"{EXPORTS_PREFIX}/videos.json", "file"),
    SyncTarget("predictions_master_export", ROOT / "predictions_master.json", f"{EXPORTS_PREFIX}/predictions_master.json", "file"),
    SyncTarget("videos_export_copy", EXPORTS_DIR / "videos.json", f"{EXPORTS_PREFIX}/videos.json", "file"),
    SyncTarget(
        "predictions_master_export_copy",
        EXPORTS_DIR / "predictions_master.json",
        f"{EXPORTS_PREFIX}/predictions_master.json",
        "file",
    ),
)

ARTIFACT_TARGETS: dict[str, SyncTarget] = {
    "audio": SyncTarget("audio", DATA_DIR / "audio", f"{ARTIFACTS_PREFIX}/audio", "dir", "{video_id}.mp3"),
    "transcripts": SyncTarget(
        "transcripts",
        DATA_DIR / "transcripts",
        f"{ARTIFACTS_PREFIX}/transcripts",
        "dir",
        "{video_id}.json",
    ),
    "predictions": SyncTarget(
        "predictions",
        DATA_DIR / "predictions",
        f"{ARTIFACTS_PREFIX}/predictions",
        "dir",
        "{video_id}.json",
    ),
    "fact_checks": SyncTarget(
        "fact_checks",
        DATA_DIR / "fact_checks",
        f"{ARTIFACTS_PREFIX}/fact_checks",
        "dir",
        "{video_id}.json",
    ),
}


def log(message: str) -> None:
    print(f"[r2-sync] {message}")


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _normalized_bucket_name() -> str:
    bucket = _require_env("R2_BUCKET_NAME").strip().strip("/")
    if not bucket:
        raise RuntimeError("R2_BUCKET_NAME is empty after normalization")
    if "/" in bucket:
        raise RuntimeError(
            "R2_BUCKET_NAME must be just the bucket name, not a path. "
            f"Got: {bucket!r}"
        )
    return bucket


def _strip_bucket_from_endpoint(endpoint_url: str, bucket_name: str) -> str:
    parsed = urlparse(endpoint_url)
    path = (parsed.path or "").rstrip("/")
    if path == f"/{bucket_name}":
        parsed = parsed._replace(path="")
    return urlunparse(parsed).rstrip("/")


def _r2_endpoint_url() -> str:
    bucket_name = _normalized_bucket_name()
    explicit = os.getenv("R2_ENDPOINT_URL", "").strip()
    if explicit:
        return _strip_bucket_from_endpoint(explicit, bucket_name)
    account_id = _require_env("R2_ACCOUNT_ID")
    return f"https://{account_id}.r2.cloudflarestorage.com"


def get_r2_client():
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=_r2_endpoint_url(),
        aws_access_key_id=_require_env("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=_require_env("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
    )


def get_bucket_name() -> str:
    return _normalized_bucket_name()


def _ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _iter_remote_keys(client, prefix: str) -> Iterable[str]:
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=get_bucket_name(), Prefix=prefix):
        for item in page.get("Contents", []):
            key = item.get("Key")
            if key and not key.endswith("/"):
                yield key


def _remote_exists(client, key: str) -> bool:
    try:
        client.head_object(Bucket=get_bucket_name(), Key=key)
        return True
    except Exception:
        return False


def _download_file(client, remote_key: str, local_path: Path, *, required: bool = False) -> bool:
    if not _remote_exists(client, remote_key):
        if required:
            raise FileNotFoundError(f"Remote object not found: {remote_key}")
        return False

    _ensure_parent(local_path)
    client.download_file(get_bucket_name(), remote_key, str(local_path))
    log(f"pulled {remote_key} -> {local_path.relative_to(ROOT)}")
    return True


def _upload_file(client, local_path: Path, remote_key: str, *, required: bool = False) -> bool:
    if not local_path.exists():
        if required:
            raise FileNotFoundError(f"Local file not found: {local_path}")
        return False

    client.upload_file(str(local_path), get_bucket_name(), remote_key)
    log(f"pushed {local_path.relative_to(ROOT)} -> {remote_key}")
    return True


def _download_target(client, target: SyncTarget, video_id: str | None = None) -> int:
    if target.kind == "file":
        return int(_download_file(client, target.remote_key, target.local_path))

    target.local_path.mkdir(parents=True, exist_ok=True)
    if video_id and target.file_pattern:
        filename = target.file_pattern.format(video_id=video_id)
        return int(
            _download_file(
                client,
                f"{target.remote_key}/{filename}",
                target.local_path / filename,
            )
        )

    downloaded = 0
    for remote_key in _iter_remote_keys(client, f"{target.remote_key}/"):
        filename = remote_key.split("/")[-1]
        downloaded += int(_download_file(client, remote_key, target.local_path / filename))
    return downloaded


def _upload_target(client, target: SyncTarget, video_id: str | None = None) -> int:
    if target.kind == "file":
        return int(_upload_file(client, target.local_path, target.remote_key))

    if not target.local_path.exists():
        return 0

    uploaded = 0
    if video_id and target.file_pattern:
        filename = target.file_pattern.format(video_id=video_id)
        uploaded += int(_upload_file(client, target.local_path / filename, f"{target.remote_key}/{filename}"))
        return uploaded

    for local_file in sorted(target.local_path.iterdir()):
        if not local_file.is_file():
            continue
        uploaded += int(_upload_file(client, local_file, f"{target.remote_key}/{local_file.name}"))
    return uploaded


def pull_control_files() -> int:
    client = get_r2_client()
    return sum(_download_target(client, target) for target in CONTROL_TARGETS)


def push_control_files() -> int:
    client = get_r2_client()
    return sum(_upload_target(client, target) for target in CONTROL_TARGETS)


def pull_exports() -> int:
    client = get_r2_client()
    count = 0
    # Export targets include both repo paths and exports copies. Pull once per remote key.
    seen_remote_keys: set[str] = set()
    for target in EXPORT_TARGETS:
        if target.remote_key in seen_remote_keys:
            continue
        seen_remote_keys.add(target.remote_key)
        if target.remote_key.endswith("videos.json"):
            count += int(_download_file(client, target.remote_key, DATA_DIR / "videos.json"))
            count += int(_download_file(client, target.remote_key, EXPORTS_DIR / "videos.json"))
        else:
            count += int(_download_file(client, target.remote_key, ROOT / "predictions_master.json"))
            count += int(_download_file(client, target.remote_key, EXPORTS_DIR / "predictions_master.json"))
    return count


def push_exports() -> int:
    client = get_r2_client()
    count = 0
    if (DATA_DIR / "videos.json").exists():
        count += int(_upload_file(client, DATA_DIR / "videos.json", f"{EXPORTS_PREFIX}/videos.json"))
    if (ROOT / "predictions_master.json").exists():
        count += int(
            _upload_file(
                client,
                ROOT / "predictions_master.json",
                f"{EXPORTS_PREFIX}/predictions_master.json",
            )
        )
    if (EXPORTS_DIR / "videos.json").exists():
        count += int(_upload_file(client, EXPORTS_DIR / "videos.json", f"{EXPORTS_PREFIX}/videos.json"))
    if (EXPORTS_DIR / "predictions_master.json").exists():
        count += int(
            _upload_file(
                client,
                EXPORTS_DIR / "predictions_master.json",
                f"{EXPORTS_PREFIX}/predictions_master.json",
            )
        )
    return count


def _normalize_artifact_groups(groups: Iterable[str] | None) -> list[str]:
    names = list(groups or ARTIFACT_TARGETS.keys())
    invalid = [name for name in names if name not in ARTIFACT_TARGETS]
    if invalid:
        raise ValueError(f"Unknown artifact groups: {', '.join(sorted(invalid))}")
    return names


def pull_artifacts(groups: Iterable[str] | None = None, video_id: str | None = None) -> int:
    client = get_r2_client()
    total = 0
    for name in _normalize_artifact_groups(groups):
        total += _download_target(client, ARTIFACT_TARGETS[name], video_id=video_id)
    return total


def push_artifacts(groups: Iterable[str] | None = None, video_id: str | None = None) -> int:
    client = get_r2_client()
    total = 0
    for name in _normalize_artifact_groups(groups):
        total += _upload_target(client, ARTIFACT_TARGETS[name], video_id=video_id)
    return total


def main() -> None:
    parser = argparse.ArgumentParser(description="Pull or push pipeline state to Cloudflare R2")
    parser.add_argument("direction", choices=["pull", "push"])
    parser.add_argument(
        "groups",
        nargs="+",
        choices=["control", "exports", *ARTIFACT_TARGETS.keys()],
        help="Which groups to sync. Artifact groups can be listed individually.",
    )
    parser.add_argument("--video-id", help="Only sync a single episode file for artifact groups")
    args = parser.parse_args()

    total = 0
    for group in args.groups:
        if group == "control":
            total += pull_control_files() if args.direction == "pull" else push_control_files()
        elif group == "exports":
            total += pull_exports() if args.direction == "pull" else push_exports()
        else:
            if args.direction == "pull":
                total += pull_artifacts([group], video_id=args.video_id)
            else:
                total += push_artifacts([group], video_id=args.video_id)

    log(f"completed {args.direction} for {len(args.groups)} group(s), {total} object operation(s)")


if __name__ == "__main__":
    main()
