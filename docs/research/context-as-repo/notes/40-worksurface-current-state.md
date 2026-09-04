# WorkSurface 当前实现审计（只读）

审计对象：`dsh-progressive-formulation-worksurface`，HEAD `f5fa25c46c2378af997d37e1f6b3045705c40811`。

本文只回答“代码现在实际做了什么”，不提出目标产品设计。文中证据级别：

- **I — Implemented**：存在可达的实现调用链；
- **T — Tested**：该行为有自动化测试，且本次在上述 HEAD 重新运行通过；
- **D — Documented only**：只有文档、Schema 声明或类型占位，没有完整执行链；
- **G — Gap**：本次问题要求的能力不存在，或声明与执行边界不一致。

本次重跑：

```text
pnpm exec vitest run \
  packages/design/tests/model-guidance.spec.ts \
  packages/core/tests/revision-store.spec.ts \
  packages/core/tests/view-projection.spec.ts \
  packages/dsh/tests/context-runtime.spec.ts \
  packages/dsh/tests/session-surface.spec.ts \
  packages/dsh/tests/code-first-surface-port.spec.ts \
  packages/dsh/tests/session-admission-agent-loop.spec.ts

Test Files  7 passed (7)
Tests      45 passed (45)
```

## 结论摘要

1. **WorkSurface 已经有一个真实的“文件工作面 + 不可变 Revision + 事件/账本”内核，而不是 Prompt 模板。** Surface 的普通文件会被完整快照为 content-addressed Revision；发布、事件追加、恢复和 GC 都有实际实现和部分故障测试。**[I][T]**
2. **Runtime 当前固定知道的 Surface repo 契约很小：目录身份来自外部 `SurfaceId`，唯一必需入口文件是 `surface.md`，且必须含七个有序标题；其余文件没有角色、装载策略、可信来源或生命周期元数据。** **[I][T][G]**
3. **存在三层 bootstrap：全局短说明、绑定 Session 说明、当前 Turn locators/Brief；同时还有可选的 fact-backed 自动注入。** 后者只从已绑定的不可变 Revision 取文件，不会重新快照当前可写 authoring WIP，因此“自动注入的 Revision 内容”和“目录里的最新未发布 WIP”可能不同。**[I][T][G]**
4. **`ContextPlan` / `RenderManifest` 是真实实现，但当前预算器主要裁剪 Surface 文件和 provider sections，不能裁剪 DSH 对话。** 所有 conversation item 都是 `never`，且最终 `messages` 直接取完整 `deriveMessages()`；上下文超限时会失败，不会靠这个 adapter 渐进式缩小 transcript。**[I][T][G]**
5. **Provider occurrence 有完整的事实生命周期、并发调用和稳定结算顺序，但仓库内没有任何生产 provider 注册。** 因此 analysis / acceptance / recovery / maintenance 框架当前默认不会贡献内容。**[I][T][G]**
6. **旧 v4 Surface publish 路径有在 subject lock 内完成的 CAS；v5 code-first apply 只有进程内 read-check-apply 串行，v5 的 `recordPublished()` 更只记录 `expectedRevision` 而不对 v5 head 校验。** 当前“发布经过 CAS”的内建 Contract 描述不能等同于“所有 revision 写入路径都具有同一个原子 CAS”。**[I][T][G]**
7. **WorkSurface 没有实现 context archive / restore。** `RevisionStore.pin/unpin/collect` 是底层保留与 GC；Orchestration 的 pause/resume/retire 是编排生命周期；二者都不是可逆的上下文 archive。模型侧 CLI 也只有 `emit`。**[G]**
8. **WorkSurface 不实现 compaction/prune。** 它能识别 DSH compaction checkpoint、触发 maintenance occurrence，也注册了两个相关 event type；但没有 compact/prune 执行器、没有生产 maintenance provider、没有对这两个事件的 append/fold 调用链。文档明确把压缩和 prune 留给 DSH。**[I][D][G]**

## 1. 物理结构与 Runtime 固定契约

### 1.1 事实目录

配置把公开 authoring 与 Runtime 状态分开：

