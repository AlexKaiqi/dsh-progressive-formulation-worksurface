import { readFile } from 'node:fs/promises'
import { defineWorkSurfaceView } from '@pf-worksurface/core'
import { parse } from 'yaml'

const reactFlowStyles = new URL(import.meta.resolve('@xyflow/react/dist/style.css'))

export const name = 'pf-worksurface-web'
export const inject = ['webServer', 'workSurfaces']

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

function json(res, status, body) { send(res, status, 'application/json; charset=utf-8', JSON.stringify(body)) }
/** Read-only orchestration discovery and inspection; the browser owns no domain state. */
export function apply(ctx, config) {
  const hosts = new Set(['localhost', '127.0.0.1', ...[...(config?.trustedHosts ?? [])].map(String)])
  let lastValidView
  const loadView = async () => {
    const viewRevision = String(config?.viewRevision ?? '').trim()
    if (!viewRevision) return {}
    try {
      const file = String(config?.viewFile ?? 'worksurface-view.yaml')
      const revision = await ctx.workSurfaces.readRevisionFile(viewRevision, file)
      if (lastValidView?.revision === revision.revision) return lastValidView
      lastValidView = { revision: revision.revision, definition: defineWorkSurfaceView(parse(revision.content)) }
      return lastValidView
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ...(lastValidView ?? {}), warning: message }
    }
  }
  const api = async (req, res) => {
    try {
      const hostname = String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase()
      if (!hosts.has(hostname)) return json(res, 403, { error: 'untrusted Host' })
      const url = new URL(req.url ?? '/', 'http://dsh.local')
      if (req.method === 'POST' && url.pathname === '/worksurface-map/api/session') {
        const origin = String(req.headers.origin ?? '')
        if (origin && new URL(origin).hostname.toLowerCase() !== hostname) return json(res, 403, { error: 'cross-origin admission denied' })
        const surfaceId = url.searchParams.get('surface')?.trim()
        if (!surfaceId) return json(res, 400, { error: 'missing Surface id' })
        return json(res, 200, await ctx.workSurfaces.ensureSession({ surfaceId }))
      }
      if (req.method !== 'GET') return json(res, 404, { error: 'not found' })
      if (url.pathname === '/worksurface-map/api/topology') {
        const surface = url.searchParams.get('surface')?.trim()
        if (!surface) return json(res, 400, { error: 'missing Surface id' })
        const view = await loadView()
        const topology = await ctx.workSurfaces.inspectTopology(surface, view.definition)
        return json(res, 200, {
          ...topology,
          ...(view.revision === undefined ? {} : { viewRevision: view.revision }),
          ...(view.warning === undefined ? {} : { viewWarning: view.warning }),
        })
      }
      if (url.pathname === '/worksurface-map/api/watch') {
        const abort = new AbortController()
        let timedOut = false
        const timer = setTimeout(() => { timedOut = true; abort.abort() }, 25_000)
        const disconnected = () => abort.abort()
        res.once?.('close', disconnected)
        try {
          await ctx.workSurfaces.waitForProjectionWake(abort.signal)
          return json(res, 200, { changed: true })
        } catch (error) {
          if (timedOut) return json(res, 200, { changed: false })
          if (abort.signal.aborted) return undefined
          throw error
        } finally {
          clearTimeout(timer)
          res.off?.('close', disconnected)
        }
      }
      if (url.pathname === '/worksurface-map/api/surfaces') return json(res, 200, { surfaces: await ctx.workSurfaces.listSurfaces() })
      if (url.pathname === '/worksurface-map/api/orchestrations') {
        const surface = url.searchParams.get('surface')?.trim() || undefined
        return json(res, 200, { orchestrations: await ctx.workSurfaces.listOrchestrations(surface) })
      }
      if (url.pathname === '/worksurface-map/api/orchestration') {
        const id = url.searchParams.get('id')?.trim()
        if (!id) return json(res, 400, { error: 'missing orchestration id' })
        return json(res, 200, await ctx.workSurfaces.inspectOrchestration(id))
      }
      return json(res, 404, { error: 'not found' })
    } catch (error) {
      if (error?.code === 'not-found') return json(res, 404, { error: error.message })
      ctx.logger.error(error instanceof Error ? error : new Error(String(error)))
      if (error instanceof Error) return json(res, 500, { error: error.message, ...(typeof error.code === 'string' ? { code: error.code } : {}) })
      return json(res, 500, { error: 'projection unavailable' })
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/worksurface-map/react-flow.css', handler: async (_req, res) => send(res, 200, 'text/css; charset=utf-8', await readFile(reactFlowStyles, 'utf8')) }), 'worksurface-map.react-flow-styles')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/worksurface-map/styles.css', handler: async (_req, res) => send(res, 200, 'text/css; charset=utf-8', await readFile(new URL('./styles.css', import.meta.url), 'utf8')) }), 'worksurface-map.styles')
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/worksurface-map/api', handler: api }), 'worksurface-map.api')
}
