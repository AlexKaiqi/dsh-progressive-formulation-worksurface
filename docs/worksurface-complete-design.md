# WorkSurface 完整系统设计

> 状态：权威系统设计，基线日期 2026-08-30。本文定义 WorkSurface 的领域边界、核心协议、文件布局、事件模型、DSH Session 集成、恢复算法和可执行不变量。UI 只能投影这些事实，其展示与交互规范见 [UI 设计](ui-design.md)。文档治理与实现入口见[文档索引](README.md)。

## 0. 设计结论

WorkSurface 首版只保留两个真正的领域对象：

1. **Surface**：可以独立加载、推进、恢复和判断结果的工作边界。
2. **Orchestration Definition**：订阅事件、形成 activation、再产生事件的不可变规则。

支撑它们的四类基础事实是：

- **Surface Revision**：某个 Surface 目录的不可变内容快照。
- **Definition Revision**：某个 Orchestration 作者目录的不可变内容快照。
- **Event**：已经发生的业务或控制事实。
- **Registration**：精确 Definition Revision 与角色绑定形成的可执行实例。

系统不建立 Task Tree、Agent Ownership、canonical Relation、第二套执行身份或可变 Status。Surface 的依赖由 Definition、绑定、事件和 activation 重放得到。每个 Surface 在开始推进前唯一绑定一个 DSH Session；该 Session 的 Turn/Step 日志就是这个 Surface 的推进过程。

核心关系为：

```text
可编辑目录 ──snapshot──> 不可变 Revision
                              │
                              ▼
Event ──引用 Revision──> 发布结果与业务事实
                              │
                              ▼
Definition + Binding + Event ──> Activation ──> Event | DSH followup
```

## 1. 首要设计原则

### 1.1 文件优先，但不把可变目录误当事实

“文件优先”包含三层：

- 人和模型工作的内容放在普通目录与普通文件中。
- 已发布内容保存为不可变、内容寻址的 Revision。
- 过程事实保存为 append-only 事件文件。

因此 WorkSurface 领域存在两类权威事实；执行历史另由 DSH Session 日志负责：

| 事实类型 | 权威来源 |
|---|---|
| 内容事实 | 不可变 Revision |
| 过程事实 | append-only Event Stream |
| 执行事实 | DSH Session Event Log |

作者目录、Surface Session worktree、缓存和 UI 状态都不是已发布内容事实，但 binding 和 worktree 必须持久保存，以支持原 Surface Session 续跑。

### 1.2 普通脚本负责内容操作

创建、复制、裁剪、替换、合并和批量修改目录，全部使用模型已经熟悉的工具：

- Bash / Zsh
- Python
- Node.js
- `cp`、`rsync`、`sed`、`awk`、`find`、编辑器

WorkSurface 不发明 `createSurface`、`deriveSurface`、`cloneSurface`、`writeBlock` 等领域工具。

模型环境中唯一必需的修改入口是：

```text
ws emit
```

它只追加经过校验的事件，不承担文件编辑、编排匹配或 Agent 推进。

### 1.3 恢复不依赖隐藏模型状态

任何未完成工作都必须能在原 DSH Session 恢复后从以下材料继续：

- 持久 worktree，或固定 input revision；
- `surface.md`；
- 唯一 `binding.json`、Session 日志中的 `worksurface/binding` 以及已经提交的 Turn/Step；
- 触发事件与授权输入；
- append-only 事件事实。

DSH Session 日志是执行历史的权威来源；模型 KV cache 和原进程只能是优化，不能成为正确性前提。WorkSurface 不复制 transcript，也不另建执行生命周期。

### 1.4 所有复杂性都必须回答一个真实故障

首版只引入能够解决下列问题的结构：

- 内容如何固定；
- Surface Session 创建时如何同时固定双方身份和输入；
- Host 崩溃后如何继续；
- 重复通知如何不重复执行；
- 多 Surface 如何形成依赖；
- 并发结果如何不静默覆盖；
- UI 如何不成为第二事实源。

不能对应这些问题的变量、目录、状态或对象不进入核心协议。

## 2. 领域原语

### 2.1 Surface

Surface 是稳定的工作身份，由 `SurfaceId` 标识。

它不是：

- Agent；
- DSH Session；
- 任务树节点；
- 目录层级中的父子节点；
- 某个 Agent 的所有物。

Surface 的内容随 Revision 演进；Surface 的过程随 Event 演进。

### 2.2 Revision

Revision 是目录内容的不可变快照。

```text
RevisionId = sha256(canonical manifest)
```

Revision manifest 至少记录：

- 相对路径；
- 文件类型；
- 可执行位；
- 内容哈希；
- 文件大小。

不记录 mtime、uid、gid 或绝对路径。首版只接受普通文件和目录；符号链接、设备文件、socket 和 FIFO 一律拒绝，避免越权与不可重放内容。

### 2.3 Event

Event 是已经发生的事实。每个 Event 属于一个 subject stream：

- `surface:<surface-id>`；或
- `registration:<registration-id>`。

每个 stream 内有严格递增的 `seq`。不同 stream 之间不存在可恢复的全局顺序；时间戳只用于审计，不能证明因果关系。

### 2.4 Orchestration Definition

Definition 描述：

- 有哪些角色；
- 订阅哪些事件；
- 如何分组形成 activation；
- 条件满足后产生哪些事件、向哪个目标 Surface 的唯一 DSH Session 提交 followup，或运行哪个 handler。

Definition 作者目录可以持续修改，但只有固定的 Definition Revision 才能注册和执行。

