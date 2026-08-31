# Orchestrate code 契约

> 状态：目标设计。本文定义执行语义；数据结构以链接的 JSON Schema 为准，具体行为以可执行样例为准。当前 v1 仍见 [`worksurface-complete-design.md`](worksurface-complete-design.md)。

## 边界

Orchestrate 描述已存在 Surface 之间的推进关系：收到什么事实后，如何干预哪些 Surface 的上下文，以及随后推进哪些 Surface。

创建、复制、派生 Surface 属于普通 Surface authoring，发生在 Registration 之前。Orchestrate 不创建、删除、派生 Surface，也不能改变 Registration 的 Surface 集合。并行探索的 authoring 示例见 [`prepare-parallel-surfaces.py`](../examples/orchestrate-code/prepare-parallel-surfaces.py)。

## 从 authoring 到运行

1. authoring 模型准备完整 Surface 目录、普通 Orchestrate code 和 Event Contract；
2. [`orchestrate-registration.schema.json`](../spec/design/orchestrate-registration.schema.json) 约束的 Registration source 用 local handle 绑定现有 Surface，并声明 Event routes；同一 Surface 不得以多个 handle 重复绑定；
3. Runtime 准入后固定 code Revision、entrypoint、解析后的 Contract、Surface identity 和各输入 stream 的历史边界，形成不可变 [`orchestrate-registration-record.schema.json`](../spec/design/orchestrate-registration-record.schema.json)；
4. active Registration 命中新的 `consumeFrom` Event 后，Runtime 按 [`orchestrate-input-ledger-record.schema.json`](../spec/design/orchestrate-input-ledger-record.schema.json) 把 EventRef 去重追加到 Input Ledger，并调度固定 Revision；
5. code 修改已绑定 Surface 的 staging 副本，并用 [`orchestrate-result.schema.json`](../spec/design/orchestrate-result.schema.json) 请求 Event append 或推进；
6. Runtime 校验、记录、提交全部 Surface Revision，最后才追加 Event 和推进 Session。

局部 Contract 若由 code 消费，Registration 还必须给它至少一个实际 producer capability；规范样例中的初始 `*.requested` Event 都由 coordinator 的 `surfaceOutputFrom` 产生。Runtime lifecycle built-in 默认不进入 code input，只有 catalog 明确标记为 `orchestrate-input` 的安全 projection 可以被消费。

Registration 是关系的静态装配和路由，不是行为 DSL。精确业务条件、信息转换、fan-out、join 和 loop 都是普通代码。

## `when / who / how`

| 问题 | 表达位置 | Runtime 保证 |
| --- | --- | --- |
| `when` | Registration 的 `consumeFrom` + code 的普通条件 | 只有准入且越过历史边界的 Event 能进入 Input Ledger；一个 Registration 内按 `inputSeq` 串行处理 |
| `who` | Registration 的 Surface local handle | handle 在准入时绑定到已存在 Surface；完整 namespace 留在 Runtime-private Binding |
| `how` | code 对已绑定 Surface staging 副本的普通文件操作 | code 只能改变副本内容，不能增加、删除或改名 Surface 目录 |
| 如何继续 | `result.json` 的 `advance` | 上下文提交成功后，Runtime 才建立或复用 1:1 DSH Session binding 并推进 |

这套协议没有 `when/all/join/loop` DSL，也没有重复描述文件修改的 effect 协议。

## Code 可依赖的运行视图

Runtime 为一次运行物化 `state.json`、`inputs.jsonl`、Contract 文件、已绑定 Surface 的可写 staging 副本，并接收 code 生成的 `result.json`。确切路径、字段和 capability 由以下 Schema 定义：

- [`orchestrate-run-state.schema.json`](../spec/design/orchestrate-run-state.schema.json)
- [`orchestrate-input-record.schema.json`](../spec/design/orchestrate-input-record.schema.json)
- [`orchestrate-result.schema.json`](../spec/design/orchestrate-result.schema.json)

