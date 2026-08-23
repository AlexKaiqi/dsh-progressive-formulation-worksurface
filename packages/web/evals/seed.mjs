import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProjectionCompiler, WorkSurfaceStore } from '@pf-worksurface/core'

function argumentsOf(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined) throw new Error('arguments must be --name value pairs')
    values[name.slice(2)] = value
  }
  return values
}

const args = argumentsOf(process.argv.slice(2))
const required = ['root', 'root-session', 'source-session', 'target-session']
for (const name of required) if (!args[name]?.trim()) throw new Error(`missing --${name}`)
const sessionIds = [args['root-session'], args['source-session'], args['target-session']]
if (new Set(sessionIds).size !== sessionIds.length) throw new Error('the three fixture Surfaces require three distinct Session IDs')

const stateRoot = resolve(args.root)
const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const store = new WorkSurfaceStore({ root: stateRoot })
const attemptId = 'pf-worksurface-web-eval-v1'

await store.newSurface({ attemptId, key: 'root', templatePath: fixture('root'), surface: 'ws-eval-root' })
await store.newSurface({ attemptId, key: 'source', templatePath: fixture('source'), surface: 'ws-eval-source', parent: 'ws-eval-root' })
await store.newSurface({ attemptId, key: 'target', templatePath: fixture('target'), surface: 'ws-eval-target', parent: 'ws-eval-root' })
await store.bindSession({
  surface: 'ws-eval-root',
  sessionId: args['root-session'],
  role: 'root',
  rootSurface: 'ws-eval-root',
})
const sourceProjection = await new ProjectionCompiler(store).compile({ surface: 'ws-eval-source', profile: 'research', tokenBudget: 10_000 })
await store.bindSession({
  surface: 'ws-eval-source',
  sessionId: args['source-session'],
  role: 'delegated',
  execution: 'continuable',
  rootSurface: 'ws-eval-root',
  parentSessionId: args['root-session'],
  input: {
    surfaceRevision: sourceProjection.surfaceRevision,
    blockRevisions: sourceProjection.blockRevisions,
    omittedBlockRevisions: [],
    profile: sourceProjection.profile,
    task: 'produce the evaluation source evidence',
  },
})
const projection = await new ProjectionCompiler(store).compile({ surface: 'ws-eval-target', profile: 'research', tokenBudget: 10_000 })
await store.bindSession({
  surface: 'ws-eval-target',
  sessionId: args['target-session'],
  role: 'delegated',
  execution: 'continuable',
  rootSurface: 'ws-eval-root',
  parentSessionId: args['root-session'],
  input: {
    surfaceRevision: projection.surfaceRevision,
    blockRevisions: projection.blockRevisions,
    omittedBlockRevisions: [],
    profile: projection.profile,
    task: 'produce the evaluation target result',
  },
})
await store.completeSessionBinding('ws-eval-target', args['target-session'], {
  surface: 'ws-eval-target',
  surfaceRevision: projection.surfaceRevision,
  summary: 'evaluation target complete',
  outputs: [{ surface: 'ws-eval-target', block: 'result', revision: projection.surfaceRevision }],
})

const graph = await store.graphSnapshot('ws-eval-root')
console.log(JSON.stringify({
  stateRoot,
  rootSurface: graph.rootSurface,
  rootSessionId: graph.rootSessionId,
  nodes: graph.nodes.map(node => ({ surface: node.surface, sessionId: node.sessionId, phase: node.phase })),
  edges: graph.edges.map(edge => ({ source: edge.source, target: edge.target, block: edge.sourceBlock, revision: edge.sourceRevision })),
}, null, 2))
