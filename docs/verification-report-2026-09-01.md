# WorkSurface 重构与验证报告（2026-09-01）

## 结论

当前默认实现已经与 code-first 设计收敛，核心路径可交付。设计本身合理，但成立的前提不是“把普通代码画成静态工作流图”，而是严格分离三类事实：

1. 不可变 Revision/Contract/Registration 描述已固定的内容和能力；
2. append-only Event/Input/Operation 记录实际发生的过程与因果；
3. DSH Session/Turn/Step 仍是唯一执行历史，WorkSurface 不复制第二套执行生命周期。

本次审计发现并修复的偏差都位于这些边界上。真实 `web` profile 已完成崩溃窗口恢复、Python Orchestrate 执行、Revision 应用、下游 Event、React Flow 关系证据图、Workspace attach、原生空白 Session 导航、坏 authoring 单项隔离和旧 Host 的 Session 重启兼容验证。随后又使用用户目录 `.env` 与真实 GPT-5.6 Sol 完成两类 L3 Agent 场景：普通 Session 自主发现 author/coordinate 流程并创建三段 code-first 作者产物；Surface Session 自主读取 Turn Brief、通过稳定 CLI 入口 emit，并触发真实 Orchestrate → Revision apply → completed Event 闭环。原先 DeepSeek route 的 HTTP 402 只保留为历史失败证据，不再是当前验证结论。

## 第一性原则判断

| 问题 | 判断 | 设计结果 |
| --- | --- | --- |
| Surface 当前内容由什么决定 | 由最近一次 admitted/applied/published Revision 事实决定 | 删除独立可变 head 文件；从目标 Event stream replay |
| 任意 Orchestrate 代码能否形成准确静态图 | 不能；代码中的条件、循环和 fan-out 不是 Registration route 可完整表达的 | UI 分开“声明的能力通路”和“已记录 Event 事实”，不伪造业务边 |
| Registration 重扫能否重算历史边界 | 不能；边界是首次 admission 事实的一部分 | 重扫只核对 authoring-derived immutable facts，并返回原记录 |
| Event 已 fsync、Input Ledger 未写时如何恢复 | watcher 不能作为真源 | restart 先扫描 durable target Event stream 补收，再续推 ledger |
| managed followup 何时算交付 | `user/message` 已持久接纳即交付，不应等待模型完成整个 Turn | receipt 后 flush 并返回；Agent Turn 继续由 DSH 管理 |
| transport 是否靠保密授权 | 不能；同一 OS principal 的 shell 可能观察运行目录 | transport 不进入语义契约，授权依赖 Session/Turn/Surface capability 与失效 |
| 空白 Surface Session 如何进入原生 UI | 公共作者根必须是正式 Workspace，Session 必须先 attach | `workspaceRegistry` 成为必需依赖，admission 返回前完成 create/reuse + attach |

## 已修复的实现偏差

