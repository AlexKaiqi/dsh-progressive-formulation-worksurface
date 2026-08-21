const CARD_WIDTH = 308
const CARD_HEIGHT = 176
const COLUMN_GAP = 118
const ROW_GAP = 44

const EN = {
  zoomOut: 'Zoom out', zoomIn: 'Zoom in', back: 'Back to conversation', waiting: 'Waiting for the current Session', waitingHint: 'Open this view from a DSH conversation to see its entire WorkGraph.', noSession: 'No current Session is available', loadFailed: 'Failed to load', graphUnavailable: 'The WorkSurface graph is temporarily unavailable', noBody: 'No content yet', noSummary: 'No summary yet', surfaces: 'surfaces', dependencies: 'dependencies', running: 'in progress', completed: 'completed', pending: 'not started', current: 'current', inputDependencies: 'Input dependencies', outputDependencies: 'Output dependencies', blocks: 'Blocks', conversations: 'Conversations', unbound: 'unbound', view: 'View', phaseCompleted: 'Completed', phaseRunning: 'In progress', phasePending: 'Not started', surfaceTab: 'Surface', conversationTab: 'Conversation', openConversation: 'Open in conversation', noBlocks: 'No Blocks', draftUnbound: 'This draft Surface is not bound to an Agent Session yet.', noMessages: 'The Session is bound, but there are no conversations to project yet.', you: 'You', agent: 'Agent', error: 'Error',
}
const withEnglish = overrides => ({ ...EN, ...overrides })
const DICTIONARIES = {
  en: EN,
  zh: withEnglish({ zoomOut: '缩小', zoomIn: '放大', back: '返回对话', waiting: '等待当前 Session', waitingHint: '从 DSH 对话页切换进来后，这里会显示它拥有的整张 WorkGraph。', noSession: '当前没有可用的 Session', loadFailed: '加载失败', graphUnavailable: 'WorkSurface 图暂时不可用', noBody: '尚无正文', noSummary: '尚无摘要', surfaces: '工作面', dependencies: '依赖', running: '进行中', completed: '完成', pending: '待启动', current: '当前', inputDependencies: '输入依赖', outputDependencies: '输出依赖', blocks: 'Blocks', conversations: '对话', unbound: '未绑定', view: '查看', phaseCompleted: '已完成', phaseRunning: '进行中', phasePending: '待启动', surfaceTab: '工作面', conversationTab: '对话', openConversation: '在对话中打开', noBlocks: '没有 Block', draftUnbound: '这个 draft Surface 尚未绑定 Agent Session。', noMessages: 'Session 已绑定，暂无可投影的对话记录。', you: '你', agent: 'Agent', error: '错误' }),
  'zh-TW': withEnglish({ zoomOut: '縮小', zoomIn: '放大', back: '返回對話', waiting: '等待目前 Session', waitingHint: '從 DSH 對話頁切換後，這裡會顯示完整 WorkGraph。', noSession: '目前沒有可用的 Session', loadFailed: '載入失敗', graphUnavailable: 'WorkSurface 圖暫時無法使用', noBody: '尚無正文', noSummary: '尚無摘要', surfaces: '工作面', dependencies: '依賴', running: '進行中', completed: '完成', pending: '待啟動', current: '目前', inputDependencies: '輸入依賴', outputDependencies: '輸出依賴', blocks: 'Blocks', conversations: '對話', unbound: '未綁定', view: '檢視', phaseCompleted: '已完成', phaseRunning: '進行中', phasePending: '待啟動', surfaceTab: '工作面', conversationTab: '對話', openConversation: '在對話中開啟', noBlocks: '沒有 Block', draftUnbound: '此 draft Surface 尚未綁定 Agent Session。', noMessages: 'Session 已綁定，尚無可投影的對話記錄。', you: '你', agent: 'Agent', error: '錯誤' }),
  ja: withEnglish({ zoomOut: '縮小', zoomIn: '拡大', back: '会話に戻る', waiting: '現在のセッションを待っています', waitingHint: 'DSH の会話からこの画面を開くと、WorkGraph 全体が表示されます。', noSession: '利用可能なセッションがありません', loadFailed: '読み込みに失敗しました', graphUnavailable: 'WorkSurface グラフは一時的に利用できません', noBody: '本文はまだありません', noSummary: '要約はまだありません', surfaces: 'サーフェス', dependencies: '依存関係', running: '進行中', completed: '完了', pending: '未開始', current: '現在', inputDependencies: '入力依存関係', outputDependencies: '出力依存関係', blocks: 'ブロック', conversations: '会話', unbound: '未接続', view: '表示', phaseCompleted: '完了', phaseRunning: '進行中', phasePending: '未開始', surfaceTab: 'サーフェス', conversationTab: '会話', openConversation: '会話で開く', noBlocks: 'ブロックなし', draftUnbound: 'このドラフト Surface はまだ Agent Session に接続されていません。', noMessages: 'Session は接続済みですが、表示できる会話はまだありません。', you: 'あなた', agent: 'Agent', error: 'エラー' }),
  ko: withEnglish({ zoomOut: '축소', zoomIn: '확대', back: '대화로 돌아가기', waiting: '현재 세션을 기다리는 중', waitingHint: 'DSH 대화에서 이 보기를 열면 전체 WorkGraph가 표시됩니다.', noSession: '사용 가능한 현재 세션이 없습니다', loadFailed: '불러오지 못했습니다', graphUnavailable: 'WorkSurface 그래프를 일시적으로 사용할 수 없습니다', noBody: '본문이 아직 없습니다', noSummary: '요약이 아직 없습니다', surfaces: '서피스', dependencies: '종속성', running: '진행 중', completed: '완료', pending: '시작 전', current: '현재', inputDependencies: '입력 종속성', outputDependencies: '출력 종속성', blocks: '블록', conversations: '대화', unbound: '연결 안 됨', view: '보기', phaseCompleted: '완료', phaseRunning: '진행 중', phasePending: '시작 전', surfaceTab: '서피스', conversationTab: '대화', openConversation: '대화에서 열기', noBlocks: '블록 없음', draftUnbound: '이 draft Surface는 아직 Agent Session에 연결되지 않았습니다.', noMessages: 'Session은 연결되었지만 표시할 대화가 없습니다.', you: '나', agent: 'Agent', error: '오류' }),
  es: withEnglish({ zoomOut: 'Alejar', zoomIn: 'Acercar', back: 'Volver a la conversación', waiting: 'Esperando la sesión actual', waitingHint: 'Abre esta vista desde una conversación de DSH para ver todo su WorkGraph.', noSession: 'No hay una sesión actual disponible', loadFailed: 'Error al cargar', graphUnavailable: 'El grafo de WorkSurface no está disponible temporalmente', noBody: 'Aún no hay contenido', noSummary: 'Aún no hay resumen', surfaces: 'superficies', dependencies: 'dependencias', running: 'en curso', completed: 'completadas', pending: 'sin iniciar', current: 'actual', inputDependencies: 'Dependencias de entrada', outputDependencies: 'Dependencias de salida', blocks: 'Bloques', conversations: 'Conversaciones', unbound: 'sin vincular', view: 'Ver', phaseCompleted: 'Completada', phaseRunning: 'En curso', phasePending: 'Sin iniciar', surfaceTab: 'Superficie', conversationTab: 'Conversación', openConversation: 'Abrir en la conversación', noBlocks: 'Sin bloques', draftUnbound: 'Esta Surface de borrador aún no está vinculada a una sesión del Agent.', noMessages: 'La sesión está vinculada, pero aún no hay conversaciones que mostrar.', you: 'Tú', agent: 'Agent', error: 'Error' }),
  fr: withEnglish({ zoomOut: 'Réduire', zoomIn: 'Agrandir', back: 'Retour à la conversation', waiting: 'En attente de la session actuelle', waitingHint: 'Ouvrez cette vue depuis une conversation DSH pour afficher tout son WorkGraph.', noSession: 'Aucune session actuelle disponible', loadFailed: 'Échec du chargement', graphUnavailable: 'Le graphe WorkSurface est temporairement indisponible', noBody: 'Aucun contenu', noSummary: 'Aucun résumé', surfaces: 'surfaces', dependencies: 'dépendances', running: 'en cours', completed: 'terminées', pending: 'non démarrées', current: 'actuelle', inputDependencies: "Dépendances d’entrée", outputDependencies: 'Dépendances de sortie', blocks: 'Blocs', conversations: 'Conversations', unbound: 'non liée', view: 'Afficher', phaseCompleted: 'Terminée', phaseRunning: 'En cours', phasePending: 'Non démarrée', surfaceTab: 'Surface', conversationTab: 'Conversation', openConversation: 'Ouvrir dans la conversation', noBlocks: 'Aucun bloc', draftUnbound: "Cette Surface de brouillon n’est pas encore liée à une session Agent.", noMessages: "La session est liée, mais aucune conversation n’est encore disponible.", you: 'Vous', agent: 'Agent', error: 'Erreur' }),
  de: withEnglish({ zoomOut: 'Verkleinern', zoomIn: 'Vergrößern', back: 'Zur Unterhaltung zurück', waiting: 'Warten auf die aktuelle Sitzung', waitingHint: 'Öffnen Sie diese Ansicht aus einer DSH-Unterhaltung, um den gesamten WorkGraph zu sehen.', noSession: 'Keine aktuelle Sitzung verfügbar', loadFailed: 'Laden fehlgeschlagen', graphUnavailable: 'Der WorkSurface-Graph ist vorübergehend nicht verfügbar', noBody: 'Noch kein Inhalt', noSummary: 'Noch keine Zusammenfassung', surfaces: 'Arbeitsflächen', dependencies: 'Abhängigkeiten', running: 'in Bearbeitung', completed: 'abgeschlossen', pending: 'nicht gestartet', current: 'aktuell', inputDependencies: 'Eingabeabhängigkeiten', outputDependencies: 'Ausgabeabhängigkeiten', blocks: 'Blöcke', conversations: 'Unterhaltungen', unbound: 'nicht verbunden', view: 'Anzeigen', phaseCompleted: 'Abgeschlossen', phaseRunning: 'In Bearbeitung', phasePending: 'Nicht gestartet', surfaceTab: 'Arbeitsfläche', conversationTab: 'Unterhaltung', openConversation: 'In Unterhaltung öffnen', noBlocks: 'Keine Blöcke', draftUnbound: 'Diese Entwurfs-Surface ist noch nicht mit einer Agent-Sitzung verbunden.', noMessages: 'Die Sitzung ist verbunden, aber es gibt noch keine darstellbare Unterhaltung.', you: 'Sie', agent: 'Agent', error: 'Fehler' }),
  'pt-BR': withEnglish({ zoomOut: 'Reduzir', zoomIn: 'Ampliar', back: 'Voltar à conversa', waiting: 'Aguardando a sessão atual', waitingHint: 'Abra esta visualização a partir de uma conversa do DSH para ver todo o WorkGraph.', noSession: 'Nenhuma sessão atual disponível', loadFailed: 'Falha ao carregar', graphUnavailable: 'O grafo do WorkSurface está temporariamente indisponível', noBody: 'Ainda não há conteúdo', noSummary: 'Ainda não há resumo', surfaces: 'superfícies', dependencies: 'dependências', running: 'em andamento', completed: 'concluídas', pending: 'não iniciadas', current: 'atual', inputDependencies: 'Dependências de entrada', outputDependencies: 'Dependências de saída', blocks: 'Blocos', conversations: 'Conversas', unbound: 'não vinculada', view: 'Ver', phaseCompleted: 'Concluída', phaseRunning: 'Em andamento', phasePending: 'Não iniciada', surfaceTab: 'Superfície', conversationTab: 'Conversa', openConversation: 'Abrir na conversa', noBlocks: 'Sem blocos', draftUnbound: 'Esta Surface de rascunho ainda não está vinculada a uma sessão do Agent.', noMessages: 'A sessão está vinculada, mas ainda não há conversas para exibir.', you: 'Você', agent: 'Agent', error: 'Erro' }),
  ru: withEnglish({ zoomOut: 'Уменьшить', zoomIn: 'Увеличить', back: 'Вернуться к диалогу', waiting: 'Ожидание текущего сеанса', waitingHint: 'Откройте этот вид из диалога DSH, чтобы увидеть весь WorkGraph.', noSession: 'Текущий сеанс недоступен', loadFailed: 'Не удалось загрузить', graphUnavailable: 'Граф WorkSurface временно недоступен', noBody: 'Содержимого пока нет', noSummary: 'Резюме пока нет', surfaces: 'поверхности', dependencies: 'зависимости', running: 'в работе', completed: 'завершено', pending: 'не запущено', current: 'текущая', inputDependencies: 'Входные зависимости', outputDependencies: 'Выходные зависимости', blocks: 'Блоки', conversations: 'Диалоги', unbound: 'не привязано', view: 'Открыть', phaseCompleted: 'Завершено', phaseRunning: 'В работе', phasePending: 'Не запущено', surfaceTab: 'Поверхность', conversationTab: 'Диалог', openConversation: 'Открыть в диалоге', noBlocks: 'Нет блоков', draftUnbound: 'Этот черновик Surface ещё не привязан к сеансу Agent.', noMessages: 'Сеанс привязан, но диалогов для отображения пока нет.', you: 'Вы', agent: 'Agent', error: 'Ошибка' }),
  ar: withEnglish({ zoomOut: 'تصغير', zoomIn: 'تكبير', back: 'العودة إلى المحادثة', waiting: 'في انتظار الجلسة الحالية', waitingHint: 'افتح هذا العرض من محادثة DSH لرؤية WorkGraph بالكامل.', noSession: 'لا توجد جلسة حالية متاحة', loadFailed: 'فشل التحميل', graphUnavailable: 'مخطط WorkSurface غير متاح مؤقتًا', noBody: 'لا يوجد محتوى بعد', noSummary: 'لا يوجد ملخص بعد', surfaces: 'أسطح', dependencies: 'تبعيات', running: 'قيد التنفيذ', completed: 'مكتملة', pending: 'لم تبدأ', current: 'الحالية', inputDependencies: 'تبعيات الإدخال', outputDependencies: 'تبعيات الإخراج', blocks: 'الكتل', conversations: 'المحادثات', unbound: 'غير مرتبطة', view: 'عرض', phaseCompleted: 'مكتملة', phaseRunning: 'قيد التنفيذ', phasePending: 'لم تبدأ', surfaceTab: 'سطح العمل', conversationTab: 'المحادثة', openConversation: 'فتح في المحادثة', noBlocks: 'لا توجد كتل', draftUnbound: 'لم يتم ربط مسودة Surface هذه بجلسة Agent بعد.', noMessages: 'تم ربط الجلسة، لكن لا توجد محادثات لعرضها بعد.', you: 'أنت', agent: 'Agent', error: 'خطأ' }),
  hi: withEnglish({ zoomOut: 'छोटा करें', zoomIn: 'बड़ा करें', back: 'बातचीत पर वापस जाएँ', waiting: 'वर्तमान सत्र की प्रतीक्षा है', waitingHint: 'पूरा WorkGraph देखने के लिए इसे DSH बातचीत से खोलें।', noSession: 'कोई वर्तमान सत्र उपलब्ध नहीं', loadFailed: 'लोड नहीं हो सका', graphUnavailable: 'WorkSurface ग्राफ़ अभी उपलब्ध नहीं है', noBody: 'अभी कोई सामग्री नहीं', noSummary: 'अभी कोई सारांश नहीं', surfaces: 'सतहें', dependencies: 'निर्भरताएँ', running: 'प्रगति में', completed: 'पूर्ण', pending: 'शुरू नहीं', current: 'वर्तमान', inputDependencies: 'इनपुट निर्भरताएँ', outputDependencies: 'आउटपुट निर्भरताएँ', blocks: 'ब्लॉक', conversations: 'बातचीत', unbound: 'लिंक नहीं', view: 'देखें', phaseCompleted: 'पूर्ण', phaseRunning: 'प्रगति में', phasePending: 'शुरू नहीं', surfaceTab: 'सतह', conversationTab: 'बातचीत', openConversation: 'बातचीत में खोलें', noBlocks: 'कोई ब्लॉक नहीं', draftUnbound: 'यह draft Surface अभी Agent Session से लिंक नहीं है।', noMessages: 'Session लिंक है, लेकिन दिखाने के लिए अभी बातचीत नहीं है।', you: 'आप', agent: 'Agent', error: 'त्रुटि' }),
}
let locale = 'en'
function t(key) { return (DICTIONARIES[locale] ?? EN)[key] ?? EN[key] ?? key }
function setLocale(next) {
  locale = Object.hasOwn(DICTIONARIES, next) ? next : 'en'
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
}

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

