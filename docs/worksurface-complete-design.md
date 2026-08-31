# WorkSurface v1 系统设计

> 状态：实现约束下的权威设计基线，2026-08-31。本文只把已有类型、持久化记录、重放逻辑和测试约束称为“当前概念”。尚未进入代码的内容必须显式标为“演进项”，不得与当前模型混写。

## 0. 设计纪律

一个术语只有同时回答以下问题，才能进入 WorkSurface 的权威概念表：

1. 身份是什么，在哪里定义；
2. 数据结构是什么，由哪个 schema 或校验器约束；
3. 事实存在哪里，谁负责写入；
4. 如何从持久化事实重放；
5. 生命周期或状态转换由什么事件决定；
6. 幂等、并发和恢复规则在哪里执行；
7. 哪些测试证明这些规则。

只有说明文字、UI 名称或一张图，不足以建立概念。交互图负责设计关系和状态，本文与实现索引负责物理协议和源码证据；没有物理承载的术语不得作为既成节点出现。

## A. 系统设计主线

实现约束不是主画布。WorkSurface 的系统设计主线是：

```text
Surface
  ↓ Context Projection
绑定的 DSH Session（Turn → Step → Tool Call）
  ↓ 推进中产生业务事实
业务 Event
  ↓ replay / match
Orchestrate Activation
  ↓ durable Operation
emit / followup
  ↓
同一个 Surface 继续推进
```

这里各层的状态不同：

| 设计对象 | 设计含义 | 当前状态 |
| --- | --- | --- |
| Surface | 可寻址、推进过程中持续维护且模型可见的工作上下文 | 领域定位明确；v1 仅由文件 WIP、Revision、Event stream、Binding 和 DSH Session 组合承载 |
| Context Projection | 决定一次模型调用实际看到 Surface 的哪些内容 | 已实现 Revision files、Session facts 和 provider occurrence；通用局部地址协议未实现 |
| DSH execution | 提供 Session、Turn、Step 与 Tool Call 的权威执行日志 | 已实现并由 DSH 所有 |
| WorkSurface Event | 推进过程中产生、可被 Orchestrate 消费的业务事实 | Event envelope、EventRef、stream 已实现；通用 content ref payload 协议未实现 |
| Orchestrate | 根据固定 Definition、Registration 和 Event history 决定后续影响 | replay、Activation、Operation、emit/followup 已实现 |

### A.1 Orchestrate 的统一实现边界

目标作者层允许多个 source 形式，但它们不能进入推进控制器：

```text
YAML pattern ─┐
              ├─ compile / adapt ─→ canonical OrchestrationDefinition
code builder ─┘                              ↓
                                  Definition Revision
                                              ↓
                       Registration + Event history
                                              ↓
                           evaluator → reliable effects
```

这个目标边界已经确定；当前只完成右半段。现在 `definition.json` 直接就是 `OrchestrationDefinition v1`，YAML compiler、code builder adapter 和 provenance 仍未实现。Code handler 是 Definition 固定的运行 artifact，不等同于作者层的 code builder。

### A.2 控制职责而非虚构 Runtime 实体

推进控制的逻辑边界是：固定 Definition 与 Registration，重放 Event，派生 Activation，以持久 Operation 执行 effect。当前由多个实现组件承担，设计图称其为“事件推进控制”，而不是再发明一个有独立身份的 `Runtime` 领域对象。

## 1. 定位与所有权

WorkSurface v1 是构建在 DSH 之上的文件原生、事件驱动协调层。

WorkSurface 当前负责：

- `SurfaceId` 到作者目录、Surface Event stream 和唯一 DSH Session binding 的映射；
- Surface 与 Orchestration 作者目录的校验和不可变 Revision；
- WorkSurface Event 的 append、幂等、重放与 EventRef；
- Orchestration Definition、Registration、Activation 和 Operation；
- 依据 Registration replay Surface streams，派生 Activation 并可靠执行 emit/followup；
- 为一个打开的 DSH Turn 注入 Surface 目录、Context 文件和短期 emit capability。

DSH 负责：

- Agent 和 Session 的创建、恢复与销毁；
- Session append-only log；
- Turn、Step、模型请求、Tool Call、Tool Result 的执行事实；
- 等待、失败、取消、重试和 Turn 结束原因；
- 面向模型的消息历史和 transcript。

WorkSurface 不建立第二套 Agent、Session、Turn、Step 或 Tool Call。

