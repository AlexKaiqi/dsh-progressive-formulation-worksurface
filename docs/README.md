# WorkSurface 文档索引

## 权威设计

当前只有以下两份设计规范：

1. [完整系统设计](worksurface-complete-design.md)：领域边界、Revision/Event 双事实源、文件布局、DSH Session/Turn 集成、Orchestration、恢复、并发、权限和核心不变量。
2. [UI 设计](ui-design.md)：原生 `conversation.view`、拓扑、视觉编码、证据侧栏、View Definition、重放和降级。

系统设计约束 UI；UI 设计只能定义投影与交互，不能改变领域事实、依赖语义或 DSH Session 集成协议。两份文档若出现冲突，以完整系统设计的领域边界为准，并应在同一改动中修正文档冲突。

## 实现与验证资料

- [实现索引](architecture.md)：把权威设计章节映射到代码、协议和测试；不另行定义架构。
- [验证指南](invariants-and-acceptance.md)：机器可读不变量、统一门禁和恢复测试入口。
- [模型上下文](context-management.zh.md)：不可变 Revision 与 Session 事实到模型输入的重建链路；英文版见 [Fact-backed model context](context-management.md)。
- [`spec/`](../spec/)：Event、Definition、Surface Session Binding、Context schema，标准 Surface 模板和机器可读不变量注册表。
- [`examples/`](../examples/)：符合当前 Definition 和 Surface 契约的示例。

实现、schema 或测试不能静默覆盖权威设计。发现不一致时，应先判断是实现缺陷还是设计变更，再同步修改两份权威文档中的受影响内容、`spec/`、实现和测试。

## 已移除的历史材料

- `work-session-storage.md`：基于旧 Work Session 命名，内容已并入完整系统设计的文件布局与持久化章节。
- `worksurface-ui-design-revised.md`：历史 UI 草案；其中未与当前 Revision/Event 双事实源、唯一 Surface Session 和当前 projection 契约同步的内容不再适用。

Git 历史仍可用于追溯这些材料，但它们不再留在工作树中，避免被当作当前规范引用。
