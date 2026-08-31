# WorkSurface 可交互系统设计

该目录把系统设计图作为一等设计载体：

- [`worksurface-system.fragment.html`](worksurface-system.fragment.html) 是可 diff、可直接运行的设计 source；
- [`worksurface-system.html`](worksurface-system.html) 是自包含交互图；
- [`worksurface-system.receipt.json`](worksurface-system.receipt.json) 固定 source/artifact 摘要、响应式校验结果和目视检查范围。

主图表达可追溯到物理实现的设计，不画源码组件。四个审查视角分别回答：

1. Surface 如何持续维护并进入模型上下文；
2. Episode 还缺哪些严格定义，为什么现在不能使用；
3. 推进产生的 Event 如何驱动 Orchestrate；
4. YAML / code builder 如何收敛到统一 Definition 边界。

源码、schema、store 和测试映射放在[实现索引](../architecture.md)与[完整设计](../worksurface-complete-design.md)中，不占据主画布。

## 治理规则

1. 主图节点必须是领域概念、协议边界或运行关系，不得用源码类名替代系统设计。
2. 每个概念必须标出实现状态；没有物理协议的内容必须显示为待决问题。
3. source fragment 与发布 HTML 必须逐字同步；发布 HTML 不手工编辑。
4. 图不保存运行状态、事件计数、Activation 结果或 UI 临时布局。
5. 交互图必须使用宿主主题变量，在桌面与窄屏上重排，并完成明暗主题目视检查。
6. 不得重新引入背景网格、泳道、阶段栏或通用架构图模板。

更新 source 后同步发布 HTML、更新 receipt，再运行 `pnpm check`。
