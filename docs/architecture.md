# WorkSurface 实现索引

> 本文只做代码导航，不承担主设计图职责。概念定义见[系统设计](worksurface-complete-design.md)，关系见[可交互系统设计图](interactive/worksurface-system.html)。

## 1. 组件与物理责任

| 组件 | 代码 | 当前责任 | 持久化结果 |
| --- | --- | --- | --- |
| `WorkSurfaceService` | `packages/dsh/src/service.ts` | Cordis 装配、Host RPC、逐项隔离的作者目录扫描、Definition/Registration admission | 间接写 Definition、Revision、Event streams |
| `SurfaceSessionService` | `packages/dsh/src/session-surface.ts` | 1:1 binding、Turn capability、Surface emit、Revision publication、恢复 | `binding.json`、`context.json`、Surface events |
| `SurfaceSessionAdmission` | `packages/dsh/src/session-admission.ts` | 创建/恢复唯一 DSH Session，把公共作者根注册为 Workspace 并在返回 Web 前 attach Session | DSH Session + Workspace registry membership |
| `DshWorkSurfaceSessionAdapter` | `packages/dsh/src/session-adapter.ts` | 消费 DSH Turn 边界、注入 env/instructions、探测可持久 `ignorable` 后装配 fact-backed context、路由 `agent.followup()` | 可选 DSH extension facts 与 followup message |
| `WorkSurfaceEngine` | `packages/dsh/src/engine.ts` | replay、Activation 派生、Operation record/execute/settle、reconcile | Registration stream 与目标 Surface event / DSH message |
| `SubprocessCodeHandlerRunner` | `packages/dsh/src/code-handler.ts` | 从精确 Definition Revision 运行受控 handler | 临时 `emits.jsonl`，最终转为 managed emit |
| `FileEventStore` | `packages/core/src/file-event-store.ts` | subject stream append、锁、幂等、replay、wakeup | Surface / Registration JSONL |
| `RevisionStore` | `packages/core/src/revision-store.ts` | 目录快照、manifest/blob、materialize、GC | content-addressed manifests/blobs |
| `DefinitionStore` | `packages/core/src/definition-store.ts` | 按 Definition Revision 保存规范 Definition 对象 | `definitions/<revision>.json` |
| `RuntimeAuthorityStore` / `EventContractStore` | `packages/core/src/runtime-authority-contract-store.ts` | 固定 authority、内容寻址 Contract | `v5/authority.json`、`contracts/` |
| `RuntimeEventStore` | `packages/core/src/runtime-event-store.ts` | 目标 Surface Event envelope、subject-local seq 与幂等 append | `v5/events/` |
| `RegistrationRecordStore` / `InputLedgerStore` | `packages/core/src/orchestrate-ledger-store.ts` | code-first immutable admission 与输入接纳事实 | `v5/registrations/`、`input-ledgers/` |
| `OperationLedgerStore` | `packages/core/src/orchestrate-ledger-store.ts` | record-before-effect 与 settle 恢复屏障 | `v5/operation-ledger/` |
| Runtime store 公共 IO | `packages/core/src/runtime-store-io.ts` | 锁、durable create、目录 fsync、局部 ID 与 digest 校验 | 无独立领域事实 |
| Runtime store compatibility facade | `packages/core/src/runtime-store.ts` | 保持既有 Core export，不拥有实现 | 无 |
| `CodeFirstOrchestrator` | `packages/dsh/src/code-first-orchestrator.ts` | Registration resolve、staged run、完整校验、恢复和 advance | 上述 v5 私有事实与目标 Surface Event |
| `SubprocessOrchestrateCodeRunner` | `packages/dsh/src/orchestrate-code-runner.ts` | 从精确 artifact Revision 物化隔离 run view | 临时 run view；候选 Surface Revision |
| `DshCodeFirstSurfacePort` | `packages/dsh/src/code-first-surface-port.ts` | 从 admitted/applied/published Event 重放 Surface head、候选 apply、唯一 Session advance、DSH tool completion 解析 | 目标 Surface Event 与 DSH Turn |

## 2. 类型与状态来源

