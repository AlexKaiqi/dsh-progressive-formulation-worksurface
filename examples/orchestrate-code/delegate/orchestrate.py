#!/usr/bin/env python3
"""Relationship code for two pre-existing, Registration-bound Surfaces."""

import json
from pathlib import Path, PurePosixPath


run_dir = Path.cwd()
state = json.loads((run_dir / "state.json").read_text())
surface_dirs = {handle: run_dir / path for handle, path in state["surfaces"].items()}

# A missing directory is a broken Runtime view. Orchestrate never creates a Surface.
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
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"unsafe Surface-relative path: {relative}")
    return surface_dirs[handle].joinpath(*path.parts)


# when: a registered research.requested fact from coordinator
if trigger["surface"] == "coordinator" and trigger["event"]["name"] == "research.requested":
    payload = trigger["event"]["payload"]
    question = surface_file("coordinator", payload["questionPath"]).read_text()

    # how + who: transfer the relevant context into an addressable file block
    # inside the already existing researcher Surface.
    assignment = surface_file("researcher", "blocks/delegation.md")
    assignment.parent.mkdir(parents=True, exist_ok=True)
    assignment.write_text(
        "# Delegated research\n\n"
        f"Task: `{payload['taskId']}`\n\n"
        f"{question.rstrip()}\n"
    )

    # Advancement is requested only after the staged context update exists.
    result["advance"].append({
        "surface": "researcher",
        "instruction": "Read blocks/delegation.md, complete the research, write results/research.md, then publish research.completed.",
        "outputs": ["research.completed"],
    })

# The same registered relationship also carries the result back.
if trigger["surface"] == "researcher" and trigger["event"]["name"] == "research.completed":
    payload = trigger["event"]["payload"]
    research = surface_file("researcher", payload["resultPath"]).read_text()
    returned = surface_file("coordinator", "blocks/research-result.md")
    returned.parent.mkdir(parents=True, exist_ok=True)
    returned.write_text(
        "# Returned research\n\n"
        f"Task: `{payload['taskId']}`\n\n"
        f"Summary: {payload['summary']}\n\n"
        f"{research.rstrip()}\n"
    )
    result["advance"].append({
        "surface": "coordinator",
        "instruction": "Research has returned in blocks/research-result.md. Integrate it into the current work.",
        "outputs": [],
    })

(run_dir / state["files"]["result"]).write_text(json.dumps(result, indent=2) + "\n")
