export const COORDINATE_HELP = String.raw`WORKSURFACE COORDINATION

PURPOSE
Coordinate existing Surfaces when an Event should transfer or transform context and then advance registered Surfaces.

USE WHEN
The work needs delegation, fan-out, join, sequencing, or iteration across Surfaces that already exist. Do not create an Orchestration for simple independent authoring.

PRECONDITIONS
Every bound Surface already exists under WORKSURFACE_ROOT/surfaces and has a valid surface.md. Create the Surfaces first with help author. The host executes a Python entrypoint in an isolated local subprocess.

DO
1. Create WORKSURFACE_ROOT/orchestrations/<orchestration-id>/artifact/.
2. Put ordinary entrypoint code, local Event Contract declarations, and all support files inside artifact/.
3. Put registration.json beside artifact/, not inside it. It declares version, registrationId, the artifact-relative entrypoint, local-handle-to-existing-Surface bindings, and Event routes using consumeFrom, emitOn, or surfaceOutputFrom.
4. Put business conditions, transformation, fan-out, join, sequencing, and loops in ordinary entrypoint code.
5. Orchestrate code may update staged copies of registered Surfaces and request registered Event or advance outputs. It does not create, delete, or rebind Surfaces.
6. Run ws sync to validate and admit the materials. Correct reported errors before starting work. Run ws run on the initial Surface with a business instruction and a stable request key; publication of a routed Event triggers the relationship.

MINIMAL SEQUENCE EXAMPLE
Adapt goal and acceptance criteria before using this example. Two valid Surfaces already exist: research and report. In its active Turn, research writes findings.md, runs ws publish --key findings-v1, then emits research.ready when its evidence meets the stated criteria. The relationship reads the confirmed files, transfers those findings, and asks report to continue. Report writes its final files and runs ws publish --key report-v1 even though its business outputs list is empty.

registration.json:
{
  "version": 1,
  "registrationId": "research-to-report",
  "entrypoint": "orchestrate.py",
  "bindings": { "source": "research", "target": "report" },
  "events": {
    "research.ready": {
      "file": "contracts/research.ready.json",
      "consumeFrom": ["source"],
      "surfaceOutputFrom": ["source"]
    }
  }
}

artifact/contracts/research.ready.json:
{
  "name": "research.ready",
  "description": "Research findings are evidence-backed and ready for report drafting.",
  "payloadSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": false,
    "required": ["summary"],
    "properties": { "summary": { "type": "string", "minLength": 1 } }
  }
}

artifact/orchestrate.py:
import json
from pathlib import Path

run = Path.cwd()
state = json.loads((run / "state.json").read_text())
inputs = [json.loads(line) for line in
          (run / state["files"]["inputs"]).read_text().splitlines() if line]
trigger = next(item for item in inputs
               if item["inputSeq"] == state["triggerInputSeq"])
result = {"version": 1, "events": [], "advance": []}
if trigger["surface"] == "source" and trigger["event"]["name"] == "research.ready":
    source = run / state["surfaces"]["source"]
    target = run / state["surfaces"]["target"]
    findings = (source / "findings.md").read_text()
    if not findings.strip():
        raise ValueError("Research findings are empty; do not advance report")
    (target / "research.md").write_text(findings)
    result["advance"].append({
        "surface": "target",
        "instruction": "Read research.md and surface.md. Produce and verify report.md against the report's acceptance criteria.",
        "outputs": []
    })
(run / state["files"]["result"]).write_text(json.dumps(result) + "\n")

RUN VIEW AND OUTPUT RULES
- state.json locates bound staged Surfaces, contracts, the inputs file, and the result file. Read these provided paths; do not reach into authoring or hidden runtime directories.
- Staged Surfaces contain confirmed files. Agent-written drafts become visible to the relationship only after ws publish succeeds in that Surface's active Turn; emitting a business Event does not publish files. Publish before the Event that should transfer those files. Preserve a publication key for an uncertain retry; use a new key for a new file snapshot.
- inputs.jsonl contains {inputSeq, surface, event}; select state.triggerInputSeq. Earlier inputs support joins and iteration. Recompute business conditions from durable inputs instead of process globals.
- Write a result object with version: 1, events: [], and advance: []. Each advance is {surface: <bound handle>, instruction: <text>, outputs: [<declared surface-output event names>]}.
- To emit from Orchestrate, add {surface: <bound handle>, name: <event>, payload: <schema-valid object>} to events. Its route must declare emitOn for that handle; consumeFrom permits input observation, and surfaceOutputFrom permits that Surface's Agent to publish. Permissions are separate.
- Each business Event declaration has exactly name, description, and payloadSchema. Its payloadSchema must declare "$schema": "https://json-schema.org/draft/2020-12/schema" and "type": "object".
- Do not claim runtime-produced lifecycle or revision Events. A result may request only declared business outputs. Writing a file, finishing a model turn, and passing business acceptance are distinct facts.
- For a join, check durable inputs for all required sources and conditions before producing an advance. Unmet conditions return empty arrays. External side effects with uncertain outcomes require observation before retry.

VALIDATE
Run ws sync. Verify the Surface ids, contract names, payload schemas, entrypoint path, and route permissions. A saved registration.json alone does not prove admission or a completed workflow. Use ws recover after host restart, retaining the same Surface identities and confirmed files.
`
