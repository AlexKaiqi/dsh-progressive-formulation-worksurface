window.__ModuleLoader__.load({
  id: '@pf-worksurface/web',
  factory: () => {
    const module = { exports: {} }
    const NS = 'worksurfaceWeb'
    const en = { dialog: 'Conversation', map: 'WorkGraph', frame: 'WorkGraph' }
    const dictionaries = {
      en,
      zh: { dialog: '对话', map: '工作面图', frame: '工作面图' },
      'zh-TW': { dialog: '對話', map: '工作面圖', frame: '工作面圖' },
      ja: { dialog: '会話', map: 'ワークグラフ', frame: 'ワークグラフ' },
      ko: { dialog: '대화', map: '워크그래프', frame: '워크그래프' },
      es: { dialog: 'Conversación', map: 'Grafo de trabajo', frame: 'Grafo de trabajo' },
      fr: { dialog: 'Conversation', map: 'Graphe de travail', frame: 'Graphe de travail' },
      de: { dialog: 'Unterhaltung', map: 'Arbeitsgraph', frame: 'Arbeitsgraph' },
      'pt-BR': { dialog: 'Conversa', map: 'Grafo de trabalho', frame: 'Grafo de trabalho' },
      ru: { dialog: 'Диалог', map: 'Рабочий граф', frame: 'Рабочий граф' },
      ar: { dialog: 'المحادثة', map: 'مخطط العمل', frame: 'مخطط العمل' },
      hi: { dialog: 'बातचीत', map: 'कार्य ग्राफ़', frame: 'कार्य ग्राफ़' },
    }
    module.exports.inject = ['sessions', 'locale']
    module.exports.apply = ctx => {
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'worksurface-map: dictionaries')
      const t = ctx.locale.bind(NS)
      const style = document.createElement('style')
      style.textContent = '.pf-ws-switch{position:fixed;z-index:80;top:12px;left:50%;display:flex;transform:translateX(-50%);padding:3px;border:1px solid #d1d5db;border-radius:999px;background:rgba(255,255,255,.95);box-shadow:0 8px 28px #0f172a18}.pf-ws-switch button{height:28px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:#64748b;font:600 12px system-ui;cursor:pointer}.pf-ws-switch button.active{background:#0f172a;color:white}.pf-ws-overlay{position:fixed;z-index:100;inset:0;background:#f6f7fb}.pf-ws-overlay[hidden]{display:none}.pf-ws-overlay iframe{width:100%;height:100%;border:0}'
      document.head.append(style)
      const host = document.createElement('div')
      host.innerHTML = '<div class="pf-ws-switch"><button class="active" data-view="dialog"></button><button data-view="map"></button></div><section class="pf-ws-overlay" hidden><iframe src="/worksurface-map/"></iframe></section>'
      document.body.append(host)
      const overlay = host.querySelector('.pf-ws-overlay')
      const frame = host.querySelector('iframe')
      const buttons = [...host.querySelectorAll('button')]
      const renderChrome = () => {
        buttons.find(button => button.dataset.view === 'dialog').textContent = t('dialog')
        buttons.find(button => button.dataset.view === 'map').textContent = t('map')
        frame.title = t('frame')
      }
      const sendCurrent = () => {
        const snapshot = ctx.sessions.list.getSnapshot()
        frame.contentWindow?.postMessage({ source: 'pf-worksurface-web', type: 'current-session', sessionId: snapshot.current ?? null, dark: document.body?.hasAttribute('data-ds-dark-theme') === true, locale: ctx.locale.getSnapshot().active }, location.origin)
      }
      const setView = view => {
        overlay.hidden = view !== 'map'
        buttons.forEach(button => button.classList.toggle('active', button.dataset.view === view))
        if (view === 'map') sendCurrent()
      }
      const onMessage = event => {
        if (event.origin !== location.origin || event.data?.source !== 'pf-worksurface-web') return
        if (event.data.type === 'close') setView('dialog')
        if (event.data.type === 'open-session' && typeof event.data.sessionId === 'string') {
          try { ctx.sessions.open(event.data.sessionId); setView('dialog') } catch {}
        }
        if (event.data.type === 'request-current') sendCurrent()
      }
      buttons.forEach(button => button.addEventListener('click', () => setView(button.dataset.view)))
      renderChrome()
      const unsubscribe = ctx.sessions.list.subscribe(sendCurrent)
      const unsubscribeLocale = ctx.locale.subscribe(() => { renderChrome(); sendCurrent() })
      frame.addEventListener('load', sendCurrent)
      window.addEventListener('message', onMessage)
      const onKey = event => { if (event.key === 'Escape' && !overlay.hidden) setView('dialog') }
      window.addEventListener('keydown', onKey)
      ctx.effect(() => () => {
        unsubscribe()
        unsubscribeLocale()
        window.removeEventListener('message', onMessage)
        window.removeEventListener('keydown', onKey)
        host.remove()
        style.remove()
      }, 'worksurface-map: view switch')
    }
    return module.exports
  },
})
