# Event：身份、Contract 与持久事实

> 状态：目标设计。本文只定义 Schema 无法表达的语义；字段以 [`spec/design/`](../spec/design/) 中的 JSON Schema 为准。

## 身份

模型使用业务名，例如 `research.completed`。它是局部、可读的名字，不是全局 ID。

Runtime 将该名字解析为：

```text
(authority, scope.kind, scope.id, name, contract digest)
```

- `authority` 隔离不同持久存储实例；
- `scope` 区分 Runtime 预置的 `builtin` 与任务局部的 `registration`；
- `digest` 固定 Event 的 payload 语义。

完整身份只存在于 Runtime 私有记录和 Binding。模型、模型生成的 shell 与 Orchestrate code 都不构造它们，只使用当前调用中已授权的局部名字。解析不到、解析不唯一或 payload 不符合 Contract，Runtime 必须拒绝。

机器定义：

- 持久 authority：[`runtime-authority.schema.json`](../spec/design/runtime-authority.schema.json)
- Runtime 私有 Binding：[`runtime-binding.schema.json`](../spec/design/runtime-binding.schema.json)
- 完整 Contract：[`runtime-event-contract.schema.json`](../spec/design/runtime-event-contract.schema.json)
- 模型维护的最小声明：[`event-declaration.schema.json`](../spec/design/event-declaration.schema.json)

## Contract 的来源与生命周期

预定义 Event 只保留跨工作流都稳定的系统事实。名字、producer、subject、payload Schema 与模型暴露级别的唯一来源是 [`builtin-event-catalog.json`](../spec/design/builtin-event-catalog.json)，其结构由 [`builtin-event-catalog.schema.json`](../spec/design/builtin-event-catalog.schema.json) 约束。Registration 通过 `builtin: true` 引用它们，不复制声明。只有标记为 `orchestrate-input` 的 built-in 可以通过 `consumeFrom` 进入模型编写的 code；`runtime-only` payload 可能含 Session、Revision 等私有身份，在另行定义并验证安全 projection 前不得物化为 `inputs.jsonl`。其余 Event 由 Registration 中的 Contract 文件局部声明。“临时”表示只服务当前任务、作用域和生产权限有限，不表示可以在一次 run 中临时改变 Registration。

模型只维护业务名、说明和 payload JSON Schema。Runtime 在 Registration 准入时补齐 `version`、authority、scope、subjects 和 producers，形成 [`runtime-event-contract.schema.json`](../spec/design/runtime-event-contract.schema.json) 所定义的完整 Contract。规范对象把 `subjects`、`producers` 当作集合去重并按词典序排序，再使用 Core 的 [`stableStringify`](../packages/core/src/hash.ts) 递归排序对象键、保留所有数组顺序，最后计算 `sha256:<sha256(canonical JSON)>`。payload JSON Schema 中的数组不得泛化排序，因为 `prefixItems` 等数组顺序可能携带语义。authority 属于 scope 并参与摘要，因此不同 authority 下内容相同的局部声明也不会共享 digest。

Runtime 持久化这个不可变 Contract snapshot。声明、scope 或 producer capability 改变都会产生新 digest，不修改旧 Contract；只要 Event 仍引用旧 digest，旧 snapshot 就必须可读。run 期间只能引用已注册的局部名字；新增或修改 Contract 必须形成新的 Registration。规范示例和负向篡改门禁由 [`validate-schemas.mjs`](../scripts/validate-schemas.mjs) 重算，不能用仅符合字符串形状的占位摘要替代。

Registration 的三种 route 同时定义解析范围和生产权限：

| route | 含义 | 获得的 capability |
| --- | --- | --- |
| `consumeFrom` | 哪个已绑定 Surface 上的事实可成为输入 | `consume` |
| `emitOn` | Orchestrate code 可在哪个 Surface 上追加该事实 | `orchestrate-emit` |
| `surfaceOutputFrom` | 哪个 Surface Session 可产生该事实 | `surface-output` |

三种 capability 不能互相替代。Registration 结构以 [`orchestrate-registration.schema.json`](../spec/design/orchestrate-registration.schema.json) 为准。

Registration-local Contract 的身份属于当前 Registration，因此一个带 `consumeFrom` 的局部 Event 还必须在同一 Registration 中至少有 `emitOn` 或 `surfaceOutputFrom` producer capability；否则该 scope 内不存在能够产生它的主体。跨 Registration 共享事实不能靠同名文件 Contract 冒充，必须使用明确的共享 scope 协议。

## Event 的持久化与消费

WorkSurface Event 是 Surface 推进中产生的不可变事实，按 Surface subject stream 持久化。完整 envelope 由 [`runtime-event-envelope.schema.json`](../spec/design/runtime-event-envelope.schema.json) 定义；它固定 subject-local 顺序、Contract identity、payload、producer、causes 和幂等键。跨 stream 只通过 EventRef 表达因果，不假设全局总序。

Event append 的边界是：

1. 从当前 Runtime Binding 解析局部名字、subject 和 producer capability；
2. 按已绑定 Contract 校验 payload；
3. 先记录可重试 Operation，再 append Event；
4. 同一幂等键同内容收敛，同键异内容冲突。

Registration 只消费同时命中 `consumeFrom`、已绑定 Surface 与注册历史边界之后的事实。每个 handle 分别固定 Surface Event `seq` 与绑定 DSH Session Event `seq`，因为两条 stream 没有共享序号。Runtime 先按 [`orchestrate-input-ledger-record.schema.json`](../spec/design/orchestrate-input-ledger-record.schema.json) 将完整 EventRef 追加到该 Registration 的私有 Input Ledger，再向 code 物化 [`orchestrate-input-record.schema.json`](../spec/design/orchestrate-input-record.schema.json) 所定义的最小输入。

Surface Session 不接触完整 envelope。Runtime 为当前 Turn 生成 [`surface-turn-brief.schema.json`](../spec/design/surface-turn-brief.schema.json) 所约束的 Brief，只告诉模型允许输出什么、何时输出、payload 在哪里校验，以及精确的 `ws emit` 命令。

DSH 的 Step、Tool Call 和 Tool Result 仍属于 DSH Session Log。当前目标只预定义 `dsh.tool.completed` adapter Contract：adapter 观察实际 `tool/result`，按 `callId` 找到 `tool/call` 的工具名，Input Ledger 保存原 DSH EventRef，code 只得到 catalog 规定的完成元数据，不得到整份工具结果。确切映射由 [`dsh-tool-completed-adapter.mjs`](../examples/dsh-tool-completed-adapter.mjs) 和实际形状 fixture [`dsh-tool-completed.events.json`](../examples/dsh-tool-completed.events.json) 证明。需要工具内容时，应由 Surface 把结果维护到文件并产生带文件 ref 的业务 Event。Registration lifecycle、Input Ledger 和 Operation Ledger 是 Runtime 私有记录，也不伪装成业务 Event。

## 冲突规则

- 不同 authority 或 scope 可以有同名 Event；
- 同一调用能力中，一个局部名字只能解析到一个 Contract digest；
- built-in 默认不可被局部同名声明遮蔽；
- 无 Contract 的裸名字不能持久化；
- namespace、digest、cursor、ledger 和 transport 都不进入模型上下文。
