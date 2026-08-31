# WorkSurface 可交互系统设计

该目录把系统设计图作为一等设计载体：

- [`worksurface-system.architecture.json`](worksurface-system.architecture.json) 是可 diff、可机器校验的设计 source；
- [`worksurface-system.html`](worksurface-system.html) 是自包含交互图；
- [`worksurface-system.receipt.json`](worksurface-system.receipt.json) 固定 source/artifact 摘要、9/9 showcase 校验结果，以及视觉检查是否实际执行。

主图表达可追溯到物理实现的设计，不画源码组件。三个审查视角分别回答：

1. Surface 如何持续维护并进入模型上下文；
2. 推进产生的 Event 如何驱动 Orchestrate；
3. 模型需要理解哪些事件与 Definition 语义，以及 authoring 格式增加了多少额外认知负担。

源码、schema、store 和测试映射放在[实现索引](../architecture.md)与[完整设计](../worksurface-complete-design.md)中，不占据主画布。

## 治理规则

1. 主图节点必须是领域概念、协议边界或运行关系，不得用源码类名替代系统设计。
2. 每个概念必须标出实现状态；没有物理协议的内容必须显示为待决问题。
3. JSON source 通过 Archify `validate --quality showcase` 后才能原子生成 HTML；发布 HTML 不手工编辑。
4. 图不保存运行状态、事件计数、Activation 结果或 UI 临时布局。
5. 交互图必须保留明暗主题、搜索、focus 与导出；无法执行视觉检查时必须明确记录 skipped。
6. 图必须区分当前实现与目标协议，不把 Schema 已定义写成 Runtime 已支持。

更新 source 后重新 validate/deliver、更新 receipt，再运行 `pnpm check`。
