# WorkSurface 完整系统设计

> 状态：权威目标设计，基线日期 2026-08-31。本文定义 WorkSurface 的精确语义；[可交互系统设计图](interactive/worksurface-system.html)维护概念、边界和关系索引，其可审查源是 [`worksurface-system.workflow.json`](interactive/worksurface-system.workflow.json)。当前实现差异见[实现索引](architecture.md)，展示规范见 [UI 设计](ui-design.md)。

## 0. 定位

WorkSurface 是构建在 DSH 之上的工作上下文推进层。

它管理多个可寻址且持续维护的工作上下文，根据已经发生的事件计算它们何时推进、如何推进、影响谁，以及向目标提供什么上下文；真正的模型调用、工具执行和对话历史继续由 DSH 负责。

领域主轴只有两个概念：

1. **Surface**：可寻址、持续维护，并可以被推进的结构化工作上下文。
2. **Episode**：一个 Surface 上一次有边界的推进；一个 Surface 拥有一系列有序 Episode。

Event 是推进中产生或观察到的事实表达，Orchestrate 是依赖 Event 的推进策略，WorkSurface Runtime（本文暂用名）是落实推进决策的控制器。它们围绕 Surface / Episode 工作，不再与领域对象并列。这里的 Runtime 不是 DSH 术语，也不假设 DSH 存在一个同名抽象。Surface Address、Revision、Context Snapshot、EventRef、Binding、Activation 和 Operation 是支撑定位、固定、重放、幂等与恢复的协议概念。

核心关系不再维护第二份静态图，统一进入[可交互系统设计图](interactive/worksurface-system.html)。图提供五个审查视图：主模型、Episode 内容、Orchestrate 编译边界、事件驱动推进、执行承载边界。

图与本文共同构成设计：图负责“有哪些概念、边界和关系”，本文负责“这些关系的精确定义、不变量和例外”。新增或修改一级概念、边界、关键关系时，必须在同一变更中同步 JSON 图规格、生成的 HTML 和本文；任一处漂移都表示设计变更未完成。

## 1. 边界

### 1.1 WorkSurface 负责

- Surface 的稳定身份与工作上下文边界；
- WorkSurface Event 的语义、持久化和因果引用；
- 对 DSH 原生事件的稳定引用，不复制其事实；
- Orchestrate Definition、Instance、条件计算和 Effect 生成；
- WorkSurface 推进控制：接收事件、形成推进决策、打开或继续 Episode，并通过执行适配器落实；
- Effect 的记录、幂等执行、结算、恢复和重新对账；
- Surface 到 DSH 执行身份的显式映射；
- Context Projection、环境入口和授权范围；
- 从事实重放出的拓扑、状态与 UI 投影。

### 1.2 WorkSurface 不负责

- 规定 Surface 必须包含哪些内容或章节；
- 把目录、`surface.md` 或 prompt 当作 Surface 本体；
- 复制 DSH Session 日志、transcript 或执行生命周期；
- 重新定义 Session、Turn、Step、Tool Call；
- 重新发明 Bash、Zsh、Python、Node、文件编辑或 block-to-file；
- 从 Turn 结束、工具成功或 Revision 发布推断业务完成；
- 建立 Task Tree、Agent Ownership、canonical Relation 或可变全局 Status；
- 让 UI、缓存、作者目录或模型 KV cache 成为第二事实源。

### 1.3 与相邻系统的边界

| 系统 | 拥有的语义 | WorkSurface 的关系 |
| --- | --- | --- |
| DSH Session | Agent 的完整持久交互历史 | 引用，不复制 |
| DSH Agent Loop | Turn、Step、模型调用、工具执行、取消与收敛 | 通过 followup / inject 等原生入口驱动 |
| Shell / Python / Node | 通用内容处理与复杂能力组合 | 直接复用 |
| block-to-file | 模型消息到文件事务的写入协议 | 可作为 Surface Materialization 的写入适配器 |
| Web / `conversation.view` | 用户交互与可删除投影 | 只读事实与语义，通过 WorkSurface 推进控制入口提交动作 |

## 2. 领域模型与推进机制

### 2.1 Surface

