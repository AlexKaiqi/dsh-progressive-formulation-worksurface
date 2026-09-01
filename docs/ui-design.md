# WorkSurface UI 设计

> 本文描述当前可由代码事实支持的 UI 投影。领域语义见[完整系统设计](worksurface-complete-design.md)，实现位置见[实现索引](architecture.md)。

## 1. 投影输入

UI 不创建领域事实，只读取并组合：

```text
WorkSurface Surface streams
+ Registration streams
+ v5 Runtime Event streams / Input and Operation counters
+ exact OrchestrationDefinition
+ SurfaceSessionBinding
+ DSH Session events
+ optional WorkSurfaceViewDefinition
        ↓ fold / projection
可删除的 UI state
```

这些输入必须分层：

- WorkSurface Event、Registration、Activation、Operation 描述协调事实；
- DSH Session、Turn、Step、Tool Call 描述模型与工具执行；
- Revision 描述不可变目录快照；
- Binding 只描述 Surface 到 DSH Session 的固定映射；
- `WorkSurfaceViewDefinition` 只描述标题、分组、解释和布局提示。

code-first Runtime 没有可静态展开的业务图。UI 因此严格分开两层：Registration routes 投影为虚线，只表示 `consumeFrom`、`emitOn`、`surfaceOutputFrom` 的声明能力；已持久 Runtime Event 的 producer 与 causes 投影为实线，表示已发生的因果证据。不得从任意 Orchestrate 代码或 route 声明推断一条“已发生”的业务边。

## 2. 产品位置与导航

正式 UI 是 DSH 原生 `conversation.view`，与对话和执行轨迹处于同一个 Session view ring。它不复制 transcript，也不保存另一套 Session 映射。

“进入推进”把显式 `SurfaceId` 交给 Host admission：

1. 未绑定时，在首个 Turn 前创建真实 DSH Session 并写入固定 Binding；
2. 已绑定时，返回同一个 Session；
3. 由 DSH 原生导航打开 Session；
4. 用户在原生 composer 发起下一 Turn。

UI 不允许换绑，也不允许为同一 Surface 创建第二个 Session。

## 3. 拓扑与证据

当前正式页面是未来三态中的 **Evidence** 模式，由顶部导航、关系图和右侧证据抽屉组成。顶部只保留当前 Surface 选择、投影阶段、“进入推进”和刷新。不在主页堆叠 Registration 卡片、Event 列表和统计仪表，也不显示尚未实现的 Design/Run 假入口。

未来 **Design** 编辑 Template 草稿、参数 Schema 与类型端口，**Run** 绑定参数和多模态 ArtifactRef 并创建一次新的 Invocation；三态边界见[可重复管线方向](repeatable-pipeline-direction.md)。当前事实图的节点、画布、Inspector 与布局适配应可被复用，但 Evidence 不能因 UI 复用而获得模板写权限。

### 3.1 默认 code-first 关系图

默认图的对象只有：

- Surface 节点：标题、当前生命周期投影、可选分组与 Runtime Event 数量；
- Orchestrate 节点：Registration id、recorded run 和 pending run 数量；
- 虚线声明通路：Registration route 中明确的 Surface handle、Event name 和 capability；
- 实线因果通路：由 Runtime Event 的 `producer.kind=orchestrate`、producer ref 和 WorkSurface causes 精确连接来源 Surface、Orchestrate 与目标 Surface。

图使用 React Flow 提供缩放、平移、选择、节点拖动、小地图和适配视图，用 Dagre 生成按声明方向的首次稳定分层布局。用户可以微调节点并显式重新自动排版；投影刷新保留已有位置，新节点才使用生成位置。位置只用于可读性，不表示 happens-before、依赖强度或执行顺序；出现循环时 Dagre 仍保留所有节点和边。

浏览器按锚点保存节点坐标与 viewport，且只把它们当作可删除的本机 presentation state。它不保存或修改边、binding、Event、Registration、Revision、Session 映射或运行状态；因此清空浏览器存储只会恢复默认布局，不会改变重放结果。当前画布禁止用户创建、删除或重连边。

### 3.2 证据抽屉