| 概念 | 类型或校验器 | 真源 | 状态重建 |
| --- | --- | --- | --- |
| Surface identity | `SurfaceId`、`surfaceSubject()` | 作者目录 + Surface stream + Binding | 分别 replay/bind；当前没有统一 Surface aggregate fold |
| WorkSurface Event | `WorkSurfaceEvent`、`event.schema.json` | `events/{surfaces,registrations}/*.jsonl` | `FileEventStore.replay()` |
| Revision | `Revision`、`RevisionManifest` | RevisionStore | manifest/blob 校验 |
| Definition | `OrchestrationDefinition`、`definition.schema.json` | Definition Revision + DefinitionStore | `defineOrchestration()` + `DefinitionStore.get()` |
| Registration | `Registration` | Registration stream 的首条 registered record | `foldOrchestration()` |
| Activation | `OrchestrationActivation` | `registration.activation-opened` | `foldOrchestration()` |
| Operation | `operation-recorded/settled` records | Registration stream | `foldOrchestration()` + `recoverRecorded()` |
| Session binding | `SurfaceSessionBinding`、`binding.schema.json` | 权威 `binding.json` + 支持持久 `ignorable` 时的可选 DSH `worksurface/binding` | `SurfaceSessionService.init()/attachSession()` |
| DSH execution | DSH `SessionEventMap` | DSH Session Log | DSH Session replay/projection |
| v5 Surface head | `Revision` | `surface.revision.admitted/applied/published` Event | `DshCodeFirstSurfacePort.head()` replay；没有可变 head 文件 |
| v5 Registration | `OrchestrateRegistrationRecord` | 首次 admission 固定的 authoring Revision、bindings、routes、history boundary | 直接读取 immutable record；重复扫描只验证 authoring-derived facts，不重算首次 history boundary |
| v5 Runtime input | `OrchestrateInputLedgerRecord` | WorkSurface EventRef 或 DSH Session EventRef | recovery 先扫描目标 Event stream 补收，再续推未记录 input |
| v5 Operation | recorded batch + settlement | Operation Ledger | pending batch 先 apply，已接纳未 recorded input 再重跑 |

## 3. 默认 code-first 执行链

```text
artifact/ + registration.json
          ↓ CodeFirstOrchestrator.admit()
code Revision + Contract snapshots + Registration record
          ↓ EventRef → Input Ledger → staged run
result + candidate Revisions
          ↓ record before visible effect
Operation batch → apply Surface → Event / advance → settlement
```

`ws emit` 使用当前 Turn capability binding，先 `syncAuthoringRegistrations()`，再按当前 Surface 的 `surfaceOutputFrom` route 解析唯一 Contract、校验 payload 并 append；wakeup 后 Runtime replay Input Ledger。Registration 在某个 Turn 内首次写入时不会追溯授权该 Turn：输出 Contract 只会进入下一 Turn 的 Brief。旧 `definition.json` 目录仍进入 v4 compatibility Engine。

`session/event` adapter 只把 DSH `tool/result` 变成带 Session subject、原始 seq 和确定性 id 的 `source=dsh` EventRef。执行输入在需要时回到 DSH Session Log 解析 `tool/call + tool/result`，只物化 turn、step、callId、toolName、status 与可选 errorCode；工具参数和结果正文不复制到 WorkSurface ledger。

## 4. DSH 边界

所安装 `@deepseek-ai/dsh-session` 明确定义：Session 是完整 append-only 交互日志；Turn 由 `turn/start/end` 包围；Step 是一次模型调用及其请求的工具执行；Tool Call 由 `tool/call/result` 配对。

WorkSurface 通过 adapter 消费 Turn 边界、发送 followup，并把已声明可消费的 `tool/result` 引用接入 Input Ledger。它不拥有 DSH Session Event 的副本，也没有自己的 Step 或 Tool Call 类型。managed followup 以持久 `user/message` Turn receipt 为交付完成点，不等待整个 Agent Turn；模型执行仍由 DSH Session 自己恢复。

## 5. 未实现项

以下术语不得在当前实现图中伪装成已有组件：

| 演进项 | 缺少的物理实现 |
| --- | --- |
| 通用 Surface Address | adapter/locator/boundary 类型与解析器缺失 |
| YAML Source compiler | Source schema、compiler、provenance、版本策略缺失 |
| 独立 Definition IR | 当前 `definition.json` 直接就是 `OrchestrationDefinition v1` |
| 统一 Code/declarative Effect | Code handler 当前只能返回 emit，不能 followup |
| 统一 DSH Event taxonomy | 当前只实现经过安全 projection 的 `dsh.tool.completed`；尚未泛化其它 DSH 事件 |

任何一项开始实现时，必须原子更新类型、schema、store、fold、测试和设计文档。
