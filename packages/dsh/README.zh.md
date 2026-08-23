# @pf-worksurface/dsh

[English](README.md) | 中文

`@pf-worksurface/dsh` 将 WorkSurface 挂载为 DeepSeek Harness `Service`。`dsh-block-to-file` 负责把模型 file block 物化到最小权限 workspace；WorkSurface 把 canonical 文件置于已认证 Host 后方，提供一个普通脚本 orchestration tool，并向 child Agent 委派 revision-pinned Projection。

## 安装

`0.1.0-rc.6` 包族以 DeepSeek Harness `0.1.0-rc.6` 为目标。`/dsh` bundle 会先组合 `dsh-block-to-file`，并依赖匹配的 `/core` 与 `/cli` 包，因此 consumer 只需安装一个产品。默认配置把状态放在 Harness home 下，并使用 base profile 的进程内 `spawn` Subagent provider。

把插件安装到标准 Web profile。Harness plugin command 会识别其 bundle metadata，并把它追加到该 profile 的现有 bundle 之后：

```sh
dsh plugin --profile web add '@pf-worksurface/dsh@0.1.0-rc.6'
dsh plugin --profile web add '@pf-worksurface/web@0.1.0-rc.6'
dsh --profile web --dump-config
dsh plugin --profile web exec ws --version
```

第二行是可选的 Web 可视化伴侣，应放在 `/dsh` 之后安装。同一条 `add` command 可以换成其他 profile name，并保留其现有 bundle 顺序。Profile 层的 `cordis.patch.yml` 可以覆盖插入的 `pf-worksurface` 配置项；由于 patch 会替换整个 `config`，覆盖时必须重述所有需要保留的字段。

安装或升级后，需要重启所有已经加载该 profile 的 DSH process，然后新建一个 Agent task 来验证组装后的请求。现有 process 会继续运行它在启动时加载的 package code。

## Runtime 契约

每个 parent model step 开始前，Service 只为已经拥有 WorkSurface 状态的 Session 渲染 session root Projection；root Surface 及其 Agent Session binding 由首次 `work/` b2f 写入或首次 `run_orchestrator` 调用惰性创建，因此从不使用 WorkSurface 的 Session 不会产生任何持久状态。编译后的 Projection 按已解析 revision 缓存，未变化的状态在重复 step 中不会产生 canonical 读取。只有当 parent b2f 首次解析 `work/` 下的路径或执行 `run_orchestrator` 时，才会按需创建公开 `workspace/` 及其位于 `work/root` 的 revision-pinned checkout；普通源码路径继续相对于 parent Session workspace 解析。成功的 `work/root` 写入会经过 awaited publication barrier，在同消息工具执行前推进 canonical Surface revision。私有 `control/`、`runtime/` 和 `bin/` 始终位于 b2f 与 sandbox 边界之外。`run_orchestrator` 会认领这个 pending attempt，在同一公开 workspace 中执行原样 Bash 或 Python 源码，并提供 `ws` wrapper 与 attempt-scoped credentials。省略或留空 `rootSurface` 时使用 session root。Canonical storage 永不成为模型可写 root。

Plugin activation 会等待 canonical store、session template 和已认证 Host socket 全部就绪。无效的持久 root、socket placement、profile 与数值限制会拒绝 activation，不会留下只挂载了一部分的 tool surface。

Host 对每个 NDJSON 请求进行授权。Orchestrator 只能访问其 attempt 创建或纳入的 Surface。Child credential 更窄：它只能查看被分配的 Surface，并且只能 commit 精确分配给它的 checkout。Service 还会阻止其他 model tool 接收 canonical root path。

`ws agent run` 采用 file-first：可选的 `--from <template>` 会在 child 启动前先物化 Surface，因此启动阶段崩溃仍会留下持久恢复地址。随后 Host 编译 revision-pinned Projection，并创建唯一的 continuable Agent Session；每次重试和冷恢复都复用 write-once Surface/Session binding。每个 Activation 会在 prompt assembly 前从 binding 重建一次性 checkout 和新的最小权限 token。Child 必须只返回一个 JSON 对象 `{ surface, surfaceRevision, summary, outputs }`；只有新 commit 与所有精确 revision output 均验证通过才接受完成。

每个物理平级的 Surface 从文件创建起就拥有 append-only Work Session。刚物化但尚未绑定的 child Surface 是 provisional recovery anchor，暂不属于 WorkGraph；child 启动成功后才写入唯一的 Agent Session binding。新 binding 使用 v2 契约：delegated 记录必须声明 continuable execution、精确 task/input pin，并最终保存完整的已提交 completion。缺少版本的 v1 记录仍可读取，但不完整或只有 outputRevision 的旧委派会原样保留并拒绝冷恢复，不猜测、不替换。从 root 递归跟随已绑定记录得到 WorkGraph。顶层 Agent Session 对应 root Surface，delegated Agent Session 对应 child Surface，任一身份最多绑定一次。Attempt-local `result.json` 只是审计缓存，重启恢复以 canonical `binding.json` 中的 completion 为准；continuation 不可用时明确失败，不降级为 one-shot。超过 `unboundSurfaceRetentionMs` 的未绑定叶子 Surface 会完整移入 `canonical/orphans`，退出活跃命名空间但不删除 canonical revision。

每个外部 effect 都按 attempt 与 key 记入 journal。Attempt identity 同时包含不可变 control-script hash 与公开 workspace 的确定性 hash，因此同一脚本配不同 b2f 输入时不会错误 replay。不可变 commit 已落盘后的 crash 会通过幂等完成对应 Work Session 发布来恢复；由 signal 终止的 Orchestrator 最多按 `maxCrashReplays` 重放；service 会等待进行中的 child operation 达到静止状态，之后才释放 attempt authority。