Surface 是由 `SurfaceId` 标识的、可寻址且持续维护的结构化工作上下文。

“工作上下文”不是单指模型 prompt。它是推进某项工作所依赖的逻辑边界，具体内容由问题决定，可以包括：

- 文件和目录；
- DSH 对话历史；
- WorkSurface 或业务事件；
- 外部材料和版本化引用；
- 已知事实、约束、决策和开放问题；
- 其他 Surface 的结果；
- WorkSurface 推进控制层授予的能力和目标范围。

Surface 不是：

- Agent；
- DSH Session；
- 一次 Turn 或 Step；
- 文件目录；
- prompt；
- 任务树节点；
- 某个 Agent 的所有物。

Surface 的身份稳定，内容和可见投影可以演进。它可以在没有文件目录时存在，也可以同时拥有文件、事件和外部引用等多种 Materialization。

Surface 必须同时满足两个内容性质：

1. **可寻址**：内容具有结构，可以稳定定位到局部，而不只能把整个 Surface 当成一段不透明文本。最小逻辑地址为：

   ```text
   SurfaceAddress = SurfaceId + adapter + locator [+ boundary]
   ```

   `locator` 由 Materialization adapter 定义，例如文件路径与 fragment、结构化对象 selector、事件范围或外部 artifact 内部地址。需要重放、引用或跨 Surface 传递时必须携带 `boundary`，例如 Revision、EventRef、Session event boundary 或外部版本。通用协议不要求一种固定目录结构，也不为此强制引入 Block 实体。

2. **持续维护**：Surface 内容是推进过程中跨 Turn、跨 Step 延续的工作表示，不是一次模型调用后丢弃的临时 prompt。获授权的模型通过普通工具读取和修改其可维护 Materialization，后续 Context Projection 必须能够看到已提交或当前允许的最新内容。

“模型可见”表示内容可通过地址被 Context Projection 选择，并不表示每次模型调用都注入整个 Surface。每个 Step 只接收当前问题需要的 `included` 与 `required` 局部；未进入该 Step 的内容记录为 `omitted`，但仍属于可寻址、可继续维护的 Surface。

### 2.2 Episode

Episode 是一个 Surface 上一次有边界的推进。一个 Surface 按稳定顺序关联零到多个 Episode；Episode 结束后仍然是同一个 Surface，只是其可见内容和事实已经演进。

Episode 至少包含或稳定引用：

- 所属 `SurfaceId` 与稳定 `EpisodeId`；
- 本次推进的开始、结束和因果输入边界；
- 实际发生的模型步骤与工具调用；
- 对 Surface Materialization 的修改；
- 产生的结果、事件与验证证据；
- 用于恢复和审计的 DSH EventRef 或其他权威来源引用。

“包含”不表示复制 DSH transcript 或工具日志。DSH 事实继续保存在 Session Log，Episode 通过稳定边界和 EventRef 组织本次推进涉及的事实。

Episode 不预设等同于一个 DSH Turn 或 Step：一次 Episode 可以跨多个 Turn，也可以只使用一个 Turn 的部分 Step。精确开闭条件属于后续协议设计，在确定前不得通过 `turn/end`、`step/end` 或工具成功隐式推断 Episode 完成。

Episode 推进过程中可以产生任意获授权的自定义 Event，例如调研推进可以产生 `research.completed`。这类 Event 是本次 Episode 的输出事实之一，但不要求等到 Episode 沉淀后才发出；Orchestrate 可以在事件被可靠接纳后据此控制其他 Surface 或后续 Episode 的推进。

### 2.3 Event

Event 是已经发生的事实。它至少具有稳定身份、类型、来源、载荷和可验证的因果引用。

WorkSurface 使用统一事件语义，但不要求所有事件进入同一个物理日志：

- DSH 执行事实继续保存在 DSH Session Event Log；
- Surface、Orchestrate 和业务事实保存在 WorkSurface Event Stream；
- Orchestrate 通过统一 `EventRef` 引用二者；
- WorkSurface 推进控制层不把 `tool/result`、`turn/end` 等 DSH 事件复制成同义 WorkSurface 事件。

事件分为四类：

