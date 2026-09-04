# Context-as-Repo 实际采用与成熟度证据审计

审计时间：2026-09-04。本文回答一个比“代码是否存在”更严格的问题：哪些机制已经进入公开发布的默认执行路径，哪些只是可选组件、默认关闭实验、alpha、论文原型或 prompt convention。

## 结论先行

1. **最接近“context as repo”且已经进入公开产品默认路径的是 Letta Code MemFS。** 但它不是从首次发布起就默认启用：Git-backed MemFS 于 2026-02-12 随 v0.15.0 发布时仍是 cloud-only opt-in；2026-06-07 才成为受支持 backend 上新建 agent 的默认；2026-07-03 才移除普通 agent 的用户侧 opt-out。stateless subagent 与不支持 MemFS 的 self-hosted backend 仍是明确边界。
2. **Aider RepoMap 与 OpenHands SDK condenser 是成熟、已发布、当前默认路径中的“邻接机制”，不是完整 Context Repository。** Aider 自动生成预算受限的代码导航投影；OpenHands 从权威 Event stream 派生可压缩 View。两者都证明“源与投影分离/渐进披露”已经实际工程化，但都不提供完整的 repo authority、生命周期和发布协议。
3. **Codex 不是“已经全面用新机制替代压缩”。** #27488 只增加模型主动请求的无摘要换窗；#29743 才改变 TokenBudget 模式的手动和自动 compaction；#39827 两个月后才补 History/Notes 恢复层。整套能力直到 2026-09-03 的 0.153.0 才作为 `features.context_management.experimental_mode` 公开，而且当前仍 **disabled by default、`UnderDevelopment`、仅限符合条件的 Codex-backend ChatGPT 会话**。
4. **AIGNE AFS/AFSGit 与 AgentPlane Local Context 是正式发布的 opt-in 开发者组件。** 它们有真实实现、测试和 registry/release 证据，但没有证据表明所有框架用户默认走这条路径，更没有可核验的外部生产用户数。
5. **Deep Agents 要分成两层记账。** 核心 harness 的 filesystem tools、大结果外置和 summary-history 恢复路径已经是已发布的默认路径；真正有 commit/`parent_commit` 冲突处理的 `ContextHubBackend` 到 2026-05-12 才发布在 0.6.0，且必须由调用方显式选用。它是 LangChain/LangSmith 的第一方产品集成，但这仍不是外部 production adoption 证据。
6. **AICTX 是可安装、测试面完整的 Beta opt-in continuity runtime，不是多家模型厂商的官方集成。** 它于 2026-04-24 首次实现并发布 continuity loop；对 Codex、Claude、Copilot 的 hooks/instructions/plugins 由 AICTX 自己维护，只能证明兼容层存在，不能证明 OpenAI、Anthropic 或 GitHub 正式采用。
7. **ContextFS、agent-mem、agent-os、ACE 不能按同一成熟度表述。** ContextFS 是年轻但实质性的版本化文件系统 substrate；agent-mem 自称 Alpha；agent-os 是带可执行校验器的 runtime-neutral 协议模板，其中 agent 行为主要由 instructions 驱动；原始 ACE 是论文配套研究代码，后来的 `ace-playbook` 是独立社区实现，不能反向证明原作者已发布产品。
8. **本次审计没有找到任何项目可公开核验的外部活跃用户数或生产部署数。外部用户数一律记为“未知”。** GitHub stars、forks、下载量、registry 中存在版本、README 的“works with”列表都不等同于实际采用，本审计不拿它们作采用证据。

## 口径：机制证据和采用证据是两条轴

机制证据沿用 [`02-evaluation-method.md`](02-evaluation-method.md)：

| 标签 | 含义 | 不能单独证明什么 |
| --- | --- | --- |
| `I` | pinned revision 中存在可执行实现 | 已发布、默认启用或有人实际使用 |
| `T` | pinned revision 中有自动化测试锁定行为 | 测试在所有发布环境通过或存在外部用户 |
| `D` | 官方文档、release note 或配置说明 | 运行时一定如此 |
| `P` | prompt / `AGENTS.md` / skill instruction 约定 | runtime 会强制执行 |
| `C` | 作者自述、benchmark 或测试数量声明 | 独立复现或外部采用 |

成熟度另外分级；它描述 **所审计机制在项目自己公开发行面中的 rollout 状态**，不描述市场规模：