## 配置

`root` 是必填项，必须是 operating-system temporary root 之外的持久路径。`profiles` 是非空列表；每个 profile 指定 `name`、Subagent `provider`、Projection `tokenBudget`、`maxDepth`、`maxParallel`，以及可选的 `toolAllow`、`persona`、`agentProvider` 和 `agentModel`。

`attemptsRoot` 默认位于 `root/runtime/orchestrator/runs`。`socketPath` 默认位于 `root/run/host.sock`，与 canonical、journal 和 attempts 统一在同一个数据根目录下；仅当 `root` 过长导致 socket path 超过可移植 Unix 限制时才回退到 `~/.pf-worksurface/run` 下的 hash 命名 socket。`cliEntrypoint` 从已安装 CLI package 解析。`orchestratorGraceMs` 默认为 5000，`maxOutputBytes` 默认为 1 MiB，`maxCrashReplays` 默认为 1，`attemptRetention` 默认为 10，`unboundSurfaceRetentionMs` 默认为七天。Attempt 目录名会带创建时间。每个 attempt 都包含私有 control/runtime 区和模型可写 `workspace/`；pending workspace 在被认领前不会被 GC。超过保留数量的旧 attempt 会把 `runtime/result.json` 与 `control/` 归档到 `runtime/orchestrator/attempt-results/` 后删除。过期未绑定叶子只在静止生命周期边界完整归档。显式 socket 必须位于 `attemptsRoot` 外，并满足可移植的 Unix path limit。

Package default export 是 `WorkSurfaceService`；挂载后的 service 可通过 `ctx.workSurfaces` 使用。只读观测 lifecycle event 包括 `worksurface/attempt-start`、`worksurface/attempt-end`、`worksurface/agent-start` 和 `worksurface/agent-end`。

## 模型体验

模型可见的提示词、工具描述、CLI 帮助与结构化契约集中在 `src/model/`（CLI 在 `packages/cli/src/help.ts`），并由 `packages/dsh/tests/model-awareness.spec.ts` 与 `packages/cli/tests/help.spec.ts` 固定。详见 `src/model/README.md`。

### Parent orchestration tool

#### 模型看到什么

Parent 会得到 b2f file-block 指令、静态 PF WorkSurface guidance、一个 `run_orchestrator` tool，以及（一旦 Session 拥有 WorkSurface 状态）当前 session root Projection。Projection 通过与 b2f 兼容的 file fence 携带完整 `surface.md` 和同 Surface Blocks；固定到 revision 的跨 Surface Blocks 以只读形式呈现。调用 tool 前，它可以通过 b2f 写入 `work/root/surface.md`、Blocks、模板和其他公开输入；脚本随后在完全相同的 workspace 中运行，并通过 `WS_WORKING_SURFACE`、`WS_WORKING_PATH` 与 `WS_BASE_REVISION` 定位预建 checkout。持久任务逻辑可以放在 `work/control/` 下的已提交控制文件中，并通过 `control` 参数执行，这样同一控制可以重跑以针对当前 workspace 状态重放任务；控制文件与其他定义一样按内容只存一份。Tool result 包含 root Surface、attempt identity、script hash、workspace hash、受限进程结果、replay count 和最终 root revision。

#### Token 影响

插件挂载期间固定指令与 tool definition 始终存在。只有已经拥有 WorkSurface 状态的 Session 才会渲染 Projection；它消耗数据相关的 token，最多达到 default profile 的近似 budget，且 Projection 按已解析 revision 缓存，未变化的状态不会产生 canonical 读取。每次调用追加一个渲染后的 JSON 结果，每条 output stream 的大小受 `maxOutputBytes` 限制。

#### KV Cache 影响

静态指令不包含 Surface id、revision、path 或 run identity，因此它与 tool definition 可作为跨 session 复用的 request prefix。当前 Projection 和每个结果位于该 prefix 之后，因为文件状态可能在请求之间变化。

### Child WorkSurface persona

#### 模型看到什么

每个 child Session 会看到可选的 profile persona、被分配的 Surface id、初始 `Projection`、精确 base revision、必需的 `ws commit` 流程，以及 JSON completion 契约。每个 fresh 或 cold-resumed Activation 还会得到权威的当前 Projection 和重建 checkout；该 checkout 同时是 b2f root，因此 file block 只能写 `surface.md` 与 `blocks/<block-id>.md`。

#### Token 影响

完整 `surface.md` 和被直接引用的 Block 文件会消耗数据相关的 token，最多达到 profile 的近似 Projection budget；放不下的 Block 会整份省略。此外还有固定的 commit 与 return 指令。

#### KV Cache 影响

由于 Surface 内容、revision 和 working path 会变化，persona 属于每次 run；它不会形成稳定的跨 run prefix。

## 真实模型评估

静态测试只能证明 guidance 和工具契约被提供，不能证明模型真的会用。真实模型的主动采用、正确跳过、根提交、Block/Surface 粒度、委派、冲突恢复、可追溯交付和稳定性用例维护在 [`evals/`](evals/README.zh.md)。

```sh
npm run eval:check
```

## 已知限制与延期工作

- **Child execution 必须 continuable** — 重启恢复要求 Agent continuation service 与具备 `prepareContinuable` 的 provider。缺少 continuation 能力的组合会在 binding 前明确失败，绝不创建 one-shot child。
- **macOS sandbox 证明具有平台特定性** — 已提供的 integration gate 在 macOS 上执行真实 Seatbelt profile；等价的 Landlock 和 Windows ACL integration coverage 仍延期。
- **没有 distributed Host** — 已认证 transport 是私有 local socket，canonical publication 假设一个共享文件系统。
