#!/usr/bin/env python3
"""Single WorkSurface design gate: protocol, boundaries, build, and tests. [WS-23]"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = ROOT / "spec"
INTERACTIVE_DESIGN = ROOT / "docs" / "interactive"


def fail(message: str) -> None:
    raise SystemExit(f"WorkSurface check failed: {message}")


def static_checks() -> None:
    overview = (INTERACTIVE_DESIGN / "worksurface-system.html").read_text()
    required_overview_concepts = {
        "复杂目标", "Surface = 工作单元", "DSH Session = 执行者的历史",
        "Orchestrate = 工作单元之间的关系", "独立验收", "明确依赖",
        "资料研究", "数据核验", "报告成稿",
    }
    missing_overview_concepts = sorted(concept for concept in required_overview_concepts if concept not in overview)
    if missing_overview_concepts:
        fail("worksurface-system.html lacks required concepts: " + ", ".join(missing_overview_concepts))
    if "viewer.kind.frontend" in overview or "viewer.kind.database" in overview or "archify" in overview.lower():
        fail("worksurface-system.html reintroduces unrelated architecture-template semantics")
    for implementation_detail in ("Replay / Match", "Durable Operation", "record → effect → settle"):
        if implementation_detail in overview:
            fail(f"worksurface-system.html leaks Runtime detail into the product concept diagram: {implementation_detail}")
    if "用户的复杂目标" not in overview or "唯一绑定的 DSH Session" not in overview:
        fail("worksurface-system.html must explain the product through a concrete user goal and the Surface/Session relation")
    target_design = "\n".join(
        (ROOT / "docs" / name).read_text()
        for name in (
            "design-baseline.md",
            "event-type-system.md",
            "orchestration-code-contract.md",
        )
    )
    for withdrawn_target_token in (
        "effects.json",
        "surface.continue",
        "surface.file.",
        "review-reconcile.py",
        "review-runtime/",
        "orchestration-semantics.md",
        "context-management.md",
    ):
        if withdrawn_target_token in target_design:
            fail(f"target design reintroduces withdrawn Orchestrate contract {withdrawn_target_token}")
    for required_target_boundary in (
        "Orchestrate 不创建",
        "Surface authoring",
        "Orchestrate Registration",
        "consumeFrom",
        "emitOn",
        "surfaceOutputFrom",
        "result.json",
    ):
        if required_target_boundary not in target_design:
            fail(f"target design lacks stable Orchestrate boundary {required_target_boundary}")
    for schema in (
        "event.schema.json", "definition.schema.json", "context.schema.json",
        "binding.schema.json", "authoring-registration.schema.json",
        "code-handler-context.schema.json", "code-handler-emit.schema.json",
    ):
        json.loads((SPEC / schema).read_text())
    target_schemas = (
        "runtime-authority.schema.json",
        "runtime-binding.schema.json",
        "runtime-event-contract.schema.json",
        "runtime-event-envelope.schema.json",
        "builtin-event-catalog.schema.json",
        "event-declaration.schema.json",
        "session-shell-contract.schema.json",
        "surface-turn-brief.schema.json",
        "orchestrate-registration.schema.json",
        "orchestrate-registration-record.schema.json",
        "orchestrate-input-ledger-record.schema.json",
        "orchestrate-input-record.schema.json",
        "orchestrate-run-state.schema.json",
        "orchestrate-result.schema.json",
        "orchestrate-operation-batch.schema.json",
        "orchestrate-operation-settlement.schema.json",
    )
    target_design_files = sorted(path.name for path in (SPEC / "design").glob("*.schema.json"))
    if target_design_files != sorted(target_schemas):
        fail("spec/design contains a schema outside the current target protocol set")
    for schema in target_schemas:
        json.loads((SPEC / "design" / schema).read_text())
        if schema not in target_design:
            fail(f"target protocol {schema} has no target design link")
    json.loads((SPEC / "design" / "session-shell-contract.json").read_text())
    json.loads((SPEC / "design" / "builtin-event-catalog.json").read_text())
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
    expected = [f"WS-{number:02d}" for number in range(1, 28)]
    if [entry.get("id") for entry in entries] != expected:
        fail("invariants registry must contain WS-01 through WS-27 in order")
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