/** Move one card by the pointer delta in graph coordinates without changing its grab offset. */
export function draggedPosition(cardStart, pointerStart, pointerCurrent, zoom) {
  return {
    x: Math.max(20, cardStart.x + (pointerCurrent.x - pointerStart.x) / zoom),
    y: Math.max(20, cardStart.y + (pointerCurrent.y - pointerStart.y) / zoom),
  }
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
  return html.join('') || `<p class="muted">${t('noBody')}</p>`
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
  if (body.length <= limit) return body || t('noSummary')
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
  root.innerHTML = `<header class="topbar"><div class="brand"><div class="eyebrow">PROGRESSIVE FORMULATION</div><div class="title-row"><h1>WorkGraph</h1><div id="summary" class="graph-summary"></div></div></div><div class="top-actions"><span id="scope"></span><div class="zoom-control"><button id="zoom-out">−</button><span id="zoom">100%</span><button id="zoom-in">＋</button></div><button id="close"></button></div></header><main><div id="empty" class="empty"><strong></strong><span></span></div><div id="viewport" hidden><div id="canvas"><svg id="edges"></svg><div id="cards"></div></div></div><aside id="detail" hidden></aside></main>`
  renderLocaleChrome()
  root.querySelector('#close').addEventListener('click', () => parent.postMessage({ source: 'pf-worksurface-web', type: 'close' }, location.origin))
  root.querySelector('#zoom-in').addEventListener('click', () => setZoom(state.zoom + 0.1))
  root.querySelector('#zoom-out').addEventListener('click', () => setZoom(state.zoom - 0.1))
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.data?.source !== 'pf-worksurface-web' || event.data.type !== 'current-session') return
    document.documentElement.classList.toggle('dark', event.data.dark === true)
    if (typeof event.data.locale === 'string' && event.data.locale !== locale) {
      setLocale(event.data.locale)
      renderLocaleChrome()
      if (state.graph) render()
    }
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

