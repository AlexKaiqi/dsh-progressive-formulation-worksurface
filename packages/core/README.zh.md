# @pf-worksurface/core

[English](README.md) | 中文

`@pf-worksurface/core` 负责文件原生的 WorkSurface 领域：不可变的内容寻址 revision、每个平级 Surface 一条 append-only Work Session、不可变 Orchestrator definition、经校验的 working copy commit、直接引用 Projection，以及可重放的 effect 记录。它不依赖 DeepSeek Harness Agent loop。

## 文件契约

一个 Surface 是包含 `surface.md` 和 `blocks/<block-id>.md` 的目录。Runtime 所有的 YAML front matter 将每份文档绑定到其 Surface 与 Block 身份；可编辑 Markdown 仍是普通 UTF-8 文本。引用使用 `[[block:<surface-id>/<block-id>]]`。

创建 Surface 时会把 Runtime 所有的身份实例化到模板中。Commit 会校验整个 working copy，拒绝悬空引用和 metadata/path 不一致，禁止物理删除 Block，并比较调用者的 base revision 与从 Session fold 得到的当前 head。每个被接受的快照先按其 SHA-256 revision 存储，再由 Work Session event 正式发布；`HEAD.json` 只是可修复投影。

每个 `canonical/surfaces/<surface-id>` 目录还包含 `session/header.json`、物化的 Session `HEAD.json`、连续的不可变事件，以及委派后唯一的 write-once `binding.json`。Child Surface 在磁盘上仍与父级平级；`graphSnapshot()` 递归跟随与 DSH Session 树对齐的委派记录。没有委派记录的 Surface 是不可达 orphan，不属于 WorkGraph。详见 [`../../docs/work-session-storage.zh.md`](../../docs/work-session-storage.zh.md)。

## 公共 API

`WorkSurfaceStore` 提供 `newSurface`、`checkout`、`commit`、`readHead`、`readSnapshot`、`readBlock`、`validateOutputRefs`、`history`、`readWorkSession`、`defineOrchestrator` 和 `readOrchestratorDefinition`。`store.sessions` 提供类型化、幂等的事件追加与回放。修改操作要求 attempt id 和稳定的幂等 key。使用相同请求复用 key 会返回已记录结果；用不同参数复用会以 `idempotency-key-conflict` 失败。

`ProjectionCompiler.compile` 保留完整的 `surface.md`，按顺序收集直接引用 Block 的完整文件，并固定每个 Block revision。超出近似预算的文件会被整份省略，而不会截断后伪装成完整文件。`compilePinned` 从显式 revision pins 重建相同的文件 Projection。

`WorkSurfaceError` 携带稳定的 `code` 和 JSON-safe `details`。调用方应按 code 分支，而不是依赖消息文本。

## 模型体验

通过 `@pf-worksurface/dsh` 间接产生；后者会把编译后的文件 Projection 放入每个被委派子 Agent 的 persona。

#### KV Cache 影响

没有直接影响；消费方插件负责 request assembly 和 cache-prefix 行为。

## 已知限制与延期工作

- **仅直接引用** — Projection 收集不会递归收集 Block 正文中出现的引用。
- **近似 token 预算** — 编译器按每个请求 token 预留四个字符，而不调用模型特定 tokenizer。
- **单 Host 文件系统协调** — 原子文件和可恢复 lock 可保护本地并发进程；分布式 writer 需要不同的发布后端。
- **仅逻辑删除** — 调用方可以改变 status metadata，但 commit 不能物理移除已有 Block。
