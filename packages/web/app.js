const CARD_WIDTH = 308
const CARD_HEIGHT = 176
const COLUMN_GAP = 118
const ROW_GAP = 44

/** Rank a multi-parent dependency DAG; cycles are kept visible in a final column. */
export function layoutGraph(nodes, edges) {
  const ids = new Set(nodes.map(node => node.surface))
  const incoming = new Map(nodes.map(node => [node.surface, new Set()]))
  const outgoing = new Map(nodes.map(node => [node.surface, new Set()]))
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue
    incoming.get(edge.target).add(edge.source)
    outgoing.get(edge.source).add(edge.target)
  }
  const ranks = new Map()
  const queue = nodes.filter(node => incoming.get(node.surface).size === 0).map(node => node.surface).sort()
  for (const id of queue) ranks.set(id, 0)
  while (queue.length > 0) {
    const id = queue.shift()
    for (const target of outgoing.get(id)) {
      incoming.get(target).delete(id)
      ranks.set(target, Math.max(ranks.get(target) ?? 0, (ranks.get(id) ?? 0) + 1))
      if (incoming.get(target).size === 0) queue.push(target)
    }
  }
  const fallbackRank = Math.max(0, ...ranks.values()) + 1
  const columns = new Map()
  for (const node of nodes) {
    const rank = ranks.get(node.surface) ?? fallbackRank
    const column = columns.get(rank) ?? []
    column.push(node)
    columns.set(rank, column)
  }
  const positions = {}
  for (const [rank, column] of [...columns].sort((left, right) => left[0] - right[0])) {
    column.sort((left, right) => left.surface.localeCompare(right.surface))
    column.forEach((node, row) => {
      positions[node.surface] = { x: 70 + rank * (CARD_WIDTH + COLUMN_GAP), y: 70 + row * (CARD_HEIGHT + ROW_GAP) }
    })
  }
  return positions
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export function markdownBody(document) {
  return document.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
}

function markdown(document) {
  const lines = markdownBody(document).trim().split(/\r?\n/)
  const html = []
  let paragraph = []
  const flush = () => {
    if (paragraph.length === 0) return
    html.push(`<p>${inline(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      flush()
      html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`)
    } else if (line.trim() === '') flush()
    else if (/^[-*]\s+/.test(line)) { flush(); html.push(`<div class="list-item">• ${inline(line.replace(/^[-*]\s+/, ''))}</div>`) }
    else paragraph.push(line)
  }
  flush()
  return html.join('') || '<p class="muted">尚无正文</p>'
}

function inline(value) {
  return escapeHtml(value)
    .replace(/\[\[block:([^\]]+)\]\]/g, '<span class="block-ref">$1</span>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function shortRevision(revision) {
  return revision?.replace('sha256:', '').slice(0, 8) ?? '—'
}

/** Stable enough for polling: identical API payloads must not rebuild the graph DOM. */
export function graphPayloadKey(data) {
  const { createdAt: _createdAt, ...graph } = data.graph ?? {}
  return JSON.stringify({ graph, conversations: data.conversations ?? {} })
}