```text
<configured root>/
├── work/                              # 可另配 workRoot
│   ├── surfaces/<surface-id>/         # 模型维护的普通文件
│   └── orchestrations/<id>/
│       ├── artifact/
│       └── registration.json
├── v4/
│   ├── definitions/
│   ├── revisions/
│   ├── events/
│   ├── runtime/
│   └── surface-sessions/<surface-id>/
│       ├── binding.json               # Surface ↔ DSH Session 唯一绑定
│       └── context.json               # 可重建执行投影
└── v5/
    ├── authority.json
    ├── contracts/
    ├── events/
    ├── registrations/
    ├── input-ledgers/
    └── operation-ledger/
```

证据：

- `packages/dsh/src/config.ts:32-46` 固定解析 `workRoot`、v4 state roots 和 v5 `targetRoot`。**[I][T]**
- `README.md:5-15` 明确 `SurfaceId` 只是贯穿目录、authority、事件、binding 与 Revision 的关联键，不存在另一个 Surface aggregate；DSH Session 保有完整 append-only transcript。**[D]** 代码中的分散 store 与 binding 与该说明一致。
- `packages/dsh/src/service.ts:156-183` 创建 authoring collections、v4 stores、v5 authority/contracts/events/ledgers，并把它们装配进 Runtime。**[I]**

### 1.2 Runtime 真正固定知道的 Surface 文件契约

当前唯一必需文件名是 `surface.md`：

- 七个标题由 `SURFACE_SECTION_TITLES` 固定：Goal、Acceptance Criteria、Known Facts and Constraints、Assumptions、Open Questions、Current Decisions、Deliverables and Evidence（`packages/core/src/revision-store.ts:10-20`）。**[I]**
- snapshot 时要求 `surface.md` 存在并验证七个标题的相对顺序；若 frontmatter 写入 `surfaceId/parent/status/session/agent` 等 Runtime-owned 字段则拒绝（`packages/core/src/revision-store.ts:373-394`）。**[I][T]** 对应测试在 `packages/core/tests/revision-store.spec.ts:33-51`。
- 除 symlink/特殊文件、大小限制和路径规范外，目录下的其他普通文件全部进入 manifest；没有固定子目录 taxonomy（`packages/core/src/revision-store.ts:91-146`）。**[I][T]**
- Revision manifest 只记录 `path/type/executable/size/sha256`（`packages/core/src/revision-store.ts:24-36`），没有 `role`、`loadPolicy`、`trust`、`lifecycle`、`summary` 或 `freshness`。**[G]**

这意味着当前 repo ABI 实际是：

```text
SurfaceId（Runtime 外部身份）
+ surface.md（唯一约定入口）
+ 任意普通文件（无语义角色）
+ 整目录不可变 Revision manifest
```

### 1.3 不可变 Revision 的强度与边界

- snapshot 按排序后的相对路径遍历，拒绝 symlink，在读取前后比较 inode/size/mtime/mode，变化则报 `revision-conflict`；文件和 manifest 都内容寻址（`packages/core/src/revision-store.ts:91-146`）。**[I][T]**
- read 会验证 manifest hash，readFile 会验证 blob size/hash（`packages/core/src/revision-store.ts:149-177`）。**[I][T]**
- materialize 只写入新目录或空目录，可要求 read-only（`packages/core/src/revision-store.ts:180-208`）。**[I][T]**
- `pin/unpin` 是显式 storage retention roots；`collect` 是带 young-object age guard 的 mark-and-sweep（`packages/core/src/revision-store.ts:211-300`）。**[I][T]**

限制：Surface Revision 接受任意普通文件，包括二进制文件，而默认 context adapter 把每个文件直接 `.toString('utf8')`（`packages/dsh/src/context/runtime.ts:187-199`）。`RenderManifest` 类型虽允许 omission reason `unsupported-modality`（`packages/dsh/src/context/types.ts:80-90`），默认 adapter 从不产生该原因，只产生 `token-budget`（`packages/dsh/src/context/runtime.ts:264-303`）。因此当前没有真实 modality classification/adapter。**[G]**

## 2. Bootstrap 与自动装载

### 2.1 全局 discovery：所有 Agent

- WorkSurfaceService 构造时把固定 guidance 注册为 system-prompt section（`packages/dsh/src/service.ts:133-140`）。**[I]**
- guidance 只讲适用边界、普通文件、Surface 分解和 `"$DSH_WORKSURFACE_CLI" help`，长度上限 1200 chars（`packages/design/src/model-guidance.ts:18-33`；DSH 具体入口在 `packages/dsh/src/model/global-instructions.ts:1-12`）。**[I][T]**
- 真实 Agent-loop 测试证明普通 Agent 在任何 Surface 存在前就能收到 guidance、CLI 路径和 authoring root，并能创建首个 `surface.md`（`packages/dsh/tests/session-admission-agent-loop.spec.ts:123-160`）。**[T]**

