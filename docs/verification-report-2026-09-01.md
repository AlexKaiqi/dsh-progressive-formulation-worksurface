# WorkSurface 重构与验证报告（2026-09-01）

## 结论

当前默认实现已经与 code-first 设计收敛，核心路径可交付。设计本身合理，但成立的前提不是“把普通代码画成静态工作流图”，而是严格分离三类事实：

1. 不可变 Revision/Contract/Registration 描述已固定的内容和能力；
2. append-only Event/Input/Operation 记录实际发生的过程与因果；
3. DSH Session/Turn/Step 仍是唯一执行历史，WorkSurface 不复制第二套执行生命周期。

本次审计发现并修复的偏差都位于这些边界上。最终全量门禁为 24 个测试文件、115 个测试全部通过；真实 `web` profile 还完成了崩溃窗口恢复、Python Orchestrate 执行、Revision 应用、下游 Event、Web 投影、Workspace attach、原生空白 Session 导航和旧 Host 的 Session 重启兼容验证。真实模型 Turn 已验证到 Provider 请求边界；用户目录 `.env` 中的 DeepSeek 凭据被实际采用，但 Provider 以 HTTP 402 `Insufficient Balance` 拒绝生成，因此模型工具执行后的 Event 链不能记为通过。

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
8. Web 增加 v5 Registration/Event 投影，并把 declared capability 与 actual Event/causes 分栏。
9. 公共作者根注册为 `WorkSurfaces` Workspace；新建/恢复 Session 返回 Web 前 attach。
10. 兼容本机仍链接的 DSH Session `0.1.2-alpha.1`：对具体 Session constructor 探测 `ignorable` envelope 能力。旧 Host 不写 binding 或 context extension facts，以外部 immutable `binding.json`、Turn Brief 与 shell context 为兼容面；支持新 envelope 的 Host 才启用全部 ignorable facts。
11. Host domain error 通过同源、已认证 Web API 返回可操作信息，不再一律压成 `projection unavailable`。

## 按变化来源拆分的文件边界

| 变化来源 / 权威事实 | 文件 | 不应承担的责任 |
| --- | --- | --- |
| 协议类型与严格校验 | `packages/core/src/runtime-protocol.ts` | 文件 IO、DSH 生命周期 |
| 锁、durable create、fsync、ID/digest 基础校验 | `packages/core/src/runtime-store-io.ts` | 领域状态机 |
| authority 与 Contract snapshot | `packages/core/src/runtime-authority-contract-store.ts` | Event/Operation ledger |
| Surface Runtime Event stream | `packages/core/src/runtime-event-store.ts` | Registration 或 runner |
| Registration/Input/Operation durable facts | `packages/core/src/orchestrate-ledger-store.ts` | Surface authoring apply |
| 兼容 export facade | `packages/core/src/runtime-store.ts` | 新实现逻辑 |
| code-first admission/reconcile/recovery | `packages/dsh/src/code-first-orchestrator.ts` | DSH Session UI 与文件交换细节 |
| artifact/run view/subprocess/result | `packages/dsh/src/orchestrate-code-runner.ts` | durable effect apply |
| Event-backed head/CAS apply/DSH EventRef bridge | `packages/dsh/src/code-first-surface-port.ts` | Registration 业务条件 |
| Session create/resume/Workspace attach | `packages/dsh/src/session-admission.ts` | Turn capability 和 Surface 内容 |
| 1:1 binding/Turn Brief/capability/publication | `packages/dsh/src/session-surface.ts` | Agent retry/completion 生命周期 |
| Host composition/RPC/topology aggregation | `packages/dsh/src/service.ts` | store 内部规则 |
| Web projection | `packages/web/client.js`、`packages/web/index.js` | 写入领域事实 |

## 可执行验证证据

### 自动门禁