function renderLocaleChrome() {
  if (!root) return
  root.querySelector('#zoom-out').title = t('zoomOut')
  root.querySelector('#zoom-in').title = t('zoomIn')
  root.querySelector('#close').textContent = t('back')
  if (!state.sessionId && !state.graph) {
    root.querySelector('#empty strong').textContent = t('waiting')
    root.querySelector('#empty span').textContent = t('waitingHint')
  }
}

async function refresh(quiet = false) {
  if (!state.sessionId) return showEmpty(t('noSession'))
  try {
    const response = await fetch(`/worksurface-map/api/graph?session=${encodeURIComponent(state.sessionId)}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? t('loadFailed'))
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
    if (!quiet) showEmpty(error instanceof Error ? error.message : t('graphUnavailable'))
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
  root.querySelector('#summary').innerHTML = `<span><b>${graph.nodes.length}</b> ${t('surfaces')}</span><span><b>${graph.edges.length}</b> ${t('dependencies')}</span><span class="running"><i></i><b>${counts.bound}</b> ${t('running')}</span><span class="done"><i></i><b>${counts.completed}</b> ${t('completed')}</span>${counts.draft ? `<span class="draft"><i></i><b>${counts.draft}</b> ${t('pending')}</span>` : ''}`
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
  const renderKey = JSON.stringify({ locale, node, incoming, outgoing, conversations, selected: state.selected === node.surface, current: node.sessionId === state.sessionId })
  if (card.dataset.renderKey === renderKey) return
  card.dataset.renderKey = renderKey
  card.innerHTML = `<div class="card-head"><div class="card-title"><span class="phase-dot"></span><strong>${escapeHtml(titleOf(node))}</strong></div><div class="card-state">${node.sessionId === state.sessionId ? `<span class="current-label">${t('current')}</span>` : ''}<span class="phase">${phaseLabel(node.phase)}</span></div></div><p class="card-summary">${escapeHtml(compactSummary(node.surfaceDocument))}</p><div class="card-stats"><span title="${t('inputDependencies')}">↓ <b>${incoming}</b></span><span title="${t('outputDependencies')}">↑ <b>${outgoing}</b></span><span title="${t('blocks')}">B <b>${node.blocks.length}</b></span><span title="${t('conversations')}">${t('conversations')} <b>${conversations}</b></span></div><div class="card-foot"><span class="surface-id">${escapeHtml(node.surface)}</span><span>r${shortRevision(node.revision)}</span><span>${node.sessionId ? escapeHtml(node.sessionId.slice(8, 16)) : t('unbound')}</span><button aria-label="${t('view')} ${escapeHtml(titleOf(node))}">${t('view')}</button></div>`
}

function titleOf(node) {
  const heading = /^#\s+(.+)$/m.exec(markdownBody(node.surfaceDocument))
  return heading?.[1]?.trim() || node.surface
}

function phaseLabel(phase) {
  return phase === 'completed' ? t('phaseCompleted') : phase === 'bound' ? t('phaseRunning') : t('phasePending')
}

function installDrag(card, surface) {
  card.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return
    const cardStart = { ...state.positions[surface] }
    const pointerStart = { x: event.clientX, y: event.clientY }
    card.setPointerCapture(event.pointerId)
    card.classList.add('dragging')
    const move = moveEvent => {
      state.positions[surface] = draggedPosition(
        cardStart,
        pointerStart,
        { x: moveEvent.clientX, y: moveEvent.clientY },
        state.zoom,
      )
      card.style.left = `${state.positions[surface].x}px`
      card.style.top = `${state.positions[surface].y}px`
      sizeCanvas()
      renderEdges()
    }
    const up = () => {
      card.classList.remove('dragging')
      card.removeEventListener('pointermove', move)
      card.removeEventListener('pointerup', up)
      card.removeEventListener('pointercancel', up)
      savePositions()
    }
    card.addEventListener('pointermove', move)
    card.addEventListener('pointerup', up)
    card.addEventListener('pointercancel', up)
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
  const renderKey = JSON.stringify({ locale, node, messages, tab: state.tab })
  if (!detail.hidden && detail.dataset.renderKey === renderKey) return
  detail.dataset.renderKey = renderKey
  detail.hidden = false
  detail.innerHTML = `<div class="detail-head"><div><span class="eyebrow">${escapeHtml(node.surface)}</span><h2>${escapeHtml(titleOf(node))}</h2></div><button data-close>×</button></div><div class="detail-tabs"><button data-tab="surface" class="${state.tab === 'surface' ? 'active' : ''}">${t('surfaceTab')}</button><button data-tab="conversation" class="${state.tab === 'conversation' ? 'active' : ''}">${t('conversationTab')} ${messages.length}</button></div><div class="detail-content">${state.tab === 'surface' ? surfaceDetail(node) : conversationDetail(node, messages)}</div>${node.sessionId ? `<button class="open-session">${t('openConversation')}</button>` : ''}`
  detail.querySelector('[data-close]').addEventListener('click', () => { state.selected = null; render() })
  detail.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { state.tab = button.dataset.tab; renderDetail() }))
  detail.querySelector('.open-session')?.addEventListener('click', () => parent.postMessage({ source: 'pf-worksurface-web', type: 'open-session', sessionId: node.sessionId }, location.origin))
}

function surfaceDetail(node) {
  return `<div class="detail-meta"><span>${phaseLabel(node.phase)}</span><span>${escapeHtml(node.status)}</span><span>r${shortRevision(node.revision)}</span></div><div class="markdown full">${markdown(node.surfaceDocument)}</div><h3>${t('blocks')}</h3>${node.blocks.length === 0 ? `<p class="muted">${t('noBlocks')}</p>` : node.blocks.map(block => `<details><summary><strong>${escapeHtml(block.block)}</strong><span>${escapeHtml(block.kind)} · ${escapeHtml(block.status)}</span></summary><div class="markdown">${markdown(block.content)}</div></details>`).join('')}`
}

function conversationDetail(node, messages) {
  if (!node.sessionId) return `<p class="muted">${t('draftUnbound')}</p>`
  if (messages.length === 0) return `<p class="muted">${t('noMessages')}</p>`
  return `<div class="conversation">${messages.map(message => `<article class="message ${message.role}"><span>${message.role === 'user' ? t('you') : message.role === 'assistant' ? t('agent') : t('error')}</span><div>${escapeHtml(message.text).replaceAll('\n', '<br>')}</div></article>`).join('')}</div>`
}

function setZoom(value) {
  state.zoom = Math.min(1.5, Math.max(0.6, Math.round(value * 10) / 10))
  const canvas = root?.querySelector('#canvas')
  if (canvas) canvas.style.zoom = state.zoom
  const label = root?.querySelector('#zoom')
  if (label) label.textContent = `${Math.round(state.zoom * 100)}%`
}
