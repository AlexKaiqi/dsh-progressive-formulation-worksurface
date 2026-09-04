# Context-as-repo 演进时间线：Codex TokenBudget 与 Letta Code MemFS

审计时间：2026-09-04。本文只回答“这些机制何时进入代码、实际做了什么”，不把产品文案或 README 当成运行时事实。

## 结论先行

1. **“Codex 在 PR #27488 就把旧压缩干掉了”不成立。** 2026-06-11 合并的 #27488 只加入模型主动调用的 `new_context`，而同一版本中，达到 token limit 后的自动路径仍调用 `run_auto_compact`。真正让 **TokenBudget 模式的手动与自动 compaction 都跳过摘要、直接切 fresh window** 的是 12 天后的 #29743（2026-06-23）。
2. **#39827 不是取消压缩的提交。** 它在 2026-08-21 才加入 History/Notes，为无摘要换窗提供按需检索旧历史、保存工作状态的恢复层。
3. **Codex 这一套是“外部状态 + 按需检索”，不是 context-as-repo。** Notes 是 Codex backend 上的虚拟路径，不是项目文件或 Git repo；九个工具也没有 schema defer-loading。称为“内容渐进披露”准确，称为“Context as Repo”超出代码证据。
4. **Letta Code 更早且更接近真正的 context-as-repo。** 它在 2025-11-07 已将 progressive disclosure 用于文件式 Skills；在该开源仓库可追溯的 `main` 历史中，MemFS 于 2026-01-26 开 PR、01-27 合并文件树双向同步，02-11 合并 Git-backed MemFS；Letta 于 02-12 正式发布 “Context Repositories” 博文，03-12 又在 memory system prompt 中明确写出 progressive disclosure。
5. **Letta 也不是第一天就有今天的完整形态。** 一等写工具、确定性 post-turn 同步、harness 管理的 worktree、`MEMORY.md` 分层索引、容量/深度约束，分别在 3 月、6 月、7 月、8 月逐步补齐。

## 审计口径

### 固定源码