### 2.2 绑定 Session 与当前 Turn

- Surface 与 DSH Session 的一对一 binding 必须在首个 Turn 前建立；重复相同 binding 是恢复，换 Surface 或换 Session 会冲突（`packages/dsh/src/session-surface.ts:193-251`）。**[I][T]**
- binding 的权威事实是只写 `binding.json`；旧 `worksurface/binding` Session event 只用于兼容校验，不再写新事件（`packages/dsh/src/session-surface.ts:254-268`）。**[I][T]**
- Session start 时自动 inject 固定的 Surface guidance（`packages/dsh/src/session-adapter.ts:164-168`）；它要求先读 Turn Brief，并把 durable claims/decisions/evidence 留在 Surface（`packages/design/src/model-guidance.ts:48-60`）。**[I][T]**
- 每个 model shell 都有 `DSH_WORKSURFACE_CLI` 与 `DSH_WORKSURFACE_ROOT`；只有 active Surface Turn 才有 `DSH_SURFACE_ID`、`DSH_SURFACE_DIR`、`DSH_WORKSURFACE_VIEW_DIR`（`packages/dsh/src/session-adapter.ts:218-249`）。**[I][T]**
- 每个 Turn 自动生成只读 `turn-brief.json`、payload schemas 和 private `.runtime.json`；Brief 的固定 entry path 当前只有 `surface.md`（`packages/dsh/src/session-surface.ts:302-330`）。**[I][T]**
- Prompt assembly 还注入一次性精确 locator 文本（`packages/dsh/src/session-adapter.ts:114-131`）。**[I][T]**

因此当前 bootstrap 是“稳定小入口 + 文件 locator + task Brief”，不是把全部操作协议常驻 prompt。CLI help 分成 `author / coordinate / emit / recover`（`packages/cli/src/help.ts:7-22`）。**[I][T]**

### 2.3 Fact-backed 文件自动注入

真正的自动装载调用链是：

```text
system-prompt/assemble
  → 找到 binding + active Turn
  → capability probe
  → publishRevision(active immutable revision)
  → prepareAutomaticOccurrences()
  → buildContextPlan()
  → DefaultModelContextAdapter.render()
  → transformed.contexts.push(...rendered.contexts)
  → agent/request 后记录 RenderManifest
```

证据：`packages/dsh/src/session-adapter.ts:171-215`。**[I][T]** 真实 service restart 测试确认 Session 中写入 ignorable `worksurface/context-revision`、`context/rendered`，且模型请求含 `# Acceptance Criteria`（`packages/dsh/tests/session-admission-agent-loop.spec.ts:496-530`）。

两个重要边界：

1. **兼容性探测失败时整个 fact-backed layer 被跳过。** adapter 要求 live Session constructor 真正保留 `ignorable`，且 persistence 同时具有 `borrowSession` 与 `ensureMaterialized`（`packages/dsh/src/session-surface.ts:643-663`；调用点 `packages/dsh/src/session-adapter.ts:182-190`）。此时仍保留 Brief、shell vars 和普通文件访问。**[I][T]**
2. **自动装载的是 `active.revision.outputRevision ?? inputRevision`，不是每次 prompt 前的 mutable authoring snapshot**（`packages/dsh/src/session-adapter.ts:192-194`）。Authoring binding 只在建立 binding 时 snapshot（`packages/dsh/src/session-surface.ts:475-498`）；普通 WIP 之后可以跨 Turn 保留，但没有自动产生新 Revision（WIP 测试：`packages/dsh/tests/session-surface.spec.ts:149-164`）。所以：
   - 已发布/Runtime-applied 内容能稳定自动注入；
   - 当前目录的未发布修改只能由模型通过 `$DSH_SURFACE_DIR` 主动读，fact-backed 注入可能仍是旧 Revision；
   - 当前没有 manifest-vs-working-copy freshness receipt。**[G]**

## 3. ContextPlan 与 RenderManifest

### 3.1 地址与 item 模型

`ContextContentRef` 只有三种：

