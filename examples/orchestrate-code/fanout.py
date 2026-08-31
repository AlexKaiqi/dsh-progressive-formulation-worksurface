import json
import os
from pathlib import Path

case_id = os.environ["CASE_ID"]
question = os.environ["QUESTION"]
effects_file = Path(os.environ["WS_EFFECTS_FILE"])

with effects_file.open("a", encoding="utf-8") as output:
    for reviewer in ("reviewer-a", "reviewer-b"):
        effect = {
            "kind": "followup",
            "role": reviewer,
            "operationKey": f"review:{case_id}:{reviewer}",
            "instruction": f"Independently review case {case_id}: {question}",
        }
        output.write(json.dumps(effect, ensure_ascii=False) + "\n")