当前 adapter 的硬约束是：

```text
one SurfaceId <-> one DSH SessionId
```

这由 `SurfaceSessionService.bindSession()` 在第一个 `turn/start` 前固定，并同时保存在 WorkSurface binding 文件与 DSH Session 的 `worksurface/binding` 事件中。

## 2. 物理布局

默认实现的公共作者数据与私有状态如下：

```text
<root>/
├── work/                                      # 模型和用户可写
│   ├── surfaces/<surface-id>/
│   │   ├── surface.md
│   │   └── ...工作文件
│   └── orchestrations/<orchestration-id>/
│       ├── definition.json
│       ├── registration.json
│       ├── ...handlers
│       └── ...支持文件
└── v4/                                        # WorkSurface 私有状态
    ├── events/
    │   ├── surfaces/<encoded-id>.jsonl
    │   └── registrations/<encoded-id>.jsonl
    ├── revisions/
    │   ├── manifests/sha256/...
    │   └── blobs/sha256/...
    ├── definitions/<revision>.json
    ├── surface-sessions/<surface-id>/
    │   ├── binding.json
    │   └── context.json
    └── runtime/...
```

DSH Session Log 由 DSH persistence 保存，不属于上述 WorkSurface EventStore。

## 3. 当前概念及其物理定义

### 3.1 Surface

当前代码没有 `Surface` aggregate class；它有 `SurfaceId = string`，并由同一个 ID 关联以下物理对象：

| 物理对象 | 作用 | 代码 |
| --- | --- | --- |
| `work/surfaces/<SurfaceId>/` | 当前可变作者 WIP | `WorkSurfaceService`、`SurfaceSessionService.authoringPath()` |
| `surface:<SurfaceId>` stream | Surface 上的 WorkSurface 业务事实与发布事实 | `FileEventStore`、`surfaceSubject()` |
| `surface-sessions/<SurfaceId>/binding.json` | 唯一 DSH Session、输入 Revision 与 CAS head | `SurfaceSessionBinding` |
| Surface Revision | 某次合法目录快照 | `RevisionStore.snapshotSurface()` |
| DSH Session Log | 该 Surface 当前 adapter 下的完整执行历史 | `DshWorkSurfaceSessionAdapter`、DSH `Session` |

所以当前严格定义是：

> Surface 是由 `SurfaceId` 标识的工作对象；其可变内容位于作者目录，WorkSurface 事实位于 Surface stream，不可变内容边界由 Revision 表示，执行历史由唯一绑定的 DSH Session 保存。

Surface 不是目录、Revision 或 Session 的别名。当前实现通过一组同 ID 关联和 1:1 binding 把它们组合起来。

当前“可寻址”只达到两个层级：

- Surface 级：`SurfaceId`；
- 文件级：作者目录或 Revision 内的规范相对路径。

仓库尚无通用的 `SurfaceAddress(adapter, locator, boundary)` 类型；因此更广义的局部寻址是演进项，不是已实现能力。

### 3.2 WorkSurface Event

`WorkSurfaceEvent` 是 WorkSurface 自己的持久事实信封：

```ts
{
  version: 1,
  id,
  subject: { kind: 'surface' | 'registration', id },
  seq,
  name,
  payload,
  causes: EventRef[],
  meta,
  recordedAt
}
```

物理存储是一条 JSONL 记录。`seq` 只在单一 subject stream 内连续有序；跨 stream 因果必须使用 `EventRef { subject, seq, id }`。

同一个 Event ID 加相同规范内容是幂等重试；同 ID 不同内容是冲突。live watch 只负责唤醒，消费者必须 replay 后再计算。

### 3.3 Revision

`Revision = sha256:<digest>` 表示一个不可变目录快照。`RevisionStore` 保存排序 manifest 和内容 blob，并在 snapshot 时拒绝符号链接、非普通文件和并发变化。

当前有三种 kind：

- `surface`：必须包含通过固定七节校验的 `surface.md`；
- `definition`：必须包含合法 `definition.json`，并包含它引用的 handler；
- `artifact`：通用不可变目录。

Revision 不是 Surface 状态机；它只是内容边界。

### 3.4 Orchestration Definition

当前 `OrchestrationDefinition` 是 `definition.json` 直接解析出的 v1 JSON 程序：

```ts
{
  version: 1,
  roles: string[],
  subscriptions: SubscriptionDefinition[]
}
```

