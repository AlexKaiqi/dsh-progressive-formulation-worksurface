#!/usr/bin/env python3
"""Authoring helper: derive Surface directories before registering Orchestrate."""

import os
import shutil
import sys
from pathlib import Path


if len(sys.argv) < 4 or len(sys.argv[2:]) % 2:
    raise SystemExit("usage: prepare-parallel-surfaces.py SOURCE TARGET VARIANT [TARGET VARIANT ...]")

surface_root = Path(os.environ["DSH_WORKSURFACE_ROOT"]) / "surfaces"
source = surface_root / sys.argv[1]
if not source.is_dir():
    raise SystemExit(f"source Surface does not exist: {source}")

for target_name, variant in zip(sys.argv[2::2], sys.argv[3::2]):
    target = surface_root / target_name
    if target.exists():
        raise SystemExit(f"target Surface already exists: {target}")
    shutil.copytree(source, target)
    block = target / "blocks" / "exploration.md"
    block.parent.mkdir(parents=True, exist_ok=True)
    block.write_text(f"# Exploration variant\n\n{variant}\n")