| 类型 | 示例 | 权威来源 |
| --- | --- | --- |
| DSH 执行事件 | `turn/end`、`step/end`、`tool/result` | DSH Session Event Log |
| Surface 标准事件 | `surface.created`、`surface.context.published`、`surface.completed` | Surface Event Stream |
| Orchestrate 内部事件 | activation opened、operation recorded/settled | Orchestrate Instance Stream |
| 业务事件 | `review.accepted`、`experiment.verified` | 相关 Surface Event Stream |

事件类型可以由 Profile、Orchestrate Definition 或应用定义。可复用事件应声明名称、载荷 schema、语义和允许的生产者；开放业务事件仍必须使用无损 JSON envelope。例如 `research.completed` 的 payload 可以直接携带调研结论，也可以携带报告文件或其他内容的引用。

`payload` 是 JSON，可以按需混合两种信息形态：

- **inline value**：较小、完整、适合直接匹配或消费的原文、结构化结论、标识和数值；
- **content ref**：较大、需要局部寻址、需要复用或已有权威存储的内容引用，例如文件、Surface 局部、DSH 事件范围、blob 或外部 artifact。

逻辑 content ref 至少要能解析到 `adapter + locator [+ boundary]`，并在需要时带上所属 Surface 或来源身份。用于 Orchestrate 重放、跨 Surface 传递或作为验收证据的 ref 必须固定 `boundary`；没有 boundary 的 working ref 只能表示“读取当前内容”，不能伪装成事件发生时的不可变证据。Event Stream 只保存 payload 与引用，不为了方便消费而复制已经有权威来源的大段内容。

以下等式禁止成立：

```text
turn/end                 != surface.completed
step/end                 != work accepted
tool/result success      != business success
context snapshot created != surface.completed
```

`surface.completed` 是显式语义事实，只能由获授权的模型、用户、验收规则或 Orchestrate 产生。它本身不强制 Surface 永久封存；是否允许再次推进由具体 Orchestrate 或 Surface Profile 决定。

### 2.4 Orchestrate

Orchestrate 是依赖 Event 的 Surface 推进策略，回答四个问题：

```text
when    何时推进
how     如何推进
who     影响哪些 Surface
context 向目标提供什么上下文
```

Orchestrate 明确分为一个作者层和两个运行概念：

1. **Orchestrate Source**：供人和模型维护的 YAML 或 Code；它是作者源码，不是推进控制层的输入；
2. **Orchestrate Definition**：Source 经 compile / adapt 得到的规范化、不可变运行 IR；
3. **Orchestrate Instance**：Definition 与实际 Surface 角色绑定后的运行装配。

Definition 使用角色而不是固定 SurfaceId，并固定 Event inputs、历史要求、activation key 规则、evaluator contract、允许产生的 Effect 类型与 capability requirements。Instance 只固定：

- 精确 Definition 版本；
- `role -> SurfaceId` bindings；
- 历史边界；
- 允许读取和影响的目标范围；
- 必要的执行策略。

`Registration` 是当前文件实现对 Orchestrate Instance 固定记录的内部名称，不是一级产品概念。

Orchestrate Source 可以使用两种作者形式：

- **YAML**：表达 single、all、any、count、sequence、fan-out、fan-in 等常见 pattern；
- **Code**：使用 Bash、Zsh、Python 或 Node 表达复杂选择、计算和上下文构造。

两种形式必须经过同一个显式实现边界：

```text
YAML Source ──compile──┐
                      ├──> immutable Definition IR
Code Source ───adapt──┘              │
                                     ├── + Instance bindings
                                     ├── + Event[]
                                     ▼
                              evaluator contract
                                     │
                                     ▼
                                  Effect[]
```

Definition 是唯一运行定义。推进控制层不得读取 YAML、作者目录或 Code 源文件来临时解释规则；它只读取固定的 DefinitionRef。SourceRef、compiler/adapter id 与版本、输入内容摘要必须作为 provenance 固定，使 Definition 可以重建和审计，但 provenance 不改变运行语义。

