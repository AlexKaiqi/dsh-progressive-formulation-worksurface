# WorkSurface 目标设计基线

> 本文定义默认 code-first 定位、所有权和不可违背的边界。协议结构以 [`spec/design/`](../spec/design/) 的 JSON Schema 为准，行为以 [`examples/`](../examples/) 的可执行代码和门禁为准。旧 v4 兼容实现见 [`worksurface-complete-design.md`](worksurface-complete-design.md)。

## 定位

WorkSurface 管理可持续维护的工作上下文，以及这些上下文之间如何由事实驱动地继续推进。

- **Surface**：一项工作依赖的、结构化、可寻址、持续维护且模型可见的上下文。当前物理地址边界是 `SurfaceId + relative file path`。
- **DSH Session**：一个 Surface 当前唯一绑定的执行历史。Turn、Step、Tool Call 仍由 DSH 定义；不引入 Episode。
- **Event**：已经发生的不可变事实，不是命令。命名空间、Contract 和持久化语义见 [`event-type-system.md`](event-type-system.md)。
- **Orchestrate**：描述已存在 Surface 之间关系的普通代码。它决定何时传递或改写上下文、影响谁、随后推进谁；不创建 Surface。执行边界见 [`orchestration-code-contract.md`](orchestration-code-contract.md)。
- **Runtime**：确定性规则和可靠性边界，不是要求模型理解的新领域对象。

## 总原则

1. Runtime 完成可确定的筛选、解析、校验、持久化、并发控制、重试和恢复；模型只承担语义判断。
2. 完整 namespace 必须存在以隔离并发任务，但由 Runtime-owned Binding 解析；模型只使用稳定 local handle。Binding 不进入稳定模型契约，但同一 OS principal 下的文件可见性不作为安全边界。
3. 不为模型已经掌握的 Bash、Python、Node 和文件能力再造工具或 DSL。
4. 模型输入按需提供：短而关键的信息进入 prompt，大内容和完整 Schema 通过普通文件读取。
5. 任何副作用都必须先有机器协议、完整校验和持久 Operation，再执行和结算。

## 所有权

| 内容 | 权威维护者 | 权威形式 |
| --- | --- | --- |
| Surface 工作内容 | Surface authoring 模型 | 普通文件；发布后为不可变 Revision |
| DSH 执行历史 | DSH | Session append-only log |
| WorkSurface Event | Runtime | Contract 校验后的 subject stream |
| Event Contract snapshot | Runtime | scoped、规范化、内容寻址的不可变 JSON |
| Orchestrate 行为 | authoring 模型 | 普通代码 Revision |
| Orchestrate 装配 | Runtime | Registration stream 的不可变 registered fact 与后续 lifecycle facts |
| Input/Operation Ledger | Runtime | append-only 私有事实，可 replay；结构见 Orchestrate code 契约中的协议链接 |
| Turn Brief / Run View | Runtime | 从权威事实确定性生成、可审计、可重建 |
| UI state | projection | 可删除并从权威事实重建 |

## 模型可见契约

模型只需要额外知道以下稳定契约，不把实际 namespace、socket、capability、digest、cursor、CAS 或幂等算法作为语义输入：

- Surface Session shell 的四个变量和 `ws` 发现方式：[`session-shell-contract.json`](../spec/design/session-shell-contract.json)，结构由 [`session-shell-contract.schema.json`](../spec/design/session-shell-contract.schema.json) 定义；
- 每次 Turn 的最小任务、受限输入定位和结构化 Event 输出 argv：[`surface-turn-brief.schema.json`](../spec/design/surface-turn-brief.schema.json)；
- 模型维护的 Event 语义声明：[`event-declaration.schema.json`](../spec/design/event-declaration.schema.json)；
- Orchestrate Registration、run view 和 result：见 [`orchestration-code-contract.md`](orchestration-code-contract.md) 中的协议链接。

环境变量只提供稳定间接引用，实际值不进入 prompt。业务值只持久化在 Surface、Event payload 或 Registration binding 中；不存在另一套业务变量存储。

模型额外上下文只有两层：

1. Surface Session 的稳定短说明：四个 shell 变量名、`ws` 通过 `PATH` 使用、当前 Turn Brief 固定为 `$DSH_WORKSURFACE_VIEW_DIR/turn-brief.json`；变量值由 Runtime 注入每次模型 shell 的进程环境，不复制进 prompt；
2. 当前 Turn 的任务专用 Brief：本次 instruction、需要读取的 Surface 路径、被筛选输入的摘要/详情路径，以及本次允许输出的 Event 和精确 argv；Runtime 或宿主按 argv 调用，不把它重新拼成 shell 字符串。

只有当前任务要求 author Orchestrate 时，Brief 才提供 Registration Schema、run/result Schema 和代码样例的文件路径；不把完整协议常驻模型上下文。Orchestrate code 执行时没有模型调用，不注入另一套业务环境变量；Runtime 只设置隔离 cwd，并物化 run view 中的普通文件。

## 当前与目标

| 状态 | 范围 |
| --- | --- |
| 当前默认 | authority namespace、scoped Event Contract、四变量 shell Contract、Turn Brief、code-first Registration、Input Ledger、staged run view、Event/advance result 与 recoverable Operation batch |
| 兼容路径 | `v4` Event/Definition v1/Activation/Operation 与既有 `definition.json` 目录；不与目标 envelope 混写，也不再注入新 authoring 指南 |
| 尚未收敛 | 旧 v4 数据的显式迁移工具、`dsh.tool.completed` 之外的 DSH 安全 projection |

目标 Schema 仍是结构真源；`WS-24` 至 `WS-27` 和对应故障测试证明已进入 Runtime 的边界。尚未收敛项不得由 Schema 通过冒充为已实现。

## 明确排除

- Episode；
- YAML/JSON pattern DSL 或另一套行为 Definition IR；
- Orchestrate 创建、删除或派生 Surface；
- 把全局 Event prefix、qualified identity 或 transport 当作模型语义契约，或把 transport 字符串保密当作授权边界；
- 通用 context dump、业务环境变量注入和模型必填 Operation plumbing；
- 在没有类型、持久化、replay、恢复和测试时引入新的一级概念。
