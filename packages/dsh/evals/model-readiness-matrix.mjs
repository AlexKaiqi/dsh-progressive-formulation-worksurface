import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WORKSPACE_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
export const READINESS_SOURCE = fileURLToPath(new URL('./model-readiness.json', import.meta.url))
export const READINESS_DOCUMENT = resolve(WORKSPACE_ROOT, 'docs/model-readiness-coverage.md')

const REQUIRED_CASES = [
  'concept-boundaries',
  'capability-fit',
  'first-surface',
  'turn-entry',
  'decomposition',
  'surface-authoring',
  'coordination',
  'authorized-output',
]
const REQUIRED_LAYERS = ['L0', 'L1', 'L2', 'L3']
const PROFILE_STATUSES = ['passed', 'failed', 'blocked']

export async function loadModelReadiness() {
  return JSON.parse(await readFile(READINESS_SOURCE, 'utf8'))
}

export function validateModelReadiness(matrix, workspaceRoot = WORKSPACE_ROOT) {
  const errors = []
  if (matrix?.version !== 2) errors.push('model readiness version must be 2')
  if (!Array.isArray(matrix?.layers)) errors.push('model readiness layers must be an array')
  if (!Array.isArray(matrix?.evidence)) errors.push('model readiness evidence must be an array')
  if (!Array.isArray(matrix?.cases)) errors.push('model readiness cases must be an array')
  if (errors.length) return errors

  const layerIds = matrix.layers.map(layer => layer?.id)
  if (JSON.stringify(layerIds) !== JSON.stringify(REQUIRED_LAYERS)) {
    errors.push(`layers must be ${REQUIRED_LAYERS.join(', ')} in order`)
  }
  for (const layer of matrix.layers) {
    if (typeof layer?.name !== 'string' || typeof layer?.proves !== 'string') {
      errors.push(`layer ${String(layer?.id)} lacks name or proves`)
    }
  }

  const evidenceById = new Map()
  for (const item of matrix.evidence) {
    const label = `evidence ${String(item?.id)}`
    if (typeof item?.id !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(item.id)) {
      errors.push(`${label} has an invalid id`)
      continue
    }
    if (evidenceById.has(item.id)) errors.push(`duplicate evidence ${item.id}`)
    evidenceById.set(item.id, item)
    if (!REQUIRED_LAYERS.includes(item.layer)) errors.push(`${label} has invalid layer ${String(item.layer)}`)
    if (!['automated-test', 'profile-run'].includes(item.kind)) errors.push(`${label} has invalid kind ${String(item.kind)}`)
    if (typeof item.file !== 'string' || item.file.startsWith('/') || item.file.split('/').includes('..')) {
      errors.push(`${label} must reference a workspace-relative file`)
      continue
    }
    const file = resolve(workspaceRoot, item.file)
    if (!existsSync(file)) {
      errors.push(`${label} references missing file ${item.file}`)
      continue
    }
    if (typeof item.marker !== 'string' || !readFileSync(file, 'utf8').includes(item.marker)) {
      errors.push(`${label} marker is absent from ${item.file}`)
    }
    if (typeof item.proves !== 'string' || item.proves.length < 30) errors.push(`${label} lacks a concrete proves statement`)
    if (item.kind === 'automated-test') {
      if (!item.file.includes('/tests/')) errors.push(`${label} automated evidence must reference a tests/ file`)
      if (item.status !== undefined || item.blocker !== undefined) errors.push(`${label} automated status comes from the test run, not the matrix`)
    }
    if (item.kind === 'profile-run') {
      if (item.layer !== 'L3') errors.push(`${label} profile-run evidence must be L3`)
      if (!PROFILE_STATUSES.includes(item.status)) errors.push(`${label} profile-run requires passed, failed, or blocked status`)
      if (item.status === 'blocked' && (typeof item.blocker !== 'string' || item.blocker.length < 20)) {
        errors.push(`${label} blocked profile-run requires a concrete blocker`)
      }
    }
  }

  const caseIds = matrix.cases.map(item => item?.id)
  if (JSON.stringify(caseIds) !== JSON.stringify(REQUIRED_CASES)) {
    errors.push(`cases must be ${REQUIRED_CASES.join(', ')} in order`)
  }
  const referencedEvidence = new Set()
  for (const item of matrix.cases) {
    const label = `case ${String(item?.id)}`
    if (typeof item?.question !== 'string' || !item.question.includes('?')) errors.push(`${label} lacks a direct question`)
    if (typeof item?.mustDemonstrate !== 'string' || item.mustDemonstrate.length < 30) errors.push(`${label} lacks mustDemonstrate`)
    if (!Array.isArray(item?.expectedSignals) || item.expectedSignals.length < 2 || item.expectedSignals.some(signal => typeof signal !== 'string' || signal.length < 12)) {
      errors.push(`${label} must declare at least two semantic expectedSignals`)
    }
    if (!Array.isArray(item?.requirements) || item.requirements.length === 0) {
      errors.push(`${label} lacks requirements`)
      continue
    }
    const requirementIds = new Set()
    const coveredLayers = new Set()
    for (const requirement of item.requirements) {
      const requirementLabel = `${label} requirement ${String(requirement?.id)}`
      if (typeof requirement?.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(requirement.id)) {
        errors.push(`${requirementLabel} has an invalid id`)
      } else if (requirementIds.has(requirement.id)) {
        errors.push(`${label} has duplicate requirement ${requirement.id}`)
      } else {
        requirementIds.add(requirement.id)
      }
      if (!REQUIRED_LAYERS.includes(requirement?.layer)) errors.push(`${requirementLabel} has invalid layer`)
      else coveredLayers.add(requirement.layer)
      if (typeof requirement?.observable !== 'string' || requirement.observable.length < 30) {
        errors.push(`${requirementLabel} lacks a concrete observable`)
      }
      if (!Array.isArray(requirement?.evidence) || requirement.evidence.length === 0) {
        errors.push(`${requirementLabel} lacks evidence`)
        continue
      }
      for (const evidenceId of requirement.evidence) {
        const evidence = evidenceById.get(evidenceId)
        if (evidence === undefined) errors.push(`${requirementLabel} references unknown evidence ${String(evidenceId)}`)
        else if (evidence.layer !== requirement.layer) {
          errors.push(`${requirementLabel} cannot use ${evidence.layer} evidence ${evidenceId} for ${requirement.layer}`)
        } else {
          referencedEvidence.add(evidenceId)
        }
      }
    }
    if (!coveredLayers.has('L0')) errors.push(`${label} must prove delivered model knowledge at L0`)
    if (!coveredLayers.has('L3')) errors.push(`${label} must expose real Agent behavior status at L3`)
  }
  for (const evidenceId of evidenceById.keys()) {
    if (!referencedEvidence.has(evidenceId)) errors.push(`unreferenced evidence ${evidenceId}`)
  }
  return errors
}