| 级别 | 判定 |
| --- | --- |
| `S4 shipped-default (scoped)` | 已发布，并在明确范围内无需用户额外 opt-in 即进入当前执行路径 |
| `S3 shipped-opt-in` | 已发布、可安装，用户或开发者需显式启用/挂载/初始化 |
| `S2 early/experimental/template` | 已公开发布，但仍是 default-off experiment、alpha、早期 substrate 或协议模板 |
| `S1 paper/prototype` | 论文或源码原型；没有核验到正式发行的 runtime 路径 |

这里特意不设“被广泛采用”级别，因为缺少 telemetry、客户案例、公开 integration inventory 或可审计部署数据。发布证明 **可获得**，默认值证明 **项目内 rollout 决策**，两者都不等于外部采用。

## 总表

| 项目 / 机制 | 首次可证实时间（UTC） | 公开发行与当前 rollout | 机制证据 | 成熟度判定 | 外部采用 |
| --- | --- | --- | --- | --- | --- |
| **Aider RepoMap** | 2023-05-19：ctags/repo map 初始实现；2023-06-07：随 [v0.5.0](https://github.com/Aider-AI/aider/releases/tag/v0.5.0) 发布 | 当前在 repo 存在、coder 有 map prompt 且模型配置启用 `use_repo_map` 时自动构造；大量随附模型配置启用，但不是所有模型的无条件默认 | `I/T/D` | `S4`，范围化的默认投影；**邻接机制** | **未知**；未用 stars/downloads 推断 |
| **OpenHands SDK condensation** | 2025-09-03：[`ab89807`](https://github.com/OpenHands/software-agent-sdk/commit/ab8980714dd397f26fe811227afbc533c59fae70)；2025-10-14：1.0.0a1；2025-11-06：[1.0.0 stable](https://github.com/OpenHands/software-agent-sdk/releases/tag/1.0.0) | 当前 `OpenHandsAgentSettings` 与 subagent factory 都默认构造 LLM summarizing condenser，可显式禁用 | `I/T/D` | `S4`，**SDK 默认**；不外推为所有 OpenHands 托管部署 | **未知** |
| **Letta Code MemFS** | 2026-02-11：[`d1a6eeb`](https://github.com/letta-ai/letta-code/commit/d1a6eeb40a12583d4e82b78f9769ec9bfcdeb54d)；2026-02-12：[v0.15.0](https://github.com/letta-ai/letta-code/releases/tag/v0.15.0) | v0.15.0 是 cloud-only opt-in；[2026-06-07 #2755](https://github.com/letta-ai/letta-code/pull/2755) 成为 capable backend 新建 agent 默认；[2026-07-03 #3202](https://github.com/letta-ai/letta-code/pull/3202) 移除普通 agent opt-out | `I/T/D` | `S4`，目前最接近完整 context-as-repo 的公开产品实现 | **未知** |
| **Codex TokenBudget + History/Notes** | 2026-06-11：[#27488](https://github.com/openai/codex/pull/27488)；2026-06-23：[#29743](https://github.com/openai/codex/pull/29743)；2026-08-21：[#39827](https://github.com/openai/codex/pull/39827) | 2026-09-03 随 [0.153.0](https://github.com/openai/codex/releases/tag/rust-v0.153.0) 首次形成公开组合开关；当前仍 default-off、`UnderDevelopment`、账户/provider/thread eligibility 受限 | `I/T/D` | `S2`，released default-off experiment；不是全局 compaction replacement，也不是 repo authority | **未知**；实验参与数未披露 |
| **Deep Agents core context management** | 2025-07-29：[`80338ed`](https://github.com/langchain-ai/deepagents/commit/80338eda64fd50179372a06f5ab5e6db11349b70) 首个 state-backed filesystem；同日 PyPI [0.0.1](https://pypi.org/project/deepagents/0.0.1/) | 当前 `create_deep_agent()` 默认挂载 filesystem、summarization 和通用 subagent；大工具结果与被 summary 替换的原消息会外置到可回读路径；Skills/Memory sources 另行 opt-in | `I/T/D` | `S4`，范围化的默认 context-as-files/offload 路径 | **未知** |
| **Deep Agents `ContextHubBackend`** | 2026-05-12：[`6962826`](https://github.com/langchain-ai/deepagents/commit/69628263cb2c1f6951b1b37bbc0edbb85983ad51)；同日 PyPI [0.6.0](https://pypi.org/project/deepagents/0.6.0/) | LangChain 仓库与官方文档中的 LangSmith Context Hub backend；有 commit/parent-conflict/replay，但调用方需显式传入，不是默认 backend | `I/T/D` | `S3`，已发布的第一方 opt-in repo backend | **未知**；第一方集成 ≠ 外部生产采用 |
| **AICTX continuity runtime** | 2026-04-24：[`88eb69b`](https://github.com/oldskultxo/aictx/commit/88eb69b16c08bfed2347cb47987c009d1c39dfb0) 起的 continuity 实现；同日 PyPI [4.0.0](https://pypi.org/project/aictx/4.0.0/) | 安装/init 后通过 CLI/MCP 与自带 runner adapters 运行；固定 `.aictx` schema、bounded resume capsule、branch-safe load、opt-in Git portability 均有实现；当前 7.0.1 仍标 Beta | `I/T/D/P` | `S3`，已发布 opt-in continuity runtime；adapter 含 prompt convention | **未知**；未发现模型厂商第一方集成 |
| **AIGNE AFS / AFSGit** | 2025-10-07：[`ac2a18a`](https://github.com/AIGNE-io/aigne-framework/commit/ac2a18a82470a2f31c466f329386525eb1cdab6d) 与 [AFS 1.0.0](https://github.com/AIGNE-io/aigne-framework/releases/tag/afs-v1.0.0)；2026-01-16：[AFSGit 1.0.0](https://github.com/AIGNE-io/aigne-framework/releases/tag/afs-git-v1.0.0) | AFS 被挂到 agent 后，prompt builder 自动注入 list/search/read/write/edit/delete/rename/exec/skill；创建 agent 本身不默认附带 AFS | `I/T/D` | `S3`，正式发布的 opt-in framework component | **未知** |
| **AgentPlane Local Context** | 2026-05-13：[`ec469f9`](https://github.com/basilisk-labs/agentplane/commit/ec469f98262a84bbd79d6ea92f0d7afffdd5705e)；2026-05-14：[v0.6.0](https://github.com/basilisk-labs/agentplane/releases/tag/v0.6.0) | CLI 的 init/ingest/reindex/search/source/verify-task 已发布并有测试；项目自身明确称 Local Context optional，且与 runner prompt assembly 独立 | `I/T/D` | `S3`，正式发布的 opt-in local context layer | **未知** |
| **ContextFS / AgentVFS** | 2026-05-22：[`abda6e1`](https://github.com/thustorage/ContextFS/commit/abda6e1) 初始公开实现；2026-05-23：[v0.1.1](https://github.com/thustorage/ContextFS/releases/tag/v0.1.1) binary release | 至 [v0.1.7](https://github.com/thustorage/ContextFS/releases/tag/v0.1.7) 有多平台 assets；checkpoint/rollback/branch/CAS 有大量 unit/system tests；不负责自动选择并装载模型语义上下文 | `I/T/D` | `S2`，年轻但实质性的 filesystem substrate | **未知**；没有核验到外部 runtime integration inventory |
| **agent-mem** | 2026-02-22：[`80dae4b`](https://github.com/lmaksym/agent-mem/commit/80dae4b) 初始 CLI；2026-02-23：[v0.1.1](https://github.com/lmaksym/agent-mem/releases/tag/v0.1.1) | 可安装 CLI，branch/switch/merge/pin/compact/archive/forget 等路径真实存在；README 明示 **Alpha**；当前审计实跑 61/61 tests 通过 | `I/T/D` | `S2`，functional alpha specimen | **未知** |
| **agent-os** | 2026-07-13：[`1bba7f4`](https://github.com/aylee/agent-os/commit/1bba7f) 转为 Agent-OS；同日 [v1.0.0](https://github.com/aylee/agent-os/releases/tag/v1.0.0) | 有 schema、doctor、backup/restore、receipt helper 与测试；但渐进读取、single-writer 复核、handoff 等 agent 行为主要靠 `AGENTS.md`/skills 执行 | `I/T/D/P` | `S2`，可执行校验器 + runtime-neutral protocol/template；不是自动运行的 context runtime | **未知** |
| **原始 ACE** | 2025-10-06：[arXiv v1](https://arxiv.org/abs/2510.04618)；2025-11-18：公开研究代码 | GitHub [没有 Releases](https://github.com/ace-agent/ace/releases)，没有核验到 PyPI 包；所审计 curator 实际只完整支持 `ADD`，没有自动化测试目录 | `I/D/C` | `S1`，paper + research-code prototype | **未知**；benchmark 不是采用证据 |
| **社区 `ace-playbook`** | 2026-06-27：[`59daf0e`](https://github.com/rrahimi-uci/agentic-context-engineering/commit/59daf0) 与 [v0.1.0](https://github.com/rrahimi-uci/agentic-context-engineering/releases/tag/v0.1.0)；2026-06-29：PyPI 0.3.0 | 独立实现 typed ADD/UPDATE/REMOVE、持久化、测试和 OpenAI Agents SDK adapter；本次隔离 uv 复跑 `.[dev]` 124/124、`.[all]` 163/163；不是原论文作者仓库的 release | `I/T/D/C` | `S2`，young independent library/reproduction | **未知** |

## 新候选的流行度、发行、官方集成与采用拆分

下表的 GitHub 数字由官方 API 于 **2026-09-04** 抓取，PyPI 数据由官方 JSON metadata 同日抓取。它们只用于表示可见度与可分发性，**不参与 S1–S4 判定**。

| 候选 | GitHub 可见度（2026-09-04） | Package/release 证据 | Download 证据 | 官方产品集成 | 真实 production adoption |
| --- | --- | --- | --- | --- | --- |
| **Deep Agents** | [28,944 stars、4,067 forks](https://api.github.com/repos/langchain-ai/deepagents) | PyPI 首版 0.0.1：2025-07-29；当前 [0.7.13](https://pypi.org/project/deepagents/0.7.13/)：2026-09-02；classifier 仍为 Beta | PyPI 官方 metadata 不发布 aggregate download counter；本文不引入机器人/CI 噪声很大的第三方下载估算 | **有**：LangChain-maintained SDK 内的 `ContextHubBackend` 对接 LangSmith Context Hub，且有[官方 Context Hub 文档](https://docs.langchain.com/langsmith/use-the-context-hub) | **未知**；stars、发布频率、第一方 LangSmith 集成都不给出外部部署/活跃用户数 |
| **AICTX** | [57 stars、6 forks](https://api.github.com/repos/oldskultxo/aictx) | PyPI 首版 0.3.0：2026-04-17；continuity 首次进入 4.0.0：2026-04-24；当前 [7.0.1](https://pypi.org/project/aictx/7.0.1/)：2026-06-17；classifier 仍为 Beta | 同上：官方 PyPI 页不给 aggregate downloads，故不报第三方估算 | **未发现** Codex/Claude/Copilot 维护方的第一方集成；现有 hooks/instructions/plugins 是 AICTX 自带 compatibility adapters | **未知**；快速升到 v7、有 CI/测试/适配器均不是外部生产案例 |

因此，“Deep Agents 的公开关注度很高”和“AICTX 已发布多个版本”都是可核验的；“已被广泛生产采用”仍不可由此推出。

## 逐项证据与边界

### 1. Aider：长期 shipped 的渐进式代码导航，不是 Context Repository

- **首次实现与发行。** Git 历史中最早相关实现是 [`5e01042`](https://github.com/Aider-AI/aider/commit/5e010422e249c837ba53bc07db597da23aa2a67b)（作者时间换算为 2023-05-19 UTC）；v0.5.0 release note 明确列出 `--map-tokens`、PageRank 和按 token budget 选择 repo map。
- **当前默认范围（I/T）。** `sources/adjacent/aider/aider/coders/base_coder.py:487-508` 只有在模型配置/显式 token 预算启用、Git repo 存在且 coder 支持 map prompt 时才实例化 `RepoMap`；`aider/resources/model-settings.yml` 中许多模型配置为 `use_repo_map: true`。`tests/basic/test_repomap.py` 覆盖 refresh、排序和 tree rendering。
- **采用判定。** 这是已发布多年并在常规配置中自动进入请求上下文的工程机制，因此在它自己的“bounded navigation projection”范围内是 `S4`。但其 authority 仍是工作 Git repo；RepoMap 是派生索引，没有 context archive/publish/recovery contract，不能据此说 Aider 已采用完整 context-as-repo。

### 2. OpenHands SDK：默认 condenser 已稳定发行，但只是 Event → View

- **首次实现与发行。** `Core context condensation implementation` 于 2025-09-03 进入主干，包含在 2025-10-14 的 1.0.0a1 pre-release，随后包含在 2025-11-06 的官方 1.0.0 stable release。
- **当前默认范围（I/T）。** `openhands/sdk/settings/model.py:150-166,191-200,1335-1344` 令 condenser `enabled=True`，并让 `OpenHandsAgentSettings` 默认构造 `LLMSummarizingCondenserSettings`；`openhands/sdk/subagent/registry.py:253-282` 对 subagent 使用同类默认；`tests/sdk/subagent/test_subagent_registry.py:885-918` 明确断言该默认。View/condensation 本身另有覆盖 cut point、tool-loop atomicity、hard reset 的测试。
- **采用判定。** 可以说“当前 OpenHands SDK 默认采用 summarizing condenser”，不能说“所有 OpenHands hosted product 会话都使用它”；后者需要部署配置或 telemetry，本审计没有。它保留 Event stream、压缩派生 View，是成熟的 authority/projection separation，却没有可供模型按稳定地址恢复所有 forgotten events 的 repo 工具。

### 3. Letta Code：从 opt-in 到 default，再到 mandatory 的真实 rollout

- **首次 Git-backed 版本（I/T/D）。** 2026-02-11 的 #905 将每个 agent memory 变成 Git repo；第二天的 v0.15.0 release 同时包含 #905 与“make memfs opt-in and cloud-only” #915。因此“从 2 月首次发布起就是默认”不成立。
- **默认阶段。** [#2755](https://github.com/letta-ai/letta-code/pull/2755) 于 2026-06-07 合并，v0.27.7 release 明确收录“enable MemFS by default for created agents”；当时 PR 仍保留 explicit opt-out。
- **mandatory 阶段。** [#3202](https://github.com/letta-ai/letta-code/pull/3202) 于 2026-07-03 合并，v0.27.21 明确收录“remove all non-memfs opt-outs”。当前 pinned source 的 `src/agent/create.ts:140-178` 与 `src/agent/create.test.ts:1-63` 锁定精确边界：regular agent 在 capable backend 上启用；subagent 故意 stateless；不具备能力的 self-hosted backend 回退到 standard；regular agent 请求 `standard` 不再构成 opt-out。
- **采用判定。** 这是本组唯一能够同时证明 Git authority、编译式投影、受约束写工具、post-turn sync、worktree maintenance，并且已经在自己产品的普通新建 agent 路径默认启用的实现。仍然不能从代码推导 Letta Cloud 的活跃用户数或 MemFS 实际使用率。

### 4. Codex：主线实现和公开默认完全是两回事

- **#27488（2026-06-11）** 只增加 direct-model-only `new_context` escape hatch。模型主动调用时新窗口不生成摘要；同一 revision 的 token-limit 自动路径仍会走旧 `run_auto_compact`。
- **#29743（2026-06-23）** 才把 **TokenBudget 模式** 的 manual 与 auto compaction 都改成 fresh window、跳过 model/server summarization。非 TokenBudget 分支仍保留 summarizing compaction。
- **#39827（2026-08-21）** 才提供 4 个 History read/search 工具和 5 个 Notes list/read/search/append/write 工具。Notes 是 Codex backend 的 virtual path/private model state，不是项目文件，也不是 Git repo。
- **公开 rollout（D/I）。** 0.153.0 release note 明写 `features.context_management.experimental_mode` **disabled by default**，只对 Codex backend 上符合条件的 ChatGPT Plus/Pro/Pro Lite 会话生效，API-key、自定义 provider 与 temporary structured thread 排除。当前 `codex-rs/features/src/lib.rs:1580-1589` 对 `TokenBudget`、`ContextManagement` 都是 `Stage::UnderDevelopment` 且 `default_enabled: false`；`codex-rs/core/src/session/token_budget.rs:13-55` 强制 eligibility。
- **采用判定。** 最准确表述是“机制已进入 main、已有公开 release、处于受限的 opt-in experiment”。不能说“Codex 已把 compaction 干掉”，也不能从 release 说明推断有多少用户启用。

### 5. Deep Agents：默认 context-as-files 与 opt-in Context Hub repo 是两个 rollout

- **起点与发行（I/D）。** 项目 2025-07-27 创建；2025-07-29 的 [`80338ed`](https://github.com/langchain-ai/deepagents/commit/80338eda64fd50179372a06f5ab5e6db11349b70) 首次引入 state-backed `ls/read/write/edit` virtual filesystem，同日 `deepagents` 0.0.1 上传 PyPI。2025-10-17 开始大工具结果外置，2026-01-16 开始在 summarization 时把被替换的原消息落到可回读 history 文件。
- **当前默认范围（I/T）。** pinned 0.7.13 的 `create_deep_agent()` 无需调用者另外挂载就组装 `FilesystemMiddleware`、summarization middleware 与通用 subagent；默认 backend 是 thread-scoped `StateBackend`。过大 tool result 写入 `/large_tool_results/<call-id>`，summary 前原消息写入 `/conversation_history/<session>.md`，模型得到 exact path 可按需回读。Skills 的 metadata-first 索引和 Memory/AGENTS 源则只在调用方传 `skills=` / `memory=` 时启用。
- **repo backend 是后来的 opt-in。** [`6962826`](https://github.com/langchain-ai/deepagents/commit/69628263cb2c1f6951b1b37bbc0edbb85983ad51) 于 2026-05-12 加入 `ContextHubBackend`，当日发布在 0.6.0。它通过 LangSmith `pull_agent/push_agent`、commit hash、`parent_commit`、冲突重拉和 edit-intent replay 实现真正版本化 remote context repo；但必须显式传为 backend，且通用模型工具不暴露 revision/diff/log/rollback。
- **验证与采用判定。** 本次 pinned source 的针对性离线 suite **347 passed, 2 xfailed**；仓库另有会连真实 LangSmith Hub 的 integration tests，本次未运行以避免创建远端资源。因此核心 filesystem/offload/summarization 为 `S4 scoped default`；ContextHubBackend 为 `S3 shipped-opt-in`。这证明 LangChain 自己把它与 LangSmith Context Hub 对接，不证明任何数量的第三方 production deployment。

### 6. AICTX：完整的 repo-local continuity loop，但是新的 Beta opt-in 产品

- **起点与发行（I/D）。** 仓库于 2026-04-16 创建，0.3.0 于 2026-04-17 首次上传 PyPI。与本课题直接相关的 continuity storage/session/handoff/decision/failure/finalize loop 从 2026-04-24 的 [`88eb69b`](https://github.com/oldskultxo/aictx/commit/88eb69b16c08bfed2347cb47987c009d1c39dfb0) 起进入主线，同日包含在 PyPI 4.0.0。当前 7.0.1 于 2026-06-17 发布，package classifier 仍是 Beta；完整公开历史只覆盖约两个月。
- **真正实现（I/T/D）。** runtime 维护固定 `.aictx/` JSON/JSONL schema，以 `resume → bounded capsule → work → finalize` 维持连续性；常规 capsule 目标约 1,200 tokens/6,000 chars，选中内容携带 source/`why_loaded`/新鲜度；它还有 branch-safe Work State load、optional RepoMap、opt-in Git portability、capability-profiled CLI/MCP 和干跑式 retention plan。
- **关键边界。** 普通更新是直接重写/追加，没有通用 revision/CAS/transaction；archive 是把特定老记录移入 gzip 的维护命令，没有通用 item-level archive/restore lifecycle。对 Codex、Claude、Copilot 的集成主要是 AICTX 仓库生成的 instructions/hooks/plugins，其中有可执行 adapter（I），也有要求 agent 按流程调用的 prompt convention（P）；未见这三家厂商维护的官方集成。
- **验证与采用判定。** pinned source 有 69 个 `test_*.py` 文件、561 个 top-level test functions；本次 `compileall` 通过，但当时本地环境无 pytest，故 `T` 表示 focused tests 存在，不声称本次全套复跑通过。它是 `S3 shipped-opt-in`；快速版本数、CI 和 adapters 不足以证明外部 production adoption。

### 7. AIGNE：挂载后自动给工具，不等于默认给所有 agent 挂载

- **发行（I/T/D）。** AFS 基础实现于 2025-10-07 进入代码并发布 `@aigne/afs` 1.0.0；Git mount 于 2026-01-16 发布 `@aigne/afs-git` 1.0.0，后续有 stable 更新。
- **运行时边界。** `packages/core/src/prompt/prompt-builder.ts:128-150,460-461` 只在 `options.agent?.afs` 存在时加入 AFS tools；`packages/core/src/prompt/skills/afs/index.ts:14-25` 返回 list/search/read/write/edit/delete/rename/exec 及 AFS skill loader。packages 下有对应 core/provider/prompt tests。
- **采用判定。** AFS 是真实、发布、可复用的 developer subsystem；“一旦配置就自动进入 agent 工具面”是 `I`，而“所有 AIGNE agent 默认采用 AFS”没有证据。故为 `S3 shipped-opt-in`。

### 8. AgentPlane：正式发布的 repository-local context，但刻意不自动进入 runner prompt

- **发行（I/T/D）。** 2026-05-13 的实现次日进入 v0.6.0；release notes 明确列出 `context init/ingest/reindex/search/source/verify-task`，并记录 npm publish 与 post-publish smoke。
- **真实边界。** 当前 `README.md:134-135` 称 Local Context optional；`packages/agentplane/src/commands/context/context-init-builders.ts:39-48` 更明确写出它与 runner prompt assembly 独立。context command、SQLite FTS、freshness、ingest/finalize/verify 有大量测试。
- **采用判定。** 它证明“repo-owned source + disposable derived index + provenance gates”已经发布为 CLI 产品能力；但用户要初始化并主动使用。release workflow 成功只证明可分发，不证明外部项目实际采用。

### 9. ContextFS：测试和 binary release 很实，但解决的是 substrate

- **发行（I/T/D）。** 2026-05-22 的 initial public release 已包含 CAS、checkpoint、branch/merge 及 CI；v0.1.1 于次日提供 Linux/macOS/Windows assets，v0.1.7 继续提供多平台 release artifacts。
- **工程证据。** pinned source 下 `tests/unit/` 与 `tests/system/` 覆盖 object store、checkpoint/rollback、branch routing/merge、agent state、runtime restore、workspace CLI 等。README 也明确说明 live process restoration 需要 cooperative runtime boundary，不是任意 PID rollback。
- **采用判定。** 这是一个可下载且测试面较广的版本化 filesystem substrate，不是会自动决定“哪些语义上下文进模型”的 context manager。没有核验到由独立产品仓库引用它的 lockfile、adapter release 或公开 deployment；故外部采用未知，成熟度记为 `S2` 而不是“paper prototype”。

### 10. agent-mem：功能不是假的，但作者自己标为 Alpha

- **发行（I/T/D）。** 初始 CLI 于 2026-02-22 出现，v0.1.1 于 2026-02-23 发布；`README.md:9` 明示 `Alpha — functional and evolving`。
- **本机复验。** 在 pinned `0f51758d…` 上运行 `npm test`，结果为 **61 passed, 0 failed**。覆盖 init、read/write/search、branch/switch/merge/diff、pin/unpin、compact/archive、forget、lesson 与 conflict resolve。
- **采用判定。** 这足以把它从“README 点子”提升为 functional specimen，却不能提升为成熟产品：版本仍为 0.1.1，分支/merge 与 archive 多为轻量文件规则，没有外部 adapter telemetry 或采用证据。因此是 `S2 alpha`，外部用户数未知。

### 11. agent-os：runtime 能校验，agent 行为仍主要是 convention

- **发行（I/T/D/P）。** 2026-07-13 从 Work-OS 转成 runtime-neutral Agent-OS 并发布 v1.0.0；GitHub 自身把仓库标为 public template。
- **可执行部分。** `docs/state-protocol.md` 定义 revisioned workstream、immutable receipt、handoff 与 single-active-writer 协议；Python 工具能执行 schema validation、receipt creation、backup/restore 和 hygiene/doctor 检查。本机运行 `python3 -m unittest discover -s library/scripts/tests -v`，**37/37 通过**；strict doctor、public hygiene audit、gitless smoke 也通过。
- **convention 部分。** `AGENTS.md` 要求 agent 先读 binder/workstream、渐进读取目录、写前重新检查 revision、写后产生 receipt。通用 filesystem/runtime 并不会自动拦截每次模型读写以强制这些步骤；这些行为应标为 `P`，不能因为有 validator 就全部升级为 runtime enforcement。
- **采用判定。** 它是很好的可移植 protocol/template 与验证工具箱，不是自动装载/维护上下文的 daemon 或 agent runtime，故为 `S2`。v1.0.0 是作者的发行版本号，不是外部生产采用证明。

### 12. ACE：必须分开论文原作与社区实现

**原始 `ace-agent/ace`：**

- arXiv v1 于 2025-10-06 发布，论文报告的 benchmark 改善属于 `C`；它证明研究结果，不证明产品 rollout 或用户采用。
- pinned source 有 generator/reflector/curator 和 playbook persistence（`I`），但所审计 operation algebra 只有 `ADD` 真正完整执行；UPDATE/MERGE/DELETE/CREATE_META 仍是未来项。仓库无 GitHub Releases、未核验到 PyPI 包、没有自动化测试目录。
- 因此判为 `S1 paper/research prototype`。

**独立社区 `rrahimi-uci/agentic-context-engineering` / `ace-playbook`：**

- 2026-06-27 独立发布 v0.1.0，2026-06-29 发布 PyPI 0.3.0；current source 实现 typed delta、持久化、CLI、OpenAI Agents SDK adapter 和自动化 tests。
- README 把 dev 安装与 163 tests 并列的说法不精确：本次在隔离 uv 环境中实测 `.[dev]` 为 **124/124 passed**，`.[all]` 为 **163/163 passed**。这提升了工程可复现性证据，不提升外部采用证据。
- 它是比原始开源代码更完整的工程样本，但不是原作者的 release，也没有外部部署证据；判为 `S2 young independent library`。

## “真的有人用了”能说到哪一步

按目前一手证据，安全表述只有三层：

1. **已经进入发布后的 scoped default path：** Letta Code MemFS；Aider RepoMap；OpenHands SDK condenser；Deep Agents 核心 filesystem/offload/summarization。只有 Letta 是接近完整 context-as-repo；Deep Agents 默认层是 context-as-files 与可恢复外置，真正的 Context Hub repo 另行 opt-in。
2. **已经发布但需要显式采用：** Deep Agents `ContextHubBackend`、AICTX、AIGNE AFS/AFSGit、AgentPlane Local Context。它们不是 paperware，但也没有证据支持“框架用户普遍启用”。
3. **已经公开但仍不应称为普遍采用：** Codex 是 default-off restricted experiment；agent-mem 是 Alpha；ContextFS 是 v0.1.x substrate；agent-os 是 template/protocol；原始 ACE 是论文原型；`ace-playbook` 是年轻独立实现。Deep Agents/AICTX 的 Beta classifier 是 API 成熟度信号，不是采用人数。

对“外部是否有人正在生产使用”这个更强问题，本次所有项目答案都是：**可能有，但可核验数量未知。** 若以后要把某项升级为“外部采用已证实”，至少需要一项独立的一手证据：第三方产品 lockfile/adapter 与 release、公开部署清单、可审计客户案例，或维护方披露且有口径的 active-install/feature-activation telemetry。stars、forks、reaction、包下载量只能作为兴趣或分发代理，不能替代这一证据。

## 关键纠偏清单

- `Codex #27488 = 删除原压缩`：**错。** 它只加主动 `new_context`；TokenBudget auto/manual 无摘要切窗是 #29743；History/Notes 是 #39827；公开组合开关是 0.153.0 且默认关闭。
- `代码进 main = 产品用户已采用`：**错。** Codex 是最明显反例；main 中存在数月，公开面仍是 restricted experiment。
- `Letta 2026-02 起默认 MemFS`：**错。** v0.15.0 同版明确改成 cloud-only opt-in；6 月默认，7 月才移除普通 agent opt-out。
- `repo map / condensation / filesystem checkpoint / playbook = context-as-repo`：**错。** 它们分别只解决 projection、window compaction、execution state rollback、semantic curation；不自动具备 authority + addressing + lifecycle + transactional publication 的完整契约。
- `有 release / npm / PyPI / v1.0 / 很多测试 = 有外部采用`：**错。** 这些是发行或工程成熟度证据，不能替代使用数据。
- `Deep Agents 有 28,944 stars 且对接 LangSmith = 已被大规模生产采用`：**错。** stars 是关注度；LangSmith backend 是第一方集成；两者都不是第三方部署或活跃用户 telemetry。
- `AICTX v7 + Codex/Claude/Copilot adapters = 三家官方采用`：**错。** 版本号来自两个月内的快速发行，adapters 由 AICTX 自己维护。
- `AGENTS.md 写了流程 = runtime 强制`：**错。** agent-os 的 validator 很有价值，但 agent 是否先读、写前复核、写后留 receipt 仍主要是 `P` 级约定。
- `社区 ACE library = 原论文作者已产品化`：**错。** 两个仓库、维护者和发行链不同，必须分别记账。

## 可复现性与限制

- 所有实现判断基于 [`sources.lock.json`](../sources.lock.json) 所列 pinned revisions；核心 SHA 也在总表链接中固定。
- release 时间与 rollout 描述以 GitHub release/PR 页面、package registry metadata 和 pinned code/tests 交叉核对；日期统一为 UTC。
- 本次本机复跑：Deep Agents 针对性 suite 347 passed/2 xfailed；agent-mem 61/61；agent-os unittest 37/37 以及 strict doctor/public hygiene/gitless smoke；`ace-playbook` 隔离 uv 环境 `.[dev]` 124/124、`.[all]` 163/163。AICTX 只复验 `compileall`；其 pytest 没有在当时环境安装，故未运行。其他项目因依赖、平台或全仓规模未重跑完整 suite，`T` 仅表示 pinned source 中存在直接锁定该行为的自动化测试。
- GitHub API 可见度数字和 PyPI 时间/classifier 于 2026-09-04 抓取；官方 PyPI metadata 不含 aggregate download count，本文没有据此猜测安装或活跃用户数据。
- 官方 OpenAI API 文档说明 Responses API 的 compaction/context-management 能力，但没有把 Codex CLI 的 `experimental_mode` 说成默认功能；因此 Codex rollout 结论以 0.153.0 官方 release note 与 pinned feature gate 为准。
- 本文只把 stars/forks 作为抓取日当时的可见度代理，不把它们作为采用指标；也没有把 README 自述的兼容对象、benchmark 或测试数量当作外部采用。