YAML 编译为规范化条件和 Effect plan。复杂 Code 不能绕过 Definition：Definition 中只保存内容寻址的 evaluator artifact ref、固定入口和输入/输出 contract；受控 evaluator 读取 `Definition + Instance + Event[]` 的冻结投影，并且只能返回标准 `Effect[]`。Code 不能直接改写推进控制层私有状态、Instance 或 Surface；不能使用私有进程状态形成第二套历史。相同 Definition、Instance、Event inputs 和 evaluator 版本必须得到相同 Effect 结果。

当前 `definition.json` 同时充当作者文件、持久 Definition 和 Engine IR，这是旧实现的混层，不是目标设计。目标实现中，JSON 最多是 Definition IR 的一种规范序列化或兼容 Source；文件名不定义边界。

### 2.5 WorkSurface Runtime（暂用名）

WorkSurface Runtime 只指 **Surface / Episode 的推进控制器**。它接收已经可靠接纳的 Event，计算 Orchestrate，并把标准推进决策落实到目标 Surface。这个名称描述 WorkSurface 内部职责，不定义 DSH 的架构；实现上可以由多个组件共同完成，也不要求存在一个名为 Runtime 的单体进程或类。

WorkSurface Runtime 负责：

- 接纳或观察获授权的 Event，并解析稳定 EventRef；
- 装载固定的 Orchestrate Definition / Instance，匹配 Event inputs；不得读取 Orchestrate Source；
- 派生 Activation 与标准 Effect，决定何时、如何、影响谁以及提供什么上下文；
- 打开、继续或沉淀 Episode 所需的控制记录；
- 对 Effect 做 durable record、dispatch、settlement 和 reconciliation；
- 解析 Surface 与当前执行承载的 Binding；
- 通过执行 adapter 把 `advance` 映射到 DSH 原生 `agent.followup()` 等入口；
- 构建 Context Projection、稳定环境入口和 capability；
- 处理并发、CAS、崩溃恢复、权限检查和 Orchestrate 内部事件。

WorkSurface Runtime 不负责：

- 取代 DSH Agent Loop 执行模型调用或工具调用；
- 假设或重新定义一个 DSH Runtime 概念；
- 判断自然语言任务是否语义完成；
- 生成已有 DSH 事件的同义副本；
- 直接充当 Surface 内容编辑工具；
- 实现通用文件和编程工具；
- 维护另一套 Agent 状态机。

## 3. 支撑协议概念

### 3.1 Surface Materialization

Materialization 是 Surface 在某种介质中的可访问表现，不是 Surface 本体。

首个实现提供文件适配器：

```text
<work-root>/surfaces/<surface-id>/
```

该目录是可变 WIP。它可以包含任意与问题相关的文件，不要求固定章节，也不要求必须存在 `surface.md`。Profile 可以选择提供 `surface.md` 模板、schema 或其他约束，但这些约束属于 Profile，不进入通用 Surface 定义。

`orchestrations/<id>/` 是 Orchestrate Source 的一种作者 Materialization，可以包含 YAML、代码、测试、fixture 和说明。compile / adapt 的输出进入内容寻址的 Definition store；Instance 只引用 DefinitionRef，不把作者目录当运行输入。当前实现使用 `definition.json` 与 `registration.json`，并让 `definition.json` 同时承担 Source、Definition 和 IR；这是待拆分的兼容实现，物理文件名不进入一级领域语义。

### 3.2 Context Projection

Context Projection 是 WorkSurface 推进控制层从一个或多个 Surface Materialization、EventRef、DSH 对话和 provider 输出中选择并固定的模型可见视图。

它必须记录：

- 来源 Surface 与版本化引用；
- included items；
- resolved-but-omitted items；
- required items；
- 选择策略与预算；
- 最终内容哈希或 render manifest。

`omitted` 不能描述为模型已经消费。required 输入超过预算时必须明确失败，不能静默截断。

Context Projection 不复制 DSH transcript。DSH `session.surface` 继续拥有模型消息历史；WorkSurface 只提供额外上下文计划和版本化材料。

### 3.3 Context Snapshot 与 Revision

Context Snapshot 是为重放固定的一组上下文输入。不同 Materialization 可以使用不同版本机制：

- 文件适配器使用内容寻址的不可变 Revision；
- DSH 对话使用 Session event boundary；
- 外部 provider 使用自身版本、摘要或稳定引用；
- WorkSurface Event 使用 EventRef。