- `worksurface-file(surfaceId, revision, path, contentHash, size)`；
- `session-event(sessionId, seq, contentHash)`；
- `blob(id, contentHash)`。

证据：`packages/dsh/src/context/types.ts:15-25`。**[I][T]** 没有 fragment、line range、directory map、query、外部 artifact、数据库 locator 或通用 adapter/boundary。**[G]** 文档也明确这一点（`docs/context-management.zh.md:21-29`）。

`buildContextPlan()` 的输入与映射：

- `session.surface.nodes` → `conversation-message` / `compaction-checkpoint`；
- 最新 `worksurface/context-revision` 的每个文件 → `surface-file`；
- 当前有效 occurrence sections → `runtime-injection` / `recovery-state`；
- canonical plan 连同 `asOfSeq`、conversation generation、revision/manifest hash、occurrence ids 被 hash 为 `planId`。

证据：`packages/dsh/src/context/projections.ts:43-105`。**[I][T]**

Surface 文件当前没有 repo-authored load policy：`surface.md = required + never`，所有其他文件一律 `high + whole-item`（`packages/dsh/src/context/projections.ts:64-75`）。**[I][T][G]**

### 3.2 Render 算法

默认 adapter：

1. resolve 并 hash-check 所有非-Session refs；
2. 先纳入 `required` 或 `never`；若它们已超预算则失败；
3. 再按 `high → normal → low` 与 plan 顺序整项贪心装入；
4. 输出非-Session `contexts`、完整 `messages` 和不含原文的 manifest。

证据：`packages/dsh/src/context/runtime.ts:264-303`。**[I][T]** 基础 deterministic plan、file render、required-budget failure 与 provider 原文不进入 render fact 的测试在 `packages/dsh/tests/context-runtime.spec.ts:17-94`。

`RenderManifest` 持久字段包括 adapter id/version、plan/as-of、included/omitted item IDs、估算 token、target 与整体 content hash（`packages/dsh/src/context/types.ts:77-92`）；`context/rendered` 作为 ignorable Session fact 记录（`packages/dsh/src/context/runtime.ts:160-170,306-316`）。**[I][T]**

### 3.3 预算器的实际边界

- 所有 conversation item 都被赋予 `omissionPolicy: never`（`packages/dsh/src/context/projections.ts:48-61`），所以它们全部属于 required set。**[I]**
- adapter 最后无条件执行 `messages = agent.session.deriveMessages()`（`packages/dsh/src/context/runtime.ts:301-302`）。即使未来把某个 conversation item 标成 omitted，该行目前也不会依据 included IDs 过滤真实消息。**[G]**
- `RenderedContext.messages` 没有被 WorkSurface adapter 替换进模型请求；session adapter 只把 `rendered.contexts` push 到已由 DSH 组装的 context（`packages/dsh/src/session-adapter.ts:198-205`）。因此当前 WorkSurface render 对 conversation 的作用主要是预算核算与 manifest 记录，不是 transcript projection。**[I][G]**
- token 估算只是 `ceil(text.length / 4)`（`packages/dsh/src/context/projections.ts:130`），不是目标模型 tokenizer。**[I]**
- 默认 `maxInputTokens` 直接采用 `target.contextWindow`，没有显式 output/tool/publish reserve（`packages/dsh/src/context/runtime.ts:155-158`）。**[G]**
- service 给 maintenance trigger 的 budget 固定为 `128_000`（`packages/dsh/src/service.ts:144-148`），而 render 的目标窗口来自当前 DSH route（`packages/dsh/src/session-adapter.ts:195-202`）；两者不保证一致。**[I][G]**
- adapter 的 `supports()` 永远为 true（`packages/dsh/src/context/runtime.ts:264-269`），没有按 model/provider capability 选择 adapter。**[G]**

## 4. Context Provider 生命周期

### 4.1 已实现