export function compactSummary(document, limit = 112) {
  const body = markdownBody(document)
    .replace(/^#{1,6}\s+.+$/gm, '')
    .replace(/\[\[block:([^\]]+)\]\]/g, '$1')
    .replace(/^\s*-\s+/gm, '')
    .replace(/[`*>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (body.length <= limit) return body || '尚无摘要'
  return `${body.slice(0, Math.max(1, limit - 1)).trimEnd()}…`
}

const state = {
  sessionId: null,
  graph: null,
  conversations: {},
  positions: {},
  selected: null,
  tab: 'surface',
  zoom: 1,
  poll: null,
  dark: false,
  payloadKey: null,
  topologyKey: null,
}

const root = typeof document === 'undefined' ? null : document.querySelector('#app')
if (root) {
  root.innerHTML = `<header class="topbar"><div class="brand"><div class="eyebrow">PROGRESSIVE FORMULATION</div><div class="title-row"><h1>WorkGraph</h1><div id="summary" class="graph-summary"></div></div></div><div class="top-actions"><span id="scope"></span><div class="zoom-control"><button id="zoom-out" title="缩小">−</button><span id="zoom">100%</span><button id="zoom-in" title="放大">＋</button></div><button id="close">返回对话</button></div></header><main><div id="empty" class="empty"><strong>等待当前 Session</strong><span>从 DSH 对话页切换进来后，这里会显示它拥有的整张 WorkGraph。</span></div><div id="viewport" hidden><div id="canvas"><svg id="edges"></svg><div id="cards"></div></div></div><aside id="detail" hidden></aside></main>`
  root.querySelector('#close').addEventListener('click', () => parent.postMessage({ source: 'pf-worksurface-web', type: 'close' }, location.origin))
  root.querySelector('#zoom-in').addEventListener('click', () => setZoom(state.zoom + 0.1))
  root.querySelector('#zoom-out').addEventListener('click', () => setZoom(state.zoom - 0.1))
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.data?.source !== 'pf-worksurface-web' || event.data.type !== 'current-session') return
    document.documentElement.classList.toggle('dark', event.data.dark === true)
    if (event.data.sessionId !== state.sessionId) {
      state.sessionId = event.data.sessionId
      state.selected = null
      state.payloadKey = null
      state.topologyKey = null
      void refresh()
    }
  })
  parent.postMessage({ source: 'pf-worksurface-web', type: 'request-current' }, location.origin)
  state.poll = window.setInterval(() => { if (state.sessionId) void refresh(true) }, 2000)
}

async function refresh(quiet = false) {
  if (!state.sessionId) return showEmpty('当前没有可用的 Session')
  try {
    const response = await fetch(`/worksurface-map/api/graph?session=${encodeURIComponent(state.sessionId)}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? '加载失败')
    const payloadKey = graphPayloadKey(data)
    if (payloadKey === state.payloadKey) return
    const topologyKey = JSON.stringify({ root: data.graph.rootSurface, nodes: data.graph.nodes.map(node => node.surface), edges: data.graph.edges.map(edge => edge.id) })
    state.graph = data.graph
    state.conversations = data.conversations
    if (topologyKey !== state.topologyKey) state.positions = loadPositions(data.graph.rootSurface, data.graph.nodes, data.graph.edges)
    state.payloadKey = payloadKey
    state.topologyKey = topologyKey
    render()
  } catch (error) {
    if (!quiet) showEmpty(error instanceof Error ? error.message : 'WorkSurface 图暂时不可用')
  }
}

function showEmpty(message) {
  const empty = root.querySelector('#empty')
  const viewport = root.querySelector('#viewport')
  setGraphVisibility(empty, viewport, false)
  empty.querySelector('strong').textContent = message
  root.querySelector('#detail').hidden = true
}

/** Keep CSS display rules from overriding the semantic hidden state. */
export function setGraphVisibility(empty, viewport, graphVisible) {
  empty.hidden = graphVisible
  empty.style.display = graphVisible ? 'none' : 'grid'
  viewport.hidden = !graphVisible
  if (graphVisible) viewport.style.removeProperty('display')
  else viewport.style.display = 'none'
}

function loadPositions(rootSurface, nodes, edges) {
  const automatic = layoutGraph(nodes, edges)
  try {
    const saved = JSON.parse(localStorage.getItem(`pf-worksurface.positions.${rootSurface}`) ?? '{}')
    for (const node of nodes) if (Number.isFinite(saved[node.surface]?.x) && Number.isFinite(saved[node.surface]?.y)) automatic[node.surface] = saved[node.surface]
  } catch {}
  return automatic
}

function savePositions() {
  if (state.graph) localStorage.setItem(`pf-worksurface.positions.${state.graph.rootSurface}`, JSON.stringify(state.positions))
}

function render() {
  const graph = state.graph
  const empty = root.querySelector('#empty')
  const viewport = root.querySelector('#viewport')
  setGraphVisibility(empty, viewport, true)
  root.querySelector('#scope').textContent = graph.rootSurface
  const counts = Object.fromEntries(['draft', 'bound', 'completed'].map(phase => [phase, graph.nodes.filter(node => node.phase === phase).length]))
  root.querySelector('#summary').innerHTML = `<span><b>${graph.nodes.length}</b> 工作面</span><span><b>${graph.edges.length}</b> 依赖</span><span class="running"><i></i><b>${counts.bound}</b> 进行中</span><span class="done"><i></i><b>${counts.completed}</b> 完成</span>${counts.draft ? `<span class="draft"><i></i><b>${counts.draft}</b> 待启动</span>` : ''}`
  renderCards()
  sizeCanvas()
  renderEdges()
  renderDetail()
  setZoom(state.zoom)
}