export function automatedEvidenceFiles(matrix) {
  return [...new Set(matrix.evidence
    .filter(item => item.kind === 'automated-test')
    .map(item => item.file))]
}

export function renderModelReadinessMarkdown(matrix) {
  const evidenceById = new Map(matrix.evidence.map(item => [item.id, item]))
  const lines = [
    '# WorkSurface 模型用例覆盖矩阵',
    '',
    '<!-- Generated by packages/dsh/evals/model-readiness-matrix.mjs. Do not edit directly. -->',
    '',
    '唯一事实源：[model-readiness.json](../packages/dsh/evals/model-readiness.json)。本页只投影用例、层级、可观察要求与证据；修改矩阵后运行 `node packages/dsh/evals/model-readiness-matrix.mjs --write`。',
    '',
    '## 证据层级',
    '',
    '| 层级 | 名称 | 能证明什么 |',
    '| --- | --- | --- |',
    ...matrix.layers.map(layer => `| ${layer.id} | ${escapeCell(layer.name)} | ${escapeCell(layer.proves)} |`),
    '',
    '低层证据不能替代高层证据。`CI` 表示证据文件被 eval 门禁执行；`BLOCKED` 或 `FAILED` 表示真实 profile 证据没有通过。',
    '',
    '## 覆盖矩阵',
    '',
    '| 用例 | L0 | L1 | L2 | L3 | 当前结论 |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  for (const item of matrix.cases) {
    const cells = REQUIRED_LAYERS.map(layer => renderLayerCell(item, layer, evidenceById))
    const conclusion = caseConclusion(item, evidenceById)
    lines.push(`| ${escapeCell(item.id)} | ${cells.join(' | ')} | ${conclusion} |`)
  }
  lines.push('', '## 用例与可观察要求', '')
  for (const item of matrix.cases) {
    lines.push(`### ${item.id}`, '', `> ${item.question}`, '', `通过标准：${item.mustDemonstrate}`, '', `预期语义信号：${item.expectedSignals.join('；')}`, '')
    for (const requirement of item.requirements) {
      lines.push(`- **${requirement.layer} · ${requirement.id}**：${requirement.observable} 证据：${requirement.evidence.map(id => `\`${id}\``).join('、')}`)
    }
    lines.push('')
  }
  lines.push('## 证据登记', '', '| Evidence ID | 层级 | 类型/状态 | 文件 | 能证明什么 |', '| --- | --- | --- | --- | --- |')
  for (const item of matrix.evidence) {
    const state = item.kind === 'automated-test' ? 'automated-test / CI' : `profile-run / ${item.status.toUpperCase()}`
    const link = `../${item.file}`
    lines.push(`| ${item.id} | ${item.layer} | ${state} | [${escapeCell(item.file)}](${link}) | ${escapeCell(item.proves)} |`)
    if (item.status === 'blocked') lines.push(`| ↳ blocker | ${item.layer} | BLOCKED | — | ${escapeCell(item.blocker)} |`)
  }
  return `${lines.join('\n')}\n`
}

export async function checkGeneratedReadinessDocument(matrix) {
  const expected = renderModelReadinessMarkdown(matrix)
  const actual = existsSync(READINESS_DOCUMENT) ? await readFile(READINESS_DOCUMENT, 'utf8') : ''
  return actual === expected
}

function renderLayerCell(item, layer, evidenceById) {
  const requirements = item.requirements.filter(requirement => requirement.layer === layer)
  if (requirements.length === 0) return '—'
  return requirements.map(requirement => {
    const evidence = requirement.evidence.map(id => evidenceById.get(id))
    const status = aggregateStatus(evidence)
    const label = status === 'ci' ? 'CI' : status.toUpperCase()
    return `${label} \`${escapeCell(requirement.id)}\``
  }).join('<br>')
}

