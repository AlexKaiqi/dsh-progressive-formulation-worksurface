#!/usr/bin/env python3
"""Serial handoff plus an explicit code-controlled loop over one bound Surface."""

import json
from pathlib import Path, PurePosixPath


run_dir = Path.cwd()
state = json.loads((run_dir / "state.json").read_text())
surface_dirs = {handle: run_dir / path for handle, path in state["surfaces"].items()}
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


def write_iteration(task_id: str, iteration: int, focus: str, source: str) -> None:
    assignment = surface_file("worker", "blocks/iteration.md")
    assignment.parent.mkdir(parents=True, exist_ok=True)
    assignment.write_text(
        "# Refinement iteration\n\n"
        f"Task: `{task_id}`\n\n"
        f"Iteration: {iteration}\n\n"
        f"Focus: {focus}\n\n"
        f"Current material:\n\n{source.rstrip()}\n"
    )


if trigger["surface"] == "coordinator" and trigger["event"]["name"] == "refinement.requested":
    payload = trigger["event"]["payload"]
    source = surface_file("coordinator", payload["sourcePath"]).read_text()
    write_iteration(payload["taskId"], 1, payload["initialFocus"], source)
    result["advance"].append({
        "surface": "worker",
        "instruction": "Complete the iteration in blocks/iteration.md, update results/refined.md, then publish iteration.completed.",
        "outputs": ["iteration.completed"],
    })


if trigger["surface"] == "worker" and trigger["event"]["name"] == "iteration.completed":
    payload = trigger["event"]["payload"]
    refined = surface_file("worker", payload["resultPath"]).read_text()
    if payload["converged"]:
        returned = surface_file("coordinator", "blocks/refined-result.md")
        returned.parent.mkdir(parents=True, exist_ok=True)
        returned.write_text(
            "# Refined result\n\n"
            f"Task: `{payload['taskId']}`\n\n"
            f"Iterations: {payload['iteration']}\n\n"
            f"{refined.rstrip()}\n"
        )
        result["advance"].append({
            "surface": "coordinator",
            "instruction": "The converged result is in blocks/refined-result.md. Continue the main work.",
            "outputs": [],
        })
    else:
        write_iteration(payload["taskId"], payload["iteration"] + 1, payload["nextFocus"], refined)
        result["advance"].append({
            "surface": "worker",
            "instruction": "A new iteration is in blocks/iteration.md. Refine results/refined.md and publish iteration.completed again.",
            "outputs": ["iteration.completed"],
        })


(run_dir / state["files"]["result"]).write_text(json.dumps(result, indent=2) + "\n")
