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
  readonly attemptRetention: number
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
  /** Host-private attempt state; never returned as a b2f or sandbox root. */
  readonly root: string
  /** Model-writable workspace shared by b2f and the Orchestrator sandbox. */
  readonly workspaceRoot: string
  /** Durable session Surface represented by the prepared root checkout. */
  readonly workspaceSurface: SurfaceIdType
  /** Prepared checkout of the calling session's durable root Surface. */
  readonly rootWorkingPath: string
  /** Commit base for the prepared root checkout. */
  readonly rootBaseRevision: Revision
  /** Hash of every public workspace entry before the Orchestrator starts. */
  readonly workspaceHash: string
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
  readonly baseRevision: Revision
  /** Session attachment must settle before any child Host operation executes. */
  readonly ready: Promise<unknown>
}

/** Parent workspace prepared before one model step and later claimed by an Orchestrator. */
export interface PendingWorkspace {
  readonly ownerId: string
  /** Host-private root containing control/runtime state and the public workspace. */
  readonly root: string
  /** Only this subtree is writable through b2f and the Orchestrator sandbox. */
  readonly workspaceRoot: string
  readonly rootSurface: SurfaceIdType
  readonly rootWorkingPath: string
  readonly rootBaseRevision: Revision
}

/** Persisted outcome of one Orchestrator subprocess. */
export interface OrchestratorResult {
  readonly attemptId: string
  readonly rootSurface: SurfaceIdType
  readonly codeHash: string
  readonly workspaceHash: string
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly replayCount: number
  readonly rootRevision: Revision
}