function caseConclusion(item, evidenceById) {
  const statuses = item.requirements.map(requirement => aggregateStatus(requirement.evidence.map(id => evidenceById.get(id))))
  if (statuses.includes('failed')) return 'FAILED'
  if (statuses.includes('blocked')) return 'BLOCKED'
  return 'COVERED'
}

function aggregateStatus(evidence) {
  const statuses = evidence.map(item => item.kind === 'automated-test' ? 'ci' : item.status)
  if (statuses.includes('failed')) return 'failed'
  if (statuses.includes('blocked')) return 'blocked'
  if (statuses.includes('passed')) return 'passed'
  return 'ci'
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

async function main() {
  const matrix = await loadModelReadiness()
  const errors = validateModelReadiness(matrix)
  if (errors.length) {
    errors.forEach(error => console.error(error))
    process.exitCode = 1
    return
  }
  const output = renderModelReadinessMarkdown(matrix)
  if (process.argv.includes('--write')) {
    await writeFile(READINESS_DOCUMENT, output)
    process.stdout.write(`${relative(WORKSPACE_ROOT, READINESS_DOCUMENT)} updated\n`)
    return
  }
  if (process.argv.includes('--check')) {
    if (!await checkGeneratedReadinessDocument(matrix)) {
      console.error(`${relative(WORKSPACE_ROOT, READINESS_DOCUMENT)} is stale; run model-readiness-matrix.mjs --write`)
      process.exitCode = 1
    }
    return
  }
  process.stdout.write(output)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
