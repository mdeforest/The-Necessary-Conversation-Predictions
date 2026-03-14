#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from infra.r2_sync import pull_control_files, push_control_files


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync local speaker control files with Cloudflare R2")
    parser.add_argument("direction", choices=["pull", "push"])
    args = parser.parse_args()

    if args.direction == "pull":
        count = pull_control_files()
    else:
        count = push_control_files()

    print(f"[control-sync] {args.direction} complete ({count} object operation(s))")


if __name__ == "__main__":
    main()
