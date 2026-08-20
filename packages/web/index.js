import { readFile } from 'node:fs/promises'

export const name = 'pf-worksurface-web'
export const inject = ['webServer', 'sessions', 'workSurfaces']

function contentText(content) {
  if (!Array.isArray(content)) return ''
  return content.flatMap(block => {
    if (block?.type === 'text') return [block.text]
    if (block?.type === 'tool-call') return [`调用 ${block.name ?? '工具'}\n${block.arguments ?? ''}`]
    if (block?.type === 'tool-result') return [contentText(block.content)]
    return []
  }).filter(value => typeof value === 'string' && value.trim() !== '').join('\n')
}

function isRuntimeContext(text) {
  return text.trimStart().startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')
}

/** Project committed DSH events into the compact conversation attached to a Surface card. */
export function projectSessionConversation(session) {
  if (session === undefined) return []
  const replayFrom = session.header?.parentSession === undefined ? 0 : (session.firstLiveSeq ?? 0)
  const messages = []
  for (const event of session.events ?? []) {
    if ((event.seq ?? 0) < replayFrom) continue
    let role
    let text
    if (event.type === 'user/message') {
      role = 'user'
      text = contentText(event.data?.content)
      if (isRuntimeContext(text)) continue
    } else if (event.type === 'assistant/message') {
      role = 'assistant'
      text = contentText(event.data?.message?.content)
    } else if (event.type === 'turn/end' && event.data?.reason?.kind === 'error') {
      role = 'error'
      text = event.data.reason.error?.message ?? 'Agent 执行失败'
    } else {
      continue
    }
    text = text.trim()
    if (text !== '') messages.push({ seq: event.seq ?? null, role, text, at: event.at ?? event.time ?? null })
  }
  return messages
}

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

function sendJson(res, status, body) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(body))
}

function page() {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WorkSurface 图</title><link rel="stylesheet" href="/worksurface-map/styles.css"></head><body><div id="app"></div><script type="module" src="/worksurface-map/app.js"></script></body></html>'
}

/** Mount the read-only WorkGraph and conversation APIs on the existing DSH Web Server. */
export function apply(ctx, config) {
  const trustedHosts = new Set(['localhost', '127.0.0.1', ...[...(config?.trustedHosts ?? [])].map(value => String(value).trim().toLowerCase()).filter(Boolean)])
  const api = async (req, res) => {
    try {
      const hostname = (typeof req.headers.host === 'string' ? req.headers.host : '').replace(/:\d+$/, '').toLowerCase()
      if (!trustedHosts.has(hostname)) return sendJson(res, 403, { error: '不被信任的 Host' })
      const url = new URL(req.url ?? '/', 'http://dsh.local')
      if (url.pathname !== '/worksurface-map/api/graph' || req.method !== 'GET') return sendJson(res, 404, { error: '接口不存在' })
      const sessionId = url.searchParams.get('session')?.trim()
      if (!sessionId) return sendJson(res, 400, { error: '缺少 session' })
      const graph = await ctx.workSurfaces.graphForSession(sessionId)
      const sessions = new Map([...ctx.sessions.list()].map(session => [String(session.id), session]))
      const conversations = Object.fromEntries(graph.nodes
        .filter(node => node.sessionId !== null)
        .map(node => [node.sessionId, projectSessionConversation(sessions.get(node.sessionId))]))
      return sendJson(res, 200, { graph, conversations })
    } catch (error) {
      if (error?.code === 'not-found') return sendJson(res, 404, { error: error.message })
      ctx.logger.error(error instanceof Error ? error : new Error(String(error)))
      return sendJson(res, 500, { error: 'WorkSurface 图暂时不可用' })
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/worksurface-map', handler: (_req, res) => { res.writeHead(302, { location: '/worksurface-map/' }); res.end() } }), 'worksurface-map: redirect')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/worksurface-map/', handler: (_req, res) => send(res, 200, 'text/html; charset=utf-8', page()) }), 'worksurface-map: page')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/worksurface-map/app.js', handler: async (_req, res) => send(res, 200, 'text/javascript; charset=utf-8', await readFile(new URL('./app.js', import.meta.url), 'utf8')) }), 'worksurface-map: app')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/worksurface-map/styles.css', handler: async (_req, res) => send(res, 200, 'text/css; charset=utf-8', await readFile(new URL('./styles.css', import.meta.url), 'utf8')) }), 'worksurface-map: styles')
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/worksurface-map/api', handler: api }), 'worksurface-map: api')
}
