import json
import os
import subprocess

with open(os.environ["DSH_CONTEXT_FILE"], encoding="utf-8") as stream:
    context = json.load(stream)

subprocess.run([
    "ws", "emit", "handler.output",
    "--surface", context["bindings"]["target"],
    "--key", "handler-output",
    "--payload", json.dumps({"language": "python", "activation": context["activation"]["id"]}),
], check=True)
