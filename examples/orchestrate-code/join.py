import json
import os
from pathlib import Path

case_id = os.environ["CASE_ID"]
review_a_ref = os.environ["REVIEW_A_REF"]
review_b_ref = os.environ["REVIEW_B_REF"]

effect = {
    "kind": "emit",
    "role": "coordinator",
    "operationKey": f"join-reviews:{case_id}",
    "event": "review.joined",
    "payload": {
        "caseId": case_id,
        "reviews": [review_a_ref, review_b_ref],
    },
}

with Path(os.environ["WS_EFFECTS_FILE"]).open("a", encoding="utf-8") as output:
    output.write(json.dumps(effect, ensure_ascii=False) + "\n")
