# Late-candidate audit：agent-mem、Agent OS、ContextFS、ACE Playbook

审计时间：2026-09-04。本文只审计四个新增候选在固定 revision 上**实际具备的机制**，不修改
WorkSurface，也不把 README、提示词或项目自述自动升级为 runtime 事实。

证据标签沿用 `02-evaluation-method.md`：

| 标签 | 含义 |
| --- | --- |
| **I** | 固定 revision 中存在可执行实现 |
| **T** | 固定 revision 中有自动化测试覆盖，或本次实际运行通过 |
| **D** | 文档描述；尚未追到对应 runtime enforcement |
| **P** | 模型提示词、skill 或操作约定；依赖模型遵守 |
| **C** | 项目宣称、benchmark 或采用度陈述；本次未独立验证 |
| **H** | 从外部证据推导出的 WorkSurface 候选假设；不是已接受设计 |

## 固定源码与时间边界

| Source | Pinned HEAD | HEAD 时间 | License | checkout |
| --- | --- | --- | --- | --- |
| agent-mem | `0f51758dc6ed803f5322ca0b2e25689120a6d291` | 2026-02-23 | MIT | full shallow blobless |
| Agent OS | `53897b7de5aa56af32dad44580c3515eb5c6733d` | 2026-07-13 | MIT | full shallow blobless |
| ContextFS | `1aaa3603e837461752519911514be28ce9327966` | 2026-07-14 | Apache-2.0 | full shallow blobless |
| ACE Playbook | `97bdb158f72c7dfca73b581545172c981ea8dc88` | 2026-08-28 | MIT | sparse shallow blobless |

固定信息见 `docs/research/context-as-repo/sources.lock.json:146-183`。四个 checkout 都是 shallow，且本地
各只有一个可见 commit。因此上表的 HEAD 时间**不是**项目开始时间，也不能回答“社区最早何时开始做”或
“何时首次采用该机制”。这类时间结论需要完整 Git history、PR 创建/合并时间或 release 证据；本文不从
浅克隆反推。

## 结论先行

| Source | 是否是 Context-as-Repo | Repo / runtime ABI | Progressive disclosure | Mutation / concurrency | Lifecycle / recovery | 实际定位 |
| --- | --- | --- | --- | --- | --- | --- |
| agent-mem | **是，但只是 alpha 级轻量原型**；满足持久文件、入口投影、稳定路径、显式 CLI、生命周期中的至少三项 | `.context/` 目录约定真实；runtime 发现主要靠生成的 host 文件和 skill | **I/P** 文件索引与精确 read 命令；没有 token budget、revision receipt 或完备 omission receipt | **I，但弱**：任意路径覆写、可选 Git commit；无 expected-head/CAS，锁只警告 | compact/forget 真实；无一等 restore，无物理 GC | 最接近用户直觉中的“小型 Context-as-Repo”，但不宜直接当安全 runtime |
| Agent OS | **是，作为 filesystem protocol/template**；不是完整的 context runtime | 四层 ownership、workstream schema、receipt/handoff ABI 很清楚 | **D/P** 明确要求先入口、再按需开文件；没有预算化装载引擎 | receipt 发布很强；普通 workstream 更新的 re-read/revision/atomic replace 仍主要是 D/P | 全根 backup/verify/restore 真实；state 只有 close/park，无实体 archive/restore/GC | 四者中最值得借鉴 repo ABI、ownership 和验证工具的项目 |
| ContextFS | **不是语义 Context-as-Repo 产品**；是高度相关且成熟的存储/恢复底座 | 有稳定 control/CAS/state 数据结构，却没有语义 role、bounded bootstrap 或 context projection ABI | **无**；skill 只教 checkpoint/rollback/status | 不可变对象、持久 ref、daemon 锁、branch merge 很强；但 `write_ref` 不是 expected-old compare-and-swap | checkpoint/rollback/session recovery/retention GC 很强；没有语义 archive | 最成熟的 durability、recovery、GC 参考实现，层级低于 WorkSurface 语义层 |
| ACE Playbook | **否**；是相邻的语义 grow/refine 组件 | 一个可选 JSON 文件，不构成 repo ABI；Python API/Agents wrapper 是集成面 | **否**；每轮注入完整 `playbook.render()` | typed delta 有价值，但无 revision、CAS、事务、锁；remove/refine 直接删除 | 无 archive/restore/GC/recovery protocol | 可借鉴语义 delta、计数器和 refine policy，必须放在安全 mutation 层之上 |

关键区别是：

1. **Git-backed files 不自动等于可靠 Context-as-Repo runtime。** agent-mem 已经把上下文放入目录和 Git，
   但路径 containment、并发发布、恢复身份和投影 receipt 仍缺失。
