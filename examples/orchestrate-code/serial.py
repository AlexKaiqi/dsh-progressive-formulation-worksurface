import json
import os
from pathlib import Path

case_id = os.environ["CASE_ID"]
prepared_ref = os.environ["PREPARED_REF"]

effect = {
    "kind": "followup",
    "role": "stage-c",
    "operationKey": f"run-stage-c:{case_id}",
    "instruction": f"Continue case {case_id} from prepared result {prepared_ref}.",
}

with Path(os.environ["WS_EFFECTS_FILE"]).open("a", encoding="utf-8") as output:
    output.write(json.dumps(effect, ensure_ascii=False) + "\n")