因此 Revision 是文件型 Materialization 的快照实现，不再等同于全部 Surface 内容事实。

文件 Revision 仍应满足：

- canonical manifest；
- 内容寻址；
- 原子 snapshot 与 materialize；
- 拒绝越界路径、符号链接和特殊文件；
- snapshot 幂等；
- 未引用对象可以安全回收。

### 3.4 EventRef

EventRef 是对事件事实的稳定引用。它至少区分事件来源：

```text
worksurface:surface:<surface-id>:<seq>
worksurface:orchestrate:<instance-id>:<seq>
dsh:<session-id>:<event-seq>
```

具体编码可以不同，但必须保留来源、稳定位置和事件身份。跨来源顺序不能靠时间戳推断；因果必须使用显式 EventRef 或来源系统已有的严格序列。

### 3.5 Effect、Activation 与 Operation

- **Effect**：Orchestrate 希望 WorkSurface Runtime 落实的标准化推进动作；
- **Activation**：某个 Orchestrate 条件在确定业务 key 上的一次满足；
- **Operation**：某个 Effect 的持久执行记录。

Activation 只属于 Orchestrate，不能表示 Agent 启动、Session 恢复或 DSH Turn。

首版标准 Effect 至少包括：

```text
emit(event)
advance(targetRole, contextRefs, message)
```

Code 是复杂 Orchestrate 的 evaluator 实现，不是一个绕过 Effect 协议的通用副作用。若以后需要新增外部动作，必须增加显式、可授权、可幂等和可对账的标准 Effect adapter，不能把任意 `run(handler)` 当作逃生口。

`advance` 由 WorkSurface Runtime 解析目标 Surface 和绑定的 DSH Session，再通过当前 DSH adapter 使用稳定 MessageId 调用 `agent.followup()`。它开启新的 DSH Turn，而不是创建 WorkSurface 自己的模型运行对象。

每个 Operation 必须先 durable record，再执行副作用，最后 durable settlement。崩溃恢复通过稳定 operation key 对账，不能把未知结果当成功。

### 3.6 Binding

Surface 与 DSH Session 是不同对象。Binding 只描述执行关联，不定义 Surface。

首个实现继续采用一对一约束：

```text
one Surface <-> one DSH Session
```

这样一个 Session 暂时承载该 Surface 的实际执行与 DSH 权威日志；Surface 自己通过有序 Episode 组织推进历史。Episode 可以引用 Session 内的 Turn、Step 与 Tool Call，但不与其中任一层级预设一一对应。该约束是首个 DSH adapter 的执行策略，不进入 Surface 或 Episode 的定义。

## 4. DSH 执行语义

WorkSurface 必须严格使用 DSH 的正式术语：

```text
Session
└── Turn 1..N
    └── Step 1..N
        └── Tool Call 0..N
```

- **Session**：一个 Agent 的完整、持久、append-only 交互历史；
- **Turn**：Session 内一次被 wake/followup 开启的连续运行，直到没有下一步工作；
- **Step**：一次逻辑模型调用，以及该响应请求的零到多个工具执行；底层请求重试可以留在同一个 Step；
- **Tool Call**：Step 内的单个工具调用，多个并行安全调用可以并发。

DSH 原生路由语义：

- `agent.followup()` 进入 `next-turn`，唤醒或开启新的 Turn；
- `agent.steer()` 与 `agent.inject()` 进入 `next-step`，影响当前 Turn 的后续 Step；
- `turn/start` / `turn/end`、`step/start` / `step/end`、`tool/call` / `tool/result` 都属于 DSH Session Log。

WorkSurface 的推进规则：

1. 用户或 Orchestrate Effect 定位目标 Surface，并打开或继续一个 Episode；
2. WorkSurface Runtime 解析当前实现的一对一 Binding；
3. WorkSurface Runtime 构建需要持久化的 Context Projection 引用；
4. 绑定的 DSH Session 通过一个或多个 Turn / Step 承载实际推进；
5. 模型调用普通工具，修改 Surface Materialization，并产生结果、证据或业务 Event；
6. Episode 记录或引用这些 DSH 事实与 Surface 修改；
7. 显式边界沉淀 Episode，新的 Surface 可见状态供后续 Episode 继续使用。