- Provider registration 固定 `providerId / phases / order / required / timeoutMs / provide`（`packages/dsh/src/context/types.ts:94-115`）；注册时校验、拒绝重复，并按 `(order, providerId)` 排序（`packages/dsh/src/context/runtime.ts:35-49,328-333`）。**[I][T]**
- occurrence kinds：`analysis / acceptance / recovery / maintenance`；lifetimes：`request / phase / until-revision-change / until-event / session`（`packages/dsh/src/context/types.ts:4-13`）。**[I]**
- 自动触发规则：analysis 按 Revision phase，acceptance 按新 Revision，recovery 在 `firstLiveSeq > 0`，maintenance 由压力/大 tool result/Revision change 触发（`packages/dsh/src/context/runtime.ts:88-109,318-325`）。**[I]**
- occurrence id 是 kind/target/lifetime 的确定性 hash；Session facts记录 created、provider-settled、consumed、ended（`packages/dsh/src/context/runtime.ts:112-170`；fold 在 `packages/dsh/src/context/projections.ts:18-40`）。**[I][T]**
- pending providers 用 `Promise.all` 并发调用，完成后按排序后的 provider 顺序持久化 settlement；timeout/provider error 被规范化；required provider failure 阻断（`packages/dsh/src/context/runtime.ts:127-152,202-217,335-339`）。**[I][T]** 并发、稳定顺序、replay 不重复调用、required failure replay 与 blob tamper 测试在 `packages/dsh/tests/context-runtime.spec.ts:38-88`。
- 内联 provider 内容会写成 mode `0600` 的 content-addressed blob 并回读验 hash（`packages/dsh/src/context/runtime.ts:219-239`）。**[I][T]**
- request occurrence 只有 section 真正被 render 纳入（或无 section）后才 consumed/ended；其他 lifetime 由 revision/event/phase 边界结束（`packages/dsh/src/context/runtime.ts:160-170,242-260`）。**[I][T 部分]**

### 4.2 当前未闭合处

- 仓库生产代码中没有任何 `contextProviders.register(...)`；只有测试直接调用 `runtime.providers.register(...)`。所以默认部署的 provider registry 是空的。**[G]**
- `required` 当前只表示“该 provider 若失败则阻断”；`no-contribution` 不算失败，未要求 required provider 必须产出 section（`packages/dsh/src/context/runtime.ts:137-151,335-339`）。这是当前语义，不是内容必需性。**[I]**
- occurrence id 不包含 provider roster、provider implementation/version 或 config；`sourceVersion` 只在 contribution section 内记录（`packages/dsh/src/context/runtime.ts:119-136,219-239`）。一个已经 ready 的相同 occurrence 会直接 replay-return，后来新增/升级的 provider 不会运行（`packages/dsh/src/context/runtime.ts:128-131`）。当前没有 registry snapshot 或迁移策略。**[G]**
- 自动触发、各 lifetime、timeout、partial-settlement resume 没有直接测试；现有 provider 测试覆盖手工 occurrence 的主要 happy/failure paths。**[G：测试覆盖]**

## 5. Revision publish、CAS 与并发

当前有两个相关但不同的事件平面，必须分别描述。

### 5.1 v4 Surface Session publish：有 subject-lock 内 CAS

Binding 固定 `inputRevision` 和当时的 `expectedHead`（`packages/dsh/src/session-surface.ts:42-57,475-498`）。模型在一个 live Turn capability 中发布时：

1. snapshot 当前 authoring directory 并 pin candidate；
2. 在 `FileEventStore.appendWith()` 的 subject lock callback 内读取最新 v4 `publishedHead`；
3. 等于 `expectedHead` 则追加 `surface.revision.published`，否则追加 `surface.publish.conflicted`；
4. 成功后更新该 Session 的 revision state 与 `context.json`。

证据：`packages/dsh/src/session-surface.ts:511-548`。`appendWith()` 同时有进程内队列和 filesystem lock，且在锁内 replay/compute/append/fsync（`packages/core/src/file-event-store.ts:36-85,137-175`）。**[I][T 部分]**

测试证明：同 id append 幂等、冲突内容拒绝、两个 store instance 的 guarded append 串行（`packages/core/tests/file-event-store.spec.ts:15-45`）；Surface publish happy path 和 Turn 结束后 capability 撤销（`packages/dsh/tests/session-surface.spec.ts:166-183`）。没有直接测试 stale-head publish 会产生 `surface.publish.conflicted`。**[G：测试覆盖]**

### 5.2 v5 code-first apply：有 base check，但不是跨实例原子 CAS

