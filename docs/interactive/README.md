# WorkSurface 可交互系统设计

该目录把系统设计图作为一等设计载体。不同问题使用不同图，不再把领域边界、
authoring 契约和执行时序塞进同一张画布：

| 图 | 只回答的问题 | Source | 交互 HTML |
|---|---|---|---|
| 定位与系统边界 | Surface、DSH Session 与 Orchestrate 分别是什么 | [`worksurface-system.architecture.json`](worksurface-system.architecture.json) | [`worksurface-system.html`](worksurface-system.html) |
| 模型 authoring | 模型需要声明什么、code 能直接依赖什么 | [`orchestrate-authoring.architecture.json`](orchestrate-authoring.architecture.json) | [`orchestrate-authoring.html`](orchestrate-authoring.html) |
| Runtime 时序 | Event 到直接变量、effects 和 Operation 如何串起来 | [`orchestrate-runtime.sequence.json`](orchestrate-runtime.sequence.json) | [`orchestrate-runtime.html`](orchestrate-runtime.html) |

每张图都有同名 receipt，固定 source/artifact 摘要、9/9 showcase 校验结果，以及视觉
检查是否实际执行。

主图只表达定位与边界。具体协议由 authoring 图解释；一次执行的先后关系由 Runtime
时序图解释。源码、Schema、store 和测试映射放在[实现索引](../architecture.md)、
[完整设计](../worksurface-complete-design.md)和[code 契约](../orchestration-code-contract.md)中。

## 治理规则

1. 每张图必须只有一个明确问题；需要切换解释层次时新增图，不用 focus 隐藏拥挤关系。
2. 图中节点必须是领域概念、协议边界或运行关系，不得用源码类名替代系统设计。
3. 每个概念必须标出实现状态；没有物理协议的内容必须显示为待决问题。
4. JSON source 通过 Archify `validate --quality showcase` 后才能原子生成 HTML；发布 HTML 不手工编辑。
5. 图不保存运行状态、事件计数、Activation 结果或 UI 临时布局。
6. 交互图必须保留明暗主题、搜索与导出；无法执行视觉检查时必须明确记录 skipped。
7. 图必须区分当前实现与目标协议，不把 Schema 已定义写成 Runtime 已支持。

更新 source 后重新 validate/deliver、更新 receipt，再运行 `pnpm check`。