### 2.5 Registration

Registration 是不可变的执行配置：

```text
Registration
= Definition Revision
+ role -> SurfaceId bindings
+ history boundary
+ capability policy
```

同一个 Orchestration 作者目录可以产生多个 Definition Revision，也可以注册多个不同绑定。必须有独立 `RegistrationId`，不能用可变作者目录代替编排身份。需要模型继续工作的 reaction 只指定目标角色，再从该角色绑定的 Surface 解析唯一 DSH Session；Registration 不保存第二份 Session 绑定，也不创建另一种执行身份。

### 2.6 Activation

Activation 是某条 subscription 在一个确定分组键上的一次满足：

```text
ActivationId
= hash(RegistrationId, SubscriptionId, ActivationKey)
```

同一 Registration、Subscription、ActivationKey 最多形成一个 activation。需要再次运行时，调用方必须使用新的业务键或 generation，而不是依赖时间窗口猜测。

### 2.7 DSH 执行引用

WorkSurface 不定义独立执行对象。模型执行沿用 DSH 的既有层级：

```text
Session
└── Turn
    └── Step
```

- 一个 Surface 唯一对应一个 DSH Session；一个 DSH Session 也只能推进这个 Surface。二者是不同数据对象，但推进关系是一对一。
- Turn 是一次从输入到无待办的推进；WorkSurface 事件使用 `SessionId + Turn` 记录执行来源。
- Step 是一次模型调用及其工具执行；WorkSurface 不重复记录其重试和状态。
- DSH Agent 启动前写入唯一 `binding.json`，并在 Session 日志追加一次标记为 downstream-ignorable 的 `worksurface/binding`，固定 `SurfaceId`、`SessionId`、输入来源、`inputRevision` 与 `expectedHead`。DSH 未装配本插件时可以安全跳过该扩展事件；本插件存在时必须把它与 `binding.json` 逐字段对账。
- 同一 Session 的后续 Turn 自动继续这个 Surface 的持久 worktree，不存在 `open`、选择或切换 Surface。
- 需要并行实验时创建或 fork 新 Surface，并为新 Surface 创建新的 DSH Session；不能给原 Surface 增加第二个 Session。
- publication 成功后，Surface Event Stream 中的 publication 推进 revision 基线；唯一 binding 不改变。

## 3. 文件布局

系统明确区分**作者目录**和**系统状态目录**。

### 3.1 作者目录

```text
<work-root>/
├── surfaces/
│   ├── <surface-id>/
│   │   ├── surface.md
│   │   └── ...
│   └── ...
└── orchestrations/
    ├── <orchestration-id>/
    │   ├── definition.json
    │   ├── handlers/
    │   └── ...
    └── ...
```

WorkSurface 只解释 `surfaces/` 和 `orchestrations/`。仓库根可以存在 README、`.gitignore` 等维护文件，但它们不形成领域对象。

两个集合的直接子目录必须平铺。目录层级、名字相似性和复制来源都不产生依赖。

### 3.2 Surface 目录

```text
surfaces/<surface-id>/
├── surface.md              # 必需
└── ...                     # 代码、材料、证据、交付物
```

`surface.md` 是当前工作的主契约，不是事件日志或状态文件。标准章节为：

```markdown
# Goal

# Acceptance Criteria

# Known Facts and Constraints

# Assumptions

# Open Questions

# Current Decisions

# Deliverables and Evidence
```

规则：

- 七个标题必须存在，内容可以暂时为空。
- 不保存 `surface_id`、`parent`、`status`、Session 或 Agent frontmatter。
- `surface.md` 表达当前形成的工作状态，不追加完整对话流水账。
- 其他文件应通过相对路径被 `surface.md` 引用为材料或证据。
- 首版不引入 Block 实体；需要引用局部内容时，使用 `SurfaceId + RevisionId + relative path`。

### 3.3 Orchestration 作者目录

```text
orchestrations/<orchestration-id>/
├── definition.json         # 必需，唯一入口
├── handlers/               # 可选，Bash/Zsh/Python/Node
└── ...                     # 测试、说明、fixture
```

`definition.json` 只引用同一目录内的相对路径。注册时整个目录被固定为 Definition Revision；之后作者目录继续修改不会影响已有 Registration。

### 3.4 系统状态目录

系统状态必须放在独立的、宿主管理的 `<state-root>`，不能混入作者目录：

```text
<state-root>/
├── revisions/
│   ├── blobs/sha256/<prefix>/<hash>
│   └── manifests/sha256/<prefix>/<hash>.json
├── events/
│   ├── surfaces/<surface-id>.jsonl
│   └── orchestrations/<orchestration-id>/<registration-id>.jsonl
├── surface-sessions/
│   └── <surface-id>/
│       ├── binding.json             # SurfaceId <-> SessionId 唯一绑定
│       ├── work/                    # 该 Surface Session 的持久 cwd
│       └── context.json             # 可重建投影
├── projections/                     # 可删除重建
├── locks/                           # 临时
└── tmp/                             # 可删除
```

分类：

| 路径 | 性质 |
|---|---|
| `revisions/` | 权威内容事实 |
| `events/` | 权威过程事实 |
| `surface-sessions/*/binding.json` | Surface 与 DSH Session 一对一绑定及初始 revision 基线 |
| `surface-sessions/*/work/` | 持久 WIP；不是已发布事实，但用于原 Surface Session 续跑 |
| `surface-sessions/*/context.json` | 可重建模型上下文投影 |
| `projections/` | 可删除 |
| `locks/`、`tmp/` | 可删除 |