- v5 head 是事件流里最后一个 `surface.revision.admitted / applied / published` 的 Revision（`packages/dsh/src/code-first-surface-port.ts:210-234`）。**[I][T]**
- `apply()` 在 `DshCodeFirstSurfacePort` 单实例的 per-Surface promise queue 内先读 head，再要求 `current === baseRevision`，随后交换 authoring directory 并追加 `surface.revision.applied`（`packages/dsh/src/code-first-surface-port.ts:103-147,252-253`）。**[I][T]**
- Runtime event append 自身有 filesystem lock 和 idempotent ID（`packages/core/src/runtime-event-store.ts:41-75`），但 `read head → filesystem swap → append event` 并未持有同一个跨实例 lock。进程内同一个 port instance 会串行；多个 Runtime 实例共享目录时，这不是一个 store-level atomic CAS。**[G]** 当前 Host 会拒绝第二个 live Unix socket owner（`packages/dsh/src/host.ts:21-55`），降低正常部署出现多 writer 的概率，但不能把它表述成 RevisionStore/EventStore 自身的跨进程 CAS。
- 测试覆盖 stale base 的代码分支所需的实现，但现有 `code-first-surface-port.spec.ts` 只直接验证 candidate apply、重启后相同 candidate 幂等与 authoring swap 恢复（`packages/dsh/tests/code-first-surface-port.spec.ts:20-59`），没有两实例竞争测试。**[T 部分][G：测试覆盖]**

### 5.3 v4 publication → v5 projection：expectedRevision 被记录但未校验

`WorkSurfaceService.emitTurn()` 先走 v4 publish；若 v4 event 是成功的 `surface.revision.published`，再调用 v5 `recordPublished()`（`packages/dsh/src/service.ts:246-280`）。但 v5 method 只验证 payload shape并 append，未读取当前 v5 head、未比较 `source.expectedRevision`（`packages/dsh/src/code-first-surface-port.ts:171-195`）。测试也只覆盖 happy path，确认 expectedRevision 被写入 payload（`packages/dsh/tests/code-first-surface-port.spec.ts:61-85`）。**[I][T][G]**

这在跨平面更新时尤其重要：v5 code-first apply 后，`adoptRuntimeRevision()` 把 input/output revision 更新为新 Revision，却保留原 `current.expectedHead`（`packages/dsh/src/session-surface.ts:367-380`）；而 v4 publish CAS 只比较 v4 stream 的 `publishedHead`。所以“v4 检查成功”不证明 `expectedRevision` 仍等于 v5 head。内建 Contract 将 v5 `surface.revision.published` 描述为“became the published head by compare-and-swap”（`packages/dsh/src/builtin-event-catalog.ts:25-28`），但 v5 projection method 本身没有执行该比较。**[G：contract/implementation mismatch]**

## 6. 事件事实与恢复

### 6.1 已实现并测试的恢复基础

- v4 `FileEventStore`：append-only canonical JSONL、subject-local seq、same-id idempotency、cross-instance lock、fsync、torn-final-record 检测（`packages/core/src/file-event-store.ts:18-119`）。**[I][T]**
- v5 `RuntimeEventStore`：authority-qualified subject、content-addressed Contract identity、same-id idempotency、per-Surface append lock、replay identity/seq/torn-record 校验（`packages/core/src/runtime-event-store.ts:27-103`）。**[I][T]**
- authority 在接纳 durable qualified identities 前持久化；Event Contract 按 digest 保存并回读验证（`packages/core/src/runtime-authority-contract-store.ts:17-78`）。**[I][T]**
- code-first Input Ledger 去重 EventRef；Operation Ledger 先 durable record、再 apply、最后 durable settlement（`packages/core/src/orchestrate-ledger-store.ts:58-148`）。**[I][T]**
- `CodeFirstOrchestrator.init()` 先 recover：重放 pending batch，再扫描 Surface events 补收 input，再重跑“已接纳但未 recorded”的 input（`packages/runtime/src/code-first-orchestrator.ts:87-90,195-207`）。**[I][T]**
- operation apply 对 Surface base revision 做冲突检查，event 与 followup receipt 具稳定 operation key，最后 settle（`packages/runtime/src/code-first-orchestrator.ts:272-359`）。**[I][T]**
- startup recovery 只恢复 interrupted/disposed Turn 或 durable queued followup；完成且 idle 的 Session 保持 cold（`packages/dsh/src/session-admission.ts:121-211,318-333`）。真实 DSH Agent-loop 测试覆盖 crash-interrupted、disposed、queued followup 与“不恢复 completed idle”（`packages/dsh/tests/session-admission-agent-loop.spec.ts:281-401`）。**[I][T]**
- authoring WIP 是同一持久目录；binding 和 marker 存活时可重建缺失目录或保留已有 WIP（`packages/dsh/src/session-surface.ts:151-170,424-431,551-588`；测试 `packages/dsh/tests/session-surface.spec.ts:185-234`）。**[I][T]**