每个 Subscription 固定：

- `history: all | from-registration`；
- `when`: selector / all / any / count / single-stream sequence；
- 可选业务 `key`；
- 一个 reaction：`emit`、`followup` 或 `handler`。

作者目录先由 `RevisionStore.snapshotDefinition()` 固定成 Definition Revision；`definition.json` 再经 `defineOrchestration()` 校验，规范对象由 `DefinitionStore` 按该 Revision 保存和加载。

当前没有 YAML compiler，也没有独立于 `OrchestrationDefinition` 的另一套 Definition IR。

### 3.5 Registration

`registration.json` 只包含：

```json
{
  "version": 1,
  "registrationId": "...",
  "bindings": { "role": "surface-id" }
}
```

真正的 `Registration` 在首次注册时写入 `registration:<id>` stream，固定：

- `orchestrationId`；
- 精确 `definitionRevision`；
- 完整 `role -> SurfaceId` bindings；
- 每个角色的 `historyBoundary`；
- 允许影响的 `targetRoles`。

Registration 一旦存在，重复相同输入是幂等；任何固定事实变化都是 `already-exists-conflict`。`active / paused / retired` 也是 Registration stream 中的状态事实。

### 3.6 Activation

Activation 不是“运行了一次 Agent”，而是某个 Subscription 在一个业务 key 上已经满足的持久事实。

身份严格派生为：

```text
ActivationId = hash(RegistrationId, SubscriptionId, businessKey)
```

单事件 Subscription 未声明 key 时使用源 Event ID；聚合条件必须声明显式 key。Activation 保存精确 source EventRefs，并以 `registration.activation-opened` 记录到 Registration stream。

### 3.7 Operation

Operation 是一个 Activation 所产生副作用的持久执行记录，身份为：

```text
(ActivationId, operationKey)
```

执行协议是：

```text
registration.operation-recorded
        ↓
执行 emit 或 followup
        ↓
registration.operation-settled
```

进程崩溃后，Engine 从未结算的 recorded Operation 恢复；稳定 Event ID 或 Message ID 防止重复目标结果。

### 3.8 SurfaceSessionBinding

Binding 是执行关联，不是 Surface 本身：

```ts
{
  version: 1,
  surfaceId,
  sessionId,
  inputSource,
  inputRevision,
  expectedHead
}
```

它必须在第一个 DSH Turn 前创建；一个 Surface 和一个 Session 都不能再次绑定到另一方。发布使用 `expectedHead` 做 compare-and-swap，冲突不会覆盖当前 head。

## 4. DSH 原生术语

WorkSurface 文档必须沿用所安装 DSH 包的语义：

| DSH 术语 | 严格含义 |
| --- | --- |
| Session | Agent 全部交互历史的 append-only 真源；消息历史由此派生 |
| Turn | `turn/start` 到 `turn/end` 的一次连续处理边界；可以没有 Step，也可以包含多个 Step |
| Step | 一个模型调用以及该模型调用请求的工具执行，由 `step/start/end` 包围 |
| Tool Call | Step 内一个带 `callId` 的工具请求，由 `tool/call` 与 `tool/result` 配对 |

WorkSurface 只能引用或桥接这些事实，不能把它们重新命名成自己的生命周期。

## 5. 当前运行链路

### 5.1 Surface admission 与执行

```text
work/surfaces/<id>/
        ↓ validate / snapshot input
SurfaceSessionService.bindSession()
        ↓ before first turn/start
binding.json + DSH worksurface/binding event
        ↓
DSH Session Turn / Step / Tool execution
        ↓ ordinary file writes
same authoring directory
```

打开 Turn 时，adapter 生成短期 capability，并注入：

- `DSH_SURFACE_ID`；
- `DSH_SURFACE_DIR`；
- `DSH_WORKSURFACE_ROOT`；
- `DSH_CONTEXT_FILE`；
- `DSH_WORKSURFACE_CLI` 和 capability。

Turn 结束后 capability 立即失效。

### 5.2 `ws emit`

模型侧唯一 WorkSurface 命令是：

```text
ws emit <event-name> --key <stable-key> --payload <json>
```

处理顺序：

1. 校验 capability 对应当前打开的 DSH Turn；
2. 扫描并固定尚未登记的 `registration.json`；
3. 构造由 `sessionId + turn + surfaceId + operationKey` 派生的稳定 Event ID；
4. append 到 `surface:<id>` stream；
5. event watch 唤醒 reconcile；
6. Engine replay 后决定是否出现新 Activation。

