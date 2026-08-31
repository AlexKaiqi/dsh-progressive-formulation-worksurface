# WorkSurface 可交互实现图

该目录把代码映射图作为可审查产物：

- [`worksurface-implementation.architecture.json`](worksurface-implementation.architecture.json) 是可 diff 的 Architecture source；
- [`worksurface-system.html`](worksurface-system.html) 是自包含交互图；
- [`worksurface-system.receipt.json`](worksurface-system.receipt.json) 固定 source/artifact 摘要、Showcase 校验结果和目视检查范围。

五个审查视图分别回答：

1. 当前有哪些物理组件与持久化对象；
2. `SurfaceId` 实际关联哪些目录、stream、Revision 和 Binding；
3. Orchestration 如何从 `definition.json`/Registration 进入 replay 与 Operation；
4. followup 如何跨过 WorkSurface/DSH 边界；
5. 哪些术语当前没有实现，不能进入主模型。

## 治理规则

1. 每个主图节点必须引用当前仓库中的类型、实现文件、schema 或持久化结构。
2. 没有身份、schema、store、fold/replay 和测试的名称不得作为当前概念进入图。
3. source 与生成 HTML 必须同步；HTML 不手工编辑。
4. 图不保存运行状态、事件计数、Activation 结果或 UI 临时布局。
5. 生成结果必须通过 Showcase 9/9、桌面 containment 和明暗主题目视检查。
6. Archify 渲染类型只用于视觉分组；语义护照必须使用 `meta.legend.entries` 中的 WorkSurface 领域标签。

生成后运行 `pnpm design:domain-labels`，再更新 receipt 并完成可视校验。