function renderCards() {
  const container = root.querySelector('#cards')
  const existing = new Map([...container.children].map(card => [card.dataset.surface, card]))
  const retained = new Set()
  for (const node of state.graph.nodes) {
    let card = existing.get(node.surface)
    if (!card) {
      card = createCard(node.surface)
      card.classList.add('entering')
      container.append(card)
      window.setTimeout(() => card.classList.remove('entering'), 240)
    }
    retained.add(node.surface)
    updateCard(card, node)
    container.append(card)
  }
  for (const [surface, card] of existing) if (!retained.has(surface)) card.remove()
}

function createCard(surface) {
  const card = document.createElement('article')
  card.dataset.surface = surface
  card.addEventListener('click', () => {
    if (state.selected !== surface) state.tab = 'surface'
    state.selected = surface
    render()
  })
  installDrag(card, surface)
  return card
}

function updateCard(card, node) {
  const position = state.positions[node.surface]
  const entering = card.classList.contains('entering')
  card.className = `surface-card phase-${node.phase}${state.selected === node.surface ? ' selected' : ''}${node.sessionId === state.sessionId ? ' current' : ''}`
  if (entering) card.classList.add('entering')
  card.style.left = `${position.x}px`
  card.style.top = `${position.y}px`
  const incoming = state.graph.edges.filter(edge => edge.target === node.surface).length
  const outgoing = state.graph.edges.filter(edge => edge.source === node.surface).length
  const conversations = node.sessionId ? state.conversations[node.sessionId]?.length ?? 0 : 0
  const renderKey = JSON.stringify({ node, incoming, outgoing, conversations, selected: state.selected === node.surface, current: node.sessionId === state.sessionId })
  if (card.dataset.renderKey === renderKey) return
  card.dataset.renderKey = renderKey
  card.innerHTML = `<div class="card-head"><div class="card-title"><span class="phase-dot"></span><strong>${escapeHtml(titleOf(node))}</strong></div><div class="card-state">${node.sessionId === state.sessionId ? '<span class="current-label">当前</span>' : ''}<span class="phase">${phaseLabel(node.phase)}</span></div></div><p class="card-summary">${escapeHtml(compactSummary(node.surfaceDocument))}</p><div class="card-stats"><span title="输入依赖">↓ <b>${incoming}</b></span><span title="输出依赖">↑ <b>${outgoing}</b></span><span title="Blocks">B <b>${node.blocks.length}</b></span><span title="关联对话">对话 <b>${conversations}</b></span></div><div class="card-foot"><span class="surface-id">${escapeHtml(node.surface)}</span><span>r${shortRevision(node.revision)}</span><span>${node.sessionId ? escapeHtml(node.sessionId.slice(8, 16)) : '未绑定'}</span><button aria-label="查看 ${escapeHtml(titleOf(node))}">查看</button></div>`
}

function titleOf(node) {
  const heading = /^#\s+(.+)$/m.exec(markdownBody(node.surfaceDocument))
  return heading?.[1]?.trim() || node.surface
}

function phaseLabel(phase) {
  return phase === 'completed' ? '已完成' : phase === 'bound' ? '进行中' : '待启动'
}

function installDrag(card, surface) {
  card.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return
    const start = { x: event.clientX, y: event.clientY, ...state.positions[surface] }
    card.setPointerCapture(event.pointerId)
    card.classList.add('dragging')
    const move = moveEvent => {
      state.positions[surface] = { x: Math.max(20, start.x + (moveEvent.clientX - start.x) / state.zoom), y: Math.max(20, start.y + (moveEvent.clientY - start.y) / state.zoom) }
      card.style.left = `${state.positions[surface].x}px`
      card.style.top = `${state.positions[surface].y}px`
      sizeCanvas()
      renderEdges()
    }
    const up = () => { card.classList.remove('dragging'); card.removeEventListener('pointermove', move); savePositions() }
    card.addEventListener('pointermove', move)
    card.addEventListener('pointerup', up, { once: true })
  })
}

