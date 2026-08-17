# @pf-worksurface/dsh

[English](README.md) | 中文

`@pf-worksurface/dsh` 将 WorkSurface 挂载为 DeepSeek Harness `Service`。它把 canonical 文件置于已认证 Host 之后，为 parent model 提供一个普通脚本 orchestration tool，并通过公开的 Sandbox、Subprocess、Subagent、Tool 和 ShellEnv seam，把文件 Projection 委派给子 Agent。

## 安装

`0.1.0-rc.5` 包族以 DeepSeek Harness `0.1.0-rc.6` 为目标。`/dsh` 包依赖匹配的 `/core` 和 `/cli` 包，因此 consumer 只需安装一个包。发布的包同时是 DSH 组合包；其默认配置项把状态存放在 Harness home 下，并使用 base profile 的进程内 `spawn` Subagent provider。

把插件安装到标准 Web profile。Harness plugin command 会识别其 bundle metadata，并把它追加到该 profile 的现有 bundle 之后：

```sh
dsh plugin --profile web add '@pf-worksurface/dsh@0.1.0-rc.5'
dsh --profile web --dump-config
dsh plugin --profile web exec ws --version
```

同一条 `add` command 可以换成其他 profile name，并保留其现有 bundle 顺序。Profile 层的 `cordis.patch.yml` 可以覆盖插入的 `pf-worksurface` 配置项；由于 patch 会替换整个 `config`，覆盖时必须重述所有需要保留的字段。

安装或升级后，需要重启所有已经加载该 profile 的 DSH process，然后新建一个 Agent task 来验证组装后的请求。现有 process 会继续运行它在启动时加载的 package code。

## Runtime 契约

Service 会在组装 Agent 的第一个模型请求前，为每个 Agent session 创建一个确定性的持久 root Surface。Fresh root 以目标、验收条件、已知事实与约束、假设、未决问题、当前决策，以及带证据的交付物等标题开始。Parent 使用 Bash 或 Python 源码调用 `run_orchestrator`；省略 `rootSurface` 或传入空白值时会选择该 session root。Service 创建私有 attempt 目录，原样写入脚本，使用 Harness `workspace-write` policy 对其进行限制，并且只暴露生成的 `ws` wrapper 和 attempt-scoped credentials。Canonical storage 位于 sandbox 之外，也绝不会放进 child environment。

Plugin activation 会等待 canonical store、session template 和已认证 Host socket 全部就绪。无效的持久 root、socket placement、profile 与数值限制会拒绝 activation，不会留下只挂载了一部分的 tool surface。

Host 对每个 NDJSON 请求进行授权。Orchestrator 只能访问其 attempt 创建或纳入的 Surface。Child credential 更窄：它只能查看被分配的 Surface，并且只能 commit 精确分配给它的 checkout。Service 还会阻止其他 model tool 接收 canonical root path。

`ws agent run` 编译 revision-pinned Projection，物化新的 checkout，启动 in-process Subagent provider，并要求 child 返回 `{ surface, surfaceRevision, summary, outputs }`。只有在被分配 Surface 已产生新 commit，且每个 output 都指向该精确当前 revision 中存在的 Block 时，完成结果才会被接受。Final prose 绝不会作为结果 fallback。

每个外部 effect 都按 attempt 与 key 记入 journal。发生在 `HEAD` 发布后的 crash 可从 commit record 对账；由 signal 终止的 Orchestrator 最多按 `maxCrashReplays` 重放；service 会等待进行中的 child operation 达到静止状态，之后才释放 attempt authority。

## 配置

`root` 是必填项，必须是 operating-system temporary root 之外的持久路径。`profiles` 是非空列表；每个 profile 指定 `name`、Subagent `provider`、Projection `tokenBudget`、`maxDepth`、`maxParallel`，以及可选的 `toolAllow`、`persona`、`agentProvider` 和 `agentModel`。

`attemptsRoot` 默认位于 `root` 下方。`socketPath` 默认使用私有 `~/.pf-worksurface/run` 目录中按 root hash 命名的 socket，避免长 `root` 触发 Unix socket path limit；`cliEntrypoint` 从已安装 CLI package 解析。`orchestratorGraceMs` 默认为 5000，`maxOutputBytes` 默认为 1 MiB，`maxCrashReplays` 默认为 1。显式 socket 必须位于 `attemptsRoot` 外，并满足可移植的 Unix path limit。

Package default export 是 `WorkSurfaceService`；挂载后的 service 可通过 `ctx.workSurfaces` 使用。只读观测 lifecycle event 包括 `worksurface/attempt-start`、`worksurface/attempt-end`、`worksurface/agent-start` 和 `worksurface/agent-end`。

## 模型体验

### Parent orchestration tool

#### 模型看到什么

Parent 会得到静态 PF WorkSurface 指令、一个带有必填 `language` 与 `script` 参数及可选 `rootSurface` 参数的 `run_orchestrator` tool，以及作为持久 runtime context 的当前 session root Projection。指令定义正向与负向启用条件，区分可验证任务状态与隐藏推理，要求在委派前建立最低限度的首次使用状态，并把 child Surface 留给可独立负责的交付物。指令让模型通过 `ws --help` 发现命令，并通过 `ws help init` 获取文件编写指引。Projection 标明其 Surface 与 revision，并包含当前文件状态。Tool result 是 JSON，包含 root Surface、attempt identity、script hash、exit status、受限的 stdout/stderr、replay count 和最终 root revision。

#### Token 影响

插件挂载期间固定指令与 tool definition 始终存在。当前 Projection 会消耗数据相关的 token，最多达到 default profile 的近似 budget；每次调用追加一个渲染后的 JSON 结果，每条 output stream 的大小受 `maxOutputBytes` 限制。

#### KV Cache 影响

静态指令不包含 Surface id、revision、path 或 run identity，因此它与 tool definition 可作为跨 session 复用的 request prefix。当前 Projection 和每个结果位于该 prefix 之后，因为文件状态可能在请求之间变化。

### Child WorkSurface persona

#### 模型看到什么

每个 fresh child 会看到可选的 profile persona、被分配的 Surface id、编译后的 `Projection`、私有 working path、精确 base revision、必需的 `ws commit` 流程，以及结构化完成契约。

#### Token 影响

完整 `surface.md` 和被直接引用的 Block 正文会消耗数据相关的 token，最多达到 profile 的近似 Projection budget，此外还有固定的 commit 与 return 指令。

#### KV Cache 影响

由于 Surface 内容、revision 和 working path 会变化，persona 属于每次 run；它不会形成稳定的跨 run prefix。

## 已知限制与延期工作

- **仅支持 in-process child provider** — least-authority shell environment binding 依赖本地 child Agent identity；remote Subagent provider 会被拒绝。
- **macOS sandbox 证明具有平台特定性** — 已提供的 integration gate 在 macOS 上执行真实 Seatbelt profile；等价的 Landlock 和 Windows ACL integration coverage 仍延期。
- **没有 distributed Host** — 已认证 transport 是私有 local socket，canonical publication 假设一个共享文件系统。
- **observer containment 尚未隔离** — lifecycle listener 使用普通 Cordis event delivery，应保持 non-throwing。
