# WorkSurface 可交互系统设计

该目录把系统设计图作为一等设计载体：

- [`worksurface-design.workflow.json`](worksurface-design.workflow.json) 是可 diff 的设计 source；
- [`worksurface-system.html`](worksurface-system.html) 是自包含交互图；
- [`worksurface-system.receipt.json`](worksurface-system.receipt.json) 固定 source/artifact 摘要、Showcase 校验结果和目视检查范围。

主图表达设计，不画源码组件。五个审查视图分别回答：

1. Surface 如何持续维护并进入模型上下文；
2. Episode 还缺哪些严格定义，为什么现在不能使用；
3. 推进产生的 Event 如何驱动 Orchestrate；
4. YAML / code builder 如何收敛到统一 Definition 边界；
5. 哪些节点已实现、部分实现或仍是目标设计。

源码、schema、store 和测试映射放在[实现索引](../architecture.md)与[完整设计](../worksurface-complete-design.md)中，不占据主画布。

## 治理规则

1. 主图节点必须是领域概念、协议边界或运行关系，不得用源码类名替代系统设计。
2. 每个概念必须标出实现状态；没有物理协议的内容必须显示为待决问题。
3. source 与生成 HTML 必须同步；HTML 不手工编辑。
4. 图不保存运行状态、事件计数、Activation 结果或 UI 临时布局。
5. 生成结果必须通过 Showcase 9/9、桌面 containment 和明暗主题目视检查。
6. Archify 渲染类型只用于视觉分组；语义护照使用 `meta.legend.entries` 中的 WorkSurface 领域标签。

生成后运行 `pnpm design:domain-labels`，再更新 receipt 并完成可视校验。