这套内部布局是默认文件实现，不进入公开领域协议；以后可替换为其他持久化实现，但必须通过相同不变量。

## 4. Revision 协议

### 4.1 Snapshot

Snapshot 按以下顺序执行：

1. canonicalize 根目录；
2. 拒绝越界路径和符号链接；
3. 校验必需文件；
4. 按相对路径排序；
5. 逐文件计算 SHA-256；
6. 写入缺失 blob；
7. 原子写 manifest；
8. 返回 RevisionId。

Snapshot 是幂等操作。崩溃留下的未引用 Revision 是可回收孤儿，不影响正确性。

### 4.2 Surface Revision 校验

Surface snapshot 前必须验证：

- `surface.md` 存在；
- 七个标准章节存在且顺序合法；
- 不存在被保留的 plugin-owned frontmatter；
- 文件总量、单文件大小和总大小不超过宿主限制；
- 无符号链接及特殊文件。

### 4.3 Definition Revision 校验

Definition snapshot 前必须验证：

- `definition.json` 存在；
- version 可识别；
- role 唯一；
- subscription id 唯一；
- handler 路径位于当前目录；
- handler 使用允许的解释器；
- 所有 emit 目标都是已声明角色；
- `sequence` 不依赖跨 stream 时间戳。

### 4.4 Published Head

Surface 当前 published head 不保存为可变 `head.json`。它由 Surface Event Stream 中最后一个成功 publication fold 得到。

作者目录可以包含尚未发布的修改。它是 checkout，不是 published head。

## 5. Event 模型

### 5.1 Event Envelope

```json
{
  "version": 1,
  "id": "evt_...",
  "subject": {
    "kind": "surface",
    "id": "surface-a"
  },
  "seq": 17,
  "name": "surface.revision.published",
  "payload": {},
  "causes": [
    {
      "subject": "surface:review-a",
      "seq": 9,
      "id": "evt_..."
    }
  ],
  "meta": {
    "sessionId": "session_...",
    "turn": 7,
    "registrationId": "reg_...",
    "activationId": "act_...",
    "operationKey": "advance-target",
    "definitionRevision": "sha256:...",
    "inputRevision": "sha256:...",
    "expectedHead": "sha256:...",
    "outputRevision": "sha256:..."
  },
  "recordedAt": "2026-08-30T12:00:00Z"
}
```

字段按事件场景出现，不要求全部存在。

### 5.2 顺序与因果

- `seq` 只在同一 subject stream 中有序。
- `recordedAt` 只用于审计。
- 跨 Surface 因果必须使用 `causes` EventRef。
- `sequence` 条件只允许：
  - 同一角色、同一 Surface stream 的 `seq` 顺序；或
  - 显式 `causes` 关系。
- 禁止用 wall-clock timestamp、目录修改时间或 UI 到达顺序推断因果。

### 5.3 Append 语义

Event append 必须在 stream 锁内完成：

1. 校验 subject、权限、Session/Turn 或 activation 上下文；
2. 检查 event id 是否已存在；
3. 同 id、同 canonical 内容：返回已有 EventRef；
4. 同 id、不同内容：返回 `already-exists-conflict`；
5. 分配下一 `seq`；
6. 写入并 fsync；
7. 发布 live wakeup。

live wakeup 丢失不影响事实；consumer 必须通过 replay 收敛。

### 5.4 Event Id

- 普通人工事件：随机 UUID/ULID；指定 `--key` 时可稳定派生。
- Orchestration emit：

```text
EventId = hash(RegistrationId, ActivationId, OperationKey, TargetSubject)
```

- Surface publication：

```text
EventId = hash(SessionId, Turn, SurfaceId, OutputRevision)
```

因此 append 后、settlement 前崩溃可以安全重试。

## 6. 核心事件生命周期

### 6.1 Surface 领域事件

WorkSurface 只记录 Surface 内容和业务事实：

| 事件 | 语义 |
|---|---|
| `surface.revision.published` | 指定 Session/Turn 基于固定 expected head 成功发布 output revision |
| `surface.publish.conflicted` | output revision 已保存，但 expected head CAS 失败 |
| 业务事件 | `review.accepted`、`experiment.verified` 等由具体场景定义 |

等待用户、执行失败、取消、模型请求重试和 Agent 空闲属于 DSH Session 的 Turn/Step 生命周期，不再镜像为 Surface 事件。业务验收必须使用场景自己的事件，不能从 Turn 结束或 Revision 发布推断。

### 6.2 DSH 执行事件

`turn/start`、`turn/end`、`step/start`、`step/end`、`assistant/message` 和 `tool/*` 由 DSH Session 持久记录。WorkSurface UI 可以关联读取这些事实，但 WorkSurface Core 不复制 `started`、`returned`、`crashed`、`waiting` 或 `retrying` 状态。

模型需要用户输入时直接在当前 Session 中提问；用户的 `followup` 开启后续 Turn。未闭合 Turn 的修复继续遵循 DSH persistence 合约；WorkSurface Host 只把该合约给出的 `interrupted`、运行时关闭产生的 `aborted/disposed`，以及持久 `next-turn` 解释为 restart 续推依据，不把普通 `completed`、等待用户或空闲解释为待执行状态。模型请求重试仍由 DSH Agent Loop 负责。

### 6.3 Publication 唯一性

