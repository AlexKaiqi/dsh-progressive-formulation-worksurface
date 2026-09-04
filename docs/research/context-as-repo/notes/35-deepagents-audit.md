# LangChain Deep Agents：Context-as-Repo 相邻实现审计

审计对象：[`langchain-ai/deepagents`](https://github.com/langchain-ai/deepagents)，
固定 Revision `632f2c941b877eff70407606b58e393212448a26`，MIT。
本文沿用 `02-evaluation-method.md` 的证据标签：**I**（实现）、**T**（测试）、
**D**（文档）、**P**（仅 Prompt/说明）、**C**（项目方宣称）。

为避免重复长前缀，下文代码证据中的 `.../` 专指
`sources/adjacent/deepagents/libs/deepagents/deepagents/`；测试路径中的
`.../tests/` 专指 `sources/adjacent/deepagents/libs/deepagents/tests/`。

## 结论

**Deep Agents 是本轮最强的相邻实现之一，值得保留完整历史 clone。** 它至少满足
“上下文在模型请求外持久化、稳定文件地址、bounded read/search、显式工具契约、
metadata-first 渐进披露”五项纳入条件；2026 年又加入了真正带提交和父提交冲突处理的
`ContextHubBackend`。但它仍不是 WorkSurface 的替代品：

1. Deep Agents 的公共抽象首先是一个**可插拔文件工具层**。同一 POSIX 路径可以落在
   LangGraph state、BaseStore、真实主机/沙箱文件系统或 LangSmith Context Hub；只有
   Context Hub 这一种 backend 有 repo/commit 语义。**[I][T]**
2. 它已经真实实现了两种“把正文移出活跃窗口、留下可恢复路径”的机制：大型工具结果
   写到 `/large_tool_results/<tool-call-id>`；被 summary 取代的原始消息追加到
   `/conversation_history/<session-id>.md`。这不是 prompt-only。**[I][T]**
3. 它的 Skills 是成熟的渐进披露实现：系统提示只列 name/description/path，模型需要时
   再 `read_file` 全文；AGENTS memory 则相反，是配置源的**全量、常驻装载**。**[I][T]**
4. Context Hub 的“repo”是真实的远端版本化 Agent Context 抽象，有 commit hash、
   `parent_commit`、冲突重拉和 edit-intent 重放；它不是本地 Git，也没有把 revision/diff/
   rollback 暴露进通用模型工具 ABI。**[I][T]**
5. 通用写入仍是直接 `write/edit/delete`：没有 stage/validate/publish、通用 CAS、archive/
   restore 或投影 receipt。`delete` 是不可逆物理删除；“编辑前必须 read”只写在工具说明，
   实现并未维护 read ledger。**[I][P][T]**
6. 默认 subagent 隔离的是消息窗口，不是 Surface/存储。它仍接收父状态中的非 private
   字段，并通常共享同一个 backend 和工具。**[I][T]**

最值得吸收的不是“把所有东西都做成 AGENTS.md”，而是四个组合：**统一但诚实的读取
ABI、metadata-first 索引、丢窗口前先把原文落到稳定地址、版本化长期上下文与运行态分层**。

## 1. 固定 checkout 与验证

```text
path       sources/adjacent/deepagents
origin     https://github.com/langchain-ai/deepagents.git
branch     main
revision   632f2c941b877eff70407606b58e393212448a26
history    3649 commits available locally
checkout   full history, blobless
license    MIT
LICENSE    sha256:4ec67e4ca6e6721dba849b2ca82261597c86a61ee214bbf21416006b7b2d0478
status     clean after dependency sync and tests (`.venv` is ignored)
```

固定源码里的 Python package version 是 `0.7.13`，classifier 仍为
`Development Status :: 4 - Beta`；同时完整历史已有 3,649 commits，固定 HEAD 当天仍在
更新。适合把它视为**活跃、测试密集的成熟相邻库**，不应把 Beta API，尤其 2026 年 5 月
才加入的 ContextHubBackend，表述成长期稳定标准。**[I]**

本次运行的离线测试：

```text
uv run --group test pytest -q -rx \
  tests/unit_tests/backends/test_context_hub_backend.py \
  tests/unit_tests/middleware/test_memory_middleware.py \
  tests/unit_tests/middleware/test_skills_middleware.py \
  tests/unit_tests/middleware/test_summarization_middleware.py \
  tests/unit_tests/test_file_system_tools.py \
  tests/unit_tests/test_subagents.py

347 passed, 2 xfailed in 4.34s
```

两个 xfail 中，与本审计直接相关的是同一文件的并行 `edit_file`：测试注释明确说明
StateBackend reducer 和其他 backend 都可能竞态，目前建议模型避免并行编辑同一文件，
而不是由 runtime 阻止。另一个 xfail 是父调用 callbacks 向 subagent 传播，和 repo
语义无直接关系。

- `sources/adjacent/deepagents/libs/deepagents/tests/unit_tests/test_file_system_tools.py:355-360`
- `sources/adjacent/deepagents/libs/deepagents/tests/unit_tests/test_subagents.py`

仓库另有针对真实 LangSmith Hub 的 integration tests，覆盖首写建 repo、read/search/edit
round trip、跨 backend instance 持久化、父提交冲突恢复和 batch commit。本次未运行这些
会创建远端 repo 的测试，故只记为“存在的集成测试”，不把它们记成本次独立复现。**[T]**

- `sources/adjacent/deepagents/libs/deepagents/tests/integration_tests/test_context_hub_backend.py:1-218`

## 2. “Context as Repo” 在这里到底指什么

Deep Agents 把三件容易混淆的东西放在同一个文件界面下，但它们的事实强度不同：

```mermaid
flowchart TB
    M[Model request]
    A[AGENTS memory\nfull configured files inline]
    K[Skills index\nname + description + path]
    T[ls / read_file / glob / grep\nwrite_file / edit_file / delete]
    B[BackendProtocol\nPOSIX-like virtual address space]

    S[StateBackend\nvirtual files in thread state]
    P[StoreBackend\nvirtual files in persistent BaseStore]
    F[FilesystemBackend\nreal host files; optional virtual root]
    C[ContextHubBackend\nremote versioned agent repo]
    X[CompositeBackend\nprefix routing + artifacts_root]

    O[/large_tool_results/*\nfull tool output]
    H[/conversation_history/*\nevicted raw messages]

    A --> M
    K --> M
    M --> T --> B
    B --> S
    B --> P
    B --> F
    B --> C
    B --> X
    X --> S
    X --> P
    X --> F
    X --> C
    T --> O
    M --> H
```

### 2.1 虚拟文件、真实文件与版本化 repo 的边界

| Backend | 实际 authority | 跨 Turn/Thread | 是真实文件系统吗 | 有 repo revision 吗 |
| --- | --- | --- | --- | --- |
| `StateBackend` | LangGraph `files` state channel | 同一 thread 可 checkpoint；不跨 thread | 否，virtual map | 否 |
| `StoreBackend` | LangGraph `BaseStore` namespace | 可跨 thread，作用域由调用方 namespace 决定 | 否，virtual records | 否 |
| `FilesystemBackend` | OS 文件 | 由目录寿命决定 | **是**；`virtual_mode` 只改变路径解释/约束 | 否，除非宿主目录另有 VCS |
| `ContextHubBackend` | LangSmith Hub Agent Context | 是 | 否，远端 repo API | **是**，但 revision 未进入通用工具返回值 |
| `CompositeBackend` | 按最长路径前缀路由到上述 backend | 逐 route 决定 | 混合 | 逐 route 决定 |

- `StateBackend` 明确只保证 conversation thread 内持久，并在 agent step 后 checkpoint；
  `fresh=True` 给同一 superstep read-your-writes。**[I]**
  - `.../backends/state.py:38-48,81-119`
- `StoreBackend` 把路径映射到调用方提供的 namespace，可做 user/assistant/tenant 隔离并跨
  thread 保存，但记录没有对模型公开的 expected revision。**[I][T]**
  - `.../backends/store.py:42-119`
- `FilesystemBackend(virtual_mode=True)` 默认把路径锚在 `root_dir`，拒绝 `..`、`~` 和
  越界绝对路径；源码同时明确它**不提供 sandbox/process isolation**。
  `virtual_mode=False` 则允许主机绝对路径，写入永久生效。**[I]**
  - `.../backends/filesystem.py:91-180,484-615`
- `CompositeBackend` 用 longest-prefix-wins 把 `/memories/` 等路径路由到不同 durability，
  并独立声明 `artifacts_root` 供 history/tool-result offload 使用。**[I][T]**
  - `.../backends/composite.py:228-291,300-352,459-520`

因此，“Deep Agents 有 filesystem”不能直接推导为“它已经 Context-as-Git”；“路径是
virtual”也不能推导为“安全隔离”。只有 `ContextHubBackend` 是版本化 repo 实现。

## 3. BackendProtocol：最成熟的部分是读取契约

`BackendProtocol` 把 `ls/read/grep/glob/write/edit/delete/upload/download` 放在一个公开
接口中。即使 backend 没有 shell，模型仍能得到相同的结构化文件操作。**[I][T]**

- `ReadResult` 强校验 `start_line/end_line/next_offset/total_lines` 的组合与数值一致性，
  避免分页 resume 跳过未展示内容。
- `GrepResult.truncated` 显式说明结果不完整；`GlobResult` 进一步区分 `budget`、
  `unreadable`、`transport`，使模型知道“收窄查询”是否真的有用。
- `grep` 定义为 literal search，不假装所有 backend 都支持相同 regex/shell 语义。
- upload/download 支持 per-file partial success，并标准化常见可恢复错误；不过错误 union
  仍允许任意 backend-specific string，尚不是完全封闭的错误 ABI。

证据：

- `.../backends/protocol.py:39-126,203-274,343-400,404-422`
- `.../backends/protocol.py:659-732`

模型工具层默认给 `read_file` 100 行，并在单行超过 5,000 字符时生成 continuation rows；
若字符预算切在行中，代码会重新计算 `next_offset`，不让后续分页静默漏行。`grep` 默认
上限 1,000 matches，glob/grep 在截断时带说明。**[I][T]**

- `.../middleware/filesystem.py:911-1027,1151-1264,1674-1711`

这是 WorkSurface 可以直接借鉴的成熟实践：**读取返回值必须表达“读到了什么”和“还没
读到什么”，不能只返回一段字符串。**

## 4. 大工具结果：正文落路径，窗口只留索引和 preview

`FilesystemMiddleware` 对非内建文件工具的 `ToolMessage` 做真实拦截：

1. 用 `4 chars/token` 近似估算；默认超过 20,000 tokens 才触发；
2. 把全部文本写到 `<artifacts_root>/large_tool_results/<sanitized-tool-call-id>`；
3. 用带 exact path、前 5 行、后 5 行和 omitted-line count 的 preview 替换 model-visible
   文本；ToolMessage 的 id/name/status/artifact/metadata 和非文本 block 保持；
4. 模型随后可以 `read_file(path, offset, limit)`，也可在 `/large_tool_results/` 下 grep；
5. backend write 失败时保留原始完整 ToolMessage，不会一边丢正文一边声称已保存。**[I][T]**

- `.../middleware/_message_eviction.py:25-63,66-116,119-162`
- `.../middleware/filesystem.py:1634-1639,1674-1677,3205-3279,3528-3577`

内建 `ls/glob/grep/read_file/write_file/edit_file/delete` 不走 generic offload：搜索工具自己
做 bound/truncation，`read_file` 有分页和字符 clipping，写工具只返回短 receipt。**[I]**

- `.../middleware/filesystem.py:1510-1539`

大型 HumanMessage 的路径略不同：只有“当前最后一条 HumanMessage”超过默认 50,000
token 估算时才写到 `/conversation_history/<uuid>.md`。原消息以 `lc_evicted_to` tag 留在
graph state，送给模型的 request 才替换为 preview/path；checkpoint 的 source message
没有被直接删除。**[I][T]**

- `.../middleware/filesystem.py:1674-1676,3123-3167,3281-3410`

### 边界

- tool-result 地址只以 tool-call id 命名；没有 content digest、source revision、trust、
  retention 或 overwrite receipt。
- 是否“持久”完全由 offload path 路由到哪种 backend 决定。默认 `StateBackend` 只随
  thread state 存活；不能把“已落文件”一概写成长期持久化。
- generic tool offload 是 per-result preservation，不是 summary、archive 或 domain state。

## 5. Summarization：比滚动截断强，但仍是 best-effort recovery

Deep Agents 在 LangChain summarization 之上加了一层可恢复文件：

- 自动 middleware 在 profile 有 `max_input_tokens` 时默认 85% 触发、保留最近 10%；
  没有 profile 时 fallback 为 170,000 tokens/最近 6 messages。**[I]**
- 另有真实 `compact_conversation` 工具；它不是仅凭 nudge 自动执行，且要达到约自动阈值
  的一半才允许提前 compact。**[I][T]**
- 每次 summary 把被替换的原消息渲染为 XML-like Markdown section，追加到同一
  `/conversation_history/session_<uuid>.md`；summary message 带回 exact path。**[I][T]**
- `_summarization_session_id` 是 private checkpoint state；同一会话重复使用，每个独立
  subagent invocation 得到自己的 UUID，避免 history 文件互串。**[I][T]**
- 连续多次 summary 会过滤上次生成的 synthetic summary，避免把同一原文重复归档。
  Inline base64/data-URL media 以 SHA-256 前 16 hex 命名写到
  `/conversation_history/media/`，失败会留下明确 placeholder/warning。**[I][T]**
- 原始 `state["messages"]` 不被 summary 重写；`_summarization_event` 只定义模型看到的
  `summary + recent tail` view。这是“authority log 与窗口投影分离”的好实现。**[I][T]**

- `.../middleware/summarization.py:1-59,198-224,262-299`
- `.../middleware/summarization.py:666-765,783-848`
- `.../middleware/summarization.py:1189-1343,1345-1484`
- `.../middleware/summarization.py:1636-1710,1803-1901`

### 两个关键限制

1. history append 在通用 backend 上是 `download existing → concatenate → exact edit/write`，
   没有 common CAS/transaction。不同 writer 同时 append 可能 lost update；只有
   ContextHubBackend 自己额外实现了冲突重放。**[I][G]**
2. offload 失败时会 warning “older messages will not be recoverable”，但 automatic
   summarization 仍继续并生成 summary；async 路径甚至并发运行 offload 和 summary。
   它对失败很诚实，却不是 WorkSurface 设想的 checkpoint-before-reset gate。**[I][T]**

换句话说，这里的 `/conversation_history/` 是**可检索冷历史**，不是带 archive lifecycle
的 context item，也不是保证成功后才能换窗口的事务边界。

## 6. Persistent memory 与 AGENTS.md bootstrap

### 6.1 SDK 层：显式 sources、全量装载

`MemoryMiddleware` 不扫描仓库。宿主必须显式提供 `sources: list[str]`；这些普通 Markdown
文件按顺序下载、拼接，完整注入 `<agent_memory>`。无 required schema，也无单源或总 token
上限。missing file 静默跳过，其他 download error 抛错。**[I][T]**

它每个 checkpointed session 只加载一次：只要 state 已有 `memory_contents`，后续 Turn
不重新读取。因此同一会话内 agent/用户改了 AGENTS.md，system memory 仍可能是旧 snapshot；
没有 source digest 或 freshness receipt。**[I][T]**

- `.../middleware/memory.py:1-38,180-303`

Prompt 告诉模型把 learnings 用 `edit_file` 写回、把 memory 当不可信参考、不要存 secret。
其中“信任/何时保存/禁止保存 secret”是 **P**；真正执行的只有下载、拼接、HTML comment
剥除。通用 MemoryMiddleware 没有 schema validator、provenance、proposal/publish 或敏感
信息扫描器。**[I][P]**

### 6.2 deepagents-code 层：有自动发现，但这是产品包装契约

CLI 会自动装配：

```text
user agent memory first
  $DEEPAGENTS_HOME/<agent>/AGENTS.md
then project memory
  <repo>/.deepagents/AGENTS.md
  <repo>/AGENTS.md
```

project 两个文件都存在时都会加载。自动发现对 symlink 做 fail-closed 边界检查：只接受
resolve 后仍在 project root 内的目标，避免恶意仓库用 `AGENTS.md -> ~/.ssh/config` 把
本机敏感文件注入首个模型请求。**[I][T]**

- `sources/adjacent/deepagents/libs/code/deepagents_code/project_utils.py:150-230`
- `sources/adjacent/deepagents/libs/code/deepagents_code/agent.py:2937-2966`

CLI 还为 onboarding 写入的 machine-managed AGENTS block 加了专门 middleware：拦截
`write_file/edit_file/delete`，恢复或拒绝破坏该 block 的修改。这个 guard 很具体，也说明
“模型可以直接改 AGENTS.md”本身不足以保护混合所有权文件。**[I][T]**

- `sources/adjacent/deepagents/libs/code/deepagents_code/memory_guard.py:1-21,51-104`

正确结论是：**core SDK 的固定契约是 caller-supplied memory sources；deepagents-code 才
采用 AGENTS.md discovery convention。** WorkSurface 若要 Runtime 自动装载，不能只模仿
文件名，还要明确 binding、所有权、预算、freshness 和 validation。

## 7. Skills：真正成熟的 progressive disclosure

`SkillsMiddleware` 是比 memory 更接近“Context-as-Repo router”的设计：

1. 每个 skill 是 `<source>/<skill-name>/SKILL.md`，frontmatter 至少含 `name` 和
   `description`；可带 license/compatibility/metadata/allowed-tools。**[I][T]**
2. middleware 通过 BackendProtocol 扫各 source、读取 SKILL.md 解析 frontmatter；多个
   source 按 base → user → project/team 分层，同名 skill later-source-wins。**[I][T]**
3. system prompt 只放 name、description、annotation 和 exact path；全文不进入常驻 prompt。
   模型匹配任务后才 `read_file(path, limit=1000)`，并可继续读 helper/reference。**[I][T]**
4. description/compatibility/warning count 和 warning length 有上限；loading error 会作为
   HTML-escaped、明确标为 untrusted diagnostics 的区块进入 prompt，而不是把失败伪装成
   “没有 skill”。**[I][T]**

- `.../middleware/skills.py:1-97,140-159,233-290,373-472`
- `.../middleware/skills.py:600-714,723-763,855-976`

这里要严格区分“读取实现”和“模型披露”：middleware 内部确实下载完整 SKILL.md 以解析
frontmatter，但 model-visible bootstrap 只含 metadata；这仍然属于渐进披露。

限制：skill metadata 同样每 session 只加载一次，可能 stale；10 MB 的单文件安全上限并
不是 system-prompt budget；`allowed-tools` 只是列给模型看的实验字段，没有执行权限收缩。
**[I][P]**

## 8. 写入、archive 与 recovery

### 8.1 真实工具能力

模型可见文件工具是 `ls/read_file/write_file/edit_file/delete/glob/grep`；只有 backend
实现 sandbox execution protocol 时才显示 `execute`。tool allowlist 和 read/write
permission rules 由 `FilesystemMiddleware` 执行。**[I][T]**

- `write_file` 创建或**整文件覆盖**，不要求先读。
- `edit_file` 做 exact-string replacement；默认要求 old string 唯一。
- 工具说明写着“必须先 read，否则 edit 报错”，但 wrapper 直接调用 `backend.edit`，没有
  read-set、digest 或 revision precondition。这条是 **P**，且与实现文案不一致。
- `delete` 对目录递归、不可撤销；真实 FilesystemBackend 可能在中途失败且已删除部分
  entry。它不是 archive。
- permission 目前在 middleware tool wrapper，不在 backend；直接调用 backend 可绕过。
  带 execute 的 backend 也没有通用 shell-level permission enforcement。

- `.../middleware/filesystem.py:1267-1330,2066-2347`
- `.../backends/filesystem.py:484-615`
- `.../graph.py:485-489`

### 8.2 没有一等 archive

Deep Agents 没有 `archive/list_archived/restore/supersede`，没有 active/archived lifecycle，
也没有将 archive 与 retention/GC 分开的事件。`/conversation_history/` 是历史 offload
目录；Context Hub 的 delete 是提交一个 `None` entry；二者都不构成 WorkSurface 定义的
可逆 archive。**[G]**

### 8.3 恢复能力依赖 backend

| 需要恢复的东西 | Deep Agents 的机制 | 强度 |
| --- | --- | --- |
| thread 内 agent/files state | LangGraph checkpointer + `StateBackend` | 有 checkpoint；不跨 thread |
| 跨 thread memory files | `StoreBackend` namespace | persistent records；无 revision/CAS |
| 主机工作目录 | `FilesystemBackend` | 真实字节仍在；直接写可能不可逆 |
| 被 summary 移出的细节 | `/conversation_history/<session>.md` | 可按路径读；offload 失败仍会 compact |
| 大工具正文 | `/large_tool_results/<call-id>` | 可按路径读；durability 取决于 route |
| agent/skill context history | `ContextHubBackend` | 有远端 commits；通用工具不暴露历史/rollback |

这说明 Deep Agents 的恢复是多个 backend 的能力组合，不存在一个统一的
`RevisionCheckpoint + EventSuffix` 恢复协议。

## 9. ContextHubBackend：最接近 Context-as-Repo 的部分

`ContextHubBackend(identifier="owner/name")` 用 LangSmith `pull_agent/push_agent` 读写
Agent Context repository。内部 cache 同时保存 file entries、linked agent/skill handles 和
当前 commit hash。**[I][T]**

mutation 路径有明显工程成熟度：

- 同一 instance 的 concurrent writes 在 50 ms window 内合并为一个 commit；
- accepted pending/in-flight mutation 先 overlay 到 visible cache，提供 local read-your-write；
- caller 要等远端 commit durable 后才收到成功；failure 会唤醒整 burst 的 waiters；
- `push_agent(..., parent_commit=current_hash)` 形成 optimistic concurrency；
- conflict 时最多重试 3 次，重新 pull authoritative tree，再把 write/edit/delete intent
  rematerialize。exact edit 可以保留不冲突的 remote change，已经失效的 old-string
  precondition 会失败；
- URL 无法解析 commit hash 时会重新 fetch authoritative snapshot，而不是凭空假设成功。

- `.../backends/context_hub.py:53-118,121-231`
- `.../backends/context_hub.py:252-377,379-453`
- `.../backends/context_hub.py:459-529,662-712`
- `.../tests/unit_tests/backends/test_context_hub_backend.py:166-420,918-1250`

### 它仍不等于 WorkSurface repo

1. 这是 LangSmith Context Hub 的 remote repo abstraction，不是 Git working tree；client
   代码里没有 branch/worktree/merge/rebase。
2. `BackendProtocol` 的 read/write/edit/delete result 不带 commit hash；模型不能 pin revision、
   `diff`、`log`、rollback 或显式提交 expected head。
3. 冲突恢复对模型透明，适合普通文件 UX，但不适合把每次 authority-changing publish 都
   变成带 reason/validation/receipt 的领域事务。
4. linked agent/skill entries 由 `get_linked_entries()` 单独暴露；generic file search 主要
   操作 materialized file cache，不能把链接图误写成完整 repo query engine。
5. 这是 2026 年 5 月才加入的 backend。它有广泛 unit/integration coverage，但相对核心
   filesystem/history 机制更年轻。

官方 Context Engineering 文档也把两层分开：Context Hub 用于带 commit/versioning/sharing
的长期 agent/skill context；Store backend 用于 agent 运行时跨 thread 状态。这个分层比
“所有状态塞进同一个 repo”更值得 WorkSurface 借鉴。**[D]**

- <https://docs.langchain.com/langsmith/context-engineering-concepts>
- <https://docs.langchain.com/langsmith/use-the-context-hub>
- <https://docs.langchain.com/oss/python/deepagents/backends>

## 10. Subagent：窗口隔离，不是存储隔离

默认 `mode="isolated"` 的 subagent 只收到 delegated HumanMessage，父 agent 只收到它的
最终 AI report；中间 reasoning/tool results 不回灌主窗口。这确实能控制上下文膨胀。
**[I][T]**

但 state 传递代码只排除 messages/todos/structured response 和 middleware private keys；
普通 `files` 等 state 字段仍传入，返回时也能 merge。声明式 subagent 一般还使用父 agent
同一 backend、同类 filesystem tools；Store/real FS/ContextHub 更直接共享持久空间。
所以这是 context-window containment，不是 security/transaction isolation。**[I][T]**

实验性的 `mode="fork"` 会继承父 effective conversation 和 prompt-producing middleware，
但丢掉父 `_summarization_event` 与 `_summarization_session_id`，由 fork 建自己的 history
文件，并拒绝递归再调用 task。**[I][T]**

- `.../middleware/subagents.py:46-120,352-410`
- `.../middleware/subagents.py:577-715,732-824`

WorkSurface 应借鉴“子任务只回最终 report”和“history id 按 invocation 隔离”，但 Surface
capability、stage/worktree、permission scope 和 merge ownership 必须由 Runtime 明确授予，
不能用“消息没继承”来代表 repo 隔离。

## 11. 他们什么时候开始做这些

以下日期来自本地完整 Git 历史，表示**首次相关 commit**；不把 repo 创建、PR、merge、
release 和后来营销术语混为同一天。

| 日期 | Commit | 首次相关机制 | 判断 |
| --- | --- | --- | --- |
| 2025-07-27 | `5c3ad025...` | repository initial commit，只有 license/gitignore | 项目起点，不是 Context-as-Repo 起点 |
| 2025-07-27 | `c9d8d2ee...` | 第一版 agent/subagent/todo code | 已有 context containment 意图，尚无 filesystem |
| 2025-07-29 | `80338eda...` | state-backed `ls/read/write/edit` virtual filesystem | **最早的 Context-as-Files 实现起点** |
| 2025-10-17 | `14be04b8...` | long-term memory + large tool-result interceptor | 大结果外置与 memory 进入正式 middleware |
| 2025-10-29 | `6b9c2760...` | large tool interceptor 改为写 configured backend | offload 与 backend abstraction 接通 |
| 2025-11-11 | `90dbd546...`, `76fe975c...` | CLI project/user dual `agent.md` memory | AGENTS-like 分层 bootstrap 起点 |
| 2026-01-07 | `9442b378...` | 当前形态 SDK `MemoryMiddleware` | 显式 sources + system injection |
| 2026-01-07/08 | `75ec1fc4...` | SDK Skills middleware | metadata-first progressive disclosure |
| 2026-01-16 | `d46e0b8d...` | summarization history offloading | summary 前把原消息写入可回读文件 |
| 2026-05-11/12 | `69628263...` | `ContextHubBackend` | **真正版本化 Context repo backend 起点** |

因此对“他们什么时候开始”的精确回答有三层：

- 2025-07-29：开始把 agent working context 表示为文件并让模型按需读写；
- 2025-10-17：开始系统性把大结果/长期记忆移出主窗口；
- 2026-05-11/12：才开始提供带 commit/parent-conflict 的 Context Hub repo backend。

## 12. 与当前 WorkSurface 的差异

| 维度 | Deep Agents @ pinned SHA | 当前 WorkSurface | 设计含义 |
| --- | --- | --- | --- |
| 核心 authority | backend-dependent mutable files；ContextHub route 才有 commit | content-addressed immutable Surface Revision + event/ledger | WorkSurface 的事实/恢复内核更强 |
| Runtime 固定 repo contract | core SDK 只固定 BackendProtocol；memory/skills sources 由宿主给 | `SurfaceId + surface.md + 普通文件 + Revision` | WorkSurface 仍缺 role/load manifest；Deep Agents 不提供答案 |
| 自动 bootstrap | CLI 自动发现 user/project AGENTS，全量注入；Skills 只注入 metadata | 小 guidance + binding/Turn Brief；immutable Revision files 参与计划 | 借 Skills 的 metadata index，不借无上限 memory |
| 渐进披露 | `ls/read/glob/grep` + Skills exact paths，成熟 | 当前模型主要靠目录 locator/shell；未来工具仍是假设 | Deep Agents 的 read ABI 可直接作为参考 |
| 大 tool result | 实际 offload + preview/path | WorkSurface 只观察 DSH large-result/compaction 信号，无执行器 | 这是应吸收的成熟机制 |
| transcript compaction | summary view + raw state + history file recovery path | WorkSurface 不负责 DSH compaction | 两者都应与 Surface authority 分层 |
| mutation | direct overwrite/exact edit/delete；ContextHub transparent retry | snapshot/publish Revision，v4 有 CAS、v5 路径仍有已审计缺口 | WorkSurface 不应降级为直接改 authority |
| projection receipt | 无统一 source revision/include/omit receipt | 有 ContextPlan/RenderManifest，虽预算器仍不完整 | WorkSurface 的可审计投影方向更强 |
| archive/restore | 无；delete 永久 | 无；pin/unpin/GC 也不是 archive | 两边都需要独立 lifecycle contract |
| subagent | message window 隔离；backend/state 多数共享 | WorkSurface 不拥有通用 subagent runtime | 未来必须分开定义 context、storage、permission 三种隔离 |
| recovery | checkpointer + backend-specific persistence + path recall | Revision/Event/Input/Operation settlement + Session recovery | WorkSurface 的 domain recovery 更系统 |
| hosted context repo | Context Hub 有 commit/sharing/linking | 本地 immutable Revision store | 可借 authoring/distribution层，不能混成 execution authority |

## 13. 建议吸收的成熟实践

1. **把读取 ABI 做成结构化 receipt。** `read` 返回 range/total/next，search 返回
   truncated + reason；WorkSurface 的 `context.read/search/tree` 应至少做到同等诚实。
2. **采用 CompositeBackend 的“一个逻辑命名空间、不同 durability route”。** 但 route
   registry 必须是 Runtime authority，模型不能用路径把敏感 context 偷渡到错误 backend。
3. **复制 Skills 的 metadata-first 形状。** entrypoint 常驻 name/description/path/load error；
   正文按需读。把 AGENTS 级 always-loaded 内容限制在小而固定的 Runtime contract。
4. **大结果先 durable offload，窗口只留 exact ref + head/tail preview。** 写失败就保留原文，
   不生成虚假的 recovery pointer；地址增加 digest、revision、media type 和 retention。
5. **保留 raw log，summary 只做 View。** Deep Agents 的 private summarization event 比直接
   改写 transcript 更可靠；WorkSurface 可继续坚持 authority/projection 分离。
6. **冷历史与媒体 content-addressing。** 每个 context window/subagent 使用独立 history id；
   media 用 digest 去重，失败明确占位。
7. **AGENTS 自动发现要做 symlink confinement。** 对项目自带 bootstrap 文件默认标为
   untrusted data；Runtime-owned region 必须由真正的 guard/validation 保护。
8. **借 ContextHub 的 conflict rematerialization，但保留显式 expectedRevision。** 普通
   exact edit 可自动重放；publish/archive 等 authority operation 必须返回 conflict，让
   调用方重新 validate，而不是透明合并。
9. **把 subagent 隔离拆成三个开关。** `messageContext`, `surfaceCapability`,
   `storageNamespace` 分别声明；默认“新窗口”不应被描述成“新工作区”。

## 14. 不应直接复制的部分

1. AGENTS memory 全量、无总预算、每 session 只加载一次；容易膨胀且产生 freshness drift。
2. `write_file` 无条件覆盖、`delete` 不可恢复、通用 edit 无 expected hash；不适合作为
   WorkSurface authority 工具。
3. “read before edit”“memory 不可信”“allowed-tools”如果只放 prompt 就不能算安全契约。
4. history append 的 read-concatenate-write 和 offload-failed-still-compact；WorkSurface 的
   fresh-window gate 应要求必要 durable facts 已 checkpoint。
5. 只用 tool-call id 命名 offload，不带 digest/revision/provenance。
6. 把 subagent 的消息隔离误当成文件/权限隔离。
7. ContextHubBackend 内部持有 commit hash，却不通过通用 result 暴露 revision；这让模型
   无法做可审计的 pin/diff/publish/rollback。

## 15. 最终判断

Deep Agents 证明了用户的核心判断：**context 不必反复直接塞给 model；可以把完整正文
放在文件化 authority/backends 中，只给模型一个 bounded index 和可调用的检索工具。**
它也进一步证明“Context-as-Repo”不应只画成一个文件夹：至少要区分

```text
versioned authored context     Context Hub / WorkSurface Revision
runtime conversational state   checkpointer / DSH Session
ephemeral artifacts            large tool results / scratch
model projection               AGENTS/Skills index + summary + selected reads
```

Deep Agents 的成熟部分主要在**文件工具、渐进披露、offload、窗口隔离和 hosted context
authoring**；WorkSurface 的价值仍在**Surface identity、不可变 Revision、事件/Operation
恢复、投影 receipt，以及未来的 staged archive/publish contract**。两者是互补关系，最合适
的吸收方式是在 WorkSurface 保留强 authority 内核，同时采用 Deep Agents 已验证的读取与
窗口管理 UX。
