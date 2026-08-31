#!/usr/bin/env python3
"""Single WorkSurface design gate: protocol, boundaries, build, and tests. [WS-23]"""

from __future__ import annotations

import json
import hashlib
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = ROOT / "spec"
INTERACTIVE_DESIGN = ROOT / "docs" / "interactive"


def fail(message: str) -> None:
    raise SystemExit(f"WorkSurface check failed: {message}")


def static_checks() -> None:
    receipt_path = INTERACTIVE_DESIGN / "worksurface-system.receipt.json"
    receipt = json.loads(receipt_path.read_text())
    for receipt_key, path_key in (
        ("specificationSha256", "source"),
        ("artifactSha256", "artifact"),
    ):
        artifact_path = INTERACTIVE_DESIGN / receipt[path_key]
        actual_digest = hashlib.sha256(artifact_path.read_bytes()).hexdigest()
        if actual_digest != receipt[receipt_key]:
            fail(
                f"interactive design {artifact_path.name} does not match "
                f"{receipt_path.name}; regenerate and validate the diagram"
            )
    validation = receipt.get("validation", {})
    if (
        validation.get("profile") != "showcase"
        or validation.get("checksPassed") != 9
        or validation.get("checkCount") != 9
        or validation.get("errors") != 0
        or validation.get("warnings") != 0
    ):
        fail("interactive design receipt is not a clean 9/9 Showcase validation")

    design_source = json.loads(
        (INTERACTIVE_DESIGN / receipt["source"]).read_text()
    )
    design_nodes = design_source.get("components", design_source.get("nodes", []))
    used_kinds = {component["type"] for component in design_nodes}
    domain_entries = design_source.get("meta", {}).get("legend", {}).get("entries", {})
    missing_labels = sorted(
        kind for kind in used_kinds if not domain_entries.get(kind, {}).get("label")
    )
    if missing_labels:
        fail(
            "interactive design lacks domain passport labels for renderer kinds: "
            + ", ".join(missing_labels)
        )
    html = (INTERACTIVE_DESIGN / "worksurface-system.html").read_text()
    i18n_match = re.search(
        r'<script\b(?=[^>]*\bid="archify-i18n-data")'
        r'(?=[^>]*\btype="application/json")[^>]*>\s*(\{.*?\})\s*</script>',
        html,
        re.DOTALL,
    )
    if not i18n_match:
        fail("interactive design lacks the Archify i18n payload")
    viewer_messages = json.loads(i18n_match.group(1)).get("messages", {})
    for kind in sorted(used_kinds):
        expected_label = domain_entries[kind]["label"]
        if viewer_messages.get(f"viewer.kind.{kind}") != expected_label:
            fail(
                f"interactive design exposes renderer kind {kind!r} instead of "
                f"domain passport label {expected_label!r}; run pnpm design:domain-labels"
            )

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