同一 Surface Session 的一个 Turn 最多接受一个 publication 结果：`surface.revision.published` 或 `surface.publish.conflicted`。同一 Turn 的重复提交按稳定 EventId 幂等处理。

## 7. 文件与事件提交边界

### 7.1 创建 Surface Session binding

创建 Surface 的 DSH Session 时必须显式选择输入来源，不能由 Service 根据目录是否存在暗中猜测：

| 输入来源 | 语义 | 典型用例 |
|---|---|---|
| `published` | 使用当前 published head | Orchestration 推进已有 Surface；默认模式 |
| `authoring` | snapshot `surfaces/<id>/` | 人或 Agent 已显式编辑作者目录 |
| `revision` | 使用指定且已授权的 RevisionId | 重放、实验分支、确定性派生 |

```text
选择 input source
        ↓
得到 inputRevision
        ↓
读取当前 publishedHead -> expectedHead
        ↓
原子创建 surface-sessions/<surface-id>/binding.json
        ↓
append DSH Session event: worksurface/binding
```

没有 published head 的新 Surface 必须使用 `authoring` 或 `revision`。已有 Surface 默认使用 `published`；想吸收作者目录中的未发布修改时必须显式使用 `authoring`。选择只发生在 Session 创建流程中，不暴露给模型 CLI。

Snapshot 成功、event append 失败时只产生孤儿 Revision，可安全回收。

`binding.json` 与 `worksurface/binding` 必须包含同一份 SurfaceId、SessionId、input source、`inputRevision` 和 `expectedHead`，避免之后从可变目录猜测输入。一个 Surface 目录只能有一个 binding，一个 SessionId 也只能出现在一个 binding 中。

### 7.2 Turn 推进

```text
SurfaceId + its unique SessionId + inputRevision
      ↓ materialize
surface-sessions/<surface-id>/work/
      ↓
Agent 工具 cwd = work/
      ↓
普通 Bash/Zsh/Python/Node 修改文件
      ↓
ws emit surface.revision.published
```

模型永远在当前 Surface Session 专属的持久 worktree 中工作，而不是与作者目录或其他 Surface Session 共享可变目录。该 worktree 是 Session 创建和恢复时的 cwd；所有 Turn 串行复用它。

### 7.3 完成与发布

收到发布意图时，Service 执行：

1. snapshot 当前 Surface Session worktree 得到 `outputRevision`；
2. 锁定目标 Surface stream；
3. 验证当前 Session/Turn 仍有发布权限；
4. fold 当前 published head；
5. 若等于 `expectedHead`，append 包含 `sessionId`、`turn` 和 `outputRevision` 的 `surface.revision.published`；
6. 若不等，append `surface.publish.conflicted`，保留 outputRevision 供重放或人工合并；
7. 解锁；
8. 从 publication 事件更新可重建 context 投影；唯一 binding 不改变；
9. best-effort 刷新作者 checkout。

“published head 改变”和 publication event 是同一个 append 事实，不需要额外可变 head 文件。

### 7.4 作者 checkout 刷新

成功发布后，只在作者目录当前 snapshot 仍等于该 Surface Session 的 `inputRevision` 时，才用 `outputRevision` 原子刷新作者目录。

若作者目录已经发生其他编辑：

- 不覆盖；
- published head 仍然有效；
- UI/管理层提示 checkout 落后；
- 用户可显式 materialize、diff 或合并。

checkout 同步失败不是事实丢失，因为 Revision 与 Event 已持久化。

## 8. Orchestration Definition

### 8.1 最小 Definition

```json
{
  "version": 1,
  "roles": ["reviewA", "reviewB", "target"],
  "subscriptions": [
    {
      "id": "advance-after-two-reviews",
      "history": "all",
      "key": "$.payload.caseId",
      "when": {
        "all": [
          {"role": "reviewA", "event": "review.accepted"},
          {"role": "reviewB", "event": "review.accepted"}
        ]
      },
      "reaction": {
        "followup": [
          {
            "role": "target",
            "operationKey": "advance-target",
            "content": {"caseId": "${activation.key}", "instruction": "Advance the bound Surface from the supplied review evidence."}
          }
        ]
      }
    }
  ]
}
```

### 8.2 历史边界

每条 subscription 必须明确：

- `history: "from-registration"`；或
- `history: "all"`。

不允许由实现默认值暗中决定历史事件是否参与匹配。

### 8.3 Activation Key

- 单事件、一次一触发：可以默认使用 source EventId。
- `all`、`count`、跨角色 join 或需要重复触发：必须显式 `key`。
- 同一 activation key 只运行一次。
- 需要新一轮时，业务事件提供新的 key 或 generation。

这比“时间窗口内自动配对”更可恢复，也避免把不相关历史事件拼在一起。

### 8.4 条件

首版支持：

- single event；
- `all`；
- `any`；
- `count`；
- 同一 stream 或显式因果的 `sequence`。

复杂条件使用 Bash/Zsh/Python/Node handler。handler 和声明式 reaction 只能通过托管 operation 提交领域 Event 或向绑定的 DSH Session 提交幂等 `followup`，不存在自定义执行生命周期。

### 8.5 Handler

Handler 从精确 Definition Revision 的只读 checkout 执行：

- command 仅允许 `bash`、`zsh`、`python3`、`node` 等白名单解释器；
- 代码路径必须位于 revision 内；
- inputs 与 trigger 通过只读 context 提供；
- stdout/stderr 只是日志；
- Surface 事实修改只能使用 `ws emit`；模型推进只能向绑定的 DSH Session 提交 `followup`；
- 在 orchestration context 中，`ws emit` 必须提供稳定 `--key`；
- handler 只能向 Registration 授权的目标角色 emit。

