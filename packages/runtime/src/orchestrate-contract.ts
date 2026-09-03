import type {
  OrchestrateInputRecord,
  OrchestrateRegistrationRecord,
  OrchestrateResult,
  Revision,
  RuntimeEventContract,
} from '@pf-worksurface/core'

/** Host-independent execution contract for the code that advances a run. */
export interface OrchestrateCodeRunInput {
  readonly registration: OrchestrateRegistrationRecord
  readonly triggerInputSeq: number
  readonly inputs: readonly OrchestrateInputRecord[]
  readonly baseRevisions: Readonly<Record<string, Revision>>
  readonly contracts: Readonly<Record<string, RuntimeEventContract>>
}

export interface OrchestrateCodeRunOutput {
  readonly runId: string
  readonly result: OrchestrateResult
  readonly candidates: Readonly<Record<string, Revision>>
}

export interface OrchestrateCodeRunner {
  run(input: OrchestrateCodeRunInput): Promise<OrchestrateCodeRunOutput>
}