1. 新增完整 v5 code-first Runtime：authority、Contract、Registration、Input Ledger、staged run、record/apply/settle 与 recovery。
2. Surface head 改为 `surface.revision.admitted/applied/published` Event replay，消除第二份可变真源。
3. 重启恢复补上“Event 已落盘、Input Ledger 未落盘”的崩溃窗口。
4. 重复 authoring scan 不再因 DSH/Surface 历史增长而与既有 immutable Registration 冲突。
5. 首次 admission 后立即准备下一 Turn 输出契约；Turn 内新增 Registration 不追溯授权当前 Turn。
6. managed followup 只等待 durable Turn receipt，不等待完整 Agent Turn。
7. DSH `tool/result` adapter 只持久 EventRef；按需从原 Session Log 解析安全 projection，不复制工具参数或结果正文。
8. Web 重构为 v5 关系证据图：虚线只表示 declared capability，实线只表示持久 Runtime Event producer/causes；精确事实进入统一抽屉。
9. 公共作者根注册为 `WorkSurfaces` Workspace；新建/恢复 Session 返回 Web 前 attach。
10. 兼容本机仍链接的 DSH Session `0.1.2-alpha.1`：对具体 Session constructor 探测 `ignorable` envelope 能力。旧 Host 不写 binding 或 context extension facts，以外部 immutable `binding.json`、Turn Brief 与 shell context 为兼容面；支持新 envelope 的 Host 才启用全部 ignorable facts。
11. Host domain error 通过同源、已认证 Web API 返回可操作信息，不再一律压成 `projection unavailable`。
12. Definition v1 拓扑隔离在独立 `v4 兼容` 模式，不再与默认 code-first 图面混排。
13. 启动和 Turn Brief 准备按作者目录逐项隔离坏 Orchestrate；已记录的同一旧故障不阻塞其他 Surface 发射，根集合故障或当前 Turn 新出现/变化的坏 authoring 仍保持原子拒绝。
14. 默认图面改用 React Flow + Dagre：支持拖动节点、平移、缩放、适配视图、小地图、本机布局持久化和用户触发的自动排版；connect/reconnect 保持禁用，不制造第二套执行图真相。
15. React Flow 的受控 node state 不再在相同事实快照上反复重建；图事实变化时以稳定事实键重挂载并恢复本机位置/viewport，修复长轮询或手动刷新后空画布。
16. Agent shell 获得稳定的 `DSH_WORKSURFACE_CLI` 绝对入口；提示与 Turn Brief 不再假定 profile `.bin` 已进入 `PATH`。

## 按变化来源拆分的文件边界

| 变化来源 / 权威事实 | 文件 | 不应承担的责任 |
| --- | --- | --- |
| 协议类型与严格校验 | `packages/core/src/runtime-protocol.ts` | 文件 IO、DSH 生命周期 |
| 锁、durable create、fsync、ID/digest 基础校验 | `packages/core/src/runtime-store-io.ts` | 领域状态机 |
| authority 与 Contract snapshot | `packages/core/src/runtime-authority-contract-store.ts` | Event/Operation ledger |
| Surface Runtime Event stream | `packages/core/src/runtime-event-store.ts` | Registration 或 runner |
| Registration/Input/Operation durable facts | `packages/core/src/orchestrate-ledger-store.ts` | Surface authoring apply |
| 兼容 export facade | `packages/core/src/runtime-store.ts` | 新实现逻辑 |
| code-first admission/reconcile/recovery | `packages/runtime/src/code-first-orchestrator.ts` | DSH Session UI 与文件交换细节 |
| artifact/run view/subprocess/result | `packages/dsh/src/orchestrate-code-runner.ts` | durable effect apply |
| Event-backed head/CAS apply/DSH EventRef bridge | `packages/dsh/src/code-first-surface-port.ts` | Registration 业务条件 |
| Session create/resume/Workspace attach | `packages/dsh/src/session-admission.ts` | Turn capability 和 Surface 内容 |
| 1:1 binding/Turn Brief/capability/publication | `packages/dsh/src/session-surface.ts` | Agent retry/completion 生命周期 |
| Host composition/RPC/topology aggregation/authoring scan isolation | `packages/dsh/src/service.ts` | store 内部规则 |
| Web relation layout/evidence projection | `packages/web/src/client.js`、`packages/web/styles.css`、`packages/web/tsdown.config.mjs`、`packages/web/index.js` | 写入领域事实或推断代码内部业务边 |

## 可执行验证证据

### 自动门禁

```text
pnpm check
  schema / executable examples: passed
  TypeScript build: passed
  DSH eval: 9 files / 47 tests passed
  Web eval: 1 file / 8 tests passed
  full Vitest: 25 files / 124 tests passed
git diff --check: passed
```

重点测试：

- `runtime-protocol.spec.ts`：authority、Contract digest、Binding、Event、batch/settlement 的正负契约；
- `code-first-orchestrator.spec.ts`：admission、重复扫描、run、record/apply/settle、未接纳 durable Event 的 restart recovery；
- `code-first-surface-port.spec.ts`：Event-backed head、CAS apply、published bridge、DSH tool 安全 projection；
- `session-admission-agent-loop.spec.ts`：真实 DSH Agent Loop、首 Turn 边界、followup receipt 不等待模型结束、restart recovery、坏 authoring 单项隔离；
- `web.spec.ts`：同源 admission、domain error、v4/v5 projection passthrough、声明/事实分层、统一证据抽屉与兼容模式隔离。

