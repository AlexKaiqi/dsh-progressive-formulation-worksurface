# WorkSurface 文档索引

## 当前设计真源

1. [系统设计交互图](interactive/worksurface-system.html)：领域定位、模型 authoring、事件契约、环境注入与推进闭环；可编辑源为 [`worksurface-system.architecture.json`](interactive/worksurface-system.architecture.json)。
2. [完整系统设计](worksurface-complete-design.md)：只定义能映射到当前类型、存储、fold、恢复或测试的概念，并把未实现方向单独列出。
3. [实现索引](architecture.md)：组件、状态和关键流程到源码位置的映射。
4. [机器协议与不变量](invariants-and-acceptance.md)：`spec/`、`WS-01` 至 `WS-23` 和测试证据。

交互图用于检查系统设计，完整系统设计给出严格语义，[实现索引](architecture.md)、源码、schema 和测试证明物理落点。实现证据属于概念详情，不替代主设计图。三者不一致时，先判定代码现状，再明确选择修代码还是把文档标记为提案。

## 专题文档

- [UI 设计](ui-design.md)：当前 `WorkSurfaceViewDefinition`、Surface 生命周期投影和 DSH/WorkSurface 证据分层。
- [模型上下文](context-management.zh.md)：当前 Revision、Session facts、provider occurrence、Context Plan 和 render audit；英文版见 [Fact-backed model context](context-management.md)。
- [Orchestrate 语义与模型 authoring](orchestration-semantics.md)：委派、串行、fan-out/join、loop 与 race 的实际事件轨迹和能力边界。
- [`spec/`](../spec/)：Event、Definition、Binding、Context 和 Registration 的机器 schema。
- [`spec/design/`](../spec/design/)：进入实现前已机器校验的 Event Contract、Definition v2 与 Activation Delivery Context 目标协议；不与当前 v1 混写。
- [`examples/`](../examples/)：当前协议示例，不扩张领域模型。

## 设计准入

新的一级概念只有同时回答身份、类型/schema、持久化、事件边界、fold/replay、故障恢复和测试，才能进入“当前设计”。只有名称和叙述的内容必须标为提案。

因此，当前文档明确不把以下演进方向当成已实现事实：

- 一套独立的 YAML pattern DSL；
- 独立于 `OrchestrationDefinition v1` 的 Definition IR；
- 一个统一的 `WorkSurface Runtime` 领域实体；
- 通用的 `SurfaceId + adapter + locator + boundary` 地址协议。

Git 历史中的旧草案可以用于追溯，但不是当前规范。
