import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const react = join(dirname(require.resolve('react/package.json')), 'umd', 'react.development.js')
const reactDom = join(dirname(require.resolve('react-dom/package.json')), 'umd', 'react-dom.development.js')
const client = new URL('../client.js', import.meta.url)
const styles = new URL('../styles.css', import.meta.url)

const ref = (subject, seq, id) => ({ subject, seq, id })
const authority = 'wsa_browser_acceptance'
const runtimeRef = (surfaceId, seq, id) => ({ source: 'worksurface', subject: { authority, kind: 'surface', id: surfaceId }, seq, id })
const snapshot = {
  anchorSurfaceId: 'research',
  viewRevision: `sha256:${'d'.repeat(64)}`,
  view: {
    version: 1,
    title: '发布准备工作台',
    layout: { groups: [
      { id: 'inputs', title: '输入证据', surfaces: ['research', 'review'] },
      { id: 'delivery', title: '交付', surfaces: ['publish'] },
    ] },
  },
  surfaces: [
    { surfaceId: 'research', title: '整理用户研究', group: 'inputs', lifecycle: { phase: 'completed', evidence: [], verified: true, verificationEvidence: [] } },
    { surfaceId: 'review', title: '审核发布素材', group: 'inputs', lifecycle: { phase: 'waiting-user', evidence: [{ ref: ref('surface:review', 2, 'input'), name: 'approval.requested' }], verified: false, verificationEvidence: [] } },
    { surfaceId: 'publish', title: '生成发布包', group: 'delivery', lifecycle: { phase: 'published', evidence: [{ ref: ref('surface:publish', 0, 'publication'), name: 'surface.revision.published' }], verified: false, verificationEvidence: [] } },
  ],
  orchestrations: [{
    orchestrationId: 'release-flow', registrationId: 'reg-release', definitionRevision: `sha256:${'a'.repeat(64)}`,
    status: 'active', bindings: { research: 'research', review: 'review', target: 'publish' },
    definition: { version: 1, roles: ['research', 'review', 'target'], subscriptions: [{
      id: 'evidence-ready', history: 'all', key: '$.payload.releaseId',
      when: { all: [{ role: 'research', event: 'research.accepted' }, { role: 'review', event: 'review.accepted' }] },
      reaction: { emit: [{ role: 'target', event: 'release.bundle.ready', operationKey: 'announce-ready', payload: {} }] },
    }] },
    subscriptions: [{ id: 'evidence-ready', history: 'all', key: '$.payload.releaseId', activationCount: 0, condition: {
      kind: 'all', satisfied: false, expressions: [
        { kind: 'event', selector: { role: 'research', event: 'research.accepted' }, satisfied: true, matches: [{ ref: ref('surface:research', 3, 'accepted'), event: { name: 'research.accepted' } }] },
        { kind: 'event', selector: { role: 'review', event: 'review.accepted' }, satisfied: false, matches: [] },
      ],
    } }],
    activations: [], pendingOperations: [], actual: [], planned: [], runs: [],
  }],
  codeFirst: [{
    registrationId: 'release-code', orchestrateRevision: `sha256:${'c'.repeat(64)}`,
    bindings: { research: 'research', review: 'review', subject: 'publish' },
    routes: {
      'release.requested': { consumeFrom: ['research', 'review'] },
      'release.bundle.completed': { emitOn: ['subject'], surfaceOutputFrom: ['subject'] },
    },
    acceptedInputCount: 2, recordedRunCount: 1, pendingRunCount: 0,
  }],
  runtimeEvents: {
    research: [{ version: 1, id: 'request', subject: { authority, kind: 'surface', id: 'research' }, seq: 0, recordedAt: '2026-09-01T00:00:00.000Z', type: { scope: { authority, kind: 'registration', id: 'release-code' }, name: 'release.requested', contract: `sha256:${'e'.repeat(64)}` }, payload: { releaseId: 'demo' }, producer: { kind: 'surface-session', ref: 'worksurface-research/turn-1' }, operationKey: 'request-release', causes: [] }],
    publish: [{ version: 1, id: 'completed', subject: { authority, kind: 'surface', id: 'publish' }, seq: 1, recordedAt: '2026-09-01T00:00:01.000Z', type: { scope: { authority, kind: 'registration', id: 'release-code' }, name: 'release.bundle.completed', contract: `sha256:${'f'.repeat(64)}` }, payload: { releaseId: 'demo' }, producer: { kind: 'orchestrate', ref: 'release-code/run-1' }, operationKey: 'complete-release', causes: [runtimeRef('research', 0, 'request')] }],
  },
}

const html = `<!doctype html>
<html lang="zh-CN" data-ds-dark-theme><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WorkSurface UI acceptance</title><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head>
<body><main id="root"></main><script src="/react.js"></script><script src="/react-dom.js"></script><script>
window.__ModuleLoader__={load(spec){window.__worksurfacePlugin=spec.factory(name=>{if(name==='react')return React;throw new Error('unknown module '+name)})}};
window.__renderWorkSurface=()=>{const locale={subscribe:()=>()=>{},getSnapshot:()=>({active:'zh'}),register:()=>()=>{},bind:()=>key=>key};const sessionId='worksurface-research';const sessions={list:{getSnapshot:()=>({byId:{[sessionId]:{sessionId}}}),subscribe:()=>()=>{}},open:id=>{document.body.dataset.openedSession=id}};const ctx={locale,sessions,effect:fn=>fn(),slots:{inject:(_name,fn)=>fn(),register:(_options,Component)=>ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Component,{ctx}))}};window.__worksurfacePlugin.apply(ctx)};
</script><script src="/client.js" onload="window.__renderWorkSurface()"></script></body></html>`

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  if (path === '/') return send(response, 'text/html; charset=utf-8', html)
  if (path === '/react.js') return send(response, 'text/javascript; charset=utf-8', await readFile(react))
  if (path === '/react-dom.js') return send(response, 'text/javascript; charset=utf-8', await readFile(reactDom))
  if (path === '/client.js') return send(response, 'text/javascript; charset=utf-8', await readFile(client))
  if (path === '/worksurface-map/styles.css') return send(response, 'text/css; charset=utf-8', await readFile(styles))
  if (path === '/worksurface-map/api/surfaces') return json(response, { surfaces: snapshot.surfaces.map(({ surfaceId, title }) => ({ surfaceId, title })) })
  if (request.method === 'POST' && path === '/worksurface-map/api/session') return json(response, { surfaceId: 'research', sessionId: 'worksurface-research', created: true, resumed: false })
  if (path === '/worksurface-map/api/topology') return json(response, snapshot)
  if (path === '/worksurface-map/api/watch') {
    await new Promise(resolve => setTimeout(resolve, 10_000))
    return json(response, { changed: false })
  }
  response.writeHead(404).end()
})

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (typeof address === 'object' && address !== null) process.stdout.write(`http://127.0.0.1:${address.port}/\n`)
})

function send(response, type, body) {
  response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
  response.end(body)
}
function json(response, body) { send(response, 'application/json; charset=utf-8', JSON.stringify(body)) }
