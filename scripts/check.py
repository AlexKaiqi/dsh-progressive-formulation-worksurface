#!/usr/bin/env python3
"""Single WorkSurface design gate: protocol, boundaries, build, and tests. [WS-23]"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = ROOT / "spec"


def fail(message: str) -> None:
    raise SystemExit(f"WorkSurface check failed: {message}")


def static_checks() -> None:
    for schema in ("event.schema.json", "definition.schema.json", "context.schema.json", "binding.schema.json", "authoring-registration.schema.json"):
        json.loads((SPEC / schema).read_text())
    template = (SPEC / "surface-template.md").read_text()
    required = [
        "# Goal", "# Acceptance Criteria", "# Known Facts and Constraints",
        "# Assumptions", "# Open Questions", "# Current Decisions",
        "# Deliverables and Evidence",
    ]
    positions = [template.find(title) for title in required]
    if any(position < 0 for position in positions) or positions != sorted(positions):
        fail("surface template does not contain the seven ordered sections")

    registry = json.loads((SPEC / "invariants.json").read_text())
    entries = registry.get("invariants", [])
    expected = [f"WS-{number:02d}" for number in range(1, 24)]
    if [entry.get("id") for entry in entries] != expected:
        fail("invariants registry must contain WS-01 through WS-23 in order")
    for entry in entries:
        if not entry.get("enforcedAt") or not entry.get("tests"):
            fail(f"{entry.get('id')} lacks an enforcement point or test")
        for test in entry["tests"]:
            test_path = ROOT / test
            if not test_path.is_file():
                fail(f"{entry.get('id')} references missing test {test}")
            if f"[{entry.get('id')}]" not in test_path.read_text():
                fail(f"{entry.get('id')} has no explicit assertion tag in {test}")

    cli_sources = "\n".join(path.read_text() for path in (ROOT / "packages/cli/src").glob("*.ts"))
    forbidden = ["surface.create", "orchestrate.register", "surface.derive", "revision.commit", "revision.checkout"]
    for token in forbidden:
        if token in cli_sources:
            fail(f"CLI still exposes forbidden domain mutation {token}")

    public_paths = [
        *(ROOT / "packages/core/src").glob("*.ts"),
        ROOT / "packages/web/client.js",
        ROOT / "packages/web/index.js",
    ]
    public_sources = "\n".join(path.read_text(errors="ignore") for path in public_paths)
    # SessionId may appear only as DSH execution evidence; it is not a Surface
    # identity. Canonical relation and parent models remain forbidden.
    for token in ("canonicalRelation", "parentSurface"):
        if token in public_sources:
            fail(f"public Core/Web surface contains forbidden identity or relation token {token}")


def run(command: list[str]) -> None:
    subprocess.run(command, cwd=ROOT, check=True)


def main() -> int:
    static_checks()
    run(["node", "scripts/validate-schemas.mjs"])
    run(["pnpm", "typecheck"])
    run(["pnpm", "test"])
    run(["node", "scripts/verify-protocol.mjs"])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