直接调用外部 API、发邮件、扣款等未托管副作用不享受 exactly-once 保证；如果需要恢复保证，外部系统必须接受同一个 idempotency key。

## 9. DSH Agent 环境

### 9.1 Surface Session 环境

Turn 控制组在当前 DSH Turn 内存在：

| 变量 | 含义 |
|---|---|
| `DSH_WORKSURFACE_CLI` | 当前安装的 `ws` 绝对路径 |
| `DSH_WORKSURFACE_SOCKET` | 私有 Host transport 路径 |
| `DSH_WORKSURFACE_CAPABILITY` | 绑定当前 Session/Turn 的短期能力 |

Agent 不需要把 socket 或 capability 拼进命令；CLI 自动读取它们。

只有已经唯一绑定的 Surface Session 才获得以下工作面变量：

| 变量 | 含义 | 高频用例 |
|---|---|---|
| `DSH_SURFACE_ID` | 当前 SurfaceId | 发 ambient event、命名交付物 |
| `DSH_SURFACE_DIR` | 当前持久 worktree 绝对路径 | 脚本在切换目录后仍能返回工作根 |
| `DSH_CONTEXT_FILE` | 只读结构化上下文文件 | 读取 trigger、inputs、revision、能力与授权路径 |

Surface Session 创建时已经以 `DSH_SURFACE_DIR` 为 cwd。Agent 可以直接使用相对路径；脚本切换目录后也可显式返回：

```text
cd "$DSH_SURFACE_DIR"
```

event、revision、能力范围等结构化内容不继续拆分为环境变量，统一读取 `DSH_CONTEXT_FILE`。

### 9.2 context.json

```json
{
  "version": 1,
  "execution": {
    "sessionId": "session_..."
  },
  "surface": {
    "id": "surface-target",
    "inputSource": "published",
    "inputRevision": "sha256:...",
    "expectedHead": "sha256:..."
  },
  "capabilities": {
    "emit": ["surface.revision.published", "*"],
    "targetSurfaces": ["surface-target"],
    "createSurface": true
  }
}
```

字段按场景出现：

- `outputRevision` 只在成功 publication 后出现。
- 当前版本不把作者根、其他 Surface 或 credential 放入 context；`createSurface: true` 只允许通过 Host RPC 提交结构化作者契约，不暴露公共根路径。

context 中不包含 credential、Provider Key、Cookie 或未经认证的用户身份。`sessionId` 是当前 Surface 的唯一 DSH 执行身份，不能由模型覆盖；Turn 由短期 capability 和 DSH Session Event Log 表达，不写入这个可恢复静态投影。

### 9.3 Turn 作用域能力

每个活动 Turn 获得一个不进入 Surface 领域事件的短期 capability，同时绑定唯一 `SurfaceId + SessionId + Turn`。不存在后续 `ws open`。CLI 自动使用它；Turn 关闭、取消或被中断后，旧后台进程的 emit 必须被拒绝。

恢复后由 DSH 开启新的 Turn 并发放新 capability，不创建额外执行身份。Surface Event 记录 Session/Turn 来源即可。

## 10. CLI 与脚本

### 10.1 模型侧规划与事件命令

```text
ws surface create <surface-id> --contract-file <surface.md>

ws orchestrate register <orchestration-id>
  --definition-file <definition.json>
  (--bindings <json> | --bindings-file <path>)
  --registration <registration-id>

ws emit <event-name>
  [--surface <surface-id>]
  [--key <operation-key>]
  [--payload <json> | --payload-file <path>]
```

规则：

- 缺省 subject 为 `DSH_SURFACE_ID`。
- publication 自动绑定当前 DSH Session/Turn。
- orchestration handler 必须使用 `--key`。
- Surface Session 内不存在 open 命令；输入来源由创建该 Session 的宿主在首个 Turn 前固定。
- 活动 Turn 可以提交新 Surface 的标准契约和精确 Definition；Host 验证 capability、ID、模板与 Definition，再原子写入作者根。
- Agent 必须先 register Definition，再 emit 无依赖入口的稳定根事实；有依赖目标只能由条件匹配后的托管 reaction 推进。
- Surface Session 内事件目标由 capability 固定，不能用显式 `--surface` 切换；`--surface` 只供 Session 外的管理调用。
- CLI 只做编码、认证 transport、输出结果和退出码。
- CLI 不直接读取 revision store、匹配 Definition 或启动 Agent。

### 10.2 Agent 规划、拆分与启动

Agent 先在当前 Surface worktree 中写新 Surface 契约和 Definition 草稿，再提交给 Host：

```bash
ws surface create review-a --contract-file plan/review-a.surface.md
ws surface create review-b --contract-file plan/review-b.surface.md
ws surface create delivery --contract-file plan/delivery.surface.md

ws orchestrate register proposal-review \
  --definition-file plan/proposal-review.definition.json \
  --bindings '{"planner":"root","reviewA":"review-a","reviewB":"review-b","delivery":"delivery"}' \
  --registration proposal-review-v1

ws emit plan.started --key proposal-review-v1 --payload '{"planId":"proposal-review-v1"}'
```

Definition 中由 `plan.started` 直接 followup 无依赖的 review Surface；delivery 订阅两个 review 的业务完成事实并使用 `all` 条件，因此在依赖满足前不会启动。managed followup 先通过 Surface admission 创建或恢复目标的唯一 Session，再 enqueue 稳定 MessageId，flush Session 得到 durable receipt 后才结算 operation。

