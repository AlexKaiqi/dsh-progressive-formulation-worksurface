# @pf-worksurface/dsh

[English](README.md) | 中文

`@pf-worksurface/dsh` 将 WorkSurface 挂载为 DeepSeek Harness `Service`。`@deepseek-ai/dsh-block-to-file` 负责把模型 file block 物化到最小权限 workspace；WorkSurface 把 canonical 文件置于已认证 Host 后方，提供一个普通脚本 orchestration tool，并向 child Agent 委派 revision-pinned Projection。

## 安装

`0.1.0-rc.5` 包族以 DeepSeek Harness `0.1.0-rc.6` 为目标。`/dsh` bundle 会先组合 `@deepseek-ai/dsh-block-to-file`，并依赖匹配的 `/core` 与 `/cli` 包，因此 consumer 只需安装一个产品。默认配置把状态放在 Harness home 下，并使用 base profile 的进程内 `spawn` Subagent provider。

把插件安装到标准 Web profile。Harness plugin command 会识别其 bundle metadata，并把它追加到该 profile 的现有 bundle 之后：

```sh
dsh plugin --profile web add '@pf-worksurface/dsh@0.1.0-rc.5'
dsh plugin --profile web add '@pf-worksurface/web@0.1.0-rc.5'
dsh --profile web --dump-config
dsh plugin --profile web exec ws --version
```

第二行是可选的 Web 可视化伴侣，应放在 `/dsh` 之后安装。同一条 `add` command 可以换成其他 profile name，并保留其现有 bundle 顺序。Profile 层的 `cordis.patch.yml` 可以覆盖插入的 `pf-worksurface` 配置项；由于 patch 会替换整个 `config`，覆盖时必须重述所有需要保留的字段。

安装或升级后，需要重启所有已经加载该 profile 的 DSH process，然后新建一个 Agent task 来验证组装后的请求。现有 process 会继续运行它在启动时加载的 package code。

## Runtime 契约

每个 parent model step 开始前，Service 会创建 session 的持久 root Surface 和一个 pending attempt。公开的 `workspace/` 被注册为该 Agent 的 b2f root，并在 `work/root` 放置 revision-pinned root checkout；私有 `control/`、`runtime/` 和 `bin/` 始终位于 b2f 与 sandbox 边界之外。`run_orchestrator` 会认领这个 pending attempt，在同一公开 workspace 中执行原样 Bash 或 Python 源码，并提供 `ws` wrapper 与 attempt-scoped credentials。省略或留空 `rootSurface` 时使用 session root。Canonical storage 永不成为模型可写 root。

Plugin activation 会等待 canonical store、session template 和已认证 Host socket 全部就绪。无效的持久 root、socket placement、profile 与数值限制会拒绝 activation，不会留下只挂载了一部分的 tool surface。

Host 对每个 NDJSON 请求进行授权。Orchestrator 只能访问其 attempt 创建或纳入的 Surface。Child credential 更窄：它只能查看被分配的 Surface，并且只能 commit 精确分配给它的 checkout。Service 还会阻止其他 model tool 接收 canonical root path。

`ws agent run` 编译 revision-pinned Projection，物化新的 checkout，启动 in-process Subagent provider，并要求 child 返回 `{ surface, surfaceRevision, summary, outputs }`。只有在被分配 Surface 已产生新 commit，且每个 output 都指向该精确当前 revision 中存在的 Block 时，完成结果才会被接受。Final prose 绝不会作为结果 fallback。

每个物理平级的 Surface 从创建起就拥有一条 append-only Work Session。父 Work Session 记录直接 child 的创建与执行边界，child Work Session 记录自己的 revision 与 Agent attachment；递归 fold 这些局部历史得到 WorkGraph。顶层 Agent Session 附着 root Surface，delegated Agent Session 附着 Child Surface，任一身份都只能附着一次。Child 实际读取的 Projection revision 保存在 canonical Work Session 事件中，用于构建可审计的信息依赖图。Orchestrator program 按内容寻址保存在 `canonical/orchestrator/definitions/<sha256>`；run 生命周期事实留在调用方 Surface Session，attempt workspace 仍只是 runtime state。Web profile 可另外安装 `@pf-worksurface/web` 来显示该图与各节点的关联对话。

每个外部 effect 都按 attempt 与 key 记入 journal。Attempt identity 同时包含不可变 control-script hash 与公开 workspace 的确定性 hash，因此同一脚本配不同 b2f 输入时不会错误 replay。不可变 commit 已落盘后的 crash 会通过幂等完成对应 Work Session 发布来恢复；由 signal 终止的 Orchestrator 最多按 `maxCrashReplays` 重放；service 会等待进行中的 child operation 达到静止状态，之后才释放 attempt authority。

