import { BlockId, SurfaceId } from '@pf-worksurface/core'
import type { Revision, WorkSurfaceProjectionSnapshot } from '@pf-worksurface/core'
import { describe, expect, it } from 'vitest'
import { AGENT_OUTPUT_SCHEMA, childPersona } from '../src/model/child-agent.ts'
import { renderFileProjection } from '../src/model/file-projection.ts'
import { worksurfaceGuidance } from '../src/model/guidance.ts'
import { ORCHESTRATOR_OUTPUT, ORCHESTRATOR_TOOL_SURFACE } from '../src/model/orchestrator-tool.ts'
import { SESSION_ROOT_TEMPLATE } from '../src/model/session-root-template.ts'

const revision = `sha256:${'a'.repeat(64)}` as Revision

describe('model-aware WorkSurface contract', () => {
  it('tells the parent Agent when and how to use the WorkSurface tool', () => {
    const guidance = worksurfaceGuidance()
    expect(guidance).toContain('Use it proactively without waiting for the user to name it')
    expect(guidance).toContain('Skip it for simple questions and bounded one-step changes')
    expect(guidance).toContain('Before delegating, initialize the root with the goal')
    expect(guidance).toContain('b2f paths under work/ are routed to a prepared root checkout at work/root')
    expect(guidance).toContain('ordinary source paths stay in the Session workspace')
    expect(guidance).toContain('published to the canonical Surface before same-message tools run')
    expect(guidance).toContain('run_orchestrator')
    expect(guidance).toContain('ws --help')
    expect(guidance).toContain('ws help init')
    expect(guidance).toContain('Canonical files are Host-only')
  })

  it('renders complete writable files with parent paths and safe fences', () => {
    const projection: WorkSurfaceProjectionSnapshot = {
      surfaceId: SurfaceId('ws-root'),
      surfaceRevision: revision,
      blockRevisions: [{ surface: SurfaceId('ws-root'), block: BlockId('design'), revision }],
      files: [
        {
          kind: 'surface',
          surfaceId: SurfaceId('ws-root'),
          revision,
          relativePath: 'surface.md',
          content: '# Goal\n\n[[block:ws-root/design]]\n',
          writable: true,
        },
        {
          kind: 'block',
          surfaceId: SurfaceId('ws-root'),
          blockId: BlockId('design'),
          revision,
          relativePath: 'blocks/design.md',
          content: 'A nested ``` fence remains content.\n',
          writable: true,
        },
      ],
      omittedFiles: [],
      budgetExceeded: false,
      profile: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    const rendered = renderFileProjection(projection, { writablePathPrefix: '/work/root/' })

    expect(rendered).toContain('PF WorkSurface Projection')
    expect(rendered).toContain('Surface: ws-root')
    expect(rendered).toContain(`Revision: ${revision}`)
    expect(rendered).toContain('work/root/surface.md')
    expect(rendered).toContain('work/root/blocks/design.md')
    expect(rendered).toContain('````markdown file=work/root/blocks/design.md')
    expect(rendered).toContain('[[block:ws-root/design]]')
    expect(rendered).not.toContain('worksurface:block')
  })

  it('renders cross-Surface files without a writable file attribute and reports omissions', () => {
    const projection: WorkSurfaceProjectionSnapshot = {
      surfaceId: SurfaceId('ws-root'),
      surfaceRevision: revision,
      blockRevisions: [{ surface: SurfaceId('ws-source'), block: BlockId('evidence'), revision }],
      files: [
        {
          kind: 'surface',
          surfaceId: SurfaceId('ws-root'),
          revision,
          relativePath: 'surface.md',
          content: '# Root\n',
          writable: true,
        },
        {
          kind: 'block',
          surfaceId: SurfaceId('ws-source'),
          blockId: BlockId('evidence'),
          revision,
          relativePath: 'blocks/evidence.md',
          content: 'Pinned evidence\n',
          writable: false,
        },
      ],
      omittedFiles: [{
        kind: 'block',
        surfaceId: SurfaceId('ws-root'),
        blockId: BlockId('large'),
        revision,
        relativePath: 'blocks/large.md',
        writable: true,
        reason: 'token-budget',
      }],
      budgetExceeded: true,
      profile: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    const rendered = renderFileProjection(projection)

    expect(rendered).toContain(`ws-source/blocks/evidence.md: ${revision} (read-only)`)
    expect(rendered).toContain('Read-only file ws-source/blocks/evidence.md')
    expect(rendered).not.toContain('file=blocks/evidence.md')
    expect(rendered).toContain(`blocks/large.md: ${revision} (omitted: token budget)`)
    expect(rendered).toContain('complete surface.md exceeds the requested Projection budget')
  })

  it('keeps the session root template aligned with the initialization workflow', () => {
    for (const heading of [
      '# Goal',
      '# Acceptance Criteria',
      '# Known Facts and Constraints',
      '# Assumptions',
      '# Open Questions',
      '# Current Decisions',
      '# Deliverables and Evidence',
    ]) {
      expect(SESSION_ROOT_TEMPLATE).toContain(heading)
    }
  })

  it('exposes a complete run_orchestrator tool surface to the model', () => {
    expect(ORCHESTRATOR_TOOL_SURFACE.name).toBe('run_orchestrator')
    expect(ORCHESTRATOR_TOOL_SURFACE.description).toContain('complex, multi-stage work')
    expect(ORCHESTRATOR_TOOL_SURFACE.description).toContain('skip simple questions')
    expect(ORCHESTRATOR_TOOL_SURFACE.parameters.language.enum).toEqual(['bash', 'python'])
    expect(ORCHESTRATOR_TOOL_SURFACE.parameters.script.description).toContain('WS_ROOT_SURFACE')
    expect(ORCHESTRATOR_TOOL_SURFACE.parameters.script.description).toContain('WS_WORKING_SURFACE')
    expect(ORCHESTRATOR_TOOL_SURFACE.parameters.script.description).toContain('WS_BASE_REVISION')
    expect(ORCHESTRATOR_TOOL_SURFACE.parameters.script.description).toContain('ws help init supplies authoring guidance')
    expect(ORCHESTRATOR_TOOL_SURFACE.parameters.rootSurface.description).toContain('session root')

    const schema = ORCHESTRATOR_OUTPUT.schema
    expect(schema.properties).toMatchObject({
      attemptId: { required: true },
      rootSurface: { required: true },
      codeHash: { required: true },
      workspaceHash: { required: true },
      exitCode: { required: true },
      signal: { required: true },
      stdout: { required: true },
      stderr: { required: true },
      replayCount: { required: true },
      rootRevision: { required: true },
    })
  })

  it('tells the child Agent where to commit and exactly what to return', () => {
    const persona = childPersona(
      { name: 'test', provider: 'spawn', tokenBudget: 1000, maxDepth: 1, maxParallel: 1, persona: 'Profile persona.' },
      SurfaceId('ws-child'),
      'Projection body',
      `sha256:${'b'.repeat(64)}` as Revision,
      '/tmp/work/child',
    )
    expect(persona).toContain('Profile persona.')
    expect(persona).toContain('Assigned WorkSurface: ws-child')
    expect(persona).toContain('Projection body')
    expect(persona).toContain('/tmp/work/child')
    expect(persona).toContain('checkout and b2f root')
    expect(persona).toContain('surface.md and blocks/<block-id>.md')
    expect(persona).toContain('sha256:')
    expect(persona).toContain('Use the ws CLI to commit it with that exact --base revision')
    expect(persona).toContain('surface, surfaceRevision, summary, and non-empty outputs')
    expect(persona).toContain('Every output must name a committed Block')

    expect(AGENT_OUTPUT_SCHEMA.required).toEqual(['surface', 'surfaceRevision', 'summary', 'outputs'])
    const output = AGENT_OUTPUT_SCHEMA.properties.outputs as {
      items: { required: readonly string[]; properties: Record<string, unknown> }
    }
    expect(output.items.required).toEqual(['surface', 'block', 'revision'])
    expect(Object.keys(output.items.properties).sort()).toEqual(['block', 'revision', 'surface'])
  })
})