复杂能力来自 Agent 对文件契约、精确 Definition 和事件事实的组合，不来自目录层级、通用 parent-child 边或另一套任务状态机。

## 11. DSH Session 与恢复算法

### 11.1 调度

用户消息或 Orchestration 托管 operation 先定位目标 Surface。managed followup 通过 admission 创建未绑定目标或恢复冷 Session，再从该 Surface 的唯一 binding 解析 DSH Session，并通过稳定 MessageId 的 `agent.followup()` 唤醒它；Session flush 证明 durable receipt 后 operation 才能 settled。Registration 不另存 role-to-Session 映射。DSH Agent Loop 负责 inbox、Turn、Step、模型请求、工具调用、取消和空闲收敛；WorkSurface 不再根据自己的 lifecycle projection 启动模型执行。

没有可用 DSH Session/Agent 时，Orchestration operation 保持未结算，不写伪成功事件。

### 11.2 创建 Surface Session

人类产品入口是 WorkSurface 原生 `conversation.view` 中的“进入推进”。它把选中的 Surface 交给 Host admission：未绑定时创建一个空白真实 DSH Session，已有 binding 时打开 live Session 或通过 DSH persistence 恢复原 Session。浏览器不生成 SessionId、不写 binding，也不提交首条用户消息；进入完成后由 DSH 原生 Session 导航与 composer 承接对话。

未绑定且存在作者目录时，产品默认从 `authoring` 建立输入 Revision；只有事件支持且没有作者目录的 Surface 从 `published` head 建立。精确 Revision 输入仍属于显式 Host/自动化调用，不成为普通用户必须理解的 UI 参数。进入已有 Surface 时永远沿用 binding 中已经固定的输入来源。

1. 宿主创建或 fork Surface 作者内容；
2. Host admission 解析输入来源：普通作者 Surface 使用 `authoring`，无作者目录的事件 Surface 使用 `published`，显式自动化可以给出精确 Revision；
3. 为该 Surface 分配唯一 SessionId，检查 SurfaceId 与 SessionId 均未绑定；
4. 原子创建 `surface-sessions/<surface-id>/binding.json`；
5. 创建并 materialize `surface-sessions/<surface-id>/work`，以它作为 DSH Session cwd；
6. 在 Session 日志追加唯一 `worksurface/binding`；
7. 原子生成 context.json；
8. unpublished setup 成功后发布空白 DSH Agent；此时尚无 `turn/start`，UI 等 Session 出现在 DSH 列表后直接导航到它；
9. 用户通过原生 composer 提交消息后才开启首个 Turn，获得绑定 `SurfaceId + SessionId + Turn` 的 capability；模型直接在该 cwd 中推进，不执行 open 或选择操作。

### 11.3 Host 崩溃恢复

Host 重启后：

1. 由 DSH persistence 恢复原 Session 日志；
2. 由 DSH 修复未闭合的工具、Step 和 Turn 边界；
3. replay Surface 与 Registration streams；
4. 从 `binding.json`、Session binding 事件和 publication 事件恢复该 Surface 的 inputRevision 与 expectedHead；
5. 若持久 worktree 存在，原样保留；
6. 若 worktree 丢失，从 inputRevision 重新 materialize，并在 Session 日志记录 infrastructure rebuild；
7. 撤销已关闭或中断 Turn 的 capability；
8. 检查每个绑定 Session 的持久 inbox 与最后 Turn：若存在 `interrupted`、`aborted/disposed` 或尚未开启 Turn 的持久 `next-turn`，恢复同一个 Agent/Session，并用一条明确的插件来源恢复输入自动开启续推 Turn；已完成、普通空闲和等待用户回答的 Session 保持休眠；
9. 其余新的 Turn 由用户 followup 或 Orchestration 托管 operation 开启。

同一 SurfaceId、SessionId 和 worktree 保持不变。自动续推先要求 Agent 对照 durable history 与 worktree 核对未知结果，不盲目重放可能产生副作用的旧 Step。恢复输入是 `source.kind=plugin` 的 DSH inbox 消息，不是人类命令，也不写第二份 WorkSurface 执行状态。

### 11.4 Turn 结束但没有发布

Turn 结束只说明 DSH Agent 当前没有待办，不表示 Surface 已完成或已发布。WorkSurface 不写伪造的完成或协议违规状态；UI 显示该 Turn 的真实结束原因，并继续展示 Surface 当前 published head。

### 11.5 等待用户输入

模型直接在 DSH Session 中提问，Assistant 消息应包含：

- 问题；
- 期望输入格式；
- 是否阻塞；
- 可选截止信息。

用户通过 `followup` 回复后，DSH 开启新的 Turn，并继续该 Surface Session 的同一 worktree。WorkSurface 不复制一组 input-request/input-provided 事件。

### 11.6 Orchestration 恢复

每个 Registration stream 持久记录：

- registered；
- matched EventRefs；
- activation opened；
- operation recorded；
- target EventRef settled；
- paused/retired。

恢复时重新 fold 条件并对账：

- 目标 event 已 append、settlement 未写：按稳定 event id 找到目标，再补 settlement；
- 目标 event 未 append：用同 id 重发；
- 同 id 不同内容：停止并报告冲突。

## 12. 并发与冲突

### 12.1 Surface Session 隔离

每个 Surface 只有一个 Session 和一个 worktree，因此：

