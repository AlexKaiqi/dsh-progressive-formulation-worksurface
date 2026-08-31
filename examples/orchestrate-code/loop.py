import json
import os
from pathlib import Path

case_id = os.environ["CASE_ID"]
iteration = int(os.environ["ITERATION"])
converged = os.environ["CONVERGED"] == "true"

if converged:
    effect = {
        "kind": "emit",
        "role": "coordinator",
        "operationKey": f"complete:{case_id}",
        "event": "workflow.completed",
        "payload": {"caseId": case_id, "iterations": iteration},
    }
else:
    next_iteration = iteration + 1
    effect = {
        "kind": "emit",
        "role": "worker",
        "operationKey": f"request-iteration:{case_id}:{next_iteration}",
        "event": "iteration.requested",
        "payload": {
            "caseId": case_id,
            "iteration": next_iteration,
            "iterationKey": f"{case_id}:{next_iteration}",
        },
    }

with Path(os.environ["WS_EFFECTS_FILE"]).open("a", encoding="utf-8") as output:
    output.write(json.dumps(effect, ensure_ascii=False) + "\n")