- OpenAI Codex：[`8e6a44b428e31f91b21edc97904fcdf4f0931ade`](https://github.com/openai/codex/commit/8e6a44b428e31f91b21edc97904fcdf4f0931ade)，本地只读 sparse checkout：`docs/research/context-as-repo/sources/core/openai-codex`。
- Letta Code：[`feb32e33c4f4badd546e75b70ef202283d6580da`](https://github.com/letta-ai/letta-code/commit/feb32e33c4f4badd546e75b70ef202283d6580da)，本地只读 sparse checkout：`docs/research/context-as-repo/sources/core/letta-code`。
- 历史时间由 GitHub Pull Requests API 的 `created_at`、`merged_at`、`merge_commit_sha` 与完整 Git commit history 交叉核对；下文时间统一为 UTC。
- “进入仓库”默认指 merge commit 已进入当前 `origin/main` 的祖先链。PR 创建时间另列，避免把开发开始和进入主干混为一谈。
- 本审计只能确定 **`letta-ai/letta-code` 开源仓库** 的最早可验证时间；Letta 服务端 Git endpoint 的实现不在该仓库中，不能据此断言整个 Letta 平台的全球最早时间。

### 证据标签

| 标签 | 含义 | 能证明什么 |
|---|---|---|
| **I** | Implementation | runtime 中真实执行或强制的行为 |
| **T** | Test | 测试明确锁定的预期行为 |
| **D** | Docs / prompt / UI copy | 给模型或人的说明；本身不等于 runtime enforcement |
| **C** | Config / rollout | 开关、默认状态、发布范围 |

文中的“事实”必须能由 I/T/D/C 证据直接支持；“推断”只做架构归纳，不作为实现事实。

## 一张时间线

| 时间（UTC） | 项目 | 事实（证据类型） | 架构解释（推断） |
|---|---|---|---|
| 2025-11-07 20:02 PR 创建；23:00 合并 | Letta [#76](https://github.com/letta-ai/letta-code/pull/76), [`ea31315`](https://github.com/letta-ai/letta-code/commit/ea313159ce7fd1b816a1aa5b1cc4cc2373cabc3b) | **I/D**：递归发现 `SKILL.MD`，只把 name/description/id/path 目录写进始终可见的 `skills` block；prompt 明确称其为 progressive disclosure，要求相关时才读完整 `SKILL.md`，其引用文件再按需读。 | 这是该仓库最早可验证的显式文件式渐进披露，但对象是 Skills，不是任意 working context 或 MemFS。 |
| 2026-01-26 21:32 PR 创建；01-27 05:48 合并 | Letta [#685](https://github.com/letta-ai/letta-code/pull/685), [`7ab97e4`](https://github.com/letta-ai/letta-code/commit/7ab97e404d2dfdd01755ff4552386f2329e2d204) | **I/T/D**：block ↔ Markdown 文件双向同步、内容 hash、冲突集合、始终可见的文件树；`user/` 文件不附着到 system prompt。 | 这是最早可验证的“文件化外部记忆 + 路径发现”，但还不是 Git-backed repo。 |
| 2026-02-11 02:00 PR 创建；02:06 合并 | Letta [#905](https://github.com/letta-ai/letta-code/pull/905), [`d1a6eeb`](https://github.com/letta-ai/letta-code/commit/d1a6eeb40a12583d4e82b78f9769ec9bfcdeb54d) | **I/T/D**：每个 agent 的 memory 变成 Git repo；首跑 clone、启动 pull、pre-commit 校验；服务端 remote 为 `/v1/git/{agent}/state.git`。 | 从这里开始，称其为 Git-backed context repository 有代码依据。 |
| 2026-02-11 02:16 PR 创建；02:25 合并 | Letta [#906](https://github.com/letta-ai/letta-code/pull/906), [`a695410`](https://github.com/letta-ai/letta-code/commit/a69541004bc8ab3302f0c53f659fb9bb3caa3429) | **D**：后台 reflection agent 被要求搜索旧消息、选择性改写 memory，并手工创建/合并 Git worktree。 | “睡眠式整理”已出现，但这时 worktree 生命周期主要靠 prompt 指挥，不是可靠的 runtime 状态机。 |
| 2026-02-12（页面发布日期） | Letta [Context Repositories 公告](https://www.letta.com/blog/context-repositories/) | **D/C**：正式以 “Context Repositories: Git-based Memory for Coding Agents” 发布；说明本地 clone、始终可见的 file tree、`system/` pinned 内容、description 驱动的 progressive disclosure，以及 worktree/reflection/defrag 方向。 | 这是目前找到的最早官方产品命名；其中机制声明仍需与开源代码各自核对，不能把博客中的整套能力倒推为 02-12 已全部 runtime-hardening。 |
| 2026-03-10 PR 创建；03-12 02:47 合并 | Letta [#1313](https://github.com/letta-ai/letta-code/pull/1313), [`591e663`](https://github.com/letta-ai/letta-code/commit/591e6638cc324d5db7ac2e35198c556ee843b526) | **D**：实际 MemFS system prompt 首次明确写出 `description` 支持 “progressive disclosure”，并区分始终在上下文的 `system/` 与按需读取的 progressive memory。 | 这是“渐进披露”这个命名在该仓库实际模型提示中的最早可验证落点；机制雏形早于命名。 |
| 2026-03-12 PR 创建；03-15 20:08 合并 | Letta [#1363](https://github.com/letta-ai/letta-code/pull/1363), [`d6856fa`](https://github.com/letta-ai/letta-code/commit/d6856fa5da4d52c04a2a7ed96ba2ba3f8d1e19b1) | **I/T/D**：加入一等 `memory` mutation tool；路径限制在 memory repo 内；每次有效写入 stage、commit、push，并记录 agent 作者身份与 reason。 | 模型从“用 Bash 自觉维护 repo”推进到受约束的事务式写入口。 |
| 2026-03-15 23:54 PR 创建；03-16 01:54 合并 | Letta [#1396](https://github.com/letta-ai/letta-code/pull/1396), [`cc32bb5`](https://github.com/letta-ai/letta-code/commit/cc32bb5d8d0516636fcada362c69c9cc6a2829b7) | **D/C**：Welcome UI 把 MemFS 明确括注为 “context repositories”，未启用时告警。 | 这是该仓库主干中“context repositories”产品命名的最早可验证落点，不是机制的首次实现。 |
| 2026-04-03 00:22 PR 创建；01:08 合并 | Letta [#1642](https://github.com/letta-ai/letta-code/pull/1642), [`08088b5`](https://github.com/letta-ai/letta-code/commit/08088b5b18cfa2e8bd188c5d5d5fdc99f32df705) | **D/T**：仅修改 system prompt、Memory tool description 与 prompt test，要求模型用 `[[path]]` 建立发现路径并维护引用。 | 这是约定驱动的索引，不是 runtime 解析器或自动 backlink 图。 |
| 2026-05-04 00:51 PR 创建；01:33 合并 | Letta [#2066](https://github.com/letta-ai/letta-code/pull/2066), [`a497fce`](https://github.com/letta-ai/letta-code/commit/a497fcee4c0db36822dd41bf5f996e9496467ca3) | **I/T**：加入 local system-prompt compiler：扫描 Markdown、计算 revision；内联 system memory，只渲染 external tree，并缓存按 conversation 的编译结果。 | repo 不只是存储，开始成为可重复编译的 context source。 |
| 2026-05-04 03:30 PR 创建；05-06 08:34 合并 | Letta [#2076](https://github.com/letta-ai/letta-code/pull/2076), [`91a9928`](https://github.com/letta-ai/letta-code/commit/91a9928fa5fed207018c7ce8eaff23840888b053) | **I/T/D**：本地 backend 初始化本地 Git MemFS；每轮用 committed HEAD 检查 freshness，revision 改变才重新编译；本地写只需 commit，无远端依赖。 | 形成清晰的 `repo HEAD → compiled prompt` freshness 契约。 |
| 2026-06-02 PR 创建；06-05 00:59 合并 | Letta [#2677](https://github.com/letta-ai/letta-code/pull/2677), [`4f851ef`](https://github.com/letta-ai/letta-code/commit/4f851eff54f8a45b93ad3059714dc2c4e979b948) | **I/T/D**：把远端 MemFS push 从模型提示/单个工具移入确定性的 post-turn harness；dirty/conflict/push failure 变成显式状态与 reminder。 | 从“模型记得同步”升级为 runtime 收口的提交/同步协议。 |
| 2026-06-10 18:54 PR 创建；06-11 03:07 合并 | Codex [#27438](https://github.com/openai/codex/pull/27438), [`658af93`](https://github.com/openai/codex/commit/658af936fdd04cd2661e253b4fe78d769aef8534) | **I/T/C**：TokenBudget 向模型暴露 window id 与剩余 token，并在阈值处更新提醒。 | 先让模型看见预算，尚未改变所有 compaction 行为。 |
| 2026-06-10 22:59 PR 创建；06-11 03:39 合并 | Codex [#27488](https://github.com/openai/codex/pull/27488), [`87ab018`](https://github.com/openai/codex/commit/87ab01834af30cfae99014ca93035d3068716b3f) | **I/T/C**：加入 direct-model-only `new_context`；模型主动请求后，旧 history 不做摘要，换为 fresh initial context。自动 token-limit 路径仍调用旧 `run_auto_compact`。 | 这是无摘要换窗的 model-requested escape hatch，不是全面取消压缩。 |
| 2026-06-23 22:33 PR 创建；23:52 合并 | Codex [#29739](https://github.com/openai/codex/pull/29739), [`3b41869`](https://github.com/openai/codex/commit/3b4186986f5f67aa324721d22d81e4f1501fd131) | **D**：工具说明明确换窗“不清除、重置或影响 environment state”。 | context 生命周期与外部环境生命周期被明确解耦。 |
| 2026-06-23 22:59 PR 创建；23:59 合并 | Codex [#29743](https://github.com/openai/codex/pull/29743), [`32b65bb`](https://github.com/openai/codex/commit/32b65bbf7a304f9231d81226ed3bb649739b73a6) | **I/T**：TokenBudget 的 manual 与 inline auto compaction 都改为跳过 model/server summary、调用 `start_new_context_window`；仍保留 compaction hooks/items 生命周期。 | 这是“TokenBudget 模式干掉摘要压缩”的准确提交与日期。 |
| 2026-07-03 00:32 PR 创建；01:45 合并 | Letta [#3202](https://github.com/letta-ai/letta-code/pull/3202), [`7fd73a8`](https://github.com/letta-ai/letta-code/commit/7fd73a8c2b312f7c4f216cb95d0c2b2dd145a390) | **I/T/C**：删除用户侧 non-MemFS opt-outs，新建 agent 默认带 MemFS；stateless subagent 仍是内部 carve-out。 | context repo 从可选能力变为默认 agent substrate。 |
| 2026-06-26 PR 创建；07-06 17:56 合并 | Letta [#3125](https://github.com/letta-ai/letta-code/pull/3125), [`ce8bbb7`](https://github.com/letta-ai/letta-code/commit/ce8bbb73030b84d0a5d3b4707d0369e4ea4b5351) | **I/T/D**：harness 创建 reflection worktree、收口 merge/cleanup，并实现 `merged`、`pending_conflict`、`pending_manual_merge`、`dirty_uncommitted`、`failed` 等结果状态。 | 2 月 prompt 中的手工 worktree 方案到这里才成为可恢复的 runtime 协议。 |
| 2026-07-07 18:08 PR 创建；20:18 合并 | Letta [#3251](https://github.com/letta-ai/letta-code/pull/3251), [`9bac6fe`](https://github.com/letta-ai/letta-code/commit/9bac6fed8f355426057301f725ff575b3a3e647c) | **I/T/D**：`dream --to` 每次先把共享 repo 文档 reseed 到 MemFS，reflection 成功后再导出；commit 失败则回滚未提交文件。 | 这是范围明确的 “repo-as-truth” workflow，不是所有 agent memory 的统一真相源。 |
| 2026-08-21 01:11 PR 创建；01:26 合并 | Codex [#39827](https://github.com/openai/codex/pull/39827), [`daa4807`](https://github.com/openai/codex/commit/daa48072f4f507221da313a748c3f7c551ae5500) | **I/T/C**：新增 4 个 History read/search 工具与 5 个 Notes list/read/search/append/write 工具；请求经 Codex backend，带 trusted session/agent identity 和严格边界。 | 无摘要 reset 两个月后才有第一方外部恢复层。 |
| 2026-08-25 04:05 PR 创建；04:07 合并 | Codex [#40539](https://github.com/openai/codex/pull/40539), [`2e46759`](https://github.com/openai/codex/commit/2e4675919ee9c90a0b1360e0826fe7117d71cebb) | **I/T**：新 window 启动时可注入 backend `thread_hint`，上限 4,000 bytes；失败、空值或超限都不注入。 | 采用“小 bootstrap hint + 大内容按需读”的二级披露。 |
| 2026-08-27 23:20 PR 创建；08-28 01:07 合并 | Letta [#4085](https://github.com/letta-ai/letta-code/pull/4085), [`b2c7560`](https://github.com/letta-ai/letta-code/commit/b2c7560ebd6db1bc5b41200cfd26a7ad04c83034) | **I/T/D**：API-backed repo 的根 `MEMORY.md` 选择 root-first layout；每个子目录必须有 `MEMORY.md` 才能投影其子文件；tool schema、prompt 与 pre-commit 使用同一布局选择。 | 这是从扁平 tree + 软引用升级为 runtime 强制的分层 manifest/index。 |
| 2026-08-28 22:18 PR 创建；23:05 合并 | Letta [#4105](https://github.com/letta-ai/letta-code/pull/4105), [`9047f71`](https://github.com/letta-ai/letta-code/commit/9047f71c38a8acb80518954c71bcc70959d879c2) | **I/T/C**：可追踪 `.memfs.config.json` 约束文件字符数、glob override 与最大深度；pre-commit 对 staged snapshot 执行；普通提交不能修改 config。 | context budget/结构限制进入 repo contract，而不再只是模型自律。 |
| 2026-09-02 23:37 PR 创建；23:40 合并；09-03 发布 | Codex [#42385](https://github.com/openai/codex/pull/42385), [`cff76fa`](https://github.com/openai/codex/commit/cff76fa96f70f9f3b63d221446fd02cfd87e6d2e), [0.153.0](https://github.com/openai/codex/releases/tag/rust-v0.153.0) | **C**：统一的 `features.context_management.experimental_mode` 才把 TokenBudget、History/Notes 和 `new_context` 作为组合公开；默认关闭且只支持符合条件的 Codex-backend ChatGPT 会话。 | 机制在 6–8 月分步进入主干，9 月才形成公开但受限的实验产品面。 |

> 时间顺序能证明 Letta 的开源实现早于 Codex 这些 PR，**不能证明 OpenAI 借鉴了 Letta 或其他社区项目**。没有 commit、PR 描述或 issue 的直接引用，不能作因果归因。

## Codex：两个用户指定 PR 的逐项核对

### PR #27488

| 字段 | 可验证事实 |
|---|---|
| 标题 | `[codex] Add new context window tool` |
| PR 作者 / 合并者 | `pakrym-oai` / `pakrym-oai` |
| 创建 / 合并（UTC） | `2026-06-10T22:59:10Z` / `2026-06-11T03:39:08Z` |
| merge commit | [`87ab01834af30cfae99014ca93035d3068716b3f`](https://github.com/openai/codex/commit/87ab01834af30cfae99014ca93035d3068716b3f)；单 parent squash commit |
| 规模 | PR 显示 5 个提交、10 个文件、`+261/-0` |

#### 事实：它确实做了什么

- **I/C**：只有 `Feature::TokenBudget` 启用时注册 direct-model-only `new_context`。[注册代码](https://github.com/openai/codex/blob/87ab01834af30cfae99014ca93035d3068716b3f/codex-rs/core/src/tools/spec_plan.rs#L646-L665)
- **I/D**：handler 只记录请求，并返回“新 window 不会总结 conversation history”。[handler](https://github.com/openai/codex/blob/87ab01834af30cfae99014ca93035d3068716b3f/codex-rs/core/src/tools/handlers/new_context_window.rs#L13-L40)
- **I**：sampling 完成后，runtime 重建 initial context、替换 active history，并持久化一个 `message: ""` 的 `CompactedItem`、replacement history 与新 `window_id`。[窗口切换实现](https://github.com/openai/codex/blob/87ab01834af30cfae99014ca93035d3068716b3f/codex-rs/core/src/session/mod.rs#L3061-L3096)
- **T**：集成测试断言旧 user prompt 不会进入新 window 的 follow-up request。[测试](https://github.com/openai/codex/blob/87ab01834af30cfae99014ca93035d3068716b3f/codex-rs/core/tests/suite/token_budget.rs#L240-L318)

#### 事实：它没有做什么

- **I**：同一 merge commit 的 turn loop 在 `new_context` 分支之后，若达到 token limit 且仍需 follow-up，仍调用 `run_auto_compact`。[合并时的 `turn.rs`](https://github.com/openai/codex/blob/87ab01834af30cfae99014ca93035d3068716b3f/codex-rs/core/src/session/turn.rs#L288-L315)
- 因而 #27488 **没有替换 TokenBudget 自动 compaction，更没有删除全局 compaction**。

### 真正改变 TokenBudget compaction 的 PR #29743

- 精确标题：`core: reset context for token budget compaction`；作者 `bolinfest`；创建 `2026-06-23T22:59:21Z`，合并 `2026-06-23T23:59:05Z`；merge commit [`32b65bbf7a304f9231d81226ed3bb649739b73a6`](https://github.com/openai/codex/commit/32b65bbf7a304f9231d81226ed3bb649739b73a6)。
- **I**：新模块明确声明 TokenBudget manual/auto compaction “skips model/server summarization and installs a fresh context window”，两条路径最终都调用 `start_new_context_window`。[核心实现](https://github.com/openai/codex/blob/32b65bbf7a304f9231d81226ed3bb649739b73a6/codex-rs/core/src/compact_token_budget.rs#L19-L89)
- **I**：它仍产生 `ContextCompaction` item，执行 pre/post compact hooks；改变的是摘要策略，不是客户端可观察的 compaction 生命周期。
- **I**：直到 #39827 之后，非 TokenBudget 分支仍选择 remote v2、remote 或 local summarizing compaction。[分支代码](https://github.com/openai/codex/blob/daa48072f4f507221da313a748c3f7c551ae5500/codex-rs/core/src/tasks/compact.rs#L35-L77)

### PR #39827

| 字段 | 可验证事实 |
|---|---|
| 标题 | `Add history and notes tools for token-budget sessions` |
| PR 作者 / 合并者 | `copyberry[bot]` / `copyberry[bot]` |
| Git commit 作者 | `pmccrary-oai`（GitHub commit metadata）；committer 为 `copyberry` |
| 创建 / 合并（UTC） | `2026-08-21T01:11:13Z` / `2026-08-21T01:26:08Z` |
| merge commit | [`daa48072f4f507221da313a748c3f7c551ae5500`](https://github.com/openai/codex/commit/daa48072f4f507221da313a748c3f7c551ae5500)；单 parent squash commit；内部 `GitOrigin-RevId: 43b259f…` |
| 规模 | 1 个提交、21 个文件、`+1232/-6` |

#### 事实：恢复层的真实边界

- **I/D**：加入 4 个 History 工具：`list_windows`、`list_items`、`read_item`、`search_contents`；5 个 Notes 工具：`list_files_by_prefix`、`read_file`、`search_contents`、`append_to_file`、`write_file`。[动作与 endpoint](https://github.com/openai/codex/blob/daa48072f4f507221da313a748c3f7c551ae5500/codex-rs/ext/history-notes/src/tools.rs#L25-L107)
- **I/D**：History 只读且最终一致；Notes 强一致、跨 context-window transition 存活；Notes path 明确是 virtual path 而非 filesystem path；两者均为 private model-only state。[工具语义](https://github.com/openai/codex/blob/daa48072f4f507221da313a748c3f7c551ae5500/codex-rs/ext/history-notes/src/tools.rs#L27-L38)
- **I**：`session_id` 与 `current_agent_name` 由 runtime 构造工具时注入，而不是接受模型声称的身份；随后调用 Codex backend endpoint。[trusted context](https://github.com/openai/codex/blob/daa48072f4f507221da313a748c3f7c551ae5500/codex-rs/ext/history-notes/src/tools.rs#L304-L349)
- **I**：list/read/search 的数量、字符数、query 与工具输出都有硬边界；常规输出走统一 truncate，过大的 encrypted output 要求模型缩窄请求。[边界常量](https://github.com/openai/codex/blob/daa48072f4f507221da313a748c3f7c551ae5500/codex-rs/ext/history-notes/src/tools.rs#L27-L38)、[输出处理](https://github.com/openai/codex/blob/daa48072f4f507221da313a748c3f7c551ae5500/codex-rs/ext/history-notes/src/tools.rs#L388-L445)
- **C/I**：初版只在显式配置、OpenAI provider 与 Codex backend auth 同时满足时注册；不符合条件即移除 extension。[feature gate](https://github.com/openai/codex/blob/daa48072f4f507221da313a748c3f7c551ae5500/codex-rs/ext/history-notes/src/extension.rs#L33-L50)
- **I**：九个工具的 `defer_loading` 都是 `None`。[工具 spec](https://github.com/openai/codex/blob/daa48072f4f507221da313a748c3f7c551ae5500/codex-rs/ext/history-notes/src/tools.rs#L353-L377)

#### 对“渐进披露”的判定

| 命题 | 事实 | 判定 |
|---|---|---|
| 完整旧历史不直接塞回新窗口，模型 list/search/read 后分段取回 | History 工具和输出边界直接支持 | **成立：内容渐进披露** |
| Notes 是“把中间结果放文件里” | API 使用 virtual path；实现位于远端 backend，不是 host filesystem | **只能类比，不是文件系统事实** |
| 工具本身按需发现/装载 | 九个工具全部注册，`defer_loading: None` | **不成立：不是 tool-schema 渐进披露** |
| 这是 Context as Repo | 没有 Git、working tree、commit、branch、manifest 或 restore API | **不成立** |
| #39827 取消了 compaction summary | PR 不改 compaction 算法；这个变化已由 #29743 完成 | **不成立** |

### Codex 前后提交与产品化

- [#27438](https://github.com/openai/codex/pull/27438) / [`658af93`](https://github.com/openai/codex/commit/658af936fdd04cd2661e253b4fe78d769aef8534)：先让模型看到 window id 与 token 余量。[注入内容](https://github.com/openai/codex/blob/658af936fdd04cd2661e253b4fe78d769aef8534/codex-rs/core/src/context/token_budget_context.rs#L3-L37)
- [#29739](https://github.com/openai/codex/pull/29739) / [`3b41869`](https://github.com/openai/codex/commit/3b4186986f5f67aa324721d22d81e4f1501fd131)：明确 `new_context` 不改变 environment state。[工具说明](https://github.com/openai/codex/blob/3b4186986f5f67aa324721d22d81e4f1501fd131/codex-rs/core/src/tools/handlers/new_context_window_spec.rs#L8-L16)
- [#39830](https://github.com/openai/codex/pull/39830) / [`d8ec270`](https://github.com/openai/codex/commit/d8ec270183ffb341fb0211c5ee8335419ea67cc7)：把误命名配置 `use_history_notes_history` 改为 `use_history_notes_extension`。
- [#40539](https://github.com/openai/codex/pull/40539) / [`2e46759`](https://github.com/openai/codex/commit/2e4675919ee9c90a0b1360e0826fe7117d71cebb)：增加最多 4,000 bytes 的 `thread_hint` bootstrap。[实现](https://github.com/openai/codex/blob/2e4675919ee9c90a0b1360e0826fe7117d71cebb/codex-rs/ext/history-notes/src/extension.rs#L26-L28)、[注入条件](https://github.com/openai/codex/blob/2e4675919ee9c90a0b1360e0826fe7117d71cebb/codex-rs/ext/history-notes/src/extension.rs#L93-L130)
- [#42385](https://github.com/openai/codex/pull/42385) / [`cff76fa`](https://github.com/openai/codex/commit/cff76fa96f70f9f3b63d221446fd02cfd87e6d2e)：统一实验开关。
- [Codex 0.153.0](https://github.com/openai/codex/releases/tag/rust-v0.153.0) 于 `2026-09-03T01:37:38Z` 发布；release note 明确其默认关闭，只覆盖符合条件的 Plus/Pro/Pro Lite Codex-backend 会话。固定 HEAD 中 TokenBudget/ContextManagement 仍为 `UnderDevelopment` 且 `default_enabled: false`。[当前 feature 状态](https://github.com/openai/codex/blob/8e6a44b428e31f91b21edc97904fcdf4f0931ade/codex-rs/features/src/lib.rs#L1579-L1590)

## Letta Code：从文件投影到真正 context repository

### 前身：Skills 已先采用文件式渐进披露

[#76](https://github.com/letta-ai/letta-code/pull/76) 于 2025-11-07 进入主干，比 MemFS 早约两个半月：

- **I**：runtime 递归扫描 `.skills/**/SKILL.MD`，解析 metadata，形成仅含 id/name/description/path 的 skill inventory。[发现器](https://github.com/letta-ai/letta-code/blob/ea313159ce7fd1b816a1aa5b1cc4cc2373cabc3b/src/agent/skills.ts#L115-L188)、[metadata 与目录输出](https://github.com/letta-ai/letta-code/blob/ea313159ce7fd1b816a1aa5b1cc4cc2373cabc3b/src/agent/skills.ts#L220-L335)
- **I**：agent 创建时把这份 inventory 放进 `skills` memory block，而不是把所有 skill 正文都拼进去。[bootstrap wiring](https://github.com/letta-ai/letta-code/blob/ea313159ce7fd1b816a1aa5b1cc4cc2373cabc3b/src/agent/create.ts#L59-L90)
- **D**：system prompt 原文明确使用 “progressive disclosure”，要求先选相关 skill、再读完整 `SKILL.md`，关联文件只在需要时继续发现。[模型契约](https://github.com/letta-ai/letta-code/blob/ea313159ce7fd1b816a1aa5b1cc4cc2373cabc3b/src/agent/prompts/system_prompt.txt#L27-L36)

**事实**：这证明 Letta Code 在 2025-11 已有 “metadata bootstrap → model chooses → bounded file reads” 的一般模式。**边界**：它只覆盖 Skills，不能把这一天写成 context repository 或持久 working-memory repo 的发布日期。

### 第一阶段：文件投影先于 Git repo

[#685](https://github.com/letta-ai/letta-code/pull/685) 是该仓库中最早可验证的相关主干实现：

- **I**：固定目录契约为 `~/.letta/agents/{agentId}/memory/{system,user}`，另有 `.sync-state.json`。[路径和状态定义](https://github.com/letta-ai/letta-code/blob/7ab97e404d2dfdd01755ff4552386f2329e2d204/src/agent/memoryFilesystem.ts#L10-L48)
- **I**：同步状态保存 block/file hash；若双方都变更则产生显式 conflict，并接受选择 `file` 或 `block` 的 resolution。[双向同步](https://github.com/letta-ai/letta-code/blob/7ab97e404d2dfdd01755ff4552386f2329e2d204/src/agent/memoryFilesystem.ts#L333-L491)
- **I**：runtime 渲染完整路径树到只读 `memory_filesystem` block。[树渲染](https://github.com/letta-ai/letta-code/blob/7ab97e404d2dfdd01755ff4552386f2329e2d204/src/agent/memoryFilesystem.ts#L227-L292)、[block 更新](https://github.com/letta-ai/letta-code/blob/7ab97e404d2dfdd01755ff4552386f2329e2d204/src/agent/memoryFilesystem.ts#L649-L697)
- **D**：system memory 始终加载，`user/` 是 detached reference/notes；文件路径一一映射 block label。[当时的模型说明](https://github.com/letta-ai/letta-code/blob/7ab97e404d2dfdd01755ff4552386f2329e2d204/src/agent/prompts/system_prompt_memfs.txt#L2-L34)

**事实**：01-27 已经有“always-loaded index/tree + 按需外部内容”的结构。**推断**：它在功能上已经接近渐进披露，但当时没有 Git repo、commit provenance 或受控事务边界。

### 第二阶段：Git 成为持久化与同步协议

[#905](https://github.com/letta-ai/letta-code/pull/905) 首次把 MemFS 明确做成 Git-backed repository：

- **I/D**：源文件顶部直接定义“clone on first run, pull on startup”；当时仍写明 agent 通过 Bash 自己 commit/push。[模块契约](https://github.com/letta-ai/letta-code/blob/d1a6eeb40a12583d4e82b78f9769ec9bfcdeb54d/src/agent/memoryGit.ts#L1-L10)
- **I**：repo 地址和远端 endpoint 分别为本地 `~/.letta/agents/{id}/memory` 与服务端 `/v1/git/{id}/state.git`。[地址](https://github.com/letta-ai/letta-code/blob/d1a6eeb40a12583d4e82b78f9769ec9bfcdeb54d/src/agent/memoryGit.ts#L29-L45)
- **I**：clone/migrate、credential helper、pre-commit hook、`pull --ff-only` 后回退到 rebase 都由 harness 执行。[初始化与 pull](https://github.com/letta-ai/letta-code/blob/d1a6eeb40a12583d4e82b78f9769ec9bfcdeb54d/src/agent/memoryGit.ts#L250-L355)
- **I/T**：安装了在 staged content 上校验 frontmatter、保护 `read_only` 的 pre-commit validator；初版 hook/test 只覆盖 `memory/**/*.md` 路径。[初版 hook](https://github.com/letta-ai/letta-code/blob/d1a6eeb40a12583d4e82b78f9769ec9bfcdeb54d/src/agent/memoryGit.ts#L104-L248)、[初版真实 Git commit 测试](https://github.com/letta-ai/letta-code/blob/d1a6eeb40a12583d4e82b78f9769ec9bfcdeb54d/src/tests/agent/memoryGit.precommit.test.ts#L55-L101)

**事实**：Git-backed context repo 的主干落点是 `2026-02-11T02:06:05Z`。PR 创建到合并只有约 5 分钟，不能把创建时间解读为真实内部研发起点。#905 本身还存在布局过渡痕迹：prompt 说 repo root 下是 `system/` 且文件无 frontmatter，而 hook/test 使用 `memory/system/` 与 frontmatter；[#1482](https://github.com/letta-ai/letta-code/pull/1482) 到 2026-03-21 才把 hook glob 扩成同时接受可选 `memory/` 前缀下的 `system|reference`。因此 #905 能证明“Git repo 已进入主干”，不能证明当时 schema contract 已完全收敛。[#905 prompt](https://github.com/letta-ai/letta-code/blob/d1a6eeb40a12583d4e82b78f9769ec9bfcdeb54d/src/agent/prompts/system_prompt_memfs.txt#L2-L21)、[#1482 修正](https://github.com/letta-ai/letta-code/commit/9c677d444e675cd317daf451bba5ca5d3c7950b0)

Letta 在次日发布的官方 [Context Repositories 博文](https://www.letta.com/blog/context-repositories/) 是产品命名与方向的直接证据：页面标注 2026-02-12，并描述 Git-backed memory、本地 clone、tree/description progressive disclosure、`system/` pinned memory、subagent worktree、reflection 与 defrag。它能证明 Letta 当时如何对外定义产品，不能单独证明博客列出的每个机制已经具有后来 6–8 月代码中的确定性同步、冲突状态机和层级约束；这些能力仍按各自 commit 日期判断。

### 第三阶段：渐进披露从隐含结构变成显式契约

- [#1313](https://github.com/letta-ai/letta-code/pull/1313) 的 prompt 明确说明：`description` 用于 progressive disclosure，`system/` 全量 pinned，其他文件按需读。[实际提示词](https://github.com/letta-ai/letta-code/blob/591e6638cc324d5db7ac2e35198c556ee843b526/src/agent/prompts/system_prompt_memfs.txt#L4-L18)
- [#1642](https://github.com/letta-ai/letta-code/pull/1642) 只改 prompt、tool description 和 prompt test，要求用 `[[path]]` 建发现路径。[commit diff](https://github.com/letta-ai/letta-code/commit/08088b5b18cfa2e8bd188c5d5d5fdc99f32df705)

**事实**：`[[path]]` 在 04-03 是提示词协议，没有 parser、backlink index 或 runtime 完整性校验。**推断**：可借鉴其低成本显式引用语法，但不能把它当作已经解决 stale reference 的成熟实现。

### 第四阶段：受控写、编译和 freshness

- [#1363](https://github.com/letta-ai/letta-code/pull/1363) 的 `memory` tool 提供 create/replace/insert/delete/rename；写完只 stage 受影响 path，生成 agent-attributed commit，并 push。[mutation 与提交入口](https://github.com/letta-ai/letta-code/blob/d6856fa5da4d52c04a2a7ed96ba2ba3f8d1e19b1/src/tools/impl/Memory.ts#L83-L273)、[path containment](https://github.com/letta-ai/letta-code/blob/d6856fa5da4d52c04a2a7ed96ba2ba3f8d1e19b1/src/tools/impl/Memory.ts#L301-L382)、[commit/push](https://github.com/letta-ai/letta-code/blob/d6856fa5da4d52c04a2a7ed96ba2ba3f8d1e19b1/src/tools/impl/Memory.ts#L488-L571)
- [#2066](https://github.com/letta-ai/letta-code/pull/2066) 的 local compiler 从文件 path、description、body 计算 revision；system 文件内联内容，external 文件只渲染 projection tree。[扫描/revision](https://github.com/letta-ai/letta-code/blob/a497fcee4c0db36822dd41bf5f996e9496467ca3/src/backend/local/systemPromptCompilation.ts#L49-L109)、[投影](https://github.com/letta-ai/letta-code/blob/a497fcee4c0db36822dd41bf5f996e9496467ca3/src/backend/local/systemPromptCompilation.ts#L130-L258)、[编译](https://github.com/letta-ai/letta-code/blob/a497fcee4c0db36822dd41bf5f996e9496467ca3/src/backend/local/systemPromptCompilation.ts#L425-L447)
- [#2076](https://github.com/letta-ai/letta-code/pull/2076) 把 compiled prompt 接入 local turn：读取 committed HEAD revision；raw prompt hash 与 revision 都不变才复用缓存，否则重新编译。[每轮 freshness 判断](https://github.com/letta-ai/letta-code/blob/91a9928fa5fed207018c7ce8eaff23840888b053/src/backend/local/LocalBackend.ts#L225-L315)

**推断**：最值得吸收的不是目录名，而是 `source revision → compiled context revision` 可验证映射；它能回答“当前模型看到的是否来自最新已提交状态”。

### 第五阶段：runtime 收口同步与并发恢复

- [#2677](https://github.com/letta-ai/letta-code/pull/2677) 将同步放到确定性 post-turn hook。`clean`/`pushed`/`skipped` 静默；`conflict`/`dirty`/`push_failed` 产生不同 reminder。[post-turn orchestration](https://github.com/letta-ai/letta-code/blob/4f851eff54f8a45b93ad3059714dc2c4e979b948/src/reminders/memory-git-sync.ts#L16-L96)、[Git 状态与恢复](https://github.com/letta-ai/letta-code/blob/4f851eff54f8a45b93ad3059714dc2c4e979b948/src/agent/memory-git.ts#L1673-L1939)
- [#3125](https://github.com/letta-ai/letta-code/pull/3125) 才将 reflection worktree 生命周期移入 harness，定义 pending/dirty/failed/merged 状态、保留冲突 worktree、清理失败/无提交分支并支持稍后集成。[状态定义](https://github.com/letta-ai/letta-code/blob/ce8bbb73030b84d0a5d3b4707d0369e4ea4b5351/src/agent/memory-worktree.ts#L192-L258)、[finalize 状态机](https://github.com/letta-ai/letta-code/blob/ce8bbb73030b84d0a5d3b4707d0369e4ea4b5351/src/agent/memory-worktree.ts#L545-L703)

**事实**：02-11 的 reflection prompt 已教模型手动用 worktree，但 07-06 才出现 harness-owned 可恢复实现。不能把 prompt instructions 和 runtime guarantee 写成同一个发布日期。

此阶段还有两个容易被名称误读的边界：

- [#3202](https://github.com/letta-ai/letta-code/pull/3202) 于 07-03 删除公开的 non-MemFS opt-outs，使 MemFS 成为普通 agent 的默认 substrate，但 stateless subagent 仍是内部例外。
- [#3251](https://github.com/letta-ai/letta-code/pull/3251) 的 commit 标题直接写 “repo-as-truth”，但只适用于 `dream --to` 维护的单个共享文档：每次从项目 repo reseed MemFS、基于 committed content 导出，失败时回滚工作文件。[作用域与真相源](https://github.com/letta-ai/letta-code/blob/9bac6fed8f355426057301f725ff575b3a3e647c/src/cli/subcommands/dream-targets.ts#L12-L20)、[同步/回滚/导出](https://github.com/letta-ai/letta-code/blob/9bac6fed8f355426057301f725ff575b3a3e647c/src/cli/subcommands/dream-targets.ts#L144-L231)

**推断**：共享 artifact 与 agent 私有 memory 需要分别声明 source-of-truth；不能默认“既然都是 Git，agent memory 就能覆盖项目 repo”。

### 第六阶段：分层 manifest 与可执行预算契约

- [#4085](https://github.com/letta-ai/letta-code/pull/4085)：精确根 `MEMORY.md` 是布局 marker；每层目录缺少自己的 `MEMORY.md` 时，子文件不进入 projection；写入也会被拒绝。[格式选择和索引路径](https://github.com/letta-ai/letta-code/blob/b2c7560ebd6db1bc5b41200cfd26a7ad04c83034/src/agent/memory-format.ts#L4-L70)
- [#4105](https://github.com/letta-ai/letta-code/pull/4105)：`.memfs.config.json` 配置 `maxFileCharacters`、有序 glob overrides 与 `maxDepth`；校验基于 staged Git snapshot，配置修改需专用授权环境变量。[约束契约](https://github.com/letta-ai/letta-code/blob/9047f71c38a8acb80518954c71bcc70959d879c2/src/agent/memory-constraints.ts#L1-L37)、[staged validation](https://github.com/letta-ai/letta-code/blob/9047f71c38a8acb80518954c71bcc70959d879c2/src/agent/memory-constraints.ts#L240-L354)

**推断**：截至固定 HEAD，Letta 的 API-backed root-first 格式中，最接近我们可借鉴的结构是：root marker 选择格式、逐层 index 决定可发现边界、顶层 core memory 自动注入、深层内容按需读取、Git hook 对提交快照执行预算与结构约束。固定 HEAD 的 local backend 仍选择旧 `system/` 布局，不能笼统说全部 backend 都采用 `MEMORY.md`。

## 事实与推断总表

| 主题 | 事实 | 可以做的推断 | 不能做的推断 |
|---|---|---|---|
| 谁更早 | Letta file projection 2026-01-27；Git repo 2026-02-11；官方 Context Repositories 公告 2026-02-12；Codex TokenBudget/new context 2026-06-11；Codex History/Notes 2026-08-21。 | Letta 的公开主干实现与官方产品命名均更早。 | OpenAI 因 Letta/社区方案而采用该设计。 |
| Skills 前身 | Letta 于 2025-11-07 已实现 skill metadata inventory + 正文按需加载。 | 该模式可复用于一般上下文，但需额外 lifecycle/写入契约。 | 2025-11 已经有 memory repo。 |
| Codex #27488 | 只增加 model-requested `new_context`；auto limit 仍走旧 compaction。 | 它是后续 reset 架构的第一步。 | 它当日全面删除摘要压缩。 |
| Codex #29743 | TokenBudget manual/auto compaction 都改为 fresh window，但保留 compaction lifecycle。 | “TokenBudget 干掉摘要”的准确实现点。 | Codex 所有会话、所有 provider 都不再摘要。 |
| Codex #39827 | backend virtual History/Notes，可按需 list/search/read/write，有边界。 | 是内容层渐进披露和 working-memory recovery。 | 是 host filesystem、Git repo 或 tool-schema progressive disclosure。 |
| Letta #685 | 文件树、双向同步、hash/conflict，system 与 detached user memory 分层。 | practical progressive disclosure 的雏形。 | 已有 Git provenance、事务 commit 和并发恢复。 |
| Letta #905 | 每 agent Git repo、clone/pull/hook；agent 仍经 Bash commit/push。 | context-as-repo 的首个主干实现点。 | 当时已经有完善 runtime transaction/state machine。 |
| Letta #1642 | 只新增 `[[path]]` 提示词/工具说明。 | 低成本 discovery convention。 | runtime 会解析、校验或自动修复引用。 |
| Letta #3125 | reflection worktree 有显式 finalize/pending 状态。 | 可作为后台上下文维护事务模型。 | 所有 memory write 都自动使用 worktree。 |
| archive/restore | Codex Notes 没有 delete/archive/restore action；Letta memory 有 delete/rename，Git 历史可手工恢复。 | 我们应把 archive/restore 设计成一等 manifest/state transition。 | 两者已经提供完整 archive 状态机。 |

## 对 worksurface 设计最直接的时间线启示

这些是基于上述事实的设计推断，不是上游现状描述：

1. **把“索引语法”与“运行时契约”分开。** `[[path]]` 很便宜，但 Letta 直到 `MEMORY.md` marker 与 pre-commit enforcement 才真正获得结构保证。我们的模板应同时有面向模型的 discoverability 和面向 runtime 的可验证 manifest。
2. **bootstrap 应小而固定，内容按需读取。** Codex 后来的 4 KB hint、Letta 的顶层 core + 深层 index，都指向“少量始终注入 + 大内容工具化”的组合。
3. **写入要以 repo transaction 为边界。** Letta 的演进从 Bash 自觉 commit，走向 memory tool、post-turn sync、worktree finalize；成熟部分是 staged validation、provenance、dirty/conflict/push_failed 状态，而不是某个目录名。
4. **archive/restore 不应只靠 prompt 或 `mv`。** 两个项目都没有通用的一等 archive 状态机；我们的模板仍有独立价值：可以固定 lifecycle、索引可见性、恢复来源与 runtime 自动装载规则。
5. **保留 context 与 environment 的不同生命周期。** Codex 明确 `new_context` 不重置环境；worksurface 切窗/归档时也应分别定义 model context、working tree、进程/工具状态和持久 artifact 的边界。

## 最短回答：“他们什么时候开始做？”

- **Letta Code**：文件式 Skills 的显式 progressive disclosure 在 **2025-11-07** 已进入主干；文件化 memory 的公开 PR 于 **2026-01-26** 创建、**01-27** 进入主干；真正 Git-backed repo 于 **02-11** 进入主干；官方 “Context Repositories” 公告发布于 **02-12**；同一模式于 **03-12** 明确写入 memory system prompt，**03-16** 出现在产品 UI；完整的 runtime-managed worktree 与层级 `MEMORY.md` 契约则分别到 **07-06**、**08-28** 才落地。
- **OpenAI Codex**：TokenBudget 与 `new_context` 于 **2026-06-11** 进入主干；TokenBudget 的手动/自动 compaction 全面改成无摘要 fresh window 是 **06-23**；History/Notes 按需恢复层是 **08-21**；组合能力在 **09-03 的 0.153.0** 才作为默认关闭的实验功能公开。