code 只依赖 cwd、local handle、局部 Event name、普通路径和上述文件；不依赖业务环境变量、authority、真实 Surface ID、Contract digest、cursor、lock、CAS、socket 或 transport secret。

Surface 内容变更由 staging 副本的普通文件 diff 表达。`result.json` 只表达 Runtime 才能完成的两件事：向已授权 Surface append 已注册 Event，以及在提交后推进已注册 Surface 并授予已注册的输出 Event。run 不能新增 Contract 或改变 route。样例中的 `blocks/*.md` 是普通文件，不建立 Block 领域概念。

## 提交、恢复与推进

Runtime 在产生外部副作用前必须：

1. 校验完整 staged diff、Surface 结构和 `result.json`；
2. 拒绝越界路径、符号链接、未知 Surface 和未知 Event capability；
3. 固定候选 Revision，按稳定顺序加 publication lock，并复核所有 base Revision 及未 settled reservation；
4. 在 authority-global Operation Ledger 中按 [`orchestrate-operation-batch.schema.json`](../spec/design/orchestrate-operation-batch.schema.json) 持久化已解析完整身份、输入因果、base/candidate Revision 与幂等键的 Operation batch。

recorded batch 对其中所有 `(Surface, base Revision)` 建立跨重启 reservation；其他 run 在它 settled 前不能基于这些 Surface 记录新 batch。之后按 `record → apply → settle` 应用所有 Surface Revision。只有全部上下文变更完成，才能 append Event 或执行 `advance`；全部稳定结果由 [`orchestrate-operation-settlement.schema.json`](../spec/design/orchestrate-operation-settlement.schema.json) 记录并释放 reservation。Runtime 重启时必须先恢复未 settled batch，再接受新的 Surface mutation；锁前发现 base 已变化则不记录 batch、不产生可见副作用，基于新事实重跑。

这里保证的是可恢复和下游推进屏障，不宣称底层存储具备跨 Surface 原子快照：batch apply 期间，直接绕过 Runtime 读取 Surface head 的观察者可能短暂看到部分 Revision 已更新。若产品要求任意读者都获得 all-or-nothing 可见性，必须另行引入 authority-global commit record 和统一 head projection，不能靠“事务”一词暗示已经支持。

`advance` 的目标只能是 Registration 已绑定 Surface。没有 DSH Session 时，Runtime 在首个 Turn 前创建并固定 1:1 binding；已有 binding 时复用原 Session。`followup` 只是当前 v1 向既有 Session 投递后续消息的内部桥，不属于目标 authoring 协议。

## 可执行语义

[`examples/orchestrate-code/delegate/`](../examples/orchestrate-code/delegate/) 是规范 delegate 样例：Registration 绑定两个预先存在的 Surface；代码把 coordinator 中由 Event payload 定位的问题写入 researcher，再推进 researcher；完成 Event 到达后，代码把结果写回 coordinator 并推进它。[`examples/orchestrate-code/fanout-join/`](../examples/orchestrate-code/fanout-join/) 把同一问题派到两个预先存在的 explorer，并只在两个 `exploration.completed` 都进入 Input Ledger 后写回 coordinator。[`examples/orchestrate-code/serial-loop/`](../examples/orchestrate-code/serial-loop/) 则先串行推进 worker，未收敛时改写并再次推进同一 Surface，收敛后才把结果交回 coordinator。

每个样例的 `orchestrate.py` 是 `when / who / how` 的真源，`registration.json` 是装配真源，目录中的 Contract 是 Event payload 真源。[`scripts/validate-schemas.mjs`](../scripts/validate-schemas.mjs) 实际执行 delegate、fan-out、join、serial 和 loop，并验证输入、Surface 集合、文件传递、Event capability、result 和持久记录的一致性。

这些 pattern 都只是普通条件和文件操作的可复用写法，不是 Runtime 原语。未来若引入取消、超时、并发上限或补偿，必须先定义持久事实、fold、恢复和测试。
