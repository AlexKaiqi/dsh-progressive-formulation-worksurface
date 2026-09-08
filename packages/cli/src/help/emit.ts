export const EMIT_HELP = `WORKSURFACE OUTPUT

PURPOSE
Submit a domain fact authorized for the current Surface Turn.

USE WHEN
The current work satisfies one output's condition in WORKSURFACE_VIEW_DIR/turn-brief.json.

DO
1. Read turn-brief.json.
   If this fact depends on newly written files, first follow filePublication and run ws publish --key <stable-publication-key> [--summary <text>]. Confirm publication succeeded before emitting the business fact. Reuse the key for an uncertain retry of that same publication; changed files need a new key.
2. Select only an entry in outputs whose when condition is satisfied.
3. Resolve the environment variable in schemaPath, read that schema, and save a matching JSON object in a payload file.
4. command.argv is a template: resolve its executable locator from the environment and replace <JSON matching schema> with the serialized payload. Direct argv execution does not expand environment variables automatically.
5. Run the resolved command.argv as argv exactly; do not reconstruct a shell string. The Host validates the payload against the authorized schema.

EXECUTABLE EXAMPLE
Set WS_OUTPUT to the selected Brief output's name and WS_PAYLOAD to your prepared JSON file. The example name review.completed is usable only when present in this Turn's outputs.

WS_OUTPUT=review.completed
WS_PAYLOAD=./payload.json
python3 - "$WS_OUTPUT" "$WS_PAYLOAD" <<'PY'
import json, os, pathlib, subprocess, sys

view = pathlib.Path(os.environ["WORKSURFACE_VIEW_DIR"])
brief = json.loads((view / "turn-brief.json").read_text())
output = next(item for item in brief["outputs"] if item["name"] == sys.argv[1])
schema_path = pathlib.Path(os.path.expandvars(output["schemaPath"]))
schema = json.loads(schema_path.read_text())
payload = json.loads(pathlib.Path(sys.argv[2]).read_text())
if not isinstance(payload, dict):
    raise ValueError("payload must be a JSON object matching the selected schema")
argv = list(output["command"]["argv"])
argv[0] = os.path.expandvars(argv[0])
argv[argv.index("<JSON matching schema>")] = json.dumps(payload, ensure_ascii=False)
subprocess.run(argv, check=True)
PY

BOUNDARIES
- ws emit records an authorized domain fact; publish confirms the current Surface files and does not emit a business fact. A filePublication command is separate from outputs and remains usable when outputs is empty.
- Retain valid drafts and intermediate evidence; file publication does not mean business acceptance. Final deliverables also need explicit publication.
- sync, list, run, publish, and recover are host operations.
- Do not emit an output absent from the current Turn Brief.
- Waiting for the user, model or tool failure, cancellation, retry, and execution completion belong to the host session/Turn. They are not WorkSurface domain Events.
- Outside a managed Surface Turn, do not use ws emit; author the Surface first.
`
