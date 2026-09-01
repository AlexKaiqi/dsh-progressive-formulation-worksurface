# WorkSurface 文档索引

## 阅读顺序

| 范围 | 真源 | 用途 |
| --- | --- | --- |
| 目标边界 | [目标设计基线](design-baseline.md) | 定位、概念、所有权、模型负担和明确排除项 |
| 目标 Event 语义 | [Event：身份、Contract 与持久事实](event-type-system.md) | namespace、Contract 生命周期、Event 持久化与 capability |
| 目标 Orchestrate 语义 | [Orchestrate code 契约](orchestration-code-contract.md) | 已存在 Surface 间的 `when / who / how` 与可恢复执行 |
| 演化与复用提案 | [Surface 演化、复用与 Promotion](surface-evolution-and-promotion.md) | 实例派生、检索、Promotion、Template 和分阶段准入；尚未实现 |
| v4 兼容路径 | [v4 兼容实现基线](worksurface-complete-design.md) | 旧 Definition/Activation/Operation 的类型、存储、fold 与恢复 |
| 当前源码 | [实现索引](architecture.md) | 概念到代码位置的映射 |
| 验证 | [不变量与验收](invariants-and-acceptance.md) | 机器协议、门禁与测试证据 |
| 模型用例 | [模型用例覆盖矩阵](model-readiness-coverage.md) | 七个用例的 L0–L3 要求、evidence 映射与真实 Agent 状态 |
| 本轮实证 | [2026-09-01 重构与验证报告](verification-report-2026-09-01.md) | 设计判断、修复项、文件拆分、自动与真实 profile E2E |
| 可重复管线 | [参数与多模态方向](repeatable-pipeline-direction.md) | Template、Invocation、参数绑定、ArtifactRef 与 Design/Run/Evidence 边界 |

目标与当前实现不得混写。code-first Schema 已进入默认 v5 Runtime，准确实现范围以 `WS-24` 至 `WS-27`、实现索引和测试为准；v4 文档只解释兼容 Engine，不能反向定义默认 authoring。

## 按载体维护

- 语义和不可由类型表达的边界：本目录中的设计文档；
- 数据结构、枚举和字段约束：[`spec/`](../spec/) 与 [`spec/design/`](../spec/design/) 的 JSON Schema；
- 行为和 pattern：[`examples/`](../examples/) 的可执行代码；
- 当前不变量及实现证据：[`spec/invariants.json`](../spec/invariants.json) 与测试；
- 关系概览：[交互概念图](interactive/worksurface-system.html)，只辅助理解，不定义协议。
- UI 底座与管线方向：[node editor 方向决策](ui-node-editor-decision.md)，说明为什么采用成熟画布、当前只读边界以及未来 Template/Run 双模式。

同一规则只保留一个真源，其他文档只链接。Schema 通过校验不代表 Runtime 已实现；图或 Markdown 中出现一个名称也不建立领域概念。

## 其他当前专题

- [模型上下文](context-management.zh.md)：Revision、Session facts、Context Plan 与 render audit；
- [UI 设计](ui-design.md)：当前 projection、证据层级和交互边界；
- [Surface 演化、复用与 Promotion](surface-evolution-and-promotion.md)：目标产品闭环和后续协议准入顺序，当前不是可用能力；
- [交互图维护说明](interactive/README.md)：图的范围和更新纪律。