```text
pnpm check
  schema / executable examples: passed
  TypeScript build: passed
  DSH eval: 4 files / 29 tests passed
  Web eval: 1 file / 8 tests passed
  full Vitest: 24 files / 115 tests passed
git diff --check: passed
```

重点测试：

- `runtime-protocol.spec.ts`：authority、Contract digest、Binding、Event、batch/settlement 的正负契约；
- `code-first-orchestrator.spec.ts`：admission、重复扫描、run、record/apply/settle、未接纳 durable Event 的 restart recovery；
- `code-first-surface-port.spec.ts`：Event-backed head、CAS apply、published bridge、DSH tool 安全 projection；
- `session-admission-agent-loop.spec.ts`：真实 DSH Agent Loop、首 Turn 边界、followup receipt 不等待模型结束、restart recovery；
- `web.spec.ts`：同源 admission、domain error、v4/v5 projection passthrough、声明/事实分层。

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

Web 真实页面显示 `1 输入 · 1 运行 · 0 待结算`，并分别展示 Registration routes 与上述四条实际 Event。

### 真实 profile：空白 Session admission 与导航

验证对象为 `ws-e2e-nav`：

- admission 创建唯一 Session，`binding.json` 在首 Turn 前固定；
- Workspace registry 中 `WorkSurfaces` 包含该 Session；
- 原生侧栏显示 `WorkSurfaces / 新会话`；
- 点击“进入推进”打开原生空白 composer，没有提交用户消息，也没有打开第二个 Session；
- 本机旧 Session Host 的持久日志不包含不可恢复的 `worksurface/binding` 外部 Event。

### 真实 profile：模型 Turn 与旧 Host 重启兼容

验证对象为 `ws-e2e-model` 与修复后的全新 `ws-e2e-model2`：

1. 从用户目录 `.env` 注入 `DEEPSEEK_API_KEY`，通过正式 `session/modelCatalog` 确认 `deepseek-official` 可路由；
2. 经 WorkSurface admission 创建唯一 Session，并通过正式 `session/selectModel` 固定 `deepseek-v4-flash`；
3. 经正式 `session/prompt` 进入真实 Agent Turn；未注入 `.env` 的受管进程准确返回 `MISSING_CREDENTIAL`，改用携带 `.env` 的受控进程后请求到达 Provider，并返回 HTTP 402 `Insufficient Balance`；
4. 首次尝试同时暴露：旧 Host 会丢弃 `ignorable` 字段，导致 `worksurface/context-revision` 在重启时成为未知必需事件；
5. 修复后 adapter 对具体 Session constructor 探测能力，旧 Host 整体跳过可选 extension facts。`ws-e2e-model2` 的持久日志只含 Host 已知事件；重启后同一 Session 可再次完成 `session/selectModel`，证明恢复不再被未知事件阻断。

由于 Provider 额度不足，proof 文件、`verification.model-requested` 和 `verification.model-completed` 没有出现；这是外部模型执行层的明确未通过项，不以静态测试或手工 emit 代替。

## 当前仍明确未实现

- v4 数据到 v5 的显式迁移工具；
- `dsh.tool.completed` 之外的通用 DSH Event 安全 projection。

它们没有被 UI、模型说明或 Schema 通过伪装成可用能力。

## 本地验收数据说明

真实 E2E 采用了 `~/.dsh/pf-worksurface/work` 下的 `ws-e2e-*` Surface/Orchestration、v5 Registration/Event/Operation facts 和对应 Session binding。它们已经被持久事实引用，按 WorkSurface 保留规则未自动删除。`ws-e2e-live` 的早期空白 Session 和 `ws-e2e-model` 的首次模型 Session 是在兼容探测完整修复前由本机旧 Host 写入，因缺少持久 `ignorable` 标记不能恢复；修复后的 `ws-e2e-nav` 与 `ws-e2e-model2` 分别证明空白 admission 和失败 Turn 重启不会再产生该问题。工作区根下误建、未被采用的 `surfaces/ws-e2e-verify` 已删除。