`surface.revision.published` 是保留事件：它先 snapshot 当前 Surface 目录，再按 `expectedHead` CAS 发布。

### 5.3 Orchestration reconcile

```text
exact Definition Revision
        +
Registration stream
        +
bound Surface streams
        ↓ replay
ObservedEvent[]
        ↓ deriveActivations()
registration.activation-opened
        ↓ reaction
Operation recorded → target effect → Operation settled
        ↓
registration.activation-settled
```

Engine 按 RegistrationId 串行 reconcile。运行内存中的 `running` map 只是互斥手段；真源仍是 Definition、Surface streams 和 Registration stream。

### 5.4 两种当前 effect

`emit`：

- 根据 target role 找到 SurfaceId；
- 以 Activation sources 作为 causes；
- append 稳定 ID 的 WorkSurface Event；
- settlement 保存目标 EventRef。

`followup`：

- 根据 target role 找到 SurfaceId；
- 经唯一 Binding 找 DSH Session；
- 生成稳定 Message ID；
- 调用 `agent.followup()`；
- DSH flush 证明持久接纳后记录 settlement。

### 5.5 Code handler

当前 Code handler 是 Definition Revision 内的受控程序，不是通用 Runtime：

- 从精确 Definition Revision 只读 materialize；
- Context 文件包含 Registration、Activation、matched events 和 bindings；
- sandbox 必须是 full enforcement；
- 可写目录仅用于日志和 `emits.jsonl`；
- 输出只能转换成已声明目标角色上的 `CodeHandlerEmit[]`；
- 当前 Code handler 不能产生 followup。

因此当前声明式 reaction 与 Code handler 并不共享完整 Effect 集合：声明式支持 emit/followup，Code 只支持 emit。这是明确的实现差距。

## 6. Runtime：实现装配，不是领域对象

当前不存在名为 “WorkSurface Runtime” 的统一类或持久身份。推进职责由以下组件共同完成：

- `WorkSurfaceService`：Cordis 装配、RPC、作者目录 admission；
- `WorkSurfaceEngine`：Registration replay、Activation、Operation reconcile；
- `SurfaceSessionService`：binding、Turn capability、Surface event/publication；
- `DshWorkSurfaceSessionAdapter`：DSH Turn 事件和 followup 桥接；
- `SubprocessCodeHandlerRunner`：受控 handler 执行。

“Runtime”可以作为这组组件的泛称，但不能被画成一个有独立状态和 API 的实体。

## 7. YAML / Definition IR：演进项

当前物理事实是：作者直接写 `definition.json`，其内容就是 `OrchestrationDefinition v1`；Definition Revision 同时固定 JSON 和 handler 文件。

如果未来增加 YAML 或其他作者语法，边界应当是：

```text
author source --compile/adapt--> canonical OrchestrationDefinition
                                      ↓
                               Definition Revision
```

但 compiler、SourceRef、provenance schema 和独立 IR 目前都不存在。它们只能列入迁移计划，不能描述成当前运行链。

## 8. 当前限制与下一步设计入口

| 限制 | 当前证据 | 进入设计前需要的物理协议 |
| --- | --- | --- |
| 仅文件级 Surface 局部寻址 | `SurfaceId` + relative path | 通用 Address 类型、adapter、working/frozen boundary |
| 无 YAML compiler | 只读取 `definition.json` | Source schema、compiler、provenance、版本策略 |
| Code handler 只能 emit | `CodeHandlerEmit[]` | 若允许 followup，统一输出 contract 与授权 |
| WorkSurface 不消费 DSH EventRef | 只在 Event meta 保存 sessionId/turn | 稳定 DSH session-event reference adapter |
| Context 仍以 Revision 为核心 | `SurfaceSessionContext` | 对文件、事件和外部内容的统一 projection/ref |

## 9. 设计与代码同步规则

新增一级概念必须在同一个变更中至少提供：

- TypeScript 类型；
- JSON schema 或等价 admission validator；
- 持久化位置和写入所有者；
- replay/fold；
- 幂等、并发和恢复规则；
- 单元测试与故障测试；
- 本文和[可交互系统设计图](interactive/worksurface-system.html)的更新。

缺少其中任一项时，只能称为 proposal，不得写入当前概念图。