- 同一 Surface 不存在多个 Session 之间的并发推进；
- 并行实验必须先创建或 fork 不同 Surface，各自拥有 DSH Session；
- 不同 Surface 的文件不会在运行中互相混合；
- publication CAS 仍作为防御性检查，防止损坏数据或外部陈旧写入覆盖 published head。

### 12.2 CAS

成功发布条件：

```text
currentPublishedHead == surfaceSessionContext.expectedHead
```

不允许：

- last-write-wins；
- 自动把两个 Surface worktree 混合；
- 根据作者目录当前内容偷偷 rebase；
- 因时间较晚而覆盖较早结果。

合并必须在目标 Surface 自己的一个显式 DSH Turn 中完成。

## 13. 权限与隔离

- Agent 默认只写自己的 `DSH_SURFACE_DIR`。
- inputs 是固定 Revision 的只读 materialization。
- 作者 root、Orchestration root 和模板路径只在 capability 允许时进入 context。
- 所有路径在注入前 canonicalize，并验证仍在授权根内。
- 运行时拒绝符号链接逃逸。
- `ws emit` 由 Session/Turn/Surface 或 activation capability 约束，不相信模型提供的 session、turn 或 registration 字段。
- handler 代码来自精确 Definition Revision，而不是可变作者目录。
- credential 不进入模型可读环境或 context。

## 14. 投影与 UI

下列内容全部是 replay projection：

- 当前 published head；
- 关联 DSH Turn 的 running/idle/end reason；
- Surface publication 的 published/conflicted；
- planned path；
- matched source；
- managed emit；
- topology；
- Web snapshot。

删除后必须可以从 DSH Session Event Log、Revision、Surface/Registration Event Stream 重建。

UI 不定义 Relation，不写状态文件，不在浏览器维护第二套执行状态。用户操作若要改变系统，只能通过同一个 Event Service 产生事件。

## 15. 垃圾回收

GC 采用 mark-and-sweep：

### 保留根

- 所有 Event 引用的 Revision；
- 所有 Registration 引用的 Definition Revision；
- 所有可恢复 DSH Session 引用的 input/output/WIP；
- 所有有效 `surface-sessions/*/binding.json` 对应的 worktree；
- 人工 pin 的 Revision。

### 可回收

- snapshot 成功但 Event 未引用的孤儿 Revision；
- 超过 retention 的临时 materialization；
- projections、locks、tmp；
- 已确认无引用的 blob。

Event Stream 默认不删除；压缩或归档不能改变 replay 结果。

## 16. 不变量体系

设计约束不能只写在文档中。仓库必须维护一个机器可读注册表：

```text
spec/
├── surface-template.md
├── event.schema.json
├── definition.schema.json
├── binding.schema.json
├── context.schema.json
└── invariants.json
```

`invariants.json` 每条记录至少包含：

```json
{
  "id": "WS-R08",
  "statement": "Host 重启后原 DSH Session 从持久 worktree 或 input revision 恢复",
  "enforcedAt": ["session-resume", "recovery"],
  "tests": ["acceptance/resume-session.sh"]
}
```

规则：

- 每条核心不变量必须指向至少一个 enforcement point；
- 每条核心不变量必须指向至少一个可执行测试；
- 新增核心字段或事件必须同时更新 schema、fold、恢复测试；
- 没有 enforcement/test 的“原则”不能声称已实现。

## 17. 核心不变量

### 身份与内容

- `WS-01` Surface 与推进它的 DSH Session 一对一绑定；OrchestrationId 与 RegistrationId 仍是独立身份。
- `WS-02` Surface 内容事实只有不可变 Revision；作者目录和 worktree 不是 published fact。
- `WS-03` 每个 Surface Revision 包含合法 `surface.md`。
- `WS-04` 每个 Definition Revision 包含合法 `definition.json`。

### 事件与因果

- `WS-05` Event Stream append-only；同 id 同内容幂等，同 id 异内容冲突。
- `WS-06` `seq` 只在单 stream 有序；跨 stream 因果必须显式引用 EventRef。
- `WS-07` 时间戳、目录层级和 UI edge 不产生依赖。
- `WS-08` live wakeup 的丢失、重复、乱序不改变 replay 结果。

### Session、Turn 与发布

- `WS-09` 首个 Turn 前的 `binding.json` 与 `worksurface/binding` 固定 SurfaceId、SessionId、inputRevision 和 expectedHead。
- `WS-10` 每个 Surface Session 独占一个以 SurfaceId 定位的持久 worktree。
- `WS-11` 同一 Surface Session 的一个 Turn 最多一个 publication 结果。
- `WS-12` publication 必须 CAS；冲突不得覆盖或混合。
- `WS-13` 恢复复用原 DSH Session，并由其日志修复 Turn/Step 边界；Host 只自动续推 `interrupted`、`aborted/disposed` 或持久 `next-turn`，不唤醒已完成、普通空闲或等待用户回答的 Session；WorkSurface 不复制 transcript。
- `WS-14` 已关闭、取消或中断 Turn 的 capability 不能发出有效事件。

### 编排

- `WS-15` Registration 固定 Definition Revision、角色绑定和历史边界。
- `WS-16` Activation 由 Registration、Subscription 和业务 key 确定。
- `WS-17` 同一 activation/operation key 最多产生一个目标 Event。
- `WS-18` 声明式 reaction 与代码 handler 使用同一 Event API。
- `WS-19` handler 只能向声明且授权的目标 emit。

### 边界