点击 Surface、Orchestrate、声明通路或已记录 Event 只打开一个右侧抽屉：

- Surface：SurfaceId、分组、生命周期投影和已记录 Event；非当前 Surface 可显式设为新锚点；
- Orchestrate：revision、input/run/pending 计数、bindings 和 routes；
- 声明通路：Registration、来源、去向、capability 和 Event name，并明确其只是 possible；
- Runtime Event：Event id、Surface、contract、producer、recordedAt、operation key、causes 和 payload。

### 3.3 v4 兼容图

Definition v1 拓扑只在独立的“v4 兼容”模式中出现，不与 code-first 图面同时渲染。兼容拓扑来自固定 Definition、Registration bindings 与 EventRefs，而不是目录、时间戳或画布位置。图允许循环。

兼容图面只展示概况：

- Surface 节点：标题和 `projectSurfaceLifecycle` 的当前显示阶段；
- subscription 条件：Definition 中的 selector 结构及已匹配 EventRef；
- 通路：可能事件路径与实际 managed operation；
- 执行入口：绑定的 DSH Session。

兼容抽屉展示精确证据：Definition revision、registration/subscription ID、bindings、EventRefs、Activation、Operation record/settlement、目标事件和关联 Session/Turn。DSH Step 与 Tool Call 从 DSH Session log 展示，不能伪装成 WorkSurface 对象。

## 4. 生命周期显示

`SurfaceLifecycleProjection` 当前只从 Surface stream 折叠：

- `surface.revision.published` → `published`；
- `surface.publish.conflicted` → `conflicted`；
- `WorkSurfaceViewDefinition.interpretations` 可把指定业务事件解释为 `verified / completed / failed / waiting-user`。

该投影保留产生状态的 EventRef 证据。`turn/end`、`step/end` 和工具成功不是 Surface 完成；UI 不得据此显示业务完成。

## 5. 视觉编码

每个视觉通道只承担一种含义：形状表示对象种类，颜色表示当前投影，线型区分声明路径与实际证据，动画只表示刚到达的 live wakeup。

| 对象 | 图面表达 | 权威事实 |
| --- | --- | --- |
| Surface | 统一圆角节点 | Surface stream + optional view definition |
| Orchestrate | 双圆角处理节点 | exact Registration + revision |
| declared route | 带箭头虚线 | Registration route |
| recorded causal path | 带箭头实线 | Runtime Event producer + causes |
| v4 subscription | 兼容模式的条件汇合点 | exact Definition |
| v4 managed emit/followup | 兼容模式的带箭头实线 | Operation record/settlement |
| Session execution | 独立 DSH 轨迹 | DSH Session events |

位置、线长和布局不表示 happens-before、依赖强度或执行顺序。

交互结构重度参考成熟 node editor 的共同模式：主画布占据主体空间，节点用显式输入/输出端口表达方向，右下角集中导航，小地图可关闭，自动排版必须由用户显式触发。视觉参考不改变 WorkSurface 的领域概念或证据规则。

## 6. WorkSurfaceViewDefinition

当前代码中的 `WorkSurfaceViewDefinition v1` 是 JSON-compatible 输入对象，由 `defineWorkSurfaceView()` 严格校验并冻结。Web Host 可通过配置的精确 `viewRevision` 读取 `worksurface-view.yaml`（或显式 `viewFile`），解析后才交给该校验器；读取或校验失败时保留最近一次有效定义并返回 warning。它支持：

- Surface 标题、标题锁定和分组；
- Orchestration 与 subscription 标题；
- 业务事件到显示阶段的解释；
- group 布局提示。

它不能保存 Event、Activation、Operation、Session 状态或当前计数，也不能注册、暂停或修改 Orchestration。仓库当前支持显式配置已有 Revision 中的 YAML 文件，但没有后台 View 维护 Agent，也不会自动创建、改写或发布 View artifact。

## 7. 重放与降级

Cordis live event 只触发刷新。通知丢失、重复、页面重载或 projection 缓存删除后，UI 必须通过重放持久事实收敛。

View Definition 缺失时使用确定性标题和默认布局；这不影响 Engine、DSH Agent 或事件处理。