### 真实 profile：崩溃窗口与完整执行

验证对象为 `ws-e2e-live`：

1. 先在独立进程直接 append `verification.live-requested` 到 durable target Event stream；
2. 确认对应 Input Ledger 尚不存在；
3. 重启真实 `web` profile；
4. Runtime 启动扫描补收 Event，执行真实 Python `orchestrate.py`；
5. Surface authoring 被应用到新 Revision；
6. Operation recorded 与 settled 文件均存在；
7. 目标 stream 最终严格为：

```text
#0 surface.revision.admitted       causes=0
#1 verification.live-requested     causes=0
#2 surface.revision.applied        causes=1 (#1)
#3 verification.live-completed     causes=1 (#1)
```

Web 真实页面显示 `ws-e2e-live` Orchestrate 与关联 Surface：Registration routes 是虚线，`verification.live-completed` 的 producer/causes 是实线。点击实线标签后的抽屉展示精确 Event id、Surface、producer run、时间、operation key、Contract digest、Registration 与 cause；没有从 Python 代码猜测额外业务边。

### Web 关系视图端到端验收

- 浏览器 harness 以真实 bundle、React Flow CSS 与插件 CSS 验证桌面和 560px 窄屏、Surface/Orchestrate/声明通路/实际 Event 四类抽屉、Surface 锚点切换、唯一 Session 导航以及 `v4 兼容` 隔离；默认 code-first 图支持平移、缩放、节点微调、适配视图、小地图开关和显式 Dagre 自动排版，布局只保留在浏览器；
- 真实 DSH `web` profile 在原生 `conversation.view` 中展示 `ws-e2e-live` 的虚线声明通路与实线 `verification.live-completed`，并从 Host 投影打开上述实际 Event 证据；
- 真实浏览器等待一个完整 25 秒 projection watch、执行手动刷新并重复切换 Surface 后，节点与证据边保持存在；此前可复现的空画布已由事实键重挂载修复；
- 空投影停留在默认关系模式并给出空态，不把“无 v5 数据”误报为 v4 模式。

### 启动坏 authoring 隔离

本机保留数据中存在一个缺少 `orchestrate.py` 的 artifact，以及一个与已 admission 不可变事实冲突的可变作者目录。修复前任一项都会使整个 WorkSurface 插件初始化失败；修复后扫描按目录记录一次可操作告警并继续装配其他 Registration。定向集成测试同时放置排序靠前的坏 code-first artifact 与排序靠后的有效 v4 Registration，证明服务启动、有效项可检查且其他 Surface 可继续发射；新出现或错误形态变化的坏作者配置仍会使当前发射在 Event append 前失败。

### 真实 profile：空白 Session admission 与导航

验证对象为 `ws-e2e-nav`：

- admission 创建唯一 Session，`binding.json` 在首 Turn 前固定；
- Workspace registry 中 `WorkSurfaces` 包含该 Session；
- 原生侧栏显示 `WorkSurfaces / 新会话`；
- 点击“进入推进”后，Host 返回唯一 Session 与正式 Workspace ID，Client 通过原生 `sessions.create({ sessionId, workspaceId })` 采用该精确身份，再 refresh/open 并验证 current；真实侧栏切到 `WorkSurfaces / 新会话`，没有提交用户消息，也没有打开第二个 Session；
- 本机旧 Session Host 的持久日志不包含不可恢复的 `worksurface/binding` 外部 Event。

### 真实 profile：模型就绪性与完整 Event 闭环

所有真实 Agent Turn 都由携带用户目录 `.env` 的正式 `web` profile 发起，没有把密钥写入工具参数、聊天、普通 Settings、浏览器 payload 或 Git。

