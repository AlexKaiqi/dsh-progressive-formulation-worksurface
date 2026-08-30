# WorkSurface UI 设计

> 状态：权威 UI 设计，基线日期 2026-08-30。本文只定义可删除投影的产品形态、视觉编码和交互；领域事实、DSH Session 集成与 Orchestration 语义由[完整系统设计](worksurface-complete-design.md)定义。文档治理与实现入口见[文档索引](README.md)。

## 1. 目标与边界

UI 的首要用户是正在 DSH 中推进工作的用户。它回答：有哪些 Surface；可能如何推进；哪些条件已经取得事件证据；哪里仍在等待、失败或需要用户处理。

UI 不定义执行事件、不维护编排状态，也不生成依赖语义。执行进度来自 DSH Session 的 Turn/Step 日志，核心语义以[完整系统设计](worksurface-complete-design.md)为准。

```text
事实 = DSH Session Event Log + Surface/Registration Event Streams + immutable Revisions
语义 = exact Orchestrate Definition Revision + Registration bindings
呈现 = optional View Definition Revision
UI snapshot = 对以上事实与语义的可删除投影
```

## 2. 产品位置

正式 UI 是 DSH 原生 `conversation.view`，与对话和轨迹处于同一 Session view ring。它不覆盖对话，不使用 iframe，不创建固定悬浮切换器，也不以独立地图页作为产品入口。

用户从作者目录与 Surface event streams 重放出的列表显式选择拓扑锚点；conversation target 不充当 SurfaceId。Host 再根据 Registration 与事件事实发现相关 Surface。锚点选择只保存在浏览器临时 UI 状态中，可随时丢弃；图允许循环，不按目录、时间戳、创建顺序或底层 persistence lineage 推断依赖。

视图提供“进入推进”产品动作，但不自行执行或保存推进。该动作只把当前显式 SurfaceId 交给 Host admission：未绑定时在首个 Turn 前创建并绑定一个空白真实 DSH Session，已绑定时恢复或返回同一个 Session；随后调用 DSH 原生 Session 导航。它不接受 prompt、不自动发送消息、不允许换绑，也不在浏览器保存 Session 映射。正常首次推进从用户在目标 Session 的原生 composer 提交消息开始。与此独立，Host 启动恢复会自动唤醒上次因进程中断或 DSH runtime disposal 未完成的 Turn，以及已经持久化但尚未开 Turn 的 followup；该恢复输入明确标为插件来源，不伪装成人类命令。已完成、普通空闲和等待用户回答的 Session 不会被自动唤醒。

## 3. 信息层级

图面只展示拓扑和推进概况，不堆叠执行详情：

- Surface 节点只显示有意义标题、当前投影图标和简短无障碍状态。
- subscription 以条件汇合点显示，并呈现 `1/2` 等证据进度。
- 实际事件可以在线上显示短名或数量。
- 精确 Definition、绑定、EventRefs、activation、operation 和错误放在点击后侧栏。

点击 Surface 会把它设为新的显式拓扑锚点并重新发现相关子图；“进入推进”打开该锚点唯一的 DSH Session；点击条件或通路打开当前视图内的证据侧栏。锚点选择与 Session 导航是两个不同动作。每个 Surface 与一个 DSH Session 唯一绑定：该 Session 的 Turn/Step 就是 Surface 的推进过程。UI 可以按 binding 和 publication 中的 `SessionId + Turn` 展示执行证据，但不能提供换绑、切换或给同一 Surface 新建第二个 Session 的入口。

## 4. 视觉语言

每个视觉通道只承担一种含义：

- 形状：对象种类。
- 颜色：当前注意程度或结果投影。
- 图标：产生该呈现的原因。
- 线型：可能通路与实际事件证据。
- 动画：刚到达的 live wakeup，不表示持久状态。
- 文字：标题、条件进度和短事件名。

Surface 使用统一圆角矩形。颜色必须同时配有图标和无障碍标签：

| 语义 | 浅色参考 | 含义 | 图标 |
| --- | --- | --- | --- |
| neutral | `#667085` | 空闲或等待编排事件 | 空心圆 |
| active | `#2f6feb` | Session 的 Turn 正在推进该 Surface | 播放/脉冲 |
| attention | `#b7791f` | 当前 Session 正在等待用户 followup | 用户/问号 |
| positive | `#238636` | 当前 Turn 已发布新的 Surface Revision | 对勾 |
| danger | `#cf222e` | Turn 失败、取消或防御性 publication conflict | 叉号 |

业务验收使用盾牌对勾，与 Revision 已发布的普通对勾区分。

## 5. 条件与线条

subscription 是可点击条件汇合点，不是 Relation 实体：

- `∧`：all
- `∨`：any
- `≥n`：count
- `→`：sequence
- `{}`：code handler

线条规则：

- 细灰虚线：Definition 声明的可能事件通路。
- 实色 source 线：selector 已取得匹配 EventRef。
- 带箭头实色 target 线：activation 已实际完成托管 emit。
- 红色条件点：handler 或 activation 失败，不表示“关系失败”。

箭头只表示事件传播方向。位置、线长和布局不表示时间、依赖强度或 happens-before 完整性。

## 6. 证据侧栏

点击条件或通路后显示：

- Definition revision 与 subscription id；
- 角色绑定；
- 完整条件结构；
- 已收到和缺少的 selector 证据；
- activation 与 handler invocation；
- managed operation、目标 EventRef 与关联 Session/Turn；
- 失败及恢复信息。

possible path、matched source、activation、managed operation、DSH Turn 状态与 Surface publication 结果必须分层呈现，不能压成一条“状态”。

## 7. View Definition

可选 View Definition 是不可变 YAML artifact，只维护标题、标题锁定、分组、subscription 文案、业务事件展示解释和稳定布局提示。

它不能保存 status、事件计数、activation 结果或当前进度，也不能注册、暂停、恢复或修改 Orchestrate Definition。后台 Surface 可以持续维护它；维护失败时使用最后有效 revision 或确定性回退，不影响 DSH Agent。

标题优先级为：锁定 View 标题、普通 View 标题、`surface.md` 中 Goal 的首个非空文本、Surface 目录名、缩短 SurfaceId。

## 8. 重放与降级

Cordis live event 只触发刷新。通知丢失、重复、页面重载、浏览器离线或 projection 缓存删除都不能改变最终 UI；恢复后通过重放收敛。

View Definition 缺失或无效时显示确定性标题与默认布局。后台 View 维护 Agent 不可用时，核心编排继续正常执行。