Turn 结束只表示一次 DSH 连续运行收敛，不自动表示 Episode 或 Surface 完成。

WorkSurface 不复制等待用户、请求重试、工具失败、取消或 Turn 终态。需要用户输入时，模型直接在 DSH Session 中提问，用户 followup 开启新 Turn。

## 5. 事件与 Orchestrate 关系

### 5.1 统一语义、分属事实源

```text
DSH Session Log ───────EventRef──┐
                                 ├──> Orchestrate ──Effect──> WorkSurface Runtime
Surface Event Stream ────────────┤                              │
Orchestrate Instance Stream ─────┘                              └──execution adapter──> Surface / Episode
```

Orchestrate 可以订阅获授权的 DSH 或 WorkSurface 事件，也可以依赖 Episode 推进中产生的自定义业务 Event。WorkSurface Runtime 读取源系统事实并构造统一 observed event，不复制原事件内容为新的 canonical fact。

### 5.2 历史边界与业务 key

每条 subscription 必须明确历史边界，例如：

- `all`；
- `from-instance`；
- 显式 EventRef boundary。

single event 可以用 source EventId 作为 key；join、count、跨 Surface 聚合或重复业务轮次必须给出显式 key/generation。相同 Instance、subscription 和业务 key 最多形成一个 Activation。

### 5.3 YAML 与 Code 共享运行语义

YAML 只是常见 pattern 的作者语法，Code 是复杂策略的作者语法。两者必须共享：

- 相同的 Event 输入；
- 相同的角色绑定；
- 相同的历史边界；
- 相同的 Activation 身份；
- 相同的 Effect 与 Operation 协议；
- 相同的权限、幂等和恢复约束。

不能让 Code handler 通过私有文件或进程状态形成第二套 Orchestrate 语义。

## 6. 最少新增工具原则

WorkSurface 尽量不引入新的模型工具调用。模型继续使用已经掌握的能力：

- Bash / Zsh；
- Python / Node；
- 普通文件读写；
- block-to-file；
- 已安装的搜索、浏览器、连接器和其他工具。

模型侧唯一必要的领域入口可以保留为通过 shell 调用的：

```text
ws emit <event-name>
```

它不是新的模型 tool schema，而是普通 CLI 命令。CLI 只编码并提交事件，不负责文件编辑、Orchestrate 计算或 Agent 启动。

WorkSurface 推进控制层只注入少量稳定指针：

| 入口 | 含义 |
| --- | --- |
| `DSH_SURFACE_ID` | 当前 Surface 身份 |
| `DSH_SURFACE_DIR` | 当前文件 Materialization；不存在文件适配器时可缺省 |
| `DSH_CONTEXT_FILE` | 只读 Context Projection / capability 描述 |
| `DSH_WORKSURFACE_CLI` | 当前安装的 `ws` 入口 |

SessionId、Turn、Step、InstanceId、ActivationId、Event causality 和 capability token 不要求模型记忆或填写。CLI 与 WorkSurface 推进控制层从可信执行上下文自动补充；credential、socket 和 token 不写入 prompt、事件或作者文件。

## 7. 持久事实与可删除投影

### 7.1 权威事实

| 事实 | 权威来源 |
| --- | --- |
| Surface 身份和已发布上下文引用 | WorkSurface Surface Stream |
| 文件 Materialization 快照 | immutable Revision store |
| WorkSurface / 业务事实 | Surface Event Stream |
| Orchestrate Definition 与 Instance 固定记录 | Definition store + Instance Stream |
| Activation、Operation 与 settlement | Instance Stream |
| Agent 执行、消息和工具历史 | DSH Session Event Log |
| Surface / Session 执行映射 | Binding + 对应 DSH 扩展事件 |

作者目录、Context Plan cache、UI 状态、live wakeup、socket、锁和临时文件都不是权威事实。

### 7.2 恢复原则

任何未完成工作都必须能从以下材料恢复：

- DSH Session Log；
- Surface 与 Orchestrate Event Streams；
- 固定 Definition/Instance；
- Context Snapshot、Revision 和外部稳定引用；
- Binding；
- 未结算 Operation；
- 允许保留的持久 WIP。