### 6.2 DSH transcript 边界

WorkSurface 不复制 transcript；`buildContextPlan` 从 `session.surface.nodes` 取当前 DSH projection。DSH tool completion 接入 v5 时只保存 EventRef，需要时回到 DSH Session 解引用，并只投影 turn/step/call/tool/status/errorCode，不复制参数和结果正文（`packages/dsh/src/code-first-surface-port.ts:49-95`；测试 `packages/dsh/tests/code-first-surface-port.spec.ts:87-128`）。**[I][T]**

因此恢复有两种不同粒度：

- **执行/领域事实恢复**：Revision、Event、Registration、Input、Operation、Settlement；WorkSurface 自己负责。**[I][T]**
- **对话压缩与 Step/Tool Call 恢复**：DSH Session 负责；WorkSurface 只消费其持久 projection。**[I][D]**

## 7. Context maintenance / compaction

当前能确认的实现只有：

- DSH 中 source kind 为 `compaction` 的 `user/message` 会在 plan 中标为 `compaction-checkpoint`（`packages/dsh/src/context/projections.ts:48-61`）。**[I]**
- `ContextPlan.sources.conversationGeneration` 记录 DSH `surface.replaceGeneration`（`packages/dsh/src/context/projections.ts:93-105`）。**[I]**
- 当 projected conversation 估算达到 host budget 的 80%、出现大 tool result，或检测到 Revision change 时，可触发一个 `maintenance` provider occurrence（`packages/dsh/src/context/runtime.ts:88-109,318-325`）。**[I]**

没有闭合的部分：

- 仓库没有 production maintenance provider，因此触发条件默认不会创建任何维护贡献。**[G]**
- `context/maintenance-completed` 与 `compaction/prune` 只在 SessionEventMap 中声明并加入 known types（`packages/dsh/src/context/session-events.ts:5-30`）。`ContextFactType` 的实际 append helper 不包含这两个事件（`packages/dsh/src/context/runtime.ts:306-316`），全仓没有执行 compact/prune 或 fold 其结果的调用链。**[D][G]**
- 测试只断言 `compaction/prune` 被注册为 known event type（`packages/dsh/tests/context-runtime.spec.ts:96-100`），没有行为测试。**[T：仅注册]**
- 当前文档明确：“压缩、prune 以及 Session → Turn → Step → Tool Call 生命周期仍由 DSH 负责”（`docs/context-management.zh.md:70-72`）。这与代码现状一致。**[D]**

所以当前 WorkSurface 是“能观察 DSH 已压缩后的 projection，并可在压力点邀请 provider 贡献上下文”，不是 compaction engine，也不是 checkpoint-before-reset protocol。

## 8. Archive / restore

全仓可达的模型 CLI 命令只有 `ws emit`；其他动作只是 help topic（`packages/cli/src/bin.ts:13-59`）。Host RPC 的完整方法列表也没有 context archive/restore（`packages/cli/src/protocol.ts:1-7`）。**[G]**

容易混淆但不等价的现有能力：

- `RevisionStore.pin/unpin/collect`：对象保留与垃圾回收，不改变 Surface/context 的语义生命周期（`packages/core/src/revision-store.ts:211-300`）。
- `collectSessionGarbage()`：只删除足够旧的 `.tmp`，明确保留 authoring WIP 和所有 binding（`packages/dsh/src/session-surface.ts:450-467`）。
- `orchestrate.pause/resume/retire`：只作用于旧 v4 Orchestration registration（RPC 映射 `packages/dsh/src/service.ts:461-466`），不是 Surface 或 context archive。
- UI lifecycle projection 只有 `idle/published/waiting-user/completed/failed/conflicted`，且 completed 等业务状态来自 View interpretation（`packages/core/src/view-projection.ts:4-41,115-159`）；没有 archived/restored。**[I][T][G]**

当前不存在：

- context item 的 `active / archived / restored / superseded / expired` 持久状态；
- archive reason、source revision、replacement/ref、retention class；
- 原子 archive/restore operation；
- 模型可用的 archive/list-archived/restore 命令；
- archive 与 GC 的分离契约及相关测试。

