#!/usr/bin/env python3
"""Fan-out and join over three pre-existing, Registration-bound Surfaces."""

import json
from pathlib import Path, PurePosixPath


run_dir = Path.cwd()
state = json.loads((run_dir / "state.json").read_text())
surface_dirs = {handle: run_dir / path for handle, path in state["surfaces"].items()}
explorers = ("explorer_a", "explorer_b")

for handle, directory in surface_dirs.items():
    if not directory.is_dir():
        raise RuntimeError(f"bound Surface {handle!r} is missing from the run view")

inputs = {
    item["inputSeq"]: item
    for line in (run_dir / state["files"]["inputs"]).read_text().splitlines()
    if line
    for item in [json.loads(line)]
}
trigger = inputs[state["triggerInputSeq"]]
result = {"version": 1, "events": [], "advance": []}


def surface_file(handle: str, relative: str) -> Path:
    path = PurePosixPath(relative)
    if handle not in surface_dirs or path.is_absolute() or ".." in path.parts:
        raise ValueError(f"unsafe Surface address: {handle}/{relative}")
    return surface_dirs[handle].joinpath(*path.parts)


if trigger["surface"] == "coordinator" and trigger["event"]["name"] == "exploration.requested":
    payload = trigger["event"]["payload"]
    if set(payload["targets"]) != set(explorers):
        raise ValueError("exploration targets must equal the registered explorer handles")
    source = surface_file("coordinator", payload["sourcePath"]).read_text().rstrip()

    for handle in explorers:
        assignment = surface_file(handle, "blocks/exploration.md")
        assignment.parent.mkdir(parents=True, exist_ok=True)
        assignment.write_text(
            "# Independent exploration\n\n"
            f"Task: `{payload['taskId']}`\n\n"
            f"Focus: {payload['targets'][handle]}\n\n"
            f"Source question:\n\n{source}\n"
        )
        result["advance"].append({
            "surface": handle,
            "instruction": "Read blocks/exploration.md, write results/exploration.md, then publish exploration.completed.",
            "outputs": ["exploration.completed"],
        })


if trigger["surface"] in explorers and trigger["event"]["name"] == "exploration.completed":
    task_id = trigger["event"]["payload"]["taskId"]
    completed = {}
    for item in inputs.values():
        if item["surface"] not in explorers or item["event"]["name"] != "exploration.completed":
            continue
        if item["event"]["payload"]["taskId"] == task_id:
            completed[item["surface"]] = item["event"]["payload"]

    # join: no effect until every registered explorer has completed this task
    if set(completed) == set(explorers):
        sections = ["# Exploration results", "", f"Task: `{task_id}`", ""]
        for handle in explorers:
            payload = completed[handle]
            detail = surface_file(handle, payload["resultPath"]).read_text().rstrip()
            sections.extend([f"## {handle}", "", payload["summary"], "", detail, ""])
        joined = surface_file("coordinator", "blocks/exploration-results.md")
        joined.parent.mkdir(parents=True, exist_ok=True)
        joined.write_text("\n".join(sections))
        result["advance"].append({
            "surface": "coordinator",
            "instruction": "Both explorations are available in blocks/exploration-results.md. Compare and integrate them.",
            "outputs": [],
        })


(run_dir / state["files"]["result"]).write_text(json.dumps(result, indent=2) + "\n")