- `WS-20` 模型侧只有 `ws emit` 作为领域修改命令；文件内容由通用脚本操作。
- `WS-21` Agent 默认只写自己的 worktree，只读授权 inputs。
- `WS-22` UI 和 projection 可删除，不是事实源。
- `WS-23` Core 不建立 Agent ownership、Task Tree、canonical Relation 或通用业务成功状态。

## 18. 执行门禁

仓库只需要一个统一入口：

```bash
python3 scripts/check.py
```

它必须依次执行：

1. schema 与 fixture 校验；
2. surface template 单一来源校验；
3. 目录和 import 边界静态检查；
4. Core fold / idempotency 单元测试；
5. Revision snapshot/materialize 测试；
6. Surface Session binding、context 与权限测试；
7. crash injection / restart 测试；
8. Orchestration replay 测试；
9. CLI 仅 transport 的依赖检查；
10. Web projection 重建测试。

静态依赖边界：

```text
core             不依赖 DSH、CLI、Web
revision-store   不依赖 Agent、Web
orchestrator     只依赖 core event/revision contract
session-adapter  依赖 core service，不反向进入 core
cli              只依赖 protocol/client
web              只依赖 read projection + event client
```

## 19. 必须通过的恢复验收

1. snapshot 后、binding 写入前崩溃：只留下可回收孤儿 Revision。
2. binding 写入后、Session event 或 worktree materialize 前崩溃：按同一 binding 修复原 Session 并从固定 inputRevision 重建。
3. worktree 创建一半崩溃：删除临时目录后从 inputRevision 重建。
4. Agent 修改文件后 Host 崩溃：恢复原 Session 并继续同一 worktree。
5. 已中断 Turn 的旧后台进程仍存在：其 emit 被拒绝。
6. output snapshot 后、publication append 前崩溃：重试得到同一 RevisionId。
7. publication append 后、作者 checkout 刷新前崩溃：重放仍得到正确 head，checkout 可修复。
8. target event append 后、operation settlement 前崩溃：恢复对账，不重复目标 event。
9. live wakeup 丢失、重复、乱序：最终 activation 和目标事件一致。
10. 相同 event id、不同 payload：明确冲突。
11. 第二个 Session 绑定同一 Surface、同一 Session 绑定第二个 Surface：均明确拒绝；并行实验只能使用不同 Surface。
12. 删除 projections 和 context.json：从事实重建等价结果。
13. Host 重启：恢复原 DSH Session，修复未闭合 Turn/Step，保留该 Surface Session worktree，并自动续推被 restart 中断或已有持久 `next-turn` 的工作；完成、空闲和等待用户输入的 Session 不被误唤醒。
14. 无可用 Agent：Orchestration operation 保持未结算。
15. Turn 正常结束但未发布：不伪造 publication 或业务完成。
16. `all` 与 `any` 即使平面边相同，replay 后仍保持不同条件语义。
17. cross-stream `sequence` 未声明因果：Definition 注册失败。
18. handler 未提供 operation key 或向未授权 role emit：拒绝。

## 20. 从旧方案迁移的取舍

### 保留

- Surface 与 Orchestration 作者目录分开并平铺。
- 每个 Surface 必须有 `surface.md`。
- 目录承载工作内容，事件承载推进事实，Revision 连接二者。
- Definition revision、角色绑定、匹配事件和 activation 才能解释依赖。
- 没有可用 DSH Agent 时，托管 operation 保持未结算。
- 普通脚本负责文件操作，CLI 只负责 emit。
- UI 只消费投影。

### 修正

1. **“事件日志是唯一事实源”改为双事实源**：Revision 是内容事实，Event Stream 是过程事实。
2. **模型不直接共用作者目录**：每个 Surface Session 使用专属持久 worktree，否则崩溃和作者编辑无法可靠隔离。
3. **Surface 在 Agent 启动前绑定 Session**：环境与 `DSH_CONTEXT_FILE` 从首个 Turn 起就固定，不存在模型侧 open 或切换。
4. **作者根目录不默认暴露给 Agent**：只在明确 capability 下提供，避免任意读写其他 Surface。
5. **Orchestration 增加必需 `definition.json` 与 RegistrationId**：否则无法稳定发现入口，也无法区分同 revision 的不同绑定。
6. **历史边界与 activation key 必须显式**：避免历史事件是否参与、多个事件如何配对依赖隐藏默认值。
7. **`sequence` 不使用跨 Surface 时间戳**：只允许单 stream seq 或显式因果。
8. **`dispatched/delivered` 降为 adapter 诊断**：不作为核心业务生命周期。
9. **补齐内部文件持久化布局和 crash protocol**：否则“可恢复”只有原则，没有可执行边界。
10. **不变量改为机器可读 registry + enforcement + test**：文档本身不能阻止架构决策被违反。

## 21. 最终边界

首版 WorkSurface 的完整核心可以压缩为六句话：

1. Surface 是稳定工作身份，目录只是可编辑 checkout。
2. Revision 保存不可变内容，Event Stream 保存已经发生的过程。
3. 每个 Surface 的推进就是它唯一 DSH Session 的 Turn/Step；Session 创建时固定 input revision 和持久 cwd，并通过 CAS 发布 output revision。
4. Orchestration 只由精确 Definition Revision、角色绑定、显式历史边界、activation key 和 EventRefs 解释。
5. 模型用普通脚本处理文件，只用一个 `ws emit` 改变领域事实。
6. 所有状态都能从文件与事件恢复，所有核心约束都有 admission、Session 或 replay enforcement，并由可执行验收证明。
