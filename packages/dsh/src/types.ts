import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BlockRef, Revision, SurfaceIdType } from '@pf-worksurface/core'

/** A named child-Agent execution policy. */
export interface WorkSurfaceProfile {
  readonly name: string
  readonly provider: string
  readonly tokenBudget: number
  readonly maxDepth: number
  readonly maxParallel: number
  readonly toolAllow?: readonly string[]
  readonly persona?: string
  readonly agentProvider?: string
  readonly agentModel?: string
}

/** Fully materialized plugin configuration. */
export interface WorkSurfaceConfig {
  readonly root: string
  readonly attemptsRoot: string
  readonly socketPath: string
  readonly cliEntrypoint: string
  readonly orchestratorGraceMs: number
  readonly maxOutputBytes: number
  readonly maxCrashReplays: number
  readonly profiles: readonly WorkSurfaceProfile[]
}

/** Structured completion contract required from every child Agent. */
export interface AgentCompletion {
  readonly surface: string
  readonly surfaceRevision: Revision
  readonly summary: string
  readonly outputs: readonly BlockRef[]
}

/** Runtime-owned result of one completed child delegation. */
export type AgentRunResult = AgentCompletion

/** One live Orchestrator authority scope. */
export interface AttemptAuthority {
  readonly id: string
  readonly token: string
  readonly rootSurface: SurfaceIdType
  readonly root: string
  readonly parent: Agent
  readonly surfaces: Set<SurfaceIdType>
  readonly childCredentials: Map<string, ChildCredential>
  readonly operations: Set<Promise<unknown>>
  activeAgents: number
}

/** Least-authority credential exposed only to one child Agent. */
export interface ChildCredential {
  readonly attemptId: string
  readonly token: string
  readonly surface: SurfaceIdType
  readonly workingPath: string
}

/** Persisted outcome of one Orchestrator subprocess. */
export interface OrchestratorResult {
  readonly attemptId: string
  readonly rootSurface: SurfaceIdType
  readonly codeHash: string
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly replayCount: number
  readonly rootRevision: Revision
}
