// Invariant assertion: [WS-27]
import { readFile } from 'node:fs/promises'
import { helpFor } from '@pf-worksurface/cli'
import { describe, expect, it } from 'vitest'
// @ts-expect-error executable matrix validator has no declarations
import { checkGeneratedReadinessDocument, renderModelReadinessMarkdown, validateModelReadiness } from '../evals/model-readiness-matrix.mjs'
import { WORKSURFACE_GLOBAL_INSTRUCTIONS } from '../src/model/global-instructions.ts'
import { workSurfaceInstructions } from '../src/model/session-instructions.ts'

interface ReadinessQuestion {
  readonly id: string
  readonly question: string
  readonly mustDemonstrate: string
  readonly requirements: readonly {
    readonly id: string
    readonly layer: string
    readonly observable: string
    readonly evidence: readonly string[]
  }[]
}

describe('WorkSurface Agent readiness questions', () => {
  it('keeps a valid evidence matrix for seven direct Agent questions', async () => {
    const suite = JSON.parse(await readFile(new URL('../evals/model-readiness.json', import.meta.url), 'utf8')) as {
      version: number
      layers: unknown[]
      evidence: unknown[]
      cases: ReadinessQuestion[]
    }
    expect(suite.version).toBe(2)
    expect(validateModelReadiness(suite)).toEqual([])
    expect(suite.cases.map(item => item.id)).toEqual([
      'capability-fit',
      'first-surface',
      'turn-entry',
      'decomposition',
      'surface-authoring',
      'coordination',
      'authorized-output',
    ])
    for (const item of suite.cases) {
      expect(item.question).toContain('?')
      expect(item.mustDemonstrate.length).toBeGreaterThan(30)
      expect(item.question).not.toMatch(/authority|namespace|digest|ledger|CAS|socket|capability/)
      const layers = new Set(item.requirements.map(requirement => requirement.layer))
      expect(layers.has('L0')).toBe(true)
      expect(layers.has('L3')).toBe(true)
    }
    const document = renderModelReadinessMarkdown(suite)
    expect(document).toContain('| 用例 | L0 | L1 | L2 | L3 | 当前结论 |')
    expect(document).toContain('| first-surface |')
    expect(document).toContain('BLOCKED')
    expect(await checkGeneratedReadinessDocument(suite)).toBe(true)

    const lowerLayerSubstitution = structuredClone(suite) as any
    lowerLayerSubstitution.cases[0].requirements.find((item: { id: string }) => item.id === 'agent-choice').evidence = ['global-guidance-l0']
    expect(validateModelReadiness(lowerLayerSubstitution)).toContain(
      'case capability-fit requirement agent-choice cannot use L0 evidence global-guidance-l0 for L3',
    )
  })

  it('backs every expected answer with delivered model context rather than design-only documentation', () => {
    const session = workSurfaceInstructions('readiness-surface').content
      .map(block => block.type === 'text' ? block.text : '')
      .join('\n')
    const delivered = [
      WORKSURFACE_GLOBAL_INSTRUCTIONS,
      session,
      helpFor('author'),
      helpFor('coordinate'),
      helpFor('emit'),
      helpFor('recover'),
    ].join('\n')
    for (const signal of [
      'independently assessable Surfaces',
      'ordinary DSH Session',
      'starting a first Surface from an ordinary Agent Session',
      'DSH_WORKSURFACE_ROOT/surfaces/<surface-id>',
      '# Acceptance Criteria',
      'orchestrations/<orchestration-id>/artifact/',
      'registration.json beside artifact/',
      'turn-brief.json',
      'command.argv as argv exactly',
      'They are not WorkSurface domain Events',
    ]) expect(delivered).toContain(signal)
  })
})