结论：**archive/restore 是明确未实现，不应把文件移动、Revision pin/unpin 或 DSH compaction 称为已有 archive。** **[G]**

## 9. 证据矩阵

| 维度 | 当前事实 | 等级 | 主要证据 |
| --- | --- | --- | --- |
| Surface repo 入口 | `surface.md` + 七个有序标题 | I/T | `revision-store.ts:10-20,373-394`; `revision-store.spec.ts:33-51` |
| 其他文件角色 | 全部普通文件快照；无 authored role/load policy | I/G | `revision-store.ts:91-146,24-36` |
| 全局 bootstrap | 短 system guidance + CLI/root | I/T | `service.ts:133-140`; `session-admission-agent-loop.spec.ts:123-160` |
| Session/Turn bootstrap | Session guidance + 5 env locators + Turn Brief | I/T | `session-adapter.ts:114-131,164-168,218-249`; `session-surface.ts:302-330` |
| Fact-backed auto-load | 现代 DSH 上把 immutable Revision 的全部 Surface files 建成候选；`surface.md` 必入，其余受预算控制 | I/T | `session-adapter.ts:171-215`; `context/projections.ts:64-75`; `session-admission-agent-loop.spec.ts:496-530` |
| Mutable WIP freshness | 自动注入不重新 snapshot WIP | G | `session-adapter.ts:192-194`; `session-surface.ts:475-498` |
| Address types | file / Session event / blob | I/T/G | `context/types.ts:15-25` |
| ContextPlan | hashed, as-of, itemized plan | I/T | `context/projections.ts:43-105`; `context-runtime.spec.ts:17-36` |
| Surface loading priority | `surface.md` required；其余一律 high/whole-file | I/T/G | `context/projections.ts:64-75` |
| RenderManifest | included/omitted/target/hash，不存原文 | I/T | `context/types.ts:77-92`; `context-runtime.spec.ts:38-62` |
| Transcript budget control | conversation 永不 omit；真实 messages 全量 derive | I/G | `context/projections.ts:48-61`; `context/runtime.ts:280-303` |
| Provider occurrence | facts、lifetime、timeout、并发调用、稳定 settlement | I/T | `context/runtime.ts:35-49,88-170,202-260`; `context-runtime.spec.ts:38-88` |
| Production providers | 无 | G | production `packages/**` 无注册调用 |
| v4 publish CAS | subject lock 内比较 expected head | I/T 部分 | `session-surface.ts:511-548`; `file-event-store.ts:45-85` |
| v5 apply CAS | 单实例 base check；非跨实例原子 read-check-apply | I/T/G | `code-first-surface-port.ts:103-147,252-253` |
| v5 publication CAS | expectedRevision 只记录、不校验 v5 head | I/T/G | `service.ts:268-280`; `code-first-surface-port.ts:171-195` |
| Event/ledger recovery | append-only facts、record/apply/settle、startup replay | I/T | `code-first-orchestrator.ts:87-90,195-207,329-351`; `orchestrate-ledger-store.ts:109-148` |
| Session recovery | interrupted/disposed/queued 恢复；idle 不恢复 | I/T | `session-admission.ts:121-211`; agent-loop specs `281-401` |
| Context compaction/prune | 只观察 checkpoint/声明 types；执行归 DSH | I/D/G | `projections.ts:48-61`; `session-events.ts:5-30`; context doc `70-72` |
| Archive/restore | 不存在 | G | `cli/bin.ts:13-59`; `cli/protocol.ts:1-7`; no lifecycle/event/tool |

## 10. 审计中最容易被误读的三点

1. **“Surface 是文件目录”不等于“当前 mutable repo 已自动进入每次模型上下文”。** 自动注入绑定到 immutable Revision；最新 WIP 仍依赖模型按 locator 主动读取。
2. **“有 ContextPlan 与 token budget”不等于“WorkSurface 已替代 DSH compaction”。** 当前 adapter 不裁剪真实 transcript，且 compact/prune 执行链不在 WorkSurface。
3. **“事件 payload 带 expectedRevision”不等于“所有路径都执行 CAS”。** v4 publish 确实在 subject lock 内检查；v5 recordPublished 只记录该字段，v5 apply 的 read-check-apply 也只在单实例队列内原子化。
