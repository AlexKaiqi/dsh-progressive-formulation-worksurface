# WorkSurface 平台适配边界

WorkSurface 不是 DSH 的 Session 插件模型，而是可以被多个宿主承载的一套工作设计。当前仓库把责任分成四层：

| 层 | 位置 | 可以知道什么 | 不应该知道什么 |
| --- | --- | --- | --- |
| 领域事实 | `packages/core` | Surface、Revision、Event、Contract、Registration、Ledger、不可变校验 | Agent、Session 实现、Prompt 注入方式 |
| 设计材料 | `packages/design` | WorkSurface 的适用判断、Surface/Orchestrate 边界、维护标准、模型指导模板 | DSH API、pi API、宿主目录和命令 |
| 推进 Runtime | `packages/runtime` | replay、Activation、record-before-effect、apply、settle、恢复，以及 `SurfacePort` / `EventPort` | 如何创建 Agent、如何启动 Turn、如何把文本送进宿主 |
| 宿主 Adapter | `packages/dsh`；未来 `packages/pi` | Session/Turn、文件路径、上下文注入、外部事件映射、followup、受控 subprocess | 重写 Surface 语义、推进状态机和恢复规则 |

## 模型上下文

`packages/design/src/model-guidance.ts` 是固定语义来源。它只回答四件事：

1. 什么情况下值得使用 WorkSurface；
2. Surface 记录什么，以及一个 Surface 的目标边界；
3. 普通宿主 Session、Surface 和 Orchestrate 的分工；
4. 模型从哪里开始使用这项能力。

宿主只提供具体 locator 和入口。例如 DSH adapter 把 authoring help 渲染为 `"$DSH_WORKSURFACE_CLI" help author`，把绑定 Session 的工作目录渲染为 `$DSH_SURFACE_DIR`。因此模型始终得到“这是什么”和“可以怎么用”，但平台路径、命令和生命周期不会进入平台无关设计。若 DSH 的 persistent shell 没有消费 shell-env overlay，DSH adapter 可以声明当前 cwd/PATH fallback；Turn Brief locator 缺失时必须 fail closed，不能让模型猜路径。

固定 guidance 保持在 1200 字符以内；详细 schema、字段和恢复步骤继续按需放在宿主命令的 help 中。绑定到具体 Surface 后，adapter 再注入包含 Turn Brief locator 的 Session 指令。

## 推进接口

Runtime 只依赖两类端口：

- `WorkSurfaceEventPort`：读写 Surface/Registration 事实，并向目标 Surface 请求一个 opaque followup receipt；
- `CodeFirstSurfacePort`：读取和应用 Revision、解析宿主产生的外部输入、请求一次 Surface advance。

DSH 的实现位于 `DshCodeFirstSurfacePort`、`SurfaceSessionService` 和 `DshWorkSurfaceSessionAdapter`。pi adapter 应提供相同语义的端口，但可以把 `executionId` 映射为 pi 的 session、thread 或 job identity；Runtime 不需要知道这个选择。

任何新增平台都不得把宿主类型直接引入 `design` 或 `runtime`。若某个语义确实跨平台，应先提升为明确的 core/design/runtime 类型，并同时补 schema、维护标准和 adapter contract 测试。
