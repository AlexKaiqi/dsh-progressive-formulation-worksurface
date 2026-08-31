# WorkSurface 文档索引

## 阅读顺序

| 范围 | 真源 | 用途 |
| --- | --- | --- |
| 目标边界 | [目标设计基线](design-baseline.md) | 定位、概念、所有权、模型负担和明确排除项 |
| 目标 Event 语义 | [Event：身份、Contract 与持久事实](event-type-system.md) | namespace、Contract 生命周期、Event 持久化与 capability |
| 目标 Orchestrate 语义 | [Orchestrate code 契约](orchestration-code-contract.md) | 已存在 Surface 间的 `when / who / how` 与可恢复执行 |
| 当前 v1 | [当前实现基线](worksurface-complete-design.md) | 已进入类型、存储、fold、恢复和测试的事实 |
| 当前源码 | [实现索引](architecture.md) | 概念到代码位置的映射 |
| 验证 | [不变量与验收](invariants-and-acceptance.md) | 机器协议、门禁与测试证据 |

目标与当前实现不得混写。目标协议已被 Schema 和样例约束，但尚未进入 Runtime；判断“现在能否运行”时只看当前 v1 文档和源码。

## 按载体维护

- 语义和不可由类型表达的边界：本目录中的设计文档；
- 数据结构、枚举和字段约束：[`spec/`](../spec/) 与 [`spec/design/`](../spec/design/) 的 JSON Schema；
- 行为和 pattern：[`examples/`](../examples/) 的可执行代码；
- 当前不变量及实现证据：[`spec/invariants.json`](../spec/invariants.json) 与测试；
- 关系概览：[交互概念图](interactive/worksurface-system.html)，只辅助理解，不定义协议。

同一规则只保留一个真源，其他文档只链接。Schema 通过校验不代表 Runtime 已实现；图或 Markdown 中出现一个名称也不建立领域概念。

## 其他当前专题

- [模型上下文](context-management.zh.md)：Revision、Session facts、Context Plan 与 render audit；
- [UI 设计](ui-design.md)：当前 projection、证据层级和交互边界；
- [交互图维护说明](interactive/README.md)：图的范围和更新纪律。