2. **repo ABI 和 runtime ABI 是两件事。** Agent OS 对“哪些文件归谁、如何命名、如何校验”描述得最好；
   ContextFS 对“怎样可靠落盘、恢复、清理”实现得最好；两者各自只覆盖一层。
3. **progressive disclosure 不等于完整上下文管理。** agent-mem 和 Agent OS 都能让模型从小入口继续读，
   但都没有证明一次实际模型请求装载了哪个 revision、为何省略其他内容、搜索覆盖到哪里。
4. **content-addressed store 的 CAS 不等于 compare-and-swap。** ContextFS 的对象地址由内容决定；其 ref
   发布接口本身仍不接收 `expectedOldHead`。WorkSurface 所需的防 lost-update 语义不能只写一个 “CAS”。

## 1. agent-mem：真实但偏薄的 Context-as-Repo 原型

### 1.1 已实现和已测试

- **C/D** 项目把 `.context/` 自述为 Git-backed context filesystem，并明确把自己标为 alpha；下文再分别
  用实现路径验证其中实际成立的部分。
  `docs/research/context-as-repo/sources/specimens/agent-mem/README.md:7-17`
- **I** 初始化器创建 `main.md`、`config.yaml`、`system/`、`memory/`、`branches/`、
  `reflections/`、`archive/`，安装 agent skill，并同步 Claude/Gemini/Codex 等 host 入口。
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/init.js:13-127,155-186`
- **I/D** README 给出的目录结构确实和初始化器大体一致，因此这不是纯文案；它构成一个小型 repo ABI。
  `docs/research/context-as-repo/sources/specimens/agent-mem/README.md:178-199`
- **I/P** skill 要求先运行 `amem snapshot`，再根据摘要用 `amem read/search` 钻取，并提示何时 write、
  reflect、compact。这是一个真实安装的 prompt/skill 入口；是否在每个 host 中自动进入模型上下文仍取决于
  host 的 skill/`AGENTS.md` 装载行为。
  `docs/research/context-as-repo/sources/specimens/agent-mem/.claude/skills/agent-mem/SKILL.md:1-53`
- **I** `snapshot` 展示 Git 状态、分支、system 预览、memory 文件名/描述、分支和 reflection 摘要；
  memory 通过稳定相对路径继续读取。这是四者中最直接的“小入口 → 精确文件”实现。
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/snapshot.js:7-105`
- **I** `sync` 为不同 host 生成操作说明；对 memory 只嵌入最近三条语义条目，并给出精确
  `agent-mem read memory/<file>` 路径。
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/sync.js:15-79,84-150,201-221`
- **I** search 扫描 `.context` 中的文本文件，只显示前 20 个匹配并报告尚有多少结果；read 支持全文或
  `--last N`。这已经是可用的 disclosure surface，但 full read 没有上限。
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/search.js:5-69`
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/read.js:5-61`
- **I** compact 在操作前可创建 Git checkpoint，保留 pinned 内容，把旧 memory/reflection 移入
  `archive/compact-YYYY-MM-DD/`，重写活跃文件，再提交结果；支持 dry-run。
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/compact.js:109-127,133-185,189-217,240-248`
- **I/T** forget 对该命令自身做 path containment，默认把文件复制到 archive 后再删源文件并提交；
  测试覆盖 traversal 拒绝。
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/forget.js:7-74`
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/forget.test.js:37-66`
- **T** 本次在固定 revision 独立执行 `npm test`：16 suites、61/61 tests 通过。compact 行为也有专门测试。
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/compact.test.js:59-108`

### 1.2 README、提示词与实际实现的差距

- **D > I** README 把 pinned system 文件写成“loaded in full”，但 `snapshot` 对每个 system 文件只保留
  500 字符预览；二者不能同时作为同一个输出的精确定义。
  `docs/research/context-as-repo/sources/specimens/agent-mem/README.md:64`
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/snapshot.js:28-43`
- **I gap** `main.md` 是目录契约的一部分，却没有进入 `snapshot` 输出。bootstrap 不是 repo ABI 的完整
  反映。
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/snapshot.js:18-105`
- **I gap** frontmatter 可以解析 `limit` 和 `read_only`，config 也声明 system/memory 数量上限；在审计到的
  read/write/tree runtime 中，tree 只消费 description，write 不执行 `read_only`，所声明的上限也没有成为
  enforcement。
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/core/fs.js:45-98`
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/core/config.js:3-20`
- **D/P > I** README 的 progressive disclosure 原则是合理的，但投影没有 source revision/digest、token
  estimate、freshness 或完整 omission receipt；sync 生成的 system 内容也没有统一预算。
  `docs/research/context-as-repo/sources/specimens/agent-mem/README.md:208-215`
- **D（诚实边界）** multi-agent worktrees、semantic search、automatic reflection 被列在 roadmap，而不是伪装成
  当前实现。
  `docs/research/context-as-repo/sources/specimens/agent-mem/README.md:217-221`

### 1.3 不可照搬的 mutation 和安全边界

- **I，严重边界** 普通 `read`/`write`/`move` 直接 `join(contextDir, relPath)`，没有解析真实路径后验证仍在
  `.context` 内；`write` 接受模型提供的任意相对路径并直接覆盖。因此 forget 有 `safePath` 并不能保护
  最常用的读写路径。
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/core/fs.js:15-39`
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/write.js:4-43`
- **I，严重边界** Git wrapper 用 `execSync(\`git ${args}\`)` 走 shell；commit message 只转义双引号，未处理
  `$()`、反引号等 shell substitution。模型可影响 commit message，因此此实现不应进入可信 runtime。
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/core/git.js:8-17,44-57`
- **I gap** `initGit` 用 `git rev-parse --is-inside-work-tree` 判断。如果 `.context` 位于外层项目 Git 中，
  它会认为“已经是 Git repo”，不会创建独立 `.context/.git`。README 中“history lives inside `.context`”
  只能在隔离目录场景成立；初始化测试的临时目录恰好不在外层 Git 中。
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/core/git.js:23-39`
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/init.test.js:28-50`
- **I gap** 30 秒 lock 遇到活跃持有者只打印 warning，然后仍覆写 lock 并继续；且审计到只有显式 commit
  命令调用该锁，普通 write/compact/merge 不受保护。这不是 mutual exclusion。
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/core/lock.js:4-61`
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/commit.js:5-10`
- **I gap** 默认 `auto_commit: false`；打开后 `maybeAutoCommit` 对每次 mutation 直接提交，没有
  expected-head、staging validation 或 interval transaction。
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/core/auto-commit.js:4-21`
- **I gap** “branch” 是目录和 config 中的当前名称，不是 Git branch；merge 只识别完全以 `- [` 开头的行并
  append，随后切换 config，没有 lock、事务或冲突对象。
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/branch.js:7-56`
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/merge.js:7-104`
- **I gap** compact 使用仅到日的 archive 目录，并对同名 archive 文件直接 `writeFileSync`；同日多次 compact
  会复用路径。若每一步都成功提交，Git history 可能保住旧版本，但 archive 本身没有 collision-safe identity，
  多文件移动也不是原子事务。
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/compact.js:139-185`
- **D > I** forget 输出的 “To restore: agent-mem read ...” 只是读取 archive 文件，不会恢复活跃路径；项目
  没有一等 restore 命令，也没有物理 GC 或 archive identity/provenance contract。
  `docs/research/context-as-repo/sources/specimens/agent-mem/src/commands/forget.js:60-76`
  `docs/research/context-as-repo/sources/specimens/agent-mem/README.md:133-143,178-199`

### 1.4 借鉴结论

值得借鉴的是：人可读文件、小型生成入口、稳定路径、精确 drill-down 命令、compact dry-run。不可照搬的是：
任意路径直写、shell 字符串 Git wrapper、目录伪分支、warn-and-proceed 锁和日期碰撞 archive。61 个通过的测试
证明其自身 CLI 在作者覆盖的路径上可运行，**不证明**安全性、跨进程并发、host 自动装载或社区广泛采用。

## 2. Agent OS：强 repo ABI 与操作协议，runtime enforcement 仍不完整

### 2.1 已实现和已测试

- **I/D** 项目以普通文件夹为事实源，Git 是可选传输/历史层；这比“先说 Git、后补文件契约”更清楚。
  `docs/research/context-as-repo/sources/specimens/agent-os/README.md:1-15`
- **D/I** README 明确区分 `desk/`、`library/`、`state/`、`.agents/skills/` 的 ownership 与可移植边界，
  并给出 host adapter 入口。目录和文件在仓库中真实存在，因此 repo 形态是 I；ownership 规则本身主要由
  doctor、脚本和模型约定共同维持。
  `docs/research/context-as-repo/sources/specimens/agent-os/README.md:54-64,85-111`
- **I** 根 manifest 固定 `schema_version`、instance ID、portable root、外部 local state key、single-writer、
  transcript 默认不落入 portable root。这是四者中最清楚的 runtime-known root contract。
  `docs/research/context-as-repo/sources/specimens/agent-os/agent-os.yaml:1-19`
- **D/P** `AGENTS.md` 和 `open` skill 要求先看入口、工作流和 workstream 摘要，再按需打开正文。这是合理的
  progressive disclosure 约定，但没有 runtime token budget 或装载 receipt。
  `docs/research/context-as-repo/sources/specimens/agent-os/README.md:113-123`
  `docs/research/context-as-repo/sources/specimens/agent-os/AGENTS.md:25-40`
  `docs/research/context-as-repo/sources/specimens/agent-os/.agents/skills/open/SKILL.md:6-14`
- **D，repo ABI** state protocol 给出 source-of-truth map，并为 workstream 规定精确路径、stable id、status、
  revision、固定 sections 和 400–800、最多 1200 字的 resumable snapshot。
  `docs/research/context-as-repo/sources/specimens/agent-os/docs/state-protocol.md:17-89`
- **D/P** 普通 workstream update 协议要求重读 revision、更新、尽量 atomic rename、验证、再写 receipt。
  审计未发现一个通用 helper 把这整套更新作为 runtime transaction 强制执行；initializer 除外。
  `docs/research/context-as-repo/sources/specimens/agent-os/docs/state-protocol.md:91-110`
- **I/T** receipt helper 是真实的：校验 operation/outcome、workstream id 和 revision，使用外部 local state、
  tempfile + fsync，并通过 hardlink 或 `O_EXCL` 排他发布不可变 receipt。
  `docs/research/context-as-repo/sources/specimens/agent-os/library/scripts/agent_os_state.py:18-28,31-119,121-218,221-380`
- **T** 测试覆盖 100 个并发唯一 receipts、fallback 路径、重复 event 不覆盖和 path guard。
  `docs/research/context-as-repo/sources/specimens/agent-os/library/scripts/tests/test_agent_os_tools.py:570-626`
- **I/T** initializer 对自己管理的 setup 文件先形成 preview digest，apply 时检查 `before_sha256`，使用 atomic
  replace，并能 rollback。这是真正的 compare-before-write，但作用域只是初始化器拥有的文件，不是所有
  workstream mutation。
  `docs/research/context-as-repo/sources/specimens/agent-os/library/scripts/initialize_instance.py:199-223,252-343`
- **I/T** doctor 会检查必需目录、manifest、instance、links、skills、evals、workstreams、receipts、handoffs、
  conflicts、privacy 和 local boundary。
  `docs/research/context-as-repo/sources/specimens/agent-os/library/scripts/agent_os_doctor.py:235-1070`
  `docs/research/context-as-repo/sources/specimens/agent-os/library/scripts/tests/test_agent_os_tools.py:197-361`
- **I/T** backup 对输入路径、symlink、sensitive 文件和 case-fold collision 做筛选；生成内容 hash manifest 和
  archive；verify 精确核对；restore 先 stage 到空 destination。这是成熟且可复核的全根 recovery 工具。
  `docs/research/context-as-repo/sources/specimens/agent-os/library/scripts/agent_os_backup.py:84-124,145-230,283-413`
  `docs/research/context-as-repo/sources/specimens/agent-os/library/scripts/tests/test_agent_os_tools.py:364-457`
- **T** 本次在固定 revision 执行 `python3 -m unittest library/scripts/tests/test_agent_os_tools.py`，37/37
  tests 通过；`agent_os_doctor.py --strict`、`audit_public_hygiene.py` 和 `git diff --check` 也通过。

### 2.2 文档/提示词领先于 runtime 的部分

- **D/P > I** state protocol 的 re-read revision、atomic replace、verify、receipt 顺序是优秀规范；但通用模型
  写 workstream 仍主要靠说明执行。真实 receipt helper 是 mutation **之后**的不可变记录，不会与 workstream
  文件更新原子提交，也不是对当前 head 做 expected-revision CAS。
  `docs/research/context-as-repo/sources/specimens/agent-os/docs/state-protocol.md:91-110`
  `docs/research/context-as-repo/sources/specimens/agent-os/library/scripts/agent_os_state.py:221-350`
- **D/P > I** 17 个 skill 的 manifest 声明 invocation、effects、confirmation 和 permissions，是很好的可检验
  catalog；但 metadata 和 prompt 不能代替 runtime authorization。
  `docs/research/context-as-repo/sources/specimens/agent-os/library/skills/manifest.json:1-191`
- **D/P > I** progressive disclosure 没有一个 runtime context planner 来执行 budget、记录 source revision、
  生成 omission/coverage receipt，或保证模型只收到声明的入口。
- **D/I** 文档把 skill evaluation 分成 static、routing、fresh-agent 三层，是成熟的证据纪律；其中历史
  fresh-agent 成绩和通过率仍是项目结果 **C**，本次 37 个 unit tests 只验证 corpus/contract，不重演模型 routing。
  `docs/research/context-as-repo/sources/specimens/agent-os/docs/skill-evaluation.md:1-24,44-55`

### 2.3 Lifecycle、archive 与工具面

- **D** state lifecycle 是 close/park，并明确不在 state 中创建 `z_archive`；`desk/z_archive` 只是 binder
  组织约定，不是 context entity 的可逆 lifecycle 状态。
  `docs/research/context-as-repo/sources/specimens/agent-os/docs/state-protocol.md:222-236`
  `docs/research/context-as-repo/sources/specimens/agent-os/docs/agent-guide.md:51-64,132-148`
- **I/T** recovery 是整个 portable workspace 的 backup/verify/restore，不是单个 context item 的
  archive → restore。唯一 prune 是外部 raw-session 维护，且不属于 portable v1 语义对象 GC。
  `docs/research/context-as-repo/sources/specimens/agent-os/library/guides/backup-and-restore.md:1-18,40-127`
  `docs/research/context-as-repo/sources/specimens/agent-os/library/scripts/export-session.py:167-201,221-246`
- **I/D** 模型 tool surface 实质上是 filesystem + skills；确定性 helper 主要覆盖 initializer、receipt、doctor、
  backup/restore。没有统一的 bounded `list/search/read/archive/restore` context API。

### 2.4 借鉴结论

最值得借鉴的是：显式 root manifest、schema version、ownership map、stable workstream id、bounded resumable
snapshot、不可变 receipt、portable/private state 分界、validator 和 collision-safe backup。需要保留的判断是：
**协议写得对不等于 runtime 已强制执行**。37 个通过的测试证明这些脚本的协议和 CLI 行为，不证明模型每次
都遵守更新顺序，也不证明项目被广泛采用。

## 3. ContextFS：成熟的 durability/recovery substrate，不是语义 Context-as-Repo

### 3.1 已实现和已测试

- **I** README 所述的 content-addressed snapshots、branch、rollback、agent-state journal 和 GC 都能在
  C++ 实现中找到对应路径；不是只有架构图。
  `docs/research/context-as-repo/sources/adjacent/contextfs/README.md:5-18,46-81`
- **D（诚实边界）** 项目明确说明它不是 CRIU、不能任意冻结已有 PID、模板内存不具 crash durability，
  外部资源需要调用者处理。这是成熟项目应有的能力边界。
  `docs/research/context-as-repo/sources/adjacent/contextfs/README.md:158-179`
- **I** object store 用对象类型和 body 计算地址，写 temp file 后去重/rename，并追踪 pending object；对象一旦
  发布不可变。
  `docs/research/context-as-repo/sources/adjacent/contextfs/src/cas/object_store.h:39-127`
  `docs/research/context-as-repo/sources/adjacent/contextfs/src/cas/object_store.cpp:147-253`
- **I** checkpoint 先 flush，序列化 tree/commit，fsync objects 和 shards，最后才推进 ref；rollback 验证
  对象和 tree，并能区分 retention-compacted data。
  `docs/research/context-as-repo/sources/adjacent/contextfs/src/cas/checkpoint.cpp:57-115,156-199`
- **I** ref read 要求精确的 64 hex + newline；write 使用 temp + fsync + rename + directory fsync。
  `docs/research/context-as-repo/sources/adjacent/contextfs/src/cas/refs.cpp:57-159`
- **I** agent-state 是 typed, content-derived record，包含 parent/base/branch/fs/union/runtime/agent/schema/payload/
  dependencies；sync 先持久化 dependency 和 state，再更新 latest。
  `docs/research/context-as-repo/sources/adjacent/contextfs/src/cas/agent_state.h:12-96`
  `docs/research/context-as-repo/sources/adjacent/contextfs/src/cas/agent_state.cpp:217-395`
- **I** state service 校验各组件和锚点，区分“对象已持久但 ref 更新失败”的 partial-success；latest 会重新验证，
  session recovery 有 `max_depth` 上界。
  `docs/research/context-as-repo/sources/adjacent/contextfs/src/cas/agent_state_service.cpp:294-546`
- **I** control protocol 暴露 state append/describe/latest/restore；restore 使用 256 的遍历上界，并明确 full、
  runtime-only 和 degraded runtime 结果。
  `docs/research/context-as-repo/sources/adjacent/contextfs/src/cas/control_protocol.cpp:823-1043`
- **I/T** daemon 在 checkpoint、branch create/merge/delete 周围持锁；merge 在两侧做 checkpoint，找共同祖先，
  执行 deterministic path-level three-way merge，产生 two-parent commit，并显式返回 conflicts。
  `docs/research/context-as-repo/sources/adjacent/contextfs/src/cas/daemon.cpp:370-649`
  `docs/research/context-as-repo/sources/adjacent/contextfs/src/cas/branch_merge.cpp:161-366`
  `docs/research/context-as-repo/sources/adjacent/contextfs/tests/unit/test_branch_context.cpp:14-190`
- **I/T** GC 从 refs、live branches、agent-state dependencies/fs commits 等完整 roots 做 reachability；root
  discovery 异常时 fail closed；sweep 有 age fence、dry-run、verify。retention 会保留旧 commit metadata，
  但可清理其 snapshot data，使 rollback 明确报告 compacted。
  `docs/research/context-as-repo/sources/adjacent/contextfs/src/cas/gc.h:21-65`
  `docs/research/context-as-repo/sources/adjacent/contextfs/src/cas/gc.cpp:90-475`
  `docs/research/context-as-repo/sources/adjacent/contextfs/tests/unit/test_gc.cpp:130-333,385-430,460-607,635-656`
- **T** 本次在临时 `/tmp` tool/build 目录安装 CMake，关闭 eBPF、FUSE-T 和 BLAKE3 SIMD，成功编译并运行
  `object_store`、`branch_context`、`branch_merge`、`agent_state`、`agent_state_service`、`gc` 六个 unit
  targets，6/6 通过。没有声称完整平台、FUSE 或 system suite 已运行。

### 3.2 为什么它仍不是 Context-as-Repo 产品

- **I/P** 安装的 workspace skill 只告诉模型 checkpoint、rollback、status 及错误恢复；没有 semantic role、
  context index、按需 search/read 或 bounded model projection。
  `docs/research/context-as-repo/sources/adjacent/contextfs/docs/skills/agentvfs-workspace.md:1-79`
- **I side effect** quickstart 会安装全局 Claude skill，并编辑全局 Codex `AGENTS.md`；这只是 checkpoint 指令
  接入，不是项目级 context bootstrap contract。
  `docs/research/context-as-repo/sources/adjacent/contextfs/start.sh:87-110,151-180`
- **I gap** CLI 提供 checkpoint、rollback、branch、runtime state、agent state、policy 等存储操作，没有
  semantic context 的 list/search/read/archive 工具。
  `docs/research/context-as-repo/sources/adjacent/contextfs/src/ctl/main.cpp:26-61`
- **I distinction** `write_ref` 具备耐久发布，却不接收 expected-old ref。因此这里的 CAS 是
  content-addressed storage，不是跨 daemon/跨 publisher 的 compare-and-swap；同 daemon 锁只能覆盖同一
  进程协调域。
  `docs/research/context-as-repo/sources/adjacent/contextfs/src/cas/refs.cpp:107-159`
- **I gap** 没有语义 archive。branch delete 删除 ref，之后 GC 才可能清除不可达数据；retention-compacted
  snapshot 也不是可恢复 archive。restore 针对 filesystem/agent/runtime state，不针对带身份、出处、状态的
  context entity。

### 3.3 借鉴结论

应借鉴的是底层 invariants：不可变对象 + 可变 ref、对象 fsync 后再推进 ref、partial-success receipt、
fail-closed GC、完整 root set、age fence、把语义 state 钉到精确 filesystem commit、bounded recovery 和
degraded mode。不要把 ContextFS 的重量级 VFS/runtime、ad-hoc control JSON 或 “CAS” 一词直接当成
WorkSurface 语义工具契约。

## 4. ACE Playbook：有价值的 grow/refine 语义层，不是 Context-as-Repo

### 4.1 已实现和已测试

- **I** playbook 由带 section-derived id、helpful/harmful counters、tags 和 metadata 的 bullets 组成；顺序
  稳定，可转 JSON。
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/ace/playbook.py:35-88,91-156`
- **I** delta 有 typed `ADD/UPDATE/REMOVE`，curator 按顺序确定性应用计数、增加、更新和删除。
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/ace/delta.py:23-85,103-143`
- **I** generator、reflector、curator 形成 grow-and-refine loop；engine 留下 StepRecord，online 模式逐步
  更新 playbook，parallel 仅用于 evaluation，避免并行 mutation。
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/ace/roles.py:101-262`
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/ace/engine.py:134-328`
- **I** trajectory 在 Agents integration 中截断到 8,000 字符；budget 超限会触发 refine。
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/ace/integrations/openai_agents.py:74-80,595-618`
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/ace/engine.py:421-436`
- **I** refine 支持 embedding 相似度，embedder 失败会退回 lexical；dedupe 合并 counters 并删除重复项，
  harmful pruning 会直接删除。
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/ace/refine.py:66-132`
- **T** tests 覆盖 delta、JSON roundtrip、refine、Agents wrapper、全量注入、显式 persistence、hooks 和 tool
  error；Agents 测试使用真实 SDK 类型，但 monkeypatch Runner 且禁用 network。
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/tests/test_delta.py:5-76`
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/tests/test_config_and_playbook_io.py:29-55`
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/tests/test_refine.py:13-72`
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/tests/test_openai_agents_integration.py:1-17,61-105,257-276,303-340`
- **T** 本次用隔离 `/tmp` uv 环境验证：`.[dev]` 收集并通过 124 tests；`.[all]` 收集并通过 163 tests，
  网络路径由测试 mock/disable。两次均未向候选仓库写入持久依赖或 lockfile。

### 4.2 README 和 module docstring 领先于实现的部分

- **D > I** module docstring 写“fine-grained retrieval”，实际 generator、reflector、curator 以及 Agents
  wrapper 都调用 `playbook.render()` 注入全部 bullets；没有按 id/tag/relevance 的 retrieval surface，也不是
  progressive disclosure。
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/ace/playbook.py:1-14,158-181`
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/ace/roles.py:101-262`
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/ace/integrations/openai_agents.py:87-119`
- **I gap** persistence 是可选 JSON 的直接 `open(path, "w")` / load，没有 atomic replace、schema version、
  digest、revision、lock 或 provenance。
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/ace/playbook.py:199-222`
- **D > I** wrapper 可以加载文件并提供显式 `save()`；`run_and_learn()` 只更新内存，不自动 save。因此 README
  “persists what it learns” 若理解成每轮自动耐久化就超前；README 示例自己也显式调用 `agent.save()`。
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/ace/integrations/openai_agents.py:313-409`
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/README.md:121-142`
- **I gap** `_alearn` 可通过 `asyncio.to_thread` 执行，但 playbook mutation/save 没有锁；并发 learn/save 可能
  lost update 或产生损坏 JSON。
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/ace/integrations/openai_agents.py:543-571`
- **I gap** delta 没有 expected revision/precondition、批次原子验证、rollback；REMOVE、dedupe 和 pruning 是
  物理删除，没有 archive/restore/GC/recovery protocol。
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/ace/delta.py:103-143`
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/ace/refine.py:66-132`
- **D/T discrepancy** README 说安装 `.[dev]` 后有 163 tests；`pyproject.toml` 的 dev extra 不含 Agents SDK。
  本次可复现结果是 dev 124、all 163。
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/README.md:304-319`
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/pyproject.toml:31-44`
- **C（诚实边界）** README 把论文 benchmark 与本仓库未复现的结果分开，没有把论文数字伪装成本地测试。
  `docs/research/context-as-repo/sources/adjacent/ace-playbook/README.md:246-276`

### 4.3 借鉴结论

可借鉴的是 typed item delta、stable-ish ids、helpful/harmful counters、确定性 merge、bounded trajectory、
StepRecord 和可测试 SDK wrapper。它们是**语义策展 policy**，必须建立在带 revision、原子 staging、validation、
promotion、provenance 和 restore 的 mutation engine 上。CLI 只有 demo/run/playbook/version，不构成模型可用的
context 管理工具面。
`docs/research/context-as-repo/sources/adjacent/ace-playbook/ace/cli.py:1-10,42-163`

## 横向拆解：WorkSurface 真正需要固定的契约

以下是外部实现支持的候选假设，均标为 **H**，不在本文中转成 WorkSurface 改动。

### H1. runtime 必须固定知道的是最小 bootstrap ABI，不是整个 repo 结构

建议把契约拆成四层；其中 Repo discovery 是 repo ABI，后三项共同构成 runtime ABI：

| 层 | runtime 必须知道 | runtime 不应硬编码 |
| --- | --- | --- |
| Repo discovery ABI | 根 manifest 的固定名字/发现规则、`schemaVersion`、当前 revision/ref、入口 projection 的地址、provider/tool schema 版本 | 所有业务文件夹、每一种 context type、用户自定义分类 |
| Context projection ABI | projection 的 source revision/digest、预算、已包含条目、被省略条目/原因、可继续调用的稳定地址和读工具 | README 文案、某个 host 的完整 prompt、固定“最近 N 条”策略 |
| Mutation ABI | stable id/path、expected revision/hash、dry-run/validate/promote、typed error、actor/capability、receipt | 允许模型任意直接覆写文件，或仅靠 skill 中的“请先重读” |
| Lifecycle ABI | active/archive/superseded/deleted 的机器状态、archive identity、restore target、GC roots/age fence | 用目录名暗示状态，或把 remove/branch-delete 当 archive |

agent-mem 证明“小入口 + 精确路径”足够实用；Agent OS 证明 root manifest、ownership 和 bounded resumable
snapshot 值得稳定；ContextFS 证明恢复和 GC 需要对完整依赖图负责；ACE 证明语义 policy 可以独立演进。四者
共同反对把所有内部目录直接固化成 runtime ABI。

### H2. 模型工具面应小于 operator/maintenance 工具面

模型最小面可以围绕：

```text
context.snapshot(revision?, budget?)
context.list(scope, cursor, limit)
context.search(query, scope, cursor, limit)
context.read(address, revision?, range/limit)
context.propose(delta, expectedRevision, dryRun=true)
context.publish(proposalId, expectedRevision)
context.archive(id, expectedRevision)
context.restore(archiveId, expectedRevision, target?)
```

每个 read/search/snapshot 返回 freshness、coverage、truncation/omission receipt；每个 authority-changing
mutation 都返回 previous/new revision 和 provenance。整库 backup、verify、GC、policy mutation、root repair 应留在
operator surface。agent-mem 的单一 CLI 太自由；Agent OS 的 filesystem+skills 太依赖模型遵守；ContextFS 的 CLI
太接近存储引擎；ACE 的 Python API 太接近应用内部对象。

### H3. archive、restore 与 GC 必须是三个不同动作

```text
active --archive--> archived --restore--> active/superseding revision
                         \
                          --GC eligibility policy--> physically unreachable/deleted
```

- archive：从默认 projection 中移除，但保留 stable identity、source revision 和 provenance；
- restore：创建可验证的新 revision，记录从哪个 archive identity 恢复以及冲突策略；
- GC：只处理已证明不可达/过期的物理对象，必须有完整 root discovery、age fence、dry-run 和 fail-closed。

agent-mem 的 forget/compact 只是可读 archive 文件移动，Agent OS 的 backup 是全根灾备，ContextFS 的 GC 是底层
reachability 清理，ACE 的 REMOVE 是物理删除；四者没有任何一个单独给出完整的语义 lifecycle。

### H4. 可组合的借鉴顺序

1. 用 **Agent OS** 的 root manifest、ownership、schema、stable id、receipt 与 verified backup 定义 repo ABI；
2. 用 **agent-mem** 的小入口、可读文件和精确 drill-down 形成第一版 progressive disclosure；
3. 用 **ContextFS** 的 immutable objects/ref publication、partial success、dependency roots、recovery/GC invariants
   强化底层 durability；
4. 在 mutation transaction 之上引入 **ACE Playbook** 的 typed semantic deltas、feedback counters 和 refine policy。

这个顺序很重要：不能先让 curator 自由改写 authority，再补 revision 和恢复；也不能为了拿到 durability 把整个
VFS runtime 变成 WorkSurface 的模型工具面。

## 本次可复现实验与证据限度

| Source | Command / scope | Result | 能证明 | 不能证明 |
| --- | --- | --- | --- | --- |
| agent-mem | `npm test` | 16 suites，61/61 pass | 作者覆盖的 CLI、compact、forget 等行为在 pinned revision 可运行 | 任意路径安全、shell 安全、lost-update 防护、host 自动装载、采用度 |
| Agent OS | `python3 -m unittest library/scripts/tests/test_agent_os_tools.py`；doctor/hygiene/diff | 37/37 pass；三项检查通过 | initializer/receipt/doctor/backup 等脚本契约 | 普通模型写入被 runtime 原子强制、模型 routing 成绩、采用度 |
| ContextFS | 临时 CMake build；6 个 CAS/state/GC unit targets | 6/6 pass | 被选的存储、branch、state、GC 单元路径 | 全平台/FUSE/eBPF/system suite、语义 Context-as-Repo |
| ACE Playbook | 隔离 uv：`.[dev]` 与 `.[all]` | 124/124；163/163 pass | 核心 delta/refine/IO 与 mocked Agents integration | 网络端到端、并发 persistence、progressive retrieval、采用度 |

测试结束后四个候选 checkout 均为 clean；本文没有修改候选或 WorkSurface。测试通过只提升对应路径到 **T**，
不会把未覆盖的 README、prompt、benchmark 或“社区已经使用”宣称升级为实现/采用证据。

## 最终判断

用户的“context as repo”方向没有被这些项目否定，反而被拆得更清楚：模板/目录契约确实有价值，但它只应负责
**可发现、可读、可演进的事实结构**；runtime 还必须另有一个小而强的 ABI 来完成预算化装载、coverage receipt、
expected-revision mutation、archive/restore 和 recovery。四个候选中没有一个可以原样成为 WorkSurface：

- agent-mem 提供最直观的产品形态，但工程安全性最需要重做；
- Agent OS 的协议和运维工具最值得直接转译成契约；
- ContextFS 的存储不变量最成熟，但不应上浮成语义层产品结构；
- ACE Playbook 的学习/策展策略最有启发，但必须最后接入。

因此，保留 WorkSurface 模板是有价值的；更准确的下一步不是继续扩充固定目录，而是先明确上述四类 runtime
contract，并用测试证明**装载什么、基于哪个 revision、谁能改、如何冲突、如何恢复、何时才能 GC**。
