# WorkSurface node editor 方向决策

## 结论

WorkSurface 应采用成熟 node editor 作为 UI 交互底座，但不应照搬 ComfyUI 的领域模型，也不应把当前只读事实图偷换成可执行 workflow DSL。

当前阶段的产品目标是：让用户在一个可自由导航和微调的主画布上理解已有 Surface、Orchestrate、声明能力与已记录证据，并能从任一对象进入精确事实。下一阶段才是在同一类交互底座上编辑可重复执行的 Surface Template + Orchestrate 管线。

因此当前决定是：

1. 默认关系图使用 React Flow；首次自动布局使用 Dagre；两者均固定为 MIT 许可依赖。
2. 重度参考成熟 node editor 的交互结构：主画布、紧凑节点、显式端口、平移/缩放/选择、右下导航、小地图和用户触发的自动排版。
3. 当前画布保持只读拓扑。用户只能调整 presentation layout 和打开证据，不能创建、删除或重连领域边。
4. UI 坐标与 viewport 是浏览器本机可删除状态，不进入 Runtime Event、Registration、Revision 或 View Definition。
5. 未来的模板编辑器与当前运行证据图使用相同交互底座，但必须是两个明确模式和两类 artifact；模板草稿经校验、冻结 Revision、Registration 后才能执行。

## 为什么现在应该这样做

手写 SVG 已经把主要工程成本花在缩放、平移、命中区域、键盘操作、节点拖动、布局保持和响应式适配上，而且这些并不是 WorkSurface 的差异化能力。继续维护自有画布会让 UI 质量落后，同时妨碍后续模板编辑器复用。

成熟 node editor 把这些通用问题收敛到稳定 API。WorkSurface 可以把工程注意力放回真正需要自己负责的部分：事实来源、声明与实际证据分层、不可变 Revision、Registration、恢复、Session 一对一绑定以及可解释的执行结果。

## 好处

- 用户可以直接拖动节点微调，不再被固定大画布和一次性布局锁死。
- 缩放、平移、触控板、小地图、适配视图、选择与键盘移动形成一致的图操作语言。
- 自定义 DOM 节点和可聚焦 Edge label 可以继续满足 DSH 主题、国际化和证据抽屉，而不需要重写图渲染器。
- Dagre 只负责可重复的初始位置；用户显式自动排版，实时事实刷新不会抢走布局控制权。
- 同一底座可在未来支持 Template 草稿节点、端口类型、连接校验和运行态 overlay，降低重复建设。
- React Flow 与 Dagre 的许可和包边界允许插件自行 bundle，不要求 DSH Host 提供新的全局前端依赖。

## 代价与风险

- Client bundle 增加到约 400 KB、gzip 约 129 KB，并引入 ReactDOM、React Flow、Zustand、D3 子模块和 Dagre；需要持续观察首屏与大图性能。
- 第三方升级可能改变 CSS、edge routing 或 accessibility DOM；版本必须锁定并通过真实浏览器回归后再升级。
- 本机布局不能自动跨浏览器或多人共享。若未来需要共享布局，应设计独立、版本化的 Template/View artifact，而不是把坐标混入 Runtime facts。
- 节点编辑器的视觉会天然暗示“连线即可执行”。当前必须禁用 connect/reconnect，并持续用虚线 declared / 实线 recorded 的视觉和证据抽屉阻止误解。
- 大规模图仍可能拥挤。后续需要基于事实做过滤、分组、搜索和折叠，而不是靠无限扩大画布。
- React Flow 不替代产品设计；节点信息密度、端口语义、工具栏优先级和空态仍需要 WorkSurface 自己定义并验证。

## 没有选择的方案

### 继续扩展手写 SVG

不采用。它没有为 WorkSurface 提供新的领域能力，却持续复制 node editor 已解决的通用交互，并且已经产生固定画布、无法微调和证据边命中冲突。

### 直接移植 ComfyUI 前端或其节点模型

不采用。我们只借鉴交互结构。ComfyUI 的节点、端口、队列和 workflow JSON 服务于图像生成；WorkSurface 的事实、不可变 Revision、Registration、Surface Session 和 Orchestrate 执行边界不同。直接移植会把外部实现细节变成错误的领域模型，也会扩大许可与长期维护面。

### 现在就开放可编辑执行图

不采用。当前还没有 Surface Template 的稳定 artifact、端口 contract、草稿校验、发布确认、Revision 冻结和迁移协议。先开放连线会创造第二套不受 Runtime 约束的执行真相。

## 面向可重复管线的演进边界

后续模板能力应按以下生命周期实现：

```text
Template draft
  → typed ports / connection validation
  → static preflight
  → user review
  → immutable Template + Orchestrate Revision
  → Registration
  → repeatable run
  → Runtime Event / Operation evidence overlay
  → replay / fork / compare
```

同一画布可以复用节点、端口和导航，但 UI 必须明确分为：

- **Design**：编辑 Template 草稿和布局，尚未形成运行事实；
- **Run / Evidence**：只读重放精确 Revision、Registration 与 Runtime Event，不能悄悄修改模板。

Template 是可复用定义，Surface 是一次具体工作实例，Orchestrate 是普通代码与精确 Registration，运行结果仍由 append-only facts 和不可变 Revision 证明。这个边界保留 ComfyUI 式 node workflow 的可理解性，同时避免把 WorkSurface 降格为另一套图 DSL。
