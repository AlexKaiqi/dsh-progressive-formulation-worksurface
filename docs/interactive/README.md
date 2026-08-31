# WorkSurface 可交互设计

该目录把可交互图作为一等设计载体：

- [`worksurface-system.workflow.json`](worksurface-system.workflow.json) 是可审查、可 diff 的图规格；
- [`worksurface-system.html`](worksurface-system.html) 是由该规格生成的自包含交互视图，支持聚焦视图、搜索、关系追踪、明暗主题和导出。
- [`worksurface-system.receipt.json`](worksurface-system.receipt.json) 固定 JSON 与 HTML 摘要、Showcase 校验结果和目视检查范围；仓库门禁会拒绝摘要漂移。

建议按五个视图审查设计：

1. 主模型；
2. Episode 内容；
3. 编译边界；
4. 事件驱动推进；
5. 执行承载边界。

## 治理规则

1. 图负责概念、边界和关键关系的完整索引；[完整系统设计](../worksurface-complete-design.md)负责精确定义、不变量和例外。
2. 新增或修改一级概念、边界、关键关系时，必须在同一变更中更新 JSON、重新生成 HTML，并同步完整系统设计。
3. HTML 只能从 JSON 生成，不允许手工编辑。
4. 图只表达稳定设计，不保存运行状态、事件计数、Activation 结果或 UI 临时布局。
5. 生成结果必须通过 Showcase 结构校验、桌面尺寸 containment 和明暗主题目视检查。
6. WorkSurface 领域语义以节点、关系和 `meta.legend.entries` 中的领域标签为准；受限的 Archify `component.type` 只承担渲染分组，不得把“云服务 / 后端 / 数据库”等底层分类暴露到语义护照。

Archify 生成 HTML 后必须运行 `pnpm design:domain-labels`，再更新 receipt 并完成可视校验。仓库门禁会检查每个已使用的渲染类型都映射到了领域标签。
