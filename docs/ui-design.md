# WorkSurface UI 设计

> 本文描述当前可由代码事实支持的 UI 投影。领域语义见[完整系统设计](worksurface-complete-design.md)，实现位置见[实现索引](architecture.md)。

## 1. 投影输入

UI 不创建领域事实，只读取并组合：

```text
WorkSurface Surface streams
+ Registration streams
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

`Episode` 不存在实现，UI 不能据此分组、标记边界或推断状态。

## 2. 产品位置与导航

正式 UI 是 DSH 原生 `conversation.view`，与对话和执行轨迹处于同一个 Session view ring。它不复制 transcript，也不保存另一套 Session 映射。

“进入推进”把显式 `SurfaceId` 交给 Host admission：

1. 未绑定时，在首个 Turn 前创建真实 DSH Session 并写入固定 Binding；
2. 已绑定时，返回同一个 Session；
3. 由 DSH 原生导航打开 Session；
4. 用户在原生 composer 发起下一 Turn。

UI 不允许换绑，也不允许为同一 Surface 创建第二个 Session。

## 3. 拓扑与证据

拓扑来自固定 Definition、Registration bindings 与 EventRefs，而不是目录、时间戳或画布位置。图允许循环。

图面只展示概况：

- Surface 节点：标题和 `projectSurfaceLifecycle` 的当前显示阶段；
- subscription 条件：Definition 中的 selector 结构及已匹配 EventRef；
- 通路：可能事件路径与实际 managed operation；
- 执行入口：绑定的 DSH Session。

侧栏展示精确证据：Definition revision、registration/subscription ID、bindings、EventRefs、Activation、Operation record/settlement、目标事件和关联 Session/Turn。DSH Step 与 Tool Call 从 DSH Session log 展示，不能伪装成 WorkSurface 对象。

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
| subscription | 条件汇合点 | exact Definition |
| matched selector | 实色 source 线 | EventRef |
| managed emit/followup | 带箭头实线 | Operation record/settlement |
| Session execution | 独立 DSH 轨迹 | DSH Session events |

位置、线长和布局不表示 happens-before、依赖强度或执行顺序。

## 6. WorkSurfaceViewDefinition

当前代码中的 `WorkSurfaceViewDefinition v1` 是 JSON-compatible 输入对象，由 `defineWorkSurfaceView()` 严格校验并冻结。它支持：

- Surface 标题、标题锁定和分组；
- Orchestration 与 subscription 标题；
- 业务事件到显示阶段的解释；
- group 布局提示。

它不能保存 Event、Activation、Operation、Session 状态或当前计数，也不能注册、暂停或修改 Orchestration。仓库当前没有把它定义为 YAML artifact，也没有后台 View 维护 Agent；UI 文档不得宣称存在这些实现。

## 7. 重放与降级

Cordis live event 只触发刷新。通知丢失、重复、页面重载或 projection 缓存删除后，UI 必须通过重放持久事实收敛。

View Definition 缺失时使用确定性标题和默认布局；这不影响 Engine、DSH Agent 或事件处理。
