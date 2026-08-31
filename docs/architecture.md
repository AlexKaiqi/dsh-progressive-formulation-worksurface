# WorkSurface v1 实现索引

> 本文只做代码导航。概念定义见[系统设计](worksurface-complete-design.md)，关系图见[可交互实现图](interactive/worksurface-system.html)。

## 1. 组件与物理责任

| 组件 | 代码 | 当前责任 | 持久化结果 |
| --- | --- | --- | --- |
| `WorkSurfaceService` | `packages/dsh/src/service.ts` | Cordis 装配、Host RPC、作者目录扫描、Definition/Registration admission | 间接写 Definition、Revision、Event streams |
| `SurfaceSessionService` | `packages/dsh/src/session-surface.ts` | 1:1 binding、Turn capability、Surface emit、Revision publication、恢复 | `binding.json`、`context.json`、Surface events |
| `DshWorkSurfaceSessionAdapter` | `packages/dsh/src/session-adapter.ts` | 消费 DSH Turn 边界、注入 env/instructions、路由 `agent.followup()` | DSH `worksurface/binding` 与 followup message |
| `WorkSurfaceEngine` | `packages/dsh/src/engine.ts` | replay、Activation 派生、Operation record/execute/settle、reconcile | Registration stream 与目标 Surface event / DSH message |
| `SubprocessCodeHandlerRunner` | `packages/dsh/src/code-handler.ts` | 从精确 Definition Revision 运行受控 handler | 临时 `emits.jsonl`，最终转为 managed emit |
| `FileEventStore` | `packages/core/src/file-event-store.ts` | subject stream append、锁、幂等、replay、wakeup | Surface / Registration JSONL |
| `RevisionStore` | `packages/core/src/revision-store.ts` | 目录快照、manifest/blob、materialize、GC | content-addressed manifests/blobs |
| `DefinitionStore` | `packages/core/src/definition-store.ts` | 按 Definition Revision 保存规范 Definition 对象 | `definitions/<revision>.json` |

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
| Session binding | `SurfaceSessionBinding`、`binding.schema.json` | `binding.json` + DSH `worksurface/binding` | `SurfaceSessionService.init()/attachSession()` |
| DSH execution | DSH `SessionEventMap` | DSH Session Log | DSH Session replay/projection |

## 3. 当前执行链

```text
definition.json + registration.json
          ↓ WorkSurfaceService.registerDefinition()
Definition Revision + Registration stream
          ↓ WorkSurfaceEngine.reconcile()
bound Surface streams replay
          ↓ deriveActivations()
Activation
          ↓ managed Operation
emit target Surface Event | followup target DSH Session
          ↓
Operation settlement
```

`ws emit` 走另一条入口：Turn capability → `syncAuthoringRegistrations()` → Surface stream append → wakeup → replay/reconcile。

## 4. DSH 边界

所安装 `@deepseek-ai/dsh-session` 明确定义：Session 是完整 append-only 交互日志；Turn 由 `turn/start/end` 包围；Step 是一次模型调用及其请求的工具执行；Tool Call 由 `tool/call/result` 配对。

WorkSurface 当前只通过 adapter 消费 Turn 边界并发送 followup。它不拥有 DSH Session Event 的副本，也没有自己的 Step 或 Tool Call 类型。

## 5. 未实现项

以下术语不得在当前实现图中伪装成已有组件：

| 演进项 | 缺少的物理实现 |
| --- | --- |
| Episode | ID、schema、store、边界事件、DSH/WorkSurface 引用、fold、恢复、测试全部缺失 |
| 通用 Surface Address | adapter/locator/boundary 类型与解析器缺失 |
| YAML Source compiler | Source schema、compiler、provenance、版本策略缺失 |
| 独立 Definition IR | 当前 `definition.json` 直接就是 `OrchestrationDefinition v1` |
| 统一 Code/declarative Effect | Code handler 当前只能返回 emit，不能 followup |
| DSH EventRef adapter | WorkSurface Event 只有 sessionId/turn meta，没有稳定 DSH event seq 引用 |

任何一项开始实现时，必须原子更新类型、schema、store、fold、测试和设计文档。
