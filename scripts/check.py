#!/usr/bin/env python3
"""Single WorkSurface design gate: protocol, boundaries, build, and tests. [WS-23]"""

from __future__ import annotations

import json
import hashlib
import pathlib
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
        fail("interactive design receipt is not a clean 9/9 showcase validation")

    source = json.loads((INTERACTIVE_DESIGN / receipt["source"]).read_text())
    artifact = (INTERACTIVE_DESIGN / receipt["artifact"]).read_text()
    if source.get("diagram_type") != "architecture" or source.get("meta", {}).get("quality_profile") != "showcase":
        fail("interactive design source is not a showcase Archify architecture")
    component_ids = {component.get("id") for component in source.get("components", [])}
    required_components = {
        "surface", "session", "turn_context", "model", "definition_json",
        "event_contract", "fixed_definition", "ws_emit", "event_stream",
        "orchestrate", "activation_operation", "code_binding", "runtime_injection",
        "code_handler", "effects_file", "managed_operation", "delivery", "target_session",
    }
    missing_components = sorted(required_components - component_ids)
    if missing_components:
        fail("interactive design lacks required system concepts: " + ", ".join(missing_components))
    component_vocabulary = "\n".join(
        str(component.get(field, ""))
        for component in source.get("components", [])
        for field in ("id", "label", "sublabel", "tag")
    )
    if "YAML" in component_vocabulary:
        fail("interactive design reintroduces the rejected YAML pattern authoring model")
    cards = "\n".join(
        str(item)
        for card in source.get("cards", [])
        for item in card.get("items", [])
    )
    if "code.env" not in component_vocabulary + cards or "直接" not in component_vocabulary + cards:
        fail("interactive design does not show direct Runtime environment injection")
    if "<svg" not in artifact or "WorkSurface" not in artifact:
        fail("interactive design artifact is not a rendered WorkSurface diagram")
    for schema in (
        "event.schema.json", "definition.schema.json", "context.schema.json",
        "binding.schema.json", "authoring-registration.schema.json",
        "code-handler-context.schema.json", "code-handler-emit.schema.json",
    ):
        json.loads((SPEC / schema).read_text())
    for schema in (
        "event-contract.schema.json", "orchestrate-code-binding.schema.json",
        "definition-v2.schema.json", "delivery-context.schema.json",
        "orchestrate-code-host.schema.json", "orchestrate-code-context.schema.json",
        "orchestrate-effect.schema.json",
    ):
        json.loads((SPEC / "design" / schema).read_text())
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
