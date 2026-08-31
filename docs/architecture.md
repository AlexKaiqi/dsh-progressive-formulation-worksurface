# WorkSurface 实现索引

> 本文不是第三份设计规范。领域与 DSH 集成语义以[完整系统设计](worksurface-complete-design.md)为准，展示语义以 [UI 设计](ui-design.md)为准。

## 实现状态

目标领域主轴已经统一为 `Surface / Episode`。Event、Orchestrate 与 WorkSurface Runtime 是事件驱动的推进机制，不再与 Surface、Episode 并列。WorkSurface Runtime 是目标设计对推进控制职责的暂用名，不对应一个既有 DSH Runtime。当前代码尚无 Episode 模型，并把一个绑定的 DSH Session 直接当作 Surface 的完整推进历史；可靠性机制大多可保留，但需要在 Surface 与 DSH 执行日志之间增加明确的 Episode 边界与引用。

因此下表中的“已实现”表示该机制存在并有测试，不表示已经满足目标概念边界。

## 目标设计到当前实现

| 目标范围 | 当前主要实现 | 状态与迁移 |
| --- | --- | --- |
| Surface、Event、Orchestrate 基础值 | `packages/core/src/event-model.ts` | 部分实现；Surface 已有身份，Event/Orchestrate 仍需按推进机制重新归位 |
| Episode | 尚无对应领域类型 | 未实现；需定义 EpisodeId、所属 Surface、边界、DSH EventRef、Surface 修改、结果与证据，且不能简单别名为 Turn/Step |
| Surface Address 与持续维护 | 文件路径、authoring WIP、`packages/dsh/src/context/` | 部分实现；需抽象 adapter locator/boundary，并证明跨 Turn/Step 的局部可定位与可见性 |
| WorkSurface append-only streams、幂等与冲突 | `packages/core/src/file-event-store.ts` | 可保留；需增加跨来源 EventRef，不能复制 DSH events |
| 文件 Materialization 的 Revision snapshot | `packages/core/src/revision-store.ts` | 机制已实现；概念上从“Surface 全部内容”降为文件 adapter |
| Orchestrate Source → Definition IR | `packages/core/src/definition-store.ts`、`packages/dsh/src/service.ts` | 未形成边界；当前硬编码读取 `definition.json`，同一文件同时是作者 Source、持久 Definition 和 Engine IR；需增加 YAML compiler、Code adapter、SourceRef/provenance 和规范 DefinitionRef |
| 条件、Activation、planned/actual projection | `packages/core/src/orchestration.ts` | 部分实现；Activation 只能表示条件满足，不能表示 Agent 启动 |
| WorkSurface Runtime（推进控制） | `packages/dsh/src/engine.ts`、`service.ts`、`session-admission.ts`、context 子系统 | 职责分散，尚无统一目标抽象；`WorkSurfaceContextRuntime` 只负责上下文，不等于本文的推进控制器，也不能据此推断 DSH 有同名 Runtime |
| Surface 与 DSH Session Binding | `packages/dsh/src/session-surface.ts` | 当前 1:1 adapter 可保留；必须明确是执行策略而非 Surface 定义 |
| DSH Session admission 与恢复 | `packages/dsh/src/session-admission.ts`、`packages/dsh/src/session-adapter.ts` | 已实现基础机制；术语必须遵守 Session → Turn → Step → Tool Call |
| Orchestrate evaluator 与 Effect | `packages/dsh/src/engine.ts`、`packages/dsh/src/code-handler.ts` | 未统一；声明式 reaction 当前支持 emit/followup，Code handler 只能 emit；目标 evaluator 统一接受 `Definition + Instance + Event[]` 冻结输入并返回标准 `Effect[]` |
| Context Projection | `packages/dsh/src/context/` | 部分实现；从 Revision-centric 扩展到 materializations、EventRefs、providers 与 included/omitted/required |
| 模型入口与 CLI transport | `packages/cli/src/bin.ts`、`packages/dsh/src/model/session-instructions.ts` | 保留最小 `ws emit` shell CLI；避免增加模型工具，内部字段由 WorkSurface 推进控制层补齐 |
| UI projection | `packages/core/src/view-projection.ts`、`packages/web/` | 可删除投影机制可保留；需区分 Turn/Step、上下文发布和 `surface.completed` |

相关当前协议与测试位于 `spec/`、`packages/*/tests/`、`packages/web/evals/`。完整路径与检查入口见[验证指南](invariants-and-acceptance.md)。

## 目标包边界

```text
core
├── Surface / Episode domain rules
├── Event facts / immutable Definition IR / Instance rules
├── evaluator input + Effect output contracts
├── pure replay / fold / authorization
└── no DSH, CLI or Web dependency

authoring adapters
├── YAML pattern compiler
└── Code artifact adapter

dsh execution adapter
├── Binding and admission
├── DSH Session event references
├── Effect execution / reconciliation
└── Context Projection

cli ── transport only; shell entry point, not a new model tool
web ── reads deletable projections only
```

- `core` 定义 Surface / Episode、Event、不可变 Definition IR、Instance、evaluator input 与 Effect output contract，以及校验和纯 replay/fold。
- `authoring adapters` 把 YAML / Code Source 编译或适配成 Definition IR；推进控制与 DSH adapter 不读取 Source。
- `dsh` 桥接真实 DSH Session；DSH 自己拥有 Session、Turn、Step、Tool Call 和 transcript 权威事实。
- `cli` 只提供稳定 shell transport；模型主要使用现有编程与文件能力。
- `web` 只读取 WorkSurface 推进机制生成的可删除投影，不写关系、Binding 或执行状态。

## 目录边界

当前 `surfaces/<surface-id>/`、`orchestrations/<orchestration-id>/` 和私有 `v4/` 布局是文件 materialization adapter 与现有实现组件的存储布局，不是通用 Surface 领域模型。目录层级不表达依赖，`surface.md` 只能作为可选 Surface Profile，文件型 Registration 只能解释为 Orchestrate Instance 的一种装配形式。

旧 `v2` Work Session 数据与错误多对多实现产生的 `v3/sessions/<session>/<surface>` 数据仍只允许通过 `legacy.report` 检查。当前一对一 adapter 使用隔离的 `v4/`，不自动迁移、修改或删除旧数据。

## 迁移顺序

1. 先定义 Surface / Episode 领域类型，并明确 Episode 只引用 DSH 权威日志、不复制 transcript。
2. 为当前一对一 Session adapter 增加 Episode 边界；先不假设 Episode 与 Turn/Step 一一对应。
3. 建立 `SurfaceId + adapter + locator + boundary` 地址协议，覆盖 working 与 frozen 引用。
4. 将 Revision 降级为文件 Materialization snapshot，并移除通用 `surface.md` 强制约束。
5. 为 DSH Session events 增加稳定 EventRef adapter，保持日志权威性不重复。
6. 拆分当前 `definition.json` 的三重职责：建立 SourceRef/provenance，令 YAML compiler 与 Code adapter 统一产出不可变 Definition IR，并让所有 evaluator 只返回标准 Effect[]。
7. 扩展 Context Projection，并让 audit 明确 included/omitted/required 和跨 Episode 的最新内容可见性。
8. 最后迁移 Web 文案和视觉状态，删除对旧 Registration/Revision 语义的依赖。
