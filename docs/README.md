# WorkSurface 文档索引

## 权威设计

当前权威设计由三个互相约束的载体组成：

1. [可交互系统设计图](interactive/worksurface-system.html)：概念、边界和关系的第一审查入口；可编辑源为 [`worksurface-system.workflow.json`](interactive/worksurface-system.workflow.json)。
2. [完整系统设计](worksurface-complete-design.md)：精确定义 `Surface / Episode` 主轴、Event / Orchestrate / WorkSurface Runtime 推进机制、DSH 承载边界、上下文投影、恢复和核心不变量。
3. [UI 设计](ui-design.md)：原生 `conversation.view`、拓扑、视觉编码、证据侧栏、View Definition、重放和降级。

交互图负责概念与关系索引，完整系统设计负责精确语义，UI 只能定义投影与交互。新增一级概念、边界或关键关系时，必须在同一变更中同步图规格、生成 HTML 和完整系统设计；出现冲突时不能选择性忽略，必须修复漂移。

## 实现与验证资料

- [实现索引](architecture.md)：将目标设计映射到现有代码，并明确尚未迁移的旧概念；不另行定义架构。
- [验证指南](invariants-and-acceptance.md)：区分“当前实现兼容性门禁”与“目标设计迁移验收”。
- [模型上下文](context-management.zh.md)：从 DSH Session、Surface materializations、EventRefs 与 provider 输出构建 Context Projection；英文版见 [Fact-backed model context](context-management.md)。
- [`spec/`](../spec/)：当前实现使用的 Event、Definition、Binding、Context schema、兼容性模板和机器可读不变量注册表。
- [`examples/`](../examples/)：符合当前实现协议的示例；不应被解释为 Surface 通用内容模型。

目标设计已经先行更新，当前 `spec/`、实现与测试仍含 Revision-centric、强制 `surface.md`、JSON Definition 和公开 Registration 等旧分层。测试通过只证明当前实现自洽，不表示已经完成目标语义。迁移时应原子更新 schema、registry、代码、测试和示例。

## 历史材料

- `work-session-storage.md`：基于旧 Work Session 命名，内容已经并入完整系统设计。
- `worksurface-ui-design-revised.md`：历史 UI 草案，未同步当前 Surface / Episode 模型和正确 DSH 层级。

Git 历史仍可用于追溯，但这些材料不再是当前规范。