普通 Session `验收 WorkSurface 模型就绪性` 使用 GPT-5.6 Sol / High：

1. Agent 先运行 `"$DSH_WORKSURFACE_CLI" help author` 与 `help coordinate`，没有被告知 CLI 源码路径，也没有发明 create 工具；
2. 它判断跨多轮、可独立验收、需恢复与重复协调的任务适合 WorkSurface，并以一次性 `dict.get()` 解释作为应留在普通 Session 的反例；
3. 在公共作者根创建 `ws-readiness-20260901-a-evidence`、`-b-assessment`、`-c-verdict` 三个 Surface；每个 `surface.md` 都按正式顺序包含七个一级标题，并各自包含一个支持文件；
4. 创建 `ws-readiness-20260901-serial-readiness`：普通 Python entrypoint 拥有 A→B→C 条件、payload 转换、staged 文件写入与推进，`registration.json` 只拥有三个既有 Surface 的精确绑定和 `consumeFrom` / `surfaceOutputFrom` 能力；没有创建 `definition.json` 或通用图 DSL；
5. 三个 Event declaration、Registration schema 与 Python 编译通过；A 经正式 Web admission 固定唯一 Session、artifact Revision、Registration 与三条历史边界；三个新 Surface 的 Runtime Event 数均为 0，证明没有手工伪造 Event 或 run fixture。

Surface Session `ws-e2e-nav` 随后完成两次真实 Turn。第一次在旧提示仍写 `ws help emit` 时暴露 shell `PATH` 不含 profile `.bin`，人工提供源码 CLI 路径后闭环成功；实现随即改为注入稳定的 `DSH_WORKSURFACE_CLI`。第二次模型只依赖新契约，完成：

```text
verification.browser-requested
  root Event: evt_966f676b435a4965edd5ba9327b6b121781556ea (#4)
  payload: {"evidence":"real-dsh-cli-variable"}
  ↓
Orchestrate run: run_72072a0e3184492793d7813605d4e5e4
  ↓
surface.revision.applied
  revision: sha256:268bf54466888edd343fd1d1f6e3ebe1da7cf7cb07ca43952c9b655453381ff8
  ↓
verification.browser-completed
  Event: evt_a5fbd732d75e5871c41dd203211b780235250244
  payload: {"evidence":"orchestrate-code-ran"}
```

关系 UI 重放为 `7 Event`、`2 输入 · 2 运行`，两条 completed 实际因果边均可见。目标 Surface Session 的持久事件类型只有 DSH 原生 `session`、policy、sandbox、inbox、Turn/Step/Tool/Message 类事件；全新空白目标 Session 只有 `session`、`session/end-seed`、policy、sandbox 与 inbox 事件，均不含自定义必需 `worksurface/*` 事件。旧 Host 因而能在重启后恢复，同一绑定继续通过外部 immutable `binding.json`、Turn Brief 与 shell capability 工作。

## 当前仍明确未实现

- v4 数据到 v5 的显式迁移工具；
- `dsh.tool.completed` 之外的通用 DSH Event 安全 projection。

它们没有被 UI、模型说明或 Schema 通过伪装成可用能力。

## 本地验收数据说明

真实 E2E 采用了 `~/.dsh/pf-worksurface/work` 下的 `ws-e2e-*` Surface/Orchestration、v5 Registration/Event/Operation facts 和对应 Session binding。它们已经被持久事实引用，按 WorkSurface 保留规则未自动删除。为定位启动隔离问题，作者 Orchestration 曾整体移入临时目录，真实 profile 启动后已逐项原样恢复并删除临时目录；没有删除或改写用户作者数据。`ws-e2e-live` 的早期空白 Session 和 `ws-e2e-model` 的首次模型 Session 是在兼容探测完整修复前由本机旧 Host 写入，因缺少持久 `ignorable` 标记不能恢复；修复后的 `ws-e2e-nav` 与 `ws-e2e-model2` 分别证明空白 admission 和失败 Turn 重启不会再产生该问题。工作区根下误建、未被采用的 `surfaces/ws-e2e-verify` 已删除。
