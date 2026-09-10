# WorkSurface 视觉语言（Visual Language）

> 本文定义 WorkSurface 关系图与证据视图的统一视觉语言，作为实现与评审的单一事实源。领域语义与投影规则见 [ui-design.md](ui-design.md) 与 [worksurface-complete-design.md](worksurface-complete-design.md)。当前实现版本：`pf-ws-*`。

## 1. 核心原则：一个通道只表达一种含义

每个视觉通道严格绑定一类事实，禁止用一个通道同时表达两种不同含义，也禁止只用颜色/边框去区分本质上“种类不同”的对象。

| 通道 | 只表达 | 举例 |
| --- | --- | --- |
| **形状** | 对象种类 | Surface=圆角矩形（文档）；Orchestrate=六边形（机器）；Subgraph=圆角容器；v4 条件=圆形汇合点 |
| **颜色（色相）** | 状态投影 | neutral / active / positive / attention / danger 五种色相 |
| **颜色（同色相内的填充密度）** | 同一状态下的强度/进度 | idle 空心 → published 实心；failed 浅红 → conflicted 深红 |
| **线型** | 事实类别 | 虚线=声明/可能通路；实线=已记录/实际因果 |
| **动画** | live wakeup | 仅新到达事件的短暂提示（当前未使用） |
| **标记** | 非状态焦点 | 锚点 pin、选中环、事件计数徽标（不参与状态语义） |

两条硬约束：

1. **种类必须用形状区分，不能只靠颜色或边框。** 相同形状 + 不同颜色 = 同一种类的不同状态；不同种类必须形状不同。
2. **状态必须可脱离文本读出来。** 缩放、反色或色弱环境下，状态仍应可通过 填充密度 + 字形 辨识，不能只依赖 8px 文字。

## 2. 对象种类（形状语言）

| 对象 | 形状 | 图面事实 | 权威事实 |
| --- | --- | --- | --- |
| Surface | 圆角矩形（文档卡） | 标题、状态、事件数 | Surface stream + optional view definition |
| Orchestrate | 六边形（机器/流程） | Registration id、input/run/pending 计数 | exact Registration + revision |
| Subgraph | 低对比圆角容器（虚线） | 连通分量边界 | 运行时连通分量 |
| v4 条件 gate | 圆形汇合点 | 条件符号与进度 | exact Definition |
| 锚点（当前 Surface） | 节点右上角 pin 标记 | 当前聚焦 | anchorSurfaceId |

Surface 是“被处理的对象/文档”，Orchestrate 是“处理它的机器/流程” —— 用 圆角矩形 vs 六边形 直接表达这层隐喻差异。机器节点的内容居中排布在六边形最宽的中带。

**节点内不重复种类文字。** 形状已经表达种类，画布节点上不再显示 “Surface / Orchestrate” 等标签，空间全部留给有价值内容：Surface 卡 = 状态字形 + 标题（主体）+ 状态词/事件数/修订一行元信息；Orchestrate = Registration id + input/run/pending 计数。种类语义只在图例与 aria-label 中出现。

## 3. 状态（颜色语言）

Surface 的**显示状态**由可用的最强投影派生，避免“idle 文字 + 绿色边框”的自相矛盾：

```text
displayPhase(surface) =
  surface.lifecycle.phase ≠ idle   → surface.lifecycle.phase   （精确投影优先）
  否则 surface.completed           → completed                 （code-first 业务完成标志）
  否则 surface.revision            → published                 （code-first 发布修订）
  否则                              → idle
```

原始 `lifecycle.phase` 永远保留在证据抽屉中，不被派生状态覆盖。

| 显示状态 | 色相 | 填充密度 | 描边 | 字形 | 语义 |
| --- | --- | --- | --- | --- | --- |
| idle | neutral | 空心 | 灰 | ○ | 尚无投影 |
| published | active（蓝） | 浅蓝 8% | 蓝 | ● | revision 已发布，处于工作态 |
| completed | positive（绿） | 浅绿 9% | 绿 | ✓ | 业务结果已验收 |
| waiting-user | attention（琥珀） | 浅琥珀 10% | 琥珀 | ? | 等待用户 |
| conflicted | danger（红，浅） | 浅红 6% | 红 | ! | 发布冲突 |
| failed | danger（红，深） | 深红 9% | 红 | × | 执行失败 |

同一个色相内的 `published(●)` 与 `idle(○)` 用填充密度区分；`conflicted(!)` 与 `failed(×)` 用填充密度与字形区分。

Orchestrate 的状态只有工作负荷，不混入业务色相：

| Orchestrate 状态 | 图面 | 条件 |
| --- | --- | --- |
| 就绪 | 紫描边 + 浅紫填充 | pendingRunCount = 0 且无运行 |
| 已运行 | 紫描边 + 紫填充加深 | recordedRunCount > 0 |
| 待结算 pending | 琥珀描边 + 琥珀填充 | pendingRunCount > 0 |

## 4. 路径（线型语言）

| 事实类别 | 线型 | 色相 | 含义 |
| --- | --- | --- | --- |
| declared route | 虚线 + 箭头 | 中性灰紫 | Registration 声明的可能通路 |
| actual source | 实线 + 箭头 | 蓝 | 已记录：源 Surface → Orchestrate |
| actual target | 实线 + 箭头 | 绿 | 已记录：Orchestrate → 目标 Surface（已发出/已发布） |

虚线只表示“声明能力”，实线只表示“已发生证据”，二者永不混用。

## 5. 标记（焦点，非状态）

| 标记 | 表达 | 图面 |
| --- | --- | --- |
| 锚点 pin | 当前聚焦 Surface | 右上角蓝色水滴 pin + 软外环 |
| 选中 | 当前选中对象 | active 色外环 + 描边加粗（Orchestrate 用六边形 drop-shadow） |
| 事件数 | 信息 | header 右侧小型计数 |

锚点与选中是“你正在看哪里”，不是 Surface 的“怎么样”，因此不占用状态色相。

## 6. 图例

图例是视觉语言的完整索引：每个对象种类（Surface 卡 / Orchestrate 六边形 / Subgraph 容器 / pin）、两类线型、全部六种状态色相与字形。图例必须始终与节点实际渲染一致。

## 7. 与既有规则的承接

- 本语言不改变领域规则：虚线/实线分层、不可变 Revision、只读画布、禁止连边、布局只是本地可删除状态等约束照旧（见 ui-design.md / ui-node-editor-decision.md）。
- “形状=种类”已把 Orchestrate 从“另一种盒子”提升为独立形状，消除仅靠紫色虚线框区分带来的弱辨识。
- 状态色相仍由 `phaseTone` 单一函数输出，保证节点、锚点徽标、子图摘要、证据抽屉、路径事实使用同一套色相映射。