## 配置

`root` 是必填项，必须是 operating-system temporary root 之外的持久路径。`profiles` 是非空列表；每个 profile 指定 `name`、Subagent `provider`、Projection `tokenBudget`、`maxDepth`、`maxParallel`，以及可选的 `toolAllow`、`persona`、`agentProvider` 和 `agentModel`。

`attemptsRoot` 默认位于 `root/runtime/orchestrator/runs`。`socketPath` 默认位于 `root/run/host.sock`，与 canonical、journal 和 attempts 统一在同一个数据根目录下；仅当 `root` 过长导致 socket path 超过可移植 Unix 限制时才回退到 `~/.pf-worksurface/run` 下的 hash 命名 socket。`cliEntrypoint` 从已安装 CLI package 解析。`orchestratorGraceMs` 默认为 5000，`maxOutputBytes` 默认为 1 MiB，`maxCrashReplays` 默认为 1，`attemptRetention` 默认为 10。Attempt 目录名会带创建时间。每个 attempt 都包含私有 control/runtime 区和模型可写 `workspace/`；pending workspace 在被认领前不会被 GC。超过保留数量的旧 attempt 会把 `runtime/result.json` 与 `control/` 归档到 `runtime/orchestrator/attempt-results/` 后删除。显式 socket 必须位于 `attemptsRoot` 外，并满足可移植的 Unix path limit。

Package default export 是 `WorkSurfaceService`；挂载后的 service 可通过 `ctx.workSurfaces` 使用。只读观测 lifecycle event 包括 `worksurface/attempt-start`、`worksurface/attempt-end`、`worksurface/agent-start` 和 `worksurface/agent-end`。

## 模型体验

模型可见的提示词、工具描述、CLI 帮助与结构化契约集中在 `src/model/`（CLI 在 `packages/cli/src/help.ts`），并由 `packages/dsh/tests/model-awareness.spec.ts` 与 `packages/cli/tests/help.spec.ts` 固定。详见 `src/model/README.md`。

### Parent orchestration tool

#### 模型看到什么

Parent 会得到 b2f file-block 指令、静态 PF WorkSurface guidance、一个 `run_orchestrator` tool，以及当前 session root Projection。Projection 通过与 b2f 兼容的 file fence 携带完整 `surface.md` 和同 Surface Blocks；固定到 revision 的跨 Surface Blocks 以只读形式呈现。调用 tool 前，它可以通过 b2f 写入 `work/root/surface.md`、Blocks、模板和其他公开输入；脚本随后在完全相同的 workspace 中运行，并通过 `WS_WORKING_SURFACE`、`WS_WORKING_PATH` 与 `WS_BASE_REVISION` 定位预建 checkout。Tool result 包含 root Surface、attempt identity、script hash、workspace hash、受限进程结果、replay count 和最终 root revision。

#### Token 影响

插件挂载期间固定指令与 tool definition 始终存在。当前 Projection 会消耗数据相关的 token，最多达到 default profile 的近似 budget；每次调用追加一个渲染后的 JSON 结果，每条 output stream 的大小受 `maxOutputBytes` 限制。

#### KV Cache 影响

静态指令不包含 Surface id、revision、path 或 run identity，因此它与 tool definition 可作为跨 session 复用的 request prefix。当前 Projection 和每个结果位于该 prefix 之后，因为文件状态可能在请求之间变化。

### Child WorkSurface persona

#### 模型看到什么

每个 fresh child 会看到可选的 profile persona、被分配的 Surface id、编译后的 `Projection`、精确 base revision、必需的 `ws commit` 流程，以及结构化完成契约。它的精确 checkout 同时也是 b2f root，因此 file block 只能写 `surface.md` 与 `blocks/<block-id>.md`。

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

- **仅支持 in-process child provider** — least-authority shell environment binding 依赖本地 child Agent identity；remote Subagent provider 会被拒绝。
- **macOS sandbox 证明具有平台特定性** — 已提供的 integration gate 在 macOS 上执行真实 Seatbelt profile；等价的 Landlock 和 Windows ACL integration coverage 仍延期。
- **没有 distributed Host** — 已认证 transport 是私有 local socket，canonical publication 假设一个共享文件系统。
- **observer containment 尚未隔离** — lifecycle listener 使用普通 Cordis event delivery，应保持 non-throwing。