恢复时：

1. DSH 修复未闭合的 Turn、Step 和工具边界；
2. WorkSurface 推进控制层 replay Surface 与 Orchestrate streams；
3. 恢复 Binding 和 Context Projection 引用；
4. 对未结算 Operation 执行 reconciliation；
5. 只对 DSH persistence 判定为中断或已有持久 `next-turn` 的工作续推；
6. 普通完成、空闲或等待用户输入的 Session 保持休眠；
7. 旧 Turn capability 永久失效。

### 7.3 可删除投影

以下内容删除后必须可重建：

- Surface topology；
- Orchestrate planned/actual flow；
- UI phase/status；
- Context Plan cache；
- 搜索索引；
- live notification state。

## 8. 并发、幂等与安全

### 8.1 并发

- 同一 EventId、同一 canonical 内容重试返回既有 EventRef；
- 同一 EventId、不同内容必须冲突；
- 同一 Activation key 只产生一次 Activation；
- 同一 Operation key 只结算一次 canonical Effect；
- 文件 Materialization 发布使用 expected version/CAS，不能静默覆盖；
- 多 Surface 可以并行，目录层级和时间戳不产生依赖。

### 8.2 权限

- WorkSurface 推进控制层不相信模型填写的 SessionId、Turn、InstanceId 或 ActivationId；
- 活动 Turn 的 capability 只允许当前授权 Surface 和事件类型；
- 已关闭、取消或中断 Turn 的 capability 必须拒绝；
- Code Orchestrate 只能读取固定输入并产生获授权 Effect；
- 路径必须 canonicalize 并拒绝符号链接逃逸；
- 外部 Effect 必须使用稳定 idempotency key，或明确暴露无法 exactly-once 的风险。

## 9. UI 与拓扑

UI 是以下事实和语义的可删除投影：

```text
facts     = DSH Session Events + WorkSurface Events + Context Snapshots
semantics = exact Orchestrate Definition + Instance bindings
view      = optional UI View Spec
```

UI 可以显示：

- Surface；
- Orchestrate 声明的可能通路；
- 已匹配 EventRef；
- Activation 与 Operation 证据；
- 关联 DSH Turn/Step 的执行状态；
- `surface.completed` 等显式业务事实。

UI 不能：

- 从目录、时间戳或布局推断依赖；
- 把 Turn 结束显示为 Surface 完成；
- 创建 canonical Relation；
- 保存第二份 Binding 或执行状态；
- 用颜色或动画替代事实证据。

## 10. 核心不变量

### 领域主轴

- `WS-01` Surface 是稳定、可寻址且持续维护的结构化工作上下文，不由目录、prompt、Agent 或 DSH Session 定义。
- `WS-02` 一个 Surface 关联稳定有序的 Episode；Episode 结束不创建新的 Surface 身份。
- `WS-03` Episode 是一次有边界的推进，包含或引用模型步骤、工具调用、Surface 修改、结果与证据。
- `WS-04` Episode 不复制 DSH transcript，也不预设等同于 Turn 或 Step。

### 事实与推进机制

- Event 是事实；跨来源因果只使用稳定 EventRef，不使用 wall-clock 推断。
- Event 类型可以自定义；payload 可以混合 inline value 与 content ref，作为重放或证据的 ref 必须固定 boundary。
- YAML / Code 只属于 Source；二者必须 compile / adapt 到同一种不可变 Definition IR，推进控制层不得直接消费 Source。
- Orchestrate 只通过固定 Definition、Instance bindings、历史边界和 Event inputs 解释，并且只产生标准 Effect[]。
- WorkSurface Runtime 只控制 Surface / Episode 推进，不建立第二套 Agent 生命周期，也不宣称是 DSH 的 Runtime。

### DSH 边界

- `WS-05` Session、Turn、Step、Tool Call 完全沿用 DSH 语义。
- `WS-06` WorkSurface 不复制 `turn/*`、`step/*`、`tool/*` 或 transcript。
- `WS-07` `turn/end`、`step/end`、工具成功和上下文发布都不等于 `surface.completed`。
- `WS-08` 首个 DSH adapter 的一个 Surface 与一个 DSH Session 一对一绑定；该 Session 可包含多个 Turn。

