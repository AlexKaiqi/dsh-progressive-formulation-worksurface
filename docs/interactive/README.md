# WorkSurface 可交互系统设计

该目录只保留对理解产品概念有价值、且不冒充机器协议的图：

| 图 | 只回答的问题 | 维护方式 | 交互 HTML |
|---|---|---|---|
| WorkSurface 概念图 | 复杂目标怎样成为可持续、可验收、按依赖协作的工作单元 | 自包含 HTML/CSS | [`worksurface-system.html`](worksurface-system.html) |
WorkSurface 概念图直接维护自包含 HTML/CSS，并由 `pnpm check` 检查必要概念和模板语义泄漏。

主图只表达产品价值与三个核心概念的关系。Runtime 执行边界由 JSON Schema、可执行样例和测试定义，不再用容易过期的时序图重复协议。源码、Schema、
store 和测试映射放在[实现索引](../architecture.md)和[当前实现基线](../worksurface-complete-design.md)中；
目标状态只以[设计基线](../design-baseline.md)为准；[code 契约](../orchestration-code-contract.md)由 Registration、run-state、input-record、result Schema 和可执行样例约束。

## 治理规则

1. 每张图必须只有一个明确问题；协议能由 Schema/测试准确表达时不重复画图。
2. 图中节点必须是领域概念、协议边界或运行关系，不得用源码类名替代系统设计。
3. 每个概念必须标出实现状态；没有物理协议的内容必须显示为待决问题。
4. 图的表达方式服从问题：时序图可以从结构化 source 生成；领域工作流可以直接维护 HTML/SVG，不强套系统架构节点类型。
5. 图不保存运行状态、事件计数、Activation 结果或 UI 临时布局。
6. 交互能力只保留对理解有用的部分；概念图可以是静态叙事，不为功能清单堆叠控件。
7. 图必须区分当前实现与目标协议，不把 Schema 已定义写成 Runtime 已支持。

更新图后先做视觉检查，再运行 `pnpm check`。
