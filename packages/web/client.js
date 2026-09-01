window.__ModuleLoader__.load({
  id: '@pf-worksurface/web',
  factory: require => {
    const React = require('react')
    const h = React.createElement
    const NS = 'worksurfaceWeb'
    const en = {
      view: 'Relations', title: 'WorkSurface relations', subtitle: 'Dashed paths are declared capabilities. Solid paths are recorded Event evidence.',
      refresh: 'Refresh', refreshing: 'Refreshing…', empty: 'No orchestration is connected to this Surface.',
      chooseSurface: 'Surface', noSurfaces: 'No authored or event-backed Surface exists yet.',
      emptyHint: 'The Surface remains valid. Admit an Orchestrate artifact and registration.json to connect it to other work.',
      loadFailed: 'Unable to replay WorkSurface topology', legend: 'Visual language', possible: 'Possible path',
      observed: 'Matched event', emitted: 'Emitted event', current: 'Current', details: 'Orchestration details',
      close: 'Close', definition: 'Definition', revision: 'Revision', bindings: 'Role bindings', condition: 'Condition evidence',
      activations: 'Activations', received: 'received', missing: 'missing', noRuns: 'No activation yet',
      failures: 'Failures', viewWarning: 'View definition fallback',
      idle: 'Waiting for events', published: 'Published',
      'waiting-user': 'Waiting for user', completed: 'Completed', failed: 'Failed', conflicted: 'Publish conflict',
      verified: 'Business result verified', active: 'Active', paused: 'Paused', retired: 'Retired',
      all: 'All', any: 'Any', count: 'Count', sequence: 'Sequence', handler: 'Code handler',
      surfaces: 'Surfaces', paths: 'Paths', needsAttention: 'Need attention', anchor: 'Anchor',
      pathDetails: 'Path evidence', conditionDetails: 'Condition evidence', possibleStage: 'Possible path',
      matchedStage: 'Matched source', activationStage: 'Activation formed', emitStage: 'Managed emit', publicationStage: 'Target publication',
      yes: 'Recorded', no: 'Not recorded', source: 'Source', target: 'Target', eventRefs: 'Event references',
      phase: 'Projected phase', evidence: 'Event evidence', group: 'Group',
      handlerInvocations: 'Handler invocations',
      declaredCapabilities: 'Declared path', actualFacts: 'Recorded evidence', noActualFacts: 'No Runtime Event has been recorded yet.',
      inputs: 'inputs', runs: 'runs', pendingRuns: 'pending', consume: 'consume', emit: 'orchestrate emit', surfaceOutput: 'Surface output', causes: 'causes',
      advance: 'Continue in DSH', opening: 'Opening session…', sessionFailed: 'Unable to open the Surface Session',
      relations: 'Relations', legacy: 'v4 compatibility', registration: 'Orchestrate', runtimeEvent: 'Runtime Event',
      declaredPath: 'Declared path', actualPath: 'Recorded causal path', setAnchor: 'Focus this Surface',
      eventHistory: 'Recorded Events', noEvents: 'No Runtime Event is recorded for this Surface.', route: 'Event route',
      producer: 'Producer', recordedAt: 'Recorded at', operationKey: 'Operation key', payload: 'Payload',
      exactEvidence: 'Exact evidence', capability: 'Capability', contract: 'Contract', from: 'From', to: 'To', currentSurface: 'Current Surface',
      compatibleHint: 'The v4 engine is kept in an isolated compatibility view.',
    }
    const zh = {
      view: '关系', title: 'WorkSurface 关系', subtitle: '虚线是声明的可能通路，实线是已记录 Event 证明的实际因果。',
      refresh: '刷新', refreshing: '刷新中…', empty: '当前 Surface 尚未连接任何编排。',
      chooseSurface: 'Surface', noSurfaces: '尚未发现作者目录或事件支持的 Surface。',
      emptyHint: 'Surface 本身仍然有效；准入 Orchestrate artifact 与 registration.json 后会形成事件拓扑。',
      loadFailed: '无法重放 WorkSurface 拓扑', legend: '视觉语言', possible: '可能通路',
      observed: '已匹配事件', emitted: '已发出事件', current: '当前', details: '编排详情',
      close: '关闭', definition: 'Definition', revision: 'Revision', bindings: '角色绑定', condition: '条件证据',
      activations: 'Activation', received: '已收到', missing: '仍缺少', noRuns: '尚无 activation',
      failures: '失败', viewWarning: 'View Definition 已回退',
      idle: '等待事件', published: '已发布',
      'waiting-user': '等待用户', completed: '已完成', failed: '失败', conflicted: '发布冲突',
      verified: '业务结果已验收', active: '运行中', paused: '已暂停', retired: '已退役',
      all: '全部', any: '任一', count: '计数', sequence: '顺序', handler: '代码 Handler',
      surfaces: 'Surface', paths: '通路', needsAttention: '需处理', anchor: '锚点',
      pathDetails: '通路证据', conditionDetails: '条件证据', possibleStage: '可能通路',
      matchedStage: '源事件已匹配', activationStage: 'Activation 已形成', emitStage: '托管事件已发出', publicationStage: '目标发布',
      yes: '已有事实', no: '尚无事实', source: '来源', target: '目标', eventRefs: '事件引用',
      phase: '投影阶段', evidence: '事件证据', group: '分组',
      handlerInvocations: 'Handler 调用',
      declaredCapabilities: '声明通路', actualFacts: '已记录证据', noActualFacts: '尚未记录 Runtime Event。',
      inputs: '输入', runs: '运行', pendingRuns: '待结算', consume: '消费', emit: 'Orchestrate 发出', surfaceOutput: 'Surface 输出', causes: '原因',
      advance: '进入推进', opening: '正在进入 Session…', sessionFailed: '无法进入 Surface Session',
      relations: '关系视图', legacy: 'v4 兼容', registration: 'Orchestrate', runtimeEvent: 'Runtime Event',
      declaredPath: '声明通路', actualPath: '已记录因果通路', setAnchor: '以此 Surface 为锚点',
      eventHistory: '已记录 Event', noEvents: '该 Surface 尚无 Runtime Event。', route: 'Event 路由',
      producer: '产生者', recordedAt: '记录时间', operationKey: '操作键', payload: 'Payload',
      exactEvidence: '精确证据', capability: '能力', contract: 'Contract', from: '来自', to: '去向', currentSurface: '当前 Surface',
      compatibleHint: 'v4 引擎只保留在独立的兼容视图中。',
    }
    const dictionaries = { en, zh, 'zh-TW': zh }

    function translate(locale, key) {
      const dictionary = String(locale || 'en').toLowerCase().startsWith('zh') ? zh : en
      return dictionary[key] || en[key] || key
    }
    function useLocale(ctx) {
      return React.useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), () => ctx.locale.getSnapshot().active)
    }

    function TopologyView(props) {
      const locale = useLocale(props.ctx)
      const t = React.useCallback(key => translate(locale, key), [locale])
      const [snapshot, setSnapshot] = React.useState(null)
      const [error, setError] = React.useState('')
      const [loading, setLoading] = React.useState(true)
      const [selected, setSelected] = React.useState(null)
      const [viewMode, setViewMode] = React.useState('relations')
      const [surfaceId, setSurfaceId] = React.useState('')
      const [surfaces, setSurfaces] = React.useState([])
      const [openingSurface, setOpeningSurface] = React.useState('')
      const generation = React.useRef(0)
      React.useEffect(() => {
        let active = true
        void fetch('/worksurface-map/api/surfaces', { cache: 'no-store' }).then(async response => {
          const value = await response.json()
          if (!response.ok) throw new Error(value.error || t('loadFailed'))
          if (!active) return
          const choices = value.surfaces || []
          setSurfaces(choices)
          let preferred = ''
          try { preferred = window.sessionStorage.getItem('worksurface-anchor') || '' } catch {}
          const chosen = choices.some(item => item.surfaceId === preferred) ? preferred : choices[0]?.surfaceId || ''
          setSurfaceId(chosen)
          if (!chosen) setLoading(false)
        }).catch(cause => { if (active) { setError(cause instanceof Error ? cause.message : t('loadFailed')); setLoading(false) } })
        return () => { active = false }
      }, [t])
      const load = React.useCallback(async quiet => {
        if (!surfaceId) return
        const current = ++generation.current
        if (!quiet) setLoading(true)
        try {
          const response = await fetch(`/worksurface-map/api/topology?surface=${encodeURIComponent(surfaceId)}`, { cache: 'no-store' })
          const value = await response.json()
          if (current !== generation.current) return
          if (!response.ok) throw new Error(value.error || t('loadFailed'))
          setSnapshot(value)
          setError('')
          setSelected(previous => resolveSelection(previous, value))
        } catch (cause) {
          if (current === generation.current) setError(cause instanceof Error ? cause.message : t('loadFailed'))
        } finally {
          if (current === generation.current) setLoading(false)
        }
      }, [surfaceId, t])
      React.useEffect(() => {
        if (!surfaceId) return undefined
        let active = true
        const controller = new AbortController()
        const watch = async () => {
          while (active) {
            try {
              const response = await fetch('/worksurface-map/api/watch', { cache: 'no-store', signal: controller.signal })
              if (!response.ok) throw new Error(`wakeup failed: ${response.status}`)
              if (active) await load(true)
            } catch (cause) {
              if (!active || controller.signal.aborted) return
              await new Promise(resolve => window.setTimeout(resolve, 1000))
            }
          }
        }
        void watch()
        void load(false)
        return () => { active = false; generation.current += 1; controller.abort() }
      }, [load])
      const openSurface = React.useCallback(id => {
        setSurfaceId(id)
        setSnapshot(null)
        setSelected(null)
        try { window.sessionStorage.setItem('worksurface-anchor', id) } catch {}
      }, [])
      const advanceSurface = React.useCallback(async () => {
        if (!surfaceId || openingSurface) return
        setOpeningSurface(surfaceId)
        try {
          const response = await fetch(`/worksurface-map/api/session?surface=${encodeURIComponent(surfaceId)}`, { method: 'POST', cache: 'no-store' })
          const value = await response.json()
          if (!response.ok) throw new Error(value.error || t('sessionFailed'))
          await waitForSession(props.ctx.sessions, value.sessionId)
          props.ctx.sessions.open(value.sessionId)
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : t('sessionFailed'))
        } finally {
          setOpeningSurface('')
        }
      }, [openingSurface, props.ctx.sessions, surfaceId, t])
      const displayTitle = snapshot?.view?.title || t('title')
      const hasRelations = Boolean(snapshot?.codeFirst?.length)
      const hasLegacy = Boolean(snapshot?.orchestrations?.length)
      const activeMode = hasRelations ? (viewMode === 'relations' || !hasLegacy ? 'relations' : 'legacy') : hasLegacy ? 'legacy' : 'relations'
      const anchor = snapshot?.surfaces.find(surface => surface.surfaceId === snapshot.anchorSurfaceId)
      return h('section', { className: 'pf-ws-view', 'aria-label': displayTitle }, [
        h('header', { key: 'head', className: 'pf-ws-head' }, [
          h('div', { key: 'copy', className: 'pf-ws-head-copy' }, [h('h2', { key: 'title' }, displayTitle), h('p', { key: 'sub' }, t(activeMode === 'relations' ? 'subtitle' : 'compatibleHint'))]),
          anchor ? h('span', { key: 'phase', className: `pf-ws-anchor-phase ${phaseTone(anchor.lifecycle.phase)}` }, `${phaseIcon(anchor.lifecycle.phase)} ${t(anchor.lifecycle.phase)}`) : null,
          h('div', { key: 'actions', className: 'pf-ws-head-actions' }, [
            h('label', { key: 'surface', className: 'pf-ws-surface-choice' }, [
              h('span', { key: 'label' }, t('chooseSurface')),
              h('select', { key: 'select', value: surfaceId, onChange: event => openSurface(event.target.value), disabled: surfaces.length === 0 }, [
                surfaces.length === 0 ? h('option', { key: 'none', value: '' }, '—') : null,
                ...surfaces.map(surface => h('option', { key: surface.surfaceId, value: surface.surfaceId }, surface.title)),
              ]),
            ]),
            snapshot?.viewRevision ? h('code', { key: 'revision', title: snapshot.viewRevision }, shortRevision(snapshot.viewRevision)) : null,
            h('button', { key: 'advance', type: 'button', className: 'primary', onClick: () => { void advanceSurface() }, disabled: !surfaceId || Boolean(openingSurface) }, openingSurface ? t('opening') : t('advance')),
            h('button', { key: 'refresh', type: 'button', onClick: () => { void load(false) }, disabled: loading }, loading ? t('refreshing') : t('refresh')),
          ]),
        ]),
        snapshot?.viewWarning ? h('div', { key: 'warning', className: 'pf-ws-warning', role: 'status' }, `${t('viewWarning')}: ${snapshot.viewWarning}`) : null,
        error && snapshot ? h('div', { key: 'error-warning', className: 'pf-ws-warning pf-ws-danger', role: 'alert' }, error) : null,
        error && !snapshot ? h('div', { key: 'error', className: 'pf-ws-blank pf-ws-danger', role: 'alert' }, [h('strong', { key: 'label' }, t('loadFailed')), h('span', { key: 'message' }, error)]) : null,
        !surfaceId && !loading && !error ? h('div', { key: 'no-surfaces', className: 'pf-ws-blank' }, t('noSurfaces')) : null,
        snapshot ? h('div', { key: 'body', className: `pf-ws-body${selected ? ' has-drawer' : ''}` }, [
          h('div', { key: 'canvas', className: 'pf-ws-canvas' }, [
            hasRelations && hasLegacy ? h('nav', { key: 'modes', className: 'pf-ws-modes', 'aria-label': t('view') }, [
              h('button', { key: 'relations', type: 'button', className: activeMode === 'relations' ? 'active' : '', onClick: () => { setViewMode('relations'); setSelected(null) } }, t('relations')),
              h('button', { key: 'legacy', type: 'button', className: activeMode === 'legacy' ? 'active' : '', onClick: () => { setViewMode('legacy'); setSelected(null) } }, t('legacy')),
            ]) : null,
            activeMode === 'relations' && hasRelations ? h(CodeFirstGraph, { key: 'relations', snapshot, t, onSelect: setSelected }) : null,
            activeMode === 'legacy' && hasLegacy ? h(TopologyGraph, { key: 'legacy', snapshot, t, onSurface: openSurface, onSelect: selection => setSelected({ ...selection, scope: 'legacy' }) }) : null,
            !hasLegacy && !hasRelations
              ? h('div', { key: 'empty', className: 'pf-ws-blank' }, [h('span', { key: 'mark', className: 'pf-ws-empty-mark' }, '◇'), h('strong', { key: 'title' }, t('empty')), h('p', { key: 'hint' }, t('emptyHint'))])
              : null,
            h(Legend, { key: 'legend', t, mode: activeMode }),
          ]),
          selected?.scope === 'code-first' ? h(CodeFirstEvidenceDrawer, { key: 'code-first-drawer', selection: selected, snapshot, t, onClose: () => setSelected(null), onSurface: openSurface, onSelect: setSelected }) : null,
          selected?.scope === 'legacy' ? h(LegacyEvidenceDrawer, { key: 'legacy-drawer', selection: selected, snapshot, t, onClose: () => setSelected(null), onSurface: openSurface }) : null,
        ]) : null,
      ])
    }

    function CodeFirstGraph({ snapshot, t, onSelect }) {
      const model = buildCodeFirstGraph(snapshot)
      const children = [h('defs', { key: 'defs' }, h('marker', { id: 'pf-ws-code-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, h('path', { d: 'M 0 0 L 10 5 L 0 10 z' })))]
      for (const path of model.declaredPaths) {
        children.push(h('g', { key: path.key, className: 'pf-ws-path-hit' }, [
          h('line', { key: 'hit', ...lineCoordinates(path), className: 'pf-ws-edge-target', onClick: () => onSelect({ scope: 'code-first', type: 'declared-path', key: path.key }) }),
          h('line', { key: 'line', ...lineCoordinates(path), className: 'pf-ws-edge possible', markerEnd: 'url(#pf-ws-code-arrow)' }),
          h(PathLabelButton, { key: 'label', path, label: pathLabel(path.events), ariaLabel: `${t('declaredPath')}: ${path.events.join(', ')}`, onClick: () => onSelect({ scope: 'code-first', type: 'declared-path', key: path.key }) }),
        ]))
      }
      for (const path of model.actualPaths) {
        const selectActual = () => onSelect({ scope: 'code-first', type: 'actual-event', surfaceId: path.surfaceId, eventId: path.event.id })
        children.push(h('g', { key: path.key, className: 'pf-ws-path-hit actual' }, [
          ...path.segments.flatMap((segment, index) => [
            h('line', { key: `hit:${index}`, ...lineCoordinates(segment), className: 'pf-ws-edge-target', onClick: selectActual }),
            h('line', { key: `line:${index}`, ...lineCoordinates(segment), className: 'pf-ws-edge actual', markerEnd: index === path.segments.length - 1 ? 'url(#pf-ws-code-arrow)' : undefined }),
          ]),
          h('circle', { key: 'event', cx: path.target.x, cy: path.target.y, r: 5, className: 'pf-ws-event-dot' }),
          h(PathLabelButton, { key: 'label', path: path.segments.at(-1), label: path.event.type.name, ariaLabel: `${t('actualPath')}: ${path.event.type.name}`, actual: true, onClick: selectActual }),
        ]))
      }
      for (const registration of model.registrations) {
        children.push(h('foreignObject', { key: registration.registration.registrationId, x: registration.position.x - 94, y: registration.position.y - 38, width: 188, height: 76 }, h('button', {
          type: 'button', className: `pf-ws-orchestrate${registration.registration.pendingRunCount ? ' pending' : ''}`,
          onClick: () => onSelect({ scope: 'code-first', type: 'registration', registrationId: registration.registration.registrationId }),
          'aria-label': `${t('registration')}: ${registration.registration.registrationId}`,
        }, [
          h('span', { key: 'kind' }, t('registration')),
          h('strong', { key: 'id', title: registration.registration.registrationId }, registration.registration.registrationId),
          h('small', { key: 'runs' }, `${registration.registration.recordedRunCount} ${t('runs')}${registration.registration.pendingRunCount ? ` · ${registration.registration.pendingRunCount} ${t('pendingRuns')}` : ''}`),
        ])))
      }
      for (const node of model.surfaces) {
        const phase = node.surface.lifecycle.phase
        children.push(h('foreignObject', { key: node.surface.surfaceId, x: node.position.x - 108, y: node.position.y - 44, width: 216, height: 88 }, h('button', {
          type: 'button', className: `pf-ws-node ${phase}${node.surface.surfaceId === snapshot.anchorSurfaceId ? ' current' : ''}`,
          onClick: () => onSelect({ scope: 'code-first', type: 'surface', surfaceId: node.surface.surfaceId }),
          'aria-label': `${node.surface.title}: ${t(phase)}`,
        }, [
          h('span', { key: 'icon', className: 'pf-ws-node-icon', 'aria-hidden': 'true' }, phaseIcon(phase)),
          h('span', { key: 'copy', className: 'pf-ws-node-copy' }, [node.surface.group ? h('span', { key: 'group', className: 'pf-ws-node-group' }, node.surface.group) : null, h('strong', { key: 'title', title: node.surface.title }, node.surface.title)]),
          node.eventCount ? h('span', { key: 'events', className: 'pf-ws-event-count' }, `${node.eventCount} Event`) : null,
          node.surface.surfaceId === snapshot.anchorSurfaceId ? h('span', { key: 'current', className: 'pf-ws-current' }, t('current')) : null,
        ])))
      }
      return h('svg', { className: 'pf-ws-graph pf-ws-code-graph', viewBox: '0 0 1200 720', preserveAspectRatio: 'xMidYMid meet', 'aria-label': t('relations') }, children)
    }

    function PathLabelButton({ path, label, ariaLabel, actual, onClick }) {
      const position = lineLabel(path)
      return h('foreignObject', { x: position.x - 82, y: position.y - 12, width: 164, height: 24 }, h('button', { type: 'button', className: `pf-ws-path-label${actual ? ' actual' : ''}`, onClick, 'aria-label': ariaLabel, title: label }, label))
    }

    function TopologyGraph({ snapshot, t, onSurface, onSelect }) {
      const model = buildGraph(snapshot)
      const children = [h('defs', { key: 'defs' }, h('marker', { id: 'pf-ws-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, h('path', { d: 'M 0 0 L 10 5 L 0 10 z' })))]
      for (const group of model.groups) {
        children.push(h('g', { key: `group:${group.id}`, className: 'pf-ws-group' }, [
          h('rect', { key: 'box', x: group.area.x, y: group.area.y, width: group.area.width, height: group.area.height, rx: 18 }),
          h('text', { key: 'title', x: group.area.x + 16, y: group.area.y + 24 }, group.title),
        ]))
      }
      for (const edge of model.edges) {
        const key = `${edge.relation.key}:${edge.kind}:${edge.role}:${edge.surfaceId}`
        const edgeLabel = edge.eventLabel || edge.relation.title
        children.push(h('g', { key, className: 'pf-ws-edge-hit' }, [
          h('line', { key: 'target', x1: edge.from.x, y1: edge.from.y, x2: edge.to.x, y2: edge.to.y, className: 'pf-ws-edge-target', role: 'button', tabIndex: 0, 'aria-label': edgeLabel, onClick: () => onSelect({ type: 'path', relation: edge.relation, edge }), onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect({ type: 'path', relation: edge.relation, edge }) } } }),
          h('line', { key: 'base', x1: edge.from.x, y1: edge.from.y, x2: edge.to.x, y2: edge.to.y, className: 'pf-ws-edge possible', ...(edge.kind === 'target' ? { markerEnd: 'url(#pf-ws-arrow)' } : {}) }),
          edge.actual ? h('line', { key: 'actual', x1: edge.from.x, y1: edge.from.y, x2: edge.to.x, y2: edge.to.y, className: `pf-ws-edge actual ${edge.kind}`, ...(edge.kind === 'target' ? { markerEnd: 'url(#pf-ws-arrow)' } : {}) }) : null,
          edge.actual ? h('circle', { key: 'event', cx: edge.from.x + (edge.to.x - edge.from.x) * .62, cy: edge.from.y + (edge.to.y - edge.from.y) * .62, r: 5, className: 'pf-ws-event-dot' }, h('title', null, edge.eventLabel || t(edge.kind === 'target' ? 'emitted' : 'observed'))) : null,
          edge.eventLabel ? h('text', { key: 'label', className: `pf-ws-edge-label ${edge.actual ? 'actual' : ''}`, x: edge.from.x + (edge.to.x - edge.from.x) * .48, y: edge.from.y + (edge.to.y - edge.from.y) * .48 - 7, textAnchor: 'middle' }, edge.eventLabel) : null,
        ]))
      }
      for (const relation of model.relations) {
        children.push(h('g', { key: relation.key, className: `pf-ws-gate ${relation.tone}`, transform: `translate(${relation.position.x} ${relation.position.y})`, onClick: () => onSelect({ type: 'condition', relation }), role: 'button', tabIndex: 0, 'aria-label': `${relation.title}: ${relation.progress}`, onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect({ type: 'condition', relation }) } } }, [
          h('circle', { key: 'shape', r: 25 }),
          h('text', { key: 'symbol', className: 'pf-ws-gate-symbol', textAnchor: 'middle', y: -2 }, relation.symbol),
          h('text', { key: 'progress', className: 'pf-ws-gate-progress', textAnchor: 'middle', y: 14 }, relation.progress),
          h('title', { key: 'title' }, relation.title),
        ]))
      }
      for (const node of model.nodes) {
        const phase = node.surface.lifecycle.phase
        const verified = node.surface.lifecycle.verified
        children.push(h('foreignObject', { key: node.surface.surfaceId, x: node.position.x - 115, y: node.position.y - 48, width: 230, height: 96 },
          h('button', {
            type: 'button', className: `pf-ws-node ${phase}${node.surface.surfaceId === snapshot.anchorSurfaceId ? ' current' : ''}`,
            onClick: () => onSurface(node.surface.surfaceId),
            'aria-label': `${node.surface.title}: ${t(phase)}${verified ? `, ${t('verified')}` : ''}`,
          }, [
            h('span', { key: 'icon', className: 'pf-ws-node-icon', 'aria-hidden': 'true' }, phaseIcon(phase)),
            h('span', { key: 'copy', className: 'pf-ws-node-copy' }, [
              h('span', { key: 'roles', className: 'pf-ws-node-roles' }, node.roles.slice(0, 2).map(role => h('span', { key: role }, role)).concat(node.roles.length > 2 ? [h('span', { key: 'more' }, `+${node.roles.length - 2}`)] : [])),
              h('strong', { key: 'title', title: node.surface.title }, node.surface.title),
            ]),
            verified ? h('span', { key: 'verified', className: 'pf-ws-verified', title: t('verified'), 'aria-label': t('verified') }, '🛡✓') : null,
            node.surface.surfaceId === snapshot.anchorSurfaceId ? h('span', { key: 'current', className: 'pf-ws-current' }, t('current')) : null,
          ])))
      }
      return h('svg', { className: 'pf-ws-graph', viewBox: '0 0 1200 720', preserveAspectRatio: 'xMidYMid meet', 'aria-label': t('title') }, children)
    }

    function Legend({ t, mode }) {
      return h('details', { className: 'pf-ws-legend' }, [
        h('summary', { key: 'summary' }, t('legend')),
        h('div', { key: 'items' }, [
          h('span', { key: 'possible' }, [h('i', { key: 'mark', className: 'line possible' }), t('possible')]),
          h('span', { key: 'observed' }, [h('i', { key: 'mark', className: 'line observed' }), mode === 'relations' ? t('actualFacts') : t('observed')]),
          mode === 'legacy' ? h('span', { key: 'emitted' }, [h('i', { key: 'mark', className: 'line emitted' }), t('emitted')]) : null,
          ...['idle', 'published', 'waiting-user', 'completed', 'failed', 'conflicted'].map(phase => h('span', { key: phase }, [h('i', { key: 'mark', className: `phase ${phase}` }, phaseIcon(phase)), t(phase)])),
        ]),
      ])
    }

    function CodeFirstEvidenceDrawer({ selection, snapshot, t, onClose, onSurface, onSelect }) {
      const model = buildCodeFirstGraph(snapshot)
      if (selection.type === 'surface') {
        const surface = snapshot.surfaces.find(item => item.surfaceId === selection.surfaceId)
        if (!surface) return null
        const events = [...(snapshot.runtimeEvents?.[surface.surfaceId] || [])].reverse()
        return h(EvidenceShell, { label: 'Surface', title: surface.title, onClose }, [
          h('div', { key: 'meta', className: 'pf-ws-drawer-meta' }, [h('span', { key: 'status', className: `status ${surface.lifecycle.phase}` }, t(surface.lifecycle.phase)), h('code', { key: 'id', title: surface.surfaceId }, shortId(surface.surfaceId))]),
          h(DrawerSection, { key: 'identity', title: t('exactEvidence') }, h('dl', { className: 'pf-ws-path-facts' }, [
            factRow('SurfaceId', surface.surfaceId),
            surface.group ? factRow(t('group'), surface.group) : null,
            factRow(t('phase'), t(surface.lifecycle.phase)),
          ])),
          surface.lifecycle.evidence?.length ? h(DrawerSection, { key: 'lifecycle', title: t('evidence') }, surface.lifecycle.evidence.map(item => h('div', { key: `${item.ref.subject}:${item.ref.seq}:${item.ref.id}`, className: 'pf-ws-cause' }, [h('span', { key: 'source' }, item.name), h('strong', { key: 'subject' }, item.ref.subject), h('code', { key: 'seq' }, `#${item.ref.seq}`), h('small', { key: 'id', title: item.ref.id }, shortId(item.ref.id))]))) : null,
          surface.surfaceId !== snapshot.anchorSurfaceId ? h('div', { key: 'focus', className: 'pf-ws-drawer-action' }, h('button', { type: 'button', className: 'primary', onClick: () => onSurface(surface.surfaceId) }, t('setAnchor'))) : null,
          h(DrawerSection, { key: 'events', title: `${t('eventHistory')} · ${events.length}` }, events.length ? events.map(event => h('button', { key: event.id, type: 'button', className: 'pf-ws-event-row', onClick: () => onSelect({ scope: 'code-first', type: 'actual-event', surfaceId: surface.surfaceId, eventId: event.id }) }, [
            h('span', { key: 'dot', className: 'dot' }), h('strong', { key: 'name' }, event.type.name), h('code', { key: 'seq' }, `#${event.seq}`), h('small', { key: 'producer' }, event.producer.kind),
          ])) : h('p', { className: 'pf-ws-muted' }, t('noEvents'))),
        ])
      }
      if (selection.type === 'registration') {
        const registration = snapshot.codeFirst.find(item => item.registrationId === selection.registrationId)
        if (!registration) return null
        return h(EvidenceShell, { label: t('registration'), title: registration.registrationId, onClose }, [
          h('div', { key: 'meta', className: 'pf-ws-drawer-meta' }, [h('span', { key: 'status', className: registration.pendingRunCount ? 'status pending' : 'status' }, registration.pendingRunCount ? `${registration.pendingRunCount} ${t('pendingRuns')}` : `${registration.recordedRunCount} ${t('runs')}`), h('code', { key: 'revision', title: registration.orchestrateRevision }, shortRevision(registration.orchestrateRevision))]),
          h(DrawerSection, { key: 'counts', title: t('exactEvidence') }, h('dl', { className: 'pf-ws-path-facts' }, [factRow(t('inputs'), registration.acceptedInputCount), factRow(t('runs'), registration.recordedRunCount), factRow(t('pendingRuns'), registration.pendingRunCount), factRow(t('revision'), registration.orchestrateRevision)])),
          h(DrawerSection, { key: 'bindings', title: t('bindings') }, Object.entries(registration.bindings).map(([handle, id]) => h('button', { key: handle, type: 'button', className: 'pf-ws-binding', onClick: () => onSelect({ scope: 'code-first', type: 'surface', surfaceId: id }) }, [h('b', { key: 'handle' }, handle), h('span', { key: 'arrow' }, '→'), h('span', { key: 'surface' }, surfaceTitle(snapshot, id))]))),
          h(DrawerSection, { key: 'routes', title: t('route') }, Object.entries(registration.routes).map(([name, route]) => h('article', { key: name, className: 'pf-ws-route-evidence' }, [h('strong', { key: 'name' }, name), h('ul', { key: 'items' }, routeCapabilities(route, t).map(item => h('li', { key: `${item.capability}:${item.handle}` }, `${item.capability} · ${item.handle} → ${surfaceTitle(snapshot, registration.bindings[item.handle])}`)))]))),
        ])
      }
      if (selection.type === 'declared-path') {
        const path = model.declaredPaths.find(item => item.key === selection.key)
        if (!path) return null
        return h(EvidenceShell, { label: t('declaredPath'), title: path.events.join(', '), onClose }, [
          h('div', { key: 'meta', className: 'pf-ws-drawer-meta' }, [h('span', { key: 'status', className: 'status declared' }, t('possible')), h('code', { key: 'revision', title: path.registration.orchestrateRevision }, shortRevision(path.registration.orchestrateRevision))]),
          h(DrawerSection, { key: 'evidence', title: t('exactEvidence') }, h('dl', { className: 'pf-ws-path-facts' }, [
            factRow(t('registration'), path.registration.registrationId), factRow(t('from'), nodeTitle(snapshot, path.from)), factRow(t('to'), nodeTitle(snapshot, path.to)), factRow(t('capability'), path.capabilities.join(', ')), factRow(t('route'), path.events.join(', ')),
          ])),
          h('p', { key: 'note', className: 'pf-ws-drawer-note' }, t('subtitle')),
        ])
      }
      const event = snapshot.runtimeEvents?.[selection.surfaceId]?.find(item => item.id === selection.eventId)
      if (!event) return null
      const registrationId = event.producer.kind === 'orchestrate' ? event.producer.ref.split('/')[0] : ''
      const registration = snapshot.codeFirst.find(item => item.registrationId === registrationId)
      return h(EvidenceShell, { label: t('runtimeEvent'), title: event.type.name, onClose }, [
        h('div', { key: 'meta', className: 'pf-ws-drawer-meta' }, [h('span', { key: 'status', className: 'status recorded' }, t('actualFacts')), h('code', { key: 'seq' }, `#${event.seq}`)]),
        h(DrawerSection, { key: 'identity', title: t('exactEvidence') }, h('dl', { className: 'pf-ws-path-facts' }, [
          factRow('Event ID', event.id), factRow('Surface', surfaceTitle(snapshot, selection.surfaceId)), factRow(t('producer'), `${event.producer.kind} · ${event.producer.ref}`), factRow(t('recordedAt'), event.recordedAt), factRow(t('operationKey'), event.operationKey), factRow(t('contract'), event.type.contract),
        ])),
        registration ? h(DrawerSection, { key: 'registration', title: t('registration') }, h('button', { type: 'button', className: 'pf-ws-binding', onClick: () => onSelect({ scope: 'code-first', type: 'registration', registrationId }) }, [h('b', { key: 'kind' }, t('registration')), h('span', { key: 'arrow' }, '→'), h('span', { key: 'id' }, registrationId)])) : null,
        h(DrawerSection, { key: 'causes', title: `${t('causes')} · ${event.causes.length}` }, event.causes.length ? event.causes.map(cause => h('div', { key: `${cause.source}:${cause.subject.id}:${cause.seq}:${cause.id}`, className: 'pf-ws-cause' }, [h('span', { key: 'source' }, cause.source), h('strong', { key: 'subject' }, cause.subject.id), h('code', { key: 'seq' }, `#${cause.seq}`), h('small', { key: 'id', title: cause.id }, shortId(cause.id))])) : h('p', { className: 'pf-ws-muted' }, t('no'))),
        h('details', { key: 'payload', className: 'pf-ws-raw-definition' }, [h('summary', { key: 'summary' }, t('payload')), h('pre', { key: 'pre' }, JSON.stringify(event.payload, null, 2))]),
      ])
    }

    function EvidenceShell({ label, title, onClose, children }) {
      return h('aside', { className: 'pf-ws-drawer', 'aria-label': label }, [h('header', { key: 'head' }, [h('div', { key: 'copy' }, [h('span', { key: 'label' }, label), h('h3', { key: 'title' }, title)]), h('button', { key: 'close', type: 'button', onClick: onClose, 'aria-label': 'Close' }, '×')]), ...children])
    }

    function LegacyEvidenceDrawer({ selection, snapshot, t, onClose, onSurface }) {
      const { relation } = selection
      const { inspection, subscription, condition } = relation
      const runs = inspection.runs.filter(run => run.activation.subscriptionId === subscription.id)
      const targetSurfaces = relation.targetRoles.map(role => inspection.bindings[role]).filter(Boolean).map(id => snapshot.surfaces.find(surface => surface.surfaceId === id)).filter(Boolean)
      return h('aside', { className: 'pf-ws-drawer', 'aria-label': t('details') }, [
        h('header', { key: 'head' }, [
          h('div', { key: 'copy' }, [h('span', { key: 'label' }, t(selection.type === 'path' ? 'pathDetails' : 'conditionDetails')), h('h3', { key: 'title' }, relation.title)]),
          h('button', { key: 'close', type: 'button', onClick: onClose, 'aria-label': t('close') }, '×'),
        ]),
        h('div', { key: 'meta', className: 'pf-ws-drawer-meta' }, [
          h('span', { key: 'status', className: `status ${inspection.status}` }, t(inspection.status)),
          h('code', { key: 'rev', title: inspection.definitionRevision }, shortRevision(inspection.definitionRevision)),
        ]),
        h(EvidenceRail, { key: 'rail', relation, targetSurfaces, t }),
        selection.type === 'path' ? h(PathEvidence, { key: 'path', edge: selection.edge, relation, snapshot, t, onSurface }) : null,
        h(DrawerSection, { key: 'bindings', title: t('bindings') }, Object.entries(inspection.bindings).map(([role, id]) => h('button', { key: role, type: 'button', className: 'pf-ws-binding', onClick: () => onSurface(id) }, [h('b', { key: 'role' }, role), h('span', { key: 'arrow' }, '→'), h('span', { key: 'surface' }, surfaceTitle(snapshot, id))]))),
        h(DrawerSection, { key: 'condition', title: t('condition') }, h(ConditionTree, { condition, t })),
        h(DrawerSection, { key: 'runs', title: `${t('activations')} · ${runs.length}` }, runs.length ? runs.map(run => h(RunCard, { key: run.activation.id, run, snapshot, t })) : h('p', { className: 'pf-ws-muted' }, t('noRuns'))),
        h('details', { key: 'raw', className: 'pf-ws-raw-definition' }, [h('summary', { key: 'summary' }, `${t('definition')} · ${t('revision')}`), h('pre', { key: 'pre' }, JSON.stringify(subscription, null, 2))]),
      ])
    }

    function EvidenceRail({ relation, targetSurfaces, t }) {
      const runs = relation.runs
      const matched = selectorLeaves(relation.condition).some(item => item.matches.length > 0)
      const activated = runs.length > 0
      const emitted = runs.some(run => run.operations.some(operation => operation.status === 'settled'))
      const publication = strongestPhase(targetSurfaces.map(surface => surface.lifecycle.phase))
      const steps = [
        { key: 'possibleStage', done: true, detail: relation.subscription.id },
        { key: 'matchedStage', done: matched, detail: relation.progress },
        { key: 'activationStage', done: activated, detail: activated ? String(runs.length) : t('no') },
        { key: 'emitStage', done: emitted, detail: emitted ? t('yes') : t('no') },
        { key: 'publicationStage', done: publication !== 'idle', detail: t(publication), tone: phaseTone(publication) },
      ]
      return h('ol', { className: 'pf-ws-evidence-rail', 'aria-label': t('pathDetails') }, steps.map(step => h('li', { key: step.key, className: `${step.done ? 'recorded' : 'absent'} ${step.tone || ''}` }, [
        h('span', { key: 'mark', className: 'mark', 'aria-hidden': 'true' }, step.done ? '●' : '○'),
        h('span', { key: 'copy' }, [h('strong', { key: 'title' }, t(step.key)), h('small', { key: 'detail' }, step.detail)]),
      ])))
    }

    function PathEvidence({ edge, relation, snapshot, t, onSurface }) {
      const matches = edge.kind === 'source'
        ? selectorLeaves(relation.condition).filter(item => item.selector.role === edge.role).flatMap(item => item.matches)
        : []
      const operations = edge.kind === 'target'
        ? relation.runs.flatMap(run => run.operations).filter(operation => operation.targetRole === edge.role)
        : []
      const targetSurface = edge.kind === 'target' ? snapshot.surfaces.find(surface => surface.surfaceId === edge.surfaceId) : undefined
      const refs = edge.kind === 'source' ? matches.map(match => match.ref) : operations.map(operation => operation.target).filter(Boolean)
      return h(DrawerSection, { title: t('pathDetails') }, [
        h('dl', { key: 'facts', className: 'pf-ws-path-facts' }, [
          h('div', { key: 'kind' }, [h('dt', { key: 'term' }, t(edge.kind)), h('dd', { key: 'value' }, edge.role)]),
          h('div', { key: 'surface' }, [h('dt', { key: 'term' }, 'Surface'), h('dd', { key: 'value' }, h('button', { type: 'button', onClick: () => onSurface(edge.surfaceId) }, surfaceTitle(snapshot, edge.surfaceId)))]),
          h('div', { key: 'state' }, [h('dt', { key: 'term' }, edge.kind === 'source' ? t('matchedStage') : t('emitStage')), h('dd', { key: 'value' }, edge.actual ? t('yes') : t('no'))]),
          targetSurface ? h('div', { key: 'publication' }, [h('dt', { key: 'term' }, t('publicationStage')), h('dd', { key: 'value', className: phaseTone(targetSurface.lifecycle.phase) }, `${phaseIcon(targetSurface.lifecycle.phase)} ${t(targetSurface.lifecycle.phase)}`)]) : null,
        ]),
        refs.length ? h('div', { key: 'refs', className: 'pf-ws-path-refs' }, [h('strong', { key: 'label' }, t('eventRefs')), ...refs.map(ref => h('code', { key: `${ref.subject}:${ref.seq}:${ref.id}`, title: ref.id }, `${shortId(ref.subject)}:${ref.seq}`))]) : h('p', { key: 'empty', className: 'pf-ws-muted' }, t('no')),
        targetSurface?.lifecycle.evidence?.length ? h('div', { key: 'event-evidence', className: 'pf-ws-event-evidence' }, [h('strong', { key: 'label' }, t('evidence')), ...targetSurface.lifecycle.evidence.map(item => h('span', { key: `${item.ref.subject}:${item.ref.seq}:${item.ref.id}` }, [h('code', { key: 'ref' }, `${shortId(item.ref.subject)}:${item.ref.seq}`), h('span', { key: 'name' }, item.name)]))]) : null,
      ])
    }

    function DrawerSection({ title, children }) { return h('section', { className: 'pf-ws-drawer-section' }, [h('h4', { key: 'title' }, title), h('div', { key: 'body' }, children)]) }
    function ConditionTree({ condition, t }) {
      if (condition.kind === 'event') return h(SelectorRow, { selector: condition.selector, matches: condition.matches, satisfied: condition.satisfied, t })
      if (condition.kind === 'count') return h('div', { className: 'pf-ws-condition-group' }, [h('strong', { key: 'op' }, `${t('count')} ${condition.operator} ${condition.value}`), h(SelectorRow, { key: 'selector', selector: condition.selector, matches: condition.matches, satisfied: condition.satisfied, t })])
      if (condition.kind === 'sequence') return h('div', { className: 'pf-ws-condition-group' }, [h('strong', { key: 'op' }, t('sequence')), ...condition.steps.map((step, index) => h(SelectorRow, { key: index, selector: step.selector, matches: step.match ? [step.match] : [], satisfied: Boolean(step.match), t }))])
      return h('div', { className: 'pf-ws-condition-group' }, [h('strong', { key: 'op' }, t(condition.kind)), ...condition.expressions.map((child, index) => h(ConditionTree, { key: index, condition: child, t }))])
    }
    function SelectorRow({ selector, matches, satisfied, t }) {
      const name = selector.event
      return h('div', { className: `pf-ws-selector ${satisfied ? 'received' : 'missing'}` }, [
        h('span', { key: 'icon', 'aria-hidden': 'true' }, satisfied ? '●' : '○'),
        h('div', { key: 'copy' }, [
          h('strong', { key: 'name' }, `${selector.role} · ${name}`),
          h('small', { key: 'state' }, satisfied ? `${matches.length} ${t('received')}` : t('missing')),
          matches.length ? h('div', { key: 'refs', className: 'pf-ws-refs' }, matches.map(match => h('code', { key: `${match.ref.subject}:${match.ref.seq}:${match.ref.id}` }, `${shortId(match.ref.subject)}:${match.ref.seq}`))) : null,
        ]),
      ])
    }
    function RunCard({ run, snapshot, t }) {
      return h('article', { className: `pf-ws-run ${run.status}` }, [
        h('header', { key: 'head' }, [h('code', { key: 'id' }, shortId(run.activation.id)), h('span', { key: 'status' }, run.status)]),
        run.handlerInvocations ? h('p', { key: 'handler', className: 'pf-ws-run-handler' }, `${t('handlerInvocations')}: ${run.handlerInvocations}`) : null,
        run.operations.length ? h('div', { key: 'ops', className: 'pf-ws-operations' }, run.operations.map(operation => h('div', { key: operation.operationKey }, [
          h('strong', { key: 'event' }, `${operation.targetRole} · ${operation.event.name}`),
          h('span', { key: 'status' }, operation.status),
          h('small', { key: 'surface' }, surfaceTitle(snapshot, operation.targetSubject.replace(/^surface:/, ''))),
          operation.target ? h('code', { key: 'target', title: operation.target.id }, `${shortId(operation.target.subject)}:${operation.target.seq}`) : null,
        ]))) : null,
        run.failures.length ? h('div', { key: 'failures', className: 'pf-ws-run-failures' }, [h('b', { key: 'label' }, t('failures')), ...run.failures.map((failure, index) => h('span', { key: index }, failure))]) : null,
      ])
    }

    function buildCodeFirstGraph(snapshot) {
      const registrations = [...(snapshot.codeFirst || [])].sort((a, b) => a.registrationId.localeCompare(b.registrationId))
      const graphNodes = [
        ...snapshot.surfaces.map(surface => ({ key: `surface:${surface.surfaceId}`, kind: 'surface', id: surface.surfaceId })),
        ...registrations.map(registration => ({ key: `registration:${registration.registrationId}`, kind: 'registration', id: registration.registrationId })),
      ]
      const rawEdges = []
      for (const registration of registrations) for (const route of Object.values(registration.routes)) for (const item of routeCapabilities(route, key => key)) {
        const surfaceId = registration.bindings[item.handle]
        if (!surfaceId) continue
        const incoming = item.key === 'consume'
        rawEdges.push({ from: incoming ? `surface:${surfaceId}` : `registration:${registration.registrationId}`, to: incoming ? `registration:${registration.registrationId}` : `surface:${surfaceId}` })
      }
      const positions = layoutDirectedGraph(graphNodes, rawEdges)
      const surfacePositions = new Map(snapshot.surfaces.map(surface => [surface.surfaceId, positions.get(`surface:${surface.surfaceId}`)]))
      const registrationPositions = new Map(registrations.map(registration => [registration.registrationId, positions.get(`registration:${registration.registrationId}`)]))
      const surfaces = snapshot.surfaces.map(surface => ({ surface, position: surfacePositions.get(surface.surfaceId), eventCount: snapshot.runtimeEvents?.[surface.surfaceId]?.length || 0 })).filter(item => item.position)
      const registrationNodes = registrations.map(registration => ({ registration, position: registrationPositions.get(registration.registrationId) }))
      const declaredByPair = new Map()
      for (const registration of registrations) {
        const registrationNode = { kind: 'registration', id: registration.registrationId, position: registrationPositions.get(registration.registrationId) }
        for (const [name, route] of Object.entries(registration.routes)) {
          for (const item of routeCapabilities(route, key => key)) {
            const surfaceId = registration.bindings[item.handle]
            const surfacePosition = surfacePositions.get(surfaceId)
            if (!surfacePosition) continue
            const incoming = item.key === 'consume'
            const from = incoming ? { kind: 'surface', id: surfaceId, position: surfacePosition } : registrationNode
            const to = incoming ? registrationNode : { kind: 'surface', id: surfaceId, position: surfacePosition }
            const key = `${registration.registrationId}:${from.kind}:${from.id}:${to.kind}:${to.id}`
            const existing = declaredByPair.get(key) || { key, registration, from, to, events: [], capabilities: [] }
            if (!existing.events.includes(name)) existing.events.push(name)
            if (!existing.capabilities.includes(item.key)) existing.capabilities.push(item.key)
            declaredByPair.set(key, existing)
          }
        }
      }
      const actualPaths = []
      for (const [surfaceId, events] of Object.entries(snapshot.runtimeEvents || {})) for (const event of events) {
        if (event.producer.kind !== 'orchestrate') continue
        const registrationId = event.producer.ref?.split('/')[0]
        if (!registrationId || !event.id) continue
        const registrationPosition = registrationPositions.get(registrationId)
        const target = surfacePositions.get(surfaceId)
        if (!registrationPosition || !target) continue
        const segments = []
        for (const cause of event.causes) {
          if (cause.source !== 'worksurface') continue
          const source = surfacePositions.get(cause.subject.id)
          if (source) segments.push({ from: { position: source }, to: { position: registrationPosition } })
        }
        segments.push({ from: { position: registrationPosition }, to: { position: target } })
        actualPaths.push({ key: `actual:${surfaceId}:${event.id}`, surfaceId, event, target, segments })
      }
      return { surfaces, registrations: registrationNodes, declaredPaths: [...declaredByPair.values()].sort((a, b) => a.key.localeCompare(b.key)), actualPaths }
    }
    function layoutDirectedGraph(nodes, edges) {
      const keys = new Set(nodes.map(node => node.key))
      const outgoing = new Map(nodes.map(node => [node.key, new Set()]))
      const indegree = new Map(nodes.map(node => [node.key, 0]))
      for (const edge of edges) {
        if (!keys.has(edge.from) || !keys.has(edge.to) || outgoing.get(edge.from).has(edge.to)) continue
        outgoing.get(edge.from).add(edge.to)
        indegree.set(edge.to, indegree.get(edge.to) + 1)
      }
      const level = new Map(nodes.map(node => [node.key, 0]))
      const queue = nodes.filter(node => indegree.get(node.key) === 0).map(node => node.key).sort()
      const visited = new Set()
      while (queue.length) {
        const key = queue.shift()
        visited.add(key)
        for (const target of outgoing.get(key)) {
          level.set(target, Math.max(level.get(target), level.get(key) + 1))
          indegree.set(target, indegree.get(target) - 1)
          if (indegree.get(target) === 0) { queue.push(target); queue.sort() }
        }
      }
      for (const node of nodes.filter(node => !visited.has(node.key))) level.set(node.key, node.kind === 'registration' ? 1 : 0)
      const columns = new Map()
      for (const node of nodes) {
        const value = level.get(node.key)
        if (!columns.has(value)) columns.set(value, [])
        columns.get(value).push(node)
      }
      const ordered = [...columns.entries()].sort(([a], [b]) => a - b)
      const positions = new Map()
      ordered.forEach(([_, entries], columnIndex) => {
        entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
        const x = ordered.length === 1 ? 600 : 150 + columnIndex * (900 / (ordered.length - 1))
        entries.forEach((node, index) => {
          const y = entries.length === 1 ? 360 : 110 + index * (500 / (entries.length - 1))
          positions.set(node.key, { x, y })
        })
      })
      return positions
    }
    function routeCapabilities(route, t) {
      return [
        ...(route.consumeFrom || []).map(handle => ({ key: 'consume', capability: t('consume'), handle })),
        ...(route.emitOn || []).map(handle => ({ key: 'emit', capability: t('emit'), handle })),
        ...(route.surfaceOutputFrom || []).map(handle => ({ key: 'surfaceOutput', capability: t('surfaceOutput'), handle })),
      ]
    }
    function lineCoordinates(path) { return { x1: path.from.position.x, y1: path.from.position.y, x2: path.to.position.x, y2: path.to.position.y } }
    function lineLabel(path) { return { x: path.from.position.x + (path.to.position.x - path.from.position.x) * .5, y: path.from.position.y + (path.to.position.y - path.from.position.y) * .5 - 8 } }
    function pathLabel(events) { return events.length <= 1 ? events[0] || '' : `${events[0]} +${events.length - 1}` }
    function factRow(term, value) { return h('div', { key: term }, [h('dt', { key: 'term' }, term), h('dd', { key: 'value' }, String(value))]) }
    function nodeTitle(snapshot, node) { return node.kind === 'surface' ? surfaceTitle(snapshot, node.id) : node.id }

    function buildGraph(snapshot) {
      const surfaces = [...snapshot.surfaces].sort((a, b) => a.surfaceId === snapshot.anchorSurfaceId ? -1 : b.surfaceId === snapshot.anchorSurfaceId ? 1 : a.surfaceId.localeCompare(b.surfaceId))
      const roles = new Map(surfaces.map(surface => [surface.surfaceId, new Set()]))
      for (const inspection of snapshot.orchestrations) for (const [role, id] of Object.entries(inspection.bindings)) roles.get(id)?.add(role)
      const layout = layoutSurfaces(surfaces, snapshot.view)
      const positions = layout.positions
      const center = { x: 600, y: 360 }
      const nodes = surfaces.map(surface => ({ surface, position: positions.get(surface.surfaceId), roles: [...(roles.get(surface.surfaceId) || [])].sort() }))
      const relations = []
      const edges = []
      let relationIndex = 0
      for (const inspection of snapshot.orchestrations) {
        for (const subscription of inspection.definition.subscriptions) {
          const condition = inspection.subscriptions.find(item => item.id === subscription.id)?.condition
          if (!condition) continue
          const sourceRoles = [...new Set(selectorLeaves(condition).map(item => item.selector.role).filter(role => role !== '$orchestration'))]
          const targetRoles = 'emit' in subscription.reaction ? [...new Set(subscription.reaction.emit.map(item => item.role))] : subscription.reaction.handler.emits
          const sourceIds = sourceRoles.map(role => inspection.bindings[role]).filter(Boolean)
          const targetIds = targetRoles.map(role => inspection.bindings[role]).filter(Boolean)
          const sourceCenter = average(sourceIds.map(id => positions.get(id)).filter(Boolean), center)
          const targetCenter = average(targetIds.map(id => positions.get(id)).filter(Boolean), center)
          const offset = ((relationIndex % 3) - 1) * 34
          const position = { x: (sourceCenter.x + targetCenter.x) / 2, y: (sourceCenter.y + targetCenter.y) / 2 + offset }
          const runs = inspection.runs.filter(run => run.activation.subscriptionId === subscription.id)
          const emitted = runs.some(run => run.operations.some(operation => operation.status === 'settled'))
          const failed = runs.some(run => run.failures.length > 0)
          const view = snapshot.view?.orchestrations?.[inspection.orchestrationId]
          const relation = {
            key: `${inspection.registrationId}:${subscription.id}`, inspection, subscription, condition, position, runs,
            sourceRoles, targetRoles,
            title: view?.subscriptions?.[subscription.id]?.title || subscription.id,
            symbol: gateSymbol(subscription), progress: conditionProgress(condition), tone: failed ? 'danger' : emitted ? 'positive' : condition.satisfied ? 'active' : 'neutral',
          }
          relations.push(relation)
          for (const role of sourceRoles) {
            const id = inspection.bindings[role]
            const node = positions.get(id)
            if (!node) continue
            const leaves = selectorLeaves(condition).filter(item => item.selector.role === role)
            const event = leaves[0]?.selector.event
            edges.push({ relation, kind: 'source', role, surfaceId: id, from: node, to: position, actual: leaves.some(item => item.matches.length > 0), eventLabel: leaves.flatMap(item => item.matches).length ? `${leaves.flatMap(item => item.matches).length} ${event || ''}` : '' })
          }
          for (const role of targetRoles) {
            const id = inspection.bindings[role]
            const node = positions.get(id)
            if (!node) continue
            const operation = runs.flatMap(run => run.operations).find(item => item.targetRole === role && item.status === 'settled')
            edges.push({ relation, kind: 'target', role, surfaceId: id, from: position, to: node, actual: Boolean(operation), eventLabel: operation?.event.name || '' })
          }
          relationIndex += 1
        }
      }
      return { groups: layout.groups, nodes, relations, edges }
    }
    function layoutSurfaces(surfaces, view) {
      const configured = view?.layout?.groups || []
      const groupTitles = new Map(configured.map(group => [group.id, group.title]))
      const configuredMembership = new Map(configured.flatMap(group => group.surfaces.map(surfaceId => [surfaceId, group.id])))
      const grouped = new Map()
      for (const surface of surfaces) {
        const groupId = surface.group || configuredMembership.get(surface.surfaceId) || '__ungrouped'
        if (!grouped.has(groupId)) grouped.set(groupId, [])
        grouped.get(groupId).push(surface)
      }
      const configuredOrder = configured.map(group => group.id).filter(id => grouped.has(id))
      const remaining = [...grouped.keys()].filter(id => !configuredOrder.includes(id)).sort((a, b) => a === '__ungrouped' ? 1 : b === '__ungrouped' ? -1 : a.localeCompare(b))
      const entries = [...configuredOrder, ...remaining].map(id => ({ id, title: groupTitles.get(id) || (id === '__ungrouped' ? '' : id), surfaces: grouped.get(id) }))
      const count = Math.max(1, entries.length)
      const columns = count === 1 ? 1 : Math.min(3, count)
      const rows = Math.ceil(count / columns)
      const gap = 24
      const marginX = 34
      const marginY = 34
      const width = (1200 - marginX * 2 - gap * (columns - 1)) / columns
      const height = (720 - marginY * 2 - gap * (rows - 1)) / rows
      const positions = new Map()
      const groups = []
      entries.forEach((entry, index) => {
        const column = index % columns
        const row = Math.floor(index / columns)
        const area = { x: marginX + column * (width + gap), y: marginY + row * (height + gap), width, height }
        if (entry.id !== '__ungrouped' || entries.length > 1) groups.push({ id: entry.id, title: entry.title || 'Ungrouped', area })
        const innerTop = area.y + (groups.some(group => group.id === entry.id) ? 42 : 12)
        const innerHeight = area.height - (innerTop - area.y) - 12
        const nodeColumns = Math.max(1, Math.min(entry.surfaces.length, Math.floor((area.width - 24) / 246)))
        const nodeRows = Math.ceil(entry.surfaces.length / nodeColumns)
        entry.surfaces.forEach((surface, surfaceIndex) => {
          const nodeColumn = surfaceIndex % nodeColumns
          const nodeRow = Math.floor(surfaceIndex / nodeColumns)
          positions.set(surface.surfaceId, {
            x: area.x + area.width * (nodeColumn + .5) / nodeColumns,
            y: innerTop + innerHeight * (nodeRow + .5) / nodeRows,
          })
        })
      })
      return { positions, groups }
    }
    function selectorLeaves(condition) {
      if (condition.kind === 'event') return [{ selector: condition.selector, matches: condition.matches }]
      if (condition.kind === 'count') return [{ selector: condition.selector, matches: condition.matches }]
      if (condition.kind === 'sequence') return condition.steps.map(step => ({ selector: step.selector, matches: step.match ? [step.match] : [] }))
      return condition.expressions.flatMap(selectorLeaves)
    }
    function conditionProgress(condition) {
      if (condition.kind === 'event') return `${condition.matches.length ? 1 : 0}/1`
      if (condition.kind === 'count') return `${condition.matches.length}/${condition.value}`
      if (condition.kind === 'sequence') return `${condition.steps.filter(step => step.match).length}/${condition.steps.length}`
      const leaves = selectorLeaves(condition)
      return `${leaves.filter(item => item.matches.length > 0).length}/${leaves.length}`
    }
    function gateSymbol(subscription) {
      if ('handler' in subscription.reaction) return '{}'
      if ('count' in subscription.when) return `${{ eq: '=', gte: '≥', lte: '≤' }[subscription.when.count.operator]}${subscription.when.count.value}`
      return 'all' in subscription.when ? '∧' : 'any' in subscription.when ? '∨' : 'sequence' in subscription.when ? '→' : '●'
    }
    function average(points, fallback) { if (!points.length) return fallback; return { x: points.reduce((sum, item) => sum + item.x, 0) / points.length, y: points.reduce((sum, item) => sum + item.y, 0) / points.length } }
    function phaseIcon(phase) { return phase === 'completed' || phase === 'published' ? '✓' : phase === 'failed' || phase === 'conflicted' ? '×' : phase === 'waiting-user' ? '?' : '○' }
    function phaseTone(phase) { return phase === 'completed' || phase === 'published' ? 'positive' : phase === 'failed' || phase === 'conflicted' ? 'danger' : phase === 'waiting-user' ? 'attention' : 'neutral' }
    function strongestPhase(phases) {
      const order = ['idle', 'published', 'completed', 'waiting-user', 'conflicted', 'failed']
      return phases.reduce((strongest, phase) => order.indexOf(phase) > order.indexOf(strongest) ? phase : strongest, 'idle')
    }
    function waitForSession(sessions, sessionId) {
      if (sessions.list.getSnapshot().byId[sessionId]) return Promise.resolve()
      return new Promise((resolve, reject) => {
        let unsubscribe = () => {}
        const timer = window.setTimeout(() => { unsubscribe(); reject(new Error(`DSH Session ${sessionId} was not published`)) }, 5000)
        unsubscribe = sessions.list.subscribe(() => {
          if (!sessions.list.getSnapshot().byId[sessionId]) return
          window.clearTimeout(timer)
          unsubscribe()
          resolve()
        })
      })
    }
    function surfaceTitle(snapshot, id) { return snapshot.surfaces.find(surface => surface.surfaceId === id)?.title || shortId(id) }
    function shortId(value) { const text = String(value); return text.length <= 20 ? text : `${text.slice(0, 9)}…${text.slice(-6)}` }
    function shortRevision(value) { const text = String(value); return text.startsWith('sha256:') ? `sha256:${text.slice(7, 15)}…` : shortId(text) }
    function resolveSelection(previous, snapshot) {
      if (!previous) return null
      if (previous.scope === 'code-first') {
        if (previous.type === 'surface') return snapshot.surfaces.some(item => item.surfaceId === previous.surfaceId) ? previous : null
        if (previous.type === 'registration') return snapshot.codeFirst?.some(item => item.registrationId === previous.registrationId) ? previous : null
        if (previous.type === 'actual-event') return snapshot.runtimeEvents?.[previous.surfaceId]?.some(item => item.id === previous.eventId) ? previous : null
        if (previous.type === 'declared-path') return buildCodeFirstGraph(snapshot).declaredPaths.some(item => item.key === previous.key) ? previous : null
        return null
      }
      const model = buildGraph(snapshot)
      const relation = model.relations.find(item => item.key === previous.relation.key)
      if (!relation) return null
      if (previous.type === 'condition') return { scope: 'legacy', type: 'condition', relation }
      const edge = model.edges.find(item => item.relation.key === relation.key && item.kind === previous.edge.kind && item.role === previous.edge.role && item.surfaceId === previous.edge.surfaceId)
      return edge ? { scope: 'legacy', type: 'path', relation, edge } : null
    }

    const module = { exports: {} }
    module.exports.inject = ['slots', 'locale', 'sessions']
    module.exports.apply = ctx => {
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'worksurface-topology: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.effect(() => {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = '/worksurface-map/styles.css'
        link.dataset.plugin = 'worksurface-topology'
        document.head.append(link)
        return () => link.remove()
      }, 'worksurface-topology: styles')
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view', id: 'worksurface-topology', order: 20, locale: NS, label: () => t('view'),
        inject: () => ({ ctx }),
      }, TopologyView))
    }
    return module.exports
  },
})
