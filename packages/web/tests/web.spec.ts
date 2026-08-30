// Invariant assertions: [WS-20] [WS-22]
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error JavaScript Host entrypoint has no declarations
import { apply } from '../index.js'
// @ts-expect-error executable package eval has no declarations
import { validateSuite } from '../evals/validate-suite.mjs'

describe('native WorkSurface topology view', () => {
  it('uses the DSH conversation view ring and delegates Surface progress to native Session navigation', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
    const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
    const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8')
    expect(client).toContain("ctx.slots.inject('conversation.view'")
    expect(client).toContain("id: 'worksurface-topology'")
    expect(client).toContain("sessionStorage.setItem('worksurface-anchor'")
    expect(client).toContain("'all' in subscription.when ? '∧'")
    expect(client).toContain("'any' in subscription.when ? '∨'")
    expect(client).toContain("'sequence' in subscription.when ? '→'")
    expect(client).toContain("eq: '=', gte: '≥', lte: '≤'")
    expect(client).toContain("type: 'condition'")
    expect(client).toContain("type: 'path'")
    expect(client).toContain('pf-ws-node-roles')
    expect(client).toContain('view?.layout?.groups')
    expect(client).toContain('pf-ws-evidence-rail')
    expect(client).toContain("fetch('/worksurface-map/api/watch'")
    expect(client).not.toContain('setInterval')
    expect(client).toContain('🛡✓')
    for (const stage of ['possibleStage', 'matchedStage', 'activationStage', 'emitStage', 'publicationStage']) expect(client).toContain(stage)
    expect(client).toContain("fetch(`/worksurface-map/api/session?surface=")
    expect(client).toContain('props.ctx.sessions.open(value.sessionId)')
    expect(client).toContain("module.exports.inject = ['slots', 'locale', 'sessions']")
    expect(client).not.toMatch(/iframe|pf-ws-overlay|postMessage|relationship state/i)
    expect(source).not.toContain('worksurface-map.page')
    expect(source).not.toContain('worksurface-map.app')
    expect(styles).toContain('.pf-ws-edge.possible')
    expect(styles).toContain('stroke-dasharray')
    expect(styles).toContain('.pf-ws-edge.actual')
    expect(styles).toContain('.pf-ws-group')
    expect(styles).toContain('.pf-ws-edge-label')
    expect(styles).toContain('.pf-ws-evidence-rail')
    expect(styles).not.toContain('animation: pf-ws-pulse')
    for (const semantic of ['--ws-neutral', '--ws-active', '--ws-attention', '--ws-positive', '--ws-danger']) expect(styles).toContain(semantic)
  })

  it('has release coverage for topology, view definition, and event lifecycle semantics', async () => {
    const suite = JSON.parse(await readFile(new URL('../evals/suite.json', import.meta.url), 'utf8'))
    expect(validateSuite(suite)).toEqual([])
    expect(suite.cases.map((item: { id: string }) => item.id)).toEqual(['native-topology', 'native-session-admission', 'condition-semantics', 'publication-event-phases', 'view-definition'])
  })

  it('serves one fresh connected topology projection for the current Surface', async () => {
    const routes = new Map<string, { handler: (request: unknown, response: MockResponse) => Promise<void> | void }>()
    const inspectTopology = vi.fn().mockResolvedValue({
      anchorSurfaceId: 'a',
      surfaces: [{ surfaceId: 'a', title: 'Review A', lifecycle: { phase: 'published', evidence: [], verified: false, verificationEvidence: [] } }],
      orchestrations: [{ orchestrationId: 'ws-orch', definitionRevision: 'sha256:revision', bindings: { A: 'a' } }],
    })
    const ctx = fakeContext(routes, { inspectTopology, listSurfaces: vi.fn().mockResolvedValue([{ surfaceId: 'a', title: 'Review A' }]) })
    apply(ctx, {})
    const api = routes.get('/worksurface-map/api')!
    const response = new MockResponse()
    await api.handler({ method: 'GET', url: '/worksurface-map/api/topology?surface=a', headers: { host: '127.0.0.1:3080' } }, response)
    expect(response.status).toBe(200)
    expect(response.json()).toMatchObject({ anchorSurfaceId: 'a', surfaces: [{ title: 'Review A' }] })
    expect(inspectTopology).toHaveBeenCalledWith('a', undefined)
  })

  it('admits the selected Surface into its unique DSH Session without accepting a message', async () => {
    const routes = new Map<string, { handler: (request: unknown, response: MockResponse) => Promise<void> | void }>()
    const ensureSession = vi.fn().mockResolvedValue({ surfaceId: 'a', sessionId: 'worksurface-a', created: true, resumed: false })
    const ctx = fakeContext(routes, { ensureSession })
    apply(ctx, {})
    const response = new MockResponse()
    await routes.get('/worksurface-map/api')!.handler({ method: 'POST', url: '/worksurface-map/api/session?surface=a', headers: { host: 'localhost', origin: 'http://localhost:3080' } }, response)
    expect(response.status).toBe(200)
    expect(response.json()).toEqual({ surfaceId: 'a', sessionId: 'worksurface-a', created: true, resumed: false })
    expect(ensureSession).toHaveBeenCalledWith({ surfaceId: 'a' })
  })

  it('rejects cross-origin Session admission before it reaches the Host service', async () => {
    const routes = new Map<string, { handler: (request: unknown, response: MockResponse) => Promise<void> | void }>()
    const ensureSession = vi.fn()
    const ctx = fakeContext(routes, { ensureSession })
    apply(ctx, {})
    const response = new MockResponse()
    await routes.get('/worksurface-map/api')!.handler({ method: 'POST', url: '/worksurface-map/api/session?surface=a', headers: { host: 'localhost', origin: 'https://attacker.example' } }, response)
    expect(response.status).toBe(403)
    expect(ensureSession).not.toHaveBeenCalled()
  })

  it('loads a validated immutable YAML View Definition and keeps its revision visible', async () => {
    const routes = new Map<string, { handler: (request: unknown, response: MockResponse) => Promise<void> | void }>()
    const inspectTopology = vi.fn().mockImplementation((_surface, view) => Promise.resolve({ anchorSurfaceId: 'a', surfaces: [], orchestrations: [], view }))
    const readRevisionFile = vi.fn().mockResolvedValue({
      revision: `sha256:${'a'.repeat(64)}`,
      content: 'version: 1\nsurfaces:\n  a:\n    title: Review A\n',
    })
    const ctx = fakeContext(routes, { inspectTopology, readRevisionFile })
    const viewRevision = `sha256:${'b'.repeat(64)}`
    apply(ctx, { viewRevision, viewFile: 'worksurface-view.yaml' })
    const response = new MockResponse()
    await routes.get('/worksurface-map/api')!.handler({ method: 'GET', url: '/worksurface-map/api/topology?surface=a', headers: { host: 'localhost' } }, response)
    expect(readRevisionFile).toHaveBeenCalledWith(viewRevision, 'worksurface-view.yaml')
    expect(inspectTopology.mock.calls[0]?.[1]).toMatchObject({ version: 1, surfaces: { a: { title: 'Review A' } } })
    expect(response.json()).toMatchObject({ viewRevision: `sha256:${'a'.repeat(64)}` })
  })

  it('uses a wakeup-only long poll and lets the browser rebuild the projection', async () => {
    const routes = new Map<string, { handler: (request: unknown, response: MockResponse) => Promise<void> | void }>()
    const waitForProjectionWake = vi.fn().mockResolvedValue(undefined)
    const ctx = fakeContext(routes, { waitForProjectionWake })
    apply(ctx, {})
    const response = new MockResponse()
    await routes.get('/worksurface-map/api')!.handler({ method: 'GET', url: '/worksurface-map/api/watch', headers: { host: 'localhost' } }, response)
    expect(waitForProjectionWake).toHaveBeenCalledOnce()
    expect(response.json()).toEqual({ changed: true })
  })
})

function fakeContext(routes: Map<string, { handler: (request: unknown, response: MockResponse) => Promise<void> | void }>, workSurfaces: Record<string, unknown>) {
  return {
    workSurfaces: {
      listOrchestrations: vi.fn().mockResolvedValue([]),
      inspectOrchestration: vi.fn().mockResolvedValue({}),
      ...workSurfaces,
    },
    webServer: { register: (route: { path: string; handler: (request: unknown, response: MockResponse) => Promise<void> | void }) => { routes.set(route.path, route); return () => undefined } },
    effect: (operation: () => unknown) => operation(),
    logger: { error: () => undefined },
  }
}

class MockResponse {
  status = 0
  body = ''
  writeHead(status: number): void { this.status = status }
  end(body = ''): void { this.body = body }
  json(): unknown { return JSON.parse(this.body) }
}
// Invariant assertion: [WS-22]
