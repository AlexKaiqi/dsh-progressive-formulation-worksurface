import json
import os
from pathlib import Path

task_id = os.environ["TASK_ID"]
question = os.environ["QUESTION"]

effect = {
    "kind": "followup",
    "role": "researcher",
    "operationKey": f"assign-research:{task_id}",
    "instruction": f"Research task {task_id}: {question}",
}

with Path(os.environ["WS_EFFECTS_FILE"]).open("a", encoding="utf-8") as output:
    output.write(json.dumps(effect, ensure_ascii=False) + "\n")