### 上下文

- `WS-09` Surface 内容开放但必须可结构化寻址；通用协议不要求 `surface.md`、固定章节或统一 locator 形式。
- `WS-10` Context Projection 区分 included、omitted 与 required；omitted 不得描述为已消费。
- `WS-11` Revision 只是文件 Materialization 的不可变快照，不等于全部 Surface 内容事实。
- `WS-12` 对话历史只由 DSH `session.surface` 投影。

### Orchestrate 与 Effect

- `WS-13` YAML / Code Source 必须 compile / adapt 为不可变 Definition IR；推进控制层只接受 `Definition + Instance + Event[]` 并只产生标准 `Effect[]`。
- `WS-14` Activation 只表示 Orchestrate 条件满足，不表示 Agent 启动或恢复。
- `WS-15` Effect 先 durable record，再执行，再 settlement；未知结果必须 reconciliation。
- `WS-16` `advance` 使用 DSH `agent.followup()` 开启目标 Session 的新 Turn。

### 工具与投影

- `WS-17` 模型主要使用普通编程和文件能力；`ws emit` 是 shell CLI，不是新模型工具。
- `WS-18` WorkSurface Runtime 自动补充可信身份、因果和权限字段，不要求模型记忆内部标识。
- `WS-19` UI、topology、Context Plan cache 与 live wakeup 都可删除重建。
- `WS-20` Core 不建立 Task Tree、Agent Ownership、canonical Relation 或通用业务 Status。

## 11. 当前实现迁移边界

当前代码实现了大量仍然有效的可靠性机制，但其概念分层早于本文：

- `Surface Revision` 当前承担了过多“Surface 内容”语义；目标是把它降为文件 Materialization snapshot；
- 当前局部定位主要依赖文件路径；目标是形成跨 Materialization 的 `SurfaceId + adapter + locator + boundary` 地址协议；
- `surface.md` 当前被 schema 强制；目标是改为可选 Profile/template；
- 当前 `definition.json` 同时是作者 Source、持久 Definition 和 Engine IR；目标是拆分 SourceRef、compile / adapt、不可变 Definition IR 与 DefinitionRef；
- 当前声明式 reaction 可产生 emit/followup，而 Code handler 只能 emit；目标是让所有 evaluator 通过同一个冻结输入与标准 Effect[] 输出 contract；
- `Registration` 当前是公开作者文件；目标是把它解释为 Orchestrate Instance 的一种装配记录；
- 当前 EventRef 只覆盖 WorkSurface subject stream；目标是增加对 DSH Session Event 的稳定引用；
- 当前 Context Plan 以完整 Surface Revision 为中心；目标是支持开放 Context Snapshot、included/omitted/required 和多 provider 版本；
- 当前 Web 与 schema 仍使用旧 `WS-01..WS-23` 机器注册表；实现迁移时必须原子更新 schema、registry、代码和测试。

在实现完成迁移前，[实现索引](architecture.md)必须明确区分“目标设计”与“当前实现”，测试通过不能被描述为已经满足本文全部目标语义。

## 12. 最终压缩

完整设计可以压缩为六句话：

1. Surface 是可寻址、持续维护的结构化工作上下文，具体内容与 locator 形式由问题和 adapter 决定。
2. 一个 Surface 有一系列有序 Episode；Episode 是一次有边界的推进，组织本次模型步骤、工具调用、Surface 修改、结果与证据。
3. 当前 adapter 借用一个绑定的 DSH Session 承载实际执行，但 Session 不是 Surface，Turn/Step 也不自动等于 Episode。
4. YAML / Code 只是 Orchestrate Source；两者统一形成不可变 Definition IR，Instance 再绑定实际 Surface，求值只接受 Definition、Instance 和 Event。
5. Orchestrate 只产生标准 Effect[]；WorkSurface Runtime 负责可靠落实 Effect，并通过当前 adapter 使用 DSH 承载模型与工具执行。
6. DSH 与 WorkSurface 各自保存权威事实；模型继续使用普通编程和文件能力，新的 Surface 状态供后续 Episode 持续推进。