function sizeCanvas() {
  const points = Object.values(state.positions)
  const width = Math.max(1200, ...points.map(point => point.x + CARD_WIDTH + 120))
  const height = Math.max(760, ...points.map(point => point.y + CARD_HEIGHT + 120))
  const canvas = root.querySelector('#canvas')
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const svg = root.querySelector('#edges')
  svg.setAttribute('width', width)
  svg.setAttribute('height', height)
}

function renderEdges() {
  const svg = root.querySelector('#edges')
  svg.innerHTML = '<defs><marker id="dependency-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>' + state.graph.edges.map(edge => {
    const source = state.positions[edge.source]
    const target = state.positions[edge.target]
    if (!source || !target) return ''
    const x1 = source.x + CARD_WIDTH
    const y1 = source.y + CARD_HEIGHT / 2
    const x2 = target.x
    const y2 = target.y + CARD_HEIGHT / 2
    const bend = Math.max(70, Math.abs(x2 - x1) * 0.45)
    return `<path class="dependency${edge.omitted ? ' omitted' : ''}" marker-end="url(#dependency-arrow)" d="M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}"><title>${escapeHtml(edge.sourceBlock)} · r${shortRevision(edge.sourceRevision)}</title></path>`
  }).join('')
}

function renderDetail() {
  const detail = root.querySelector('#detail')
  const node = state.graph.nodes.find(item => item.surface === state.selected)
  if (!node) { detail.hidden = true; detail.dataset.renderKey = ''; return }
  const messages = node.sessionId ? state.conversations[node.sessionId] ?? [] : []
  const renderKey = JSON.stringify({ node, messages, tab: state.tab })
  if (!detail.hidden && detail.dataset.renderKey === renderKey) return
  detail.dataset.renderKey = renderKey
  detail.hidden = false
  detail.innerHTML = `<div class="detail-head"><div><span class="eyebrow">${escapeHtml(node.surface)}</span><h2>${escapeHtml(titleOf(node))}</h2></div><button data-close>×</button></div><div class="detail-tabs"><button data-tab="surface" class="${state.tab === 'surface' ? 'active' : ''}">工作面</button><button data-tab="conversation" class="${state.tab === 'conversation' ? 'active' : ''}">对话 ${messages.length}</button></div><div class="detail-content">${state.tab === 'surface' ? surfaceDetail(node) : conversationDetail(node, messages)}</div>${node.sessionId ? '<button class="open-session">在对话中打开</button>' : ''}`
  detail.querySelector('[data-close]').addEventListener('click', () => { state.selected = null; render() })
  detail.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { state.tab = button.dataset.tab; renderDetail() }))
  detail.querySelector('.open-session')?.addEventListener('click', () => parent.postMessage({ source: 'pf-worksurface-web', type: 'open-session', sessionId: node.sessionId }, location.origin))
}

function surfaceDetail(node) {
  return `<div class="detail-meta"><span>${phaseLabel(node.phase)}</span><span>${escapeHtml(node.status)}</span><span>r${shortRevision(node.revision)}</span></div><div class="markdown full">${markdown(node.surfaceDocument)}</div><h3>Blocks</h3>${node.blocks.length === 0 ? '<p class="muted">没有 Block</p>' : node.blocks.map(block => `<details><summary><strong>${escapeHtml(block.block)}</strong><span>${escapeHtml(block.kind)} · ${escapeHtml(block.status)}</span></summary><div class="markdown">${markdown(block.content)}</div></details>`).join('')}`
}

function conversationDetail(node, messages) {
  if (!node.sessionId) return '<p class="muted">这个 draft Surface 尚未绑定 Agent Session。</p>'
  if (messages.length === 0) return '<p class="muted">Session 已绑定，暂无可投影的对话记录。</p>'
  return `<div class="conversation">${messages.map(message => `<article class="message ${message.role}"><span>${message.role === 'user' ? '你' : message.role === 'assistant' ? 'Agent' : '错误'}</span><div>${escapeHtml(message.text).replaceAll('\n', '<br>')}</div></article>`).join('')}</div>`
}

function setZoom(value) {
  state.zoom = Math.min(1.5, Math.max(0.6, Math.round(value * 10) / 10))
  const canvas = root?.querySelector('#canvas')
  if (canvas) canvas.style.zoom = state.zoom
  const label = root?.querySelector('#zoom')
  if (label) label.textContent = `${Math.round(state.zoom * 100)}%`
}
