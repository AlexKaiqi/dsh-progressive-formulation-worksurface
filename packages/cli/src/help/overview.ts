export function overviewHelp(version: string): string {
  return `ws ${version}

WorkSurface keeps each line of work's independent long-term reasoning context in a Surface—facts, decisions, deliverables, and evidence—and coordinates existing Surfaces when that structure helps. Split complex work into independently solvable, independently verifiable parts, one Surface per part. Use an ordinary host session for work that does not benefit from this separation.

Usage:
  ws help [author|coordinate|publish|emit|recover]
  ws sync
  ws list
  ws run <surface-id> --instruction <text> --key <request-id>
  ws publish --key <stable-publication-key> [--summary <text>]
  ws recover
  ws emit <event-name> [--surface <surface-id>] [--key <operation-key>]
     [--payload <json> | --payload-file <path>]

Choose the current action:
  author       Create or maintain Surfaces in ordinary files; sync validates and admits them.
  coordinate   Relate existing Surfaces with ordinary Orchestrate code; sync admits the relationship.
  run          Ask the host to start or continue one existing Surface; the key makes a retry the same request.
  publish      Confirm the current Surface's files for downstream readers, within an active Surface Turn.
  emit         Submit an output authorized by the current Turn Brief.
  recover      Resume unfinished managed work after an interrupted host process.

Read help author or help coordinate before writing their materials. A successful sync initially admits authoring; run receipts a request. Files written during a Surface Turn remain drafts until publish succeeds. Publish confirms files; emit separately records an authorized business fact. None of these alone proves business acceptance. Runtime-owned identity, persistence, concurrency, and recovery internals are not model inputs.
`
}
