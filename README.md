# WorkSurface

WorkSurface 是文件化、事件驱动的多工作面推进层。它解决两个问题：如何把一项工作组织为可独立推进的 Surface，以及多个 Surface 如何依据已经发生的事件继续推进。不可变 Revision 保存内容事实，按 subject 分流的 append-only Event stream 保存过程事实。

Surface 不是执行者，也不是任务树节点。它有公开的 `SurfaceId`，工作内容位于平铺的 `surfaces/<surface-id>/`，并且必须包含由标准模板实例化的 `surface.md` 作为目标、验收、事实、假设、问题、决策、领域事件契约和交付证据的主契约。Agent 遇到可独立验收的复杂部分时先规划，再通过活动 Turn capability 创建这些 Surface；依赖写入精确 Orchestrate Definition，而不是目录或通用父子关系。并行探索可以复制相同目录内容；复制后各自修改、发布和推进，不再共享可变演进。

公开工作根只有平铺的 `surfaces/<surface-id>/` 与 `orchestrations/<orchestration-id>/`。前者是作者 checkout，后者是 Definition 作者文件；目录不表达依赖。每个 Surface 在开始推进前唯一绑定一个 DSH Session；这个 Session 的 Turn/Step 日志就是该 Surface 的完整推进历史，不能再选择或切换 Surface。持久 worktree 由 Surface 独占，并通过 expectedHead CAS 发布。文件由现有 shell/语言工具构造，WorkSurface CLI 只负责发领域事件。

用户可以从 WorkSurface 原生 `conversation.view` 手动进入已有 Surface；更常见的复杂任务由当前 Agent 使用 `ws surface create` 创建子 Surface、使用 `ws orchestrate register` 固定依赖，然后在注册成功后 emit 无依赖入口事实。有依赖目标只在条件满足后由 managed followup 推进；Host 会自动创建或恢复目标 Surface 的唯一 Session，不需要用户逐个点击。模型仍不能 open、切换当前 Surface 或直接写私有状态。DSH 重启时，Host 自动续推被中断、因运行时销毁而终止或已有持久 `next-turn` 的绑定 Session；已完成、空闲或等待用户输入的 Session 保持休眠。

Orchestrate Definition 订阅事件，匹配后通过统一 Event API 向 Surface 发事件，或先 admission、再向目标 Surface 的唯一 DSH Session 提交 durable `followup`。Registration 不保存第二份 Session 绑定。声明式 reaction 与固定 Definition Revision 中的 handler 使用相同语义。Registration 固定 Definition Revision、角色绑定和历史边界；中断恢复就是恢复该 Surface 的 DSH Session，并保留对应 worktree。WorkSurface 不再定义另一套执行、重试、等待输入或终态生命周期。

不存在 canonical Relation、Relation 写接口或全局 parent-child 模型。Surface 之间的依赖语义由精确的 Orchestrate Definition revision 及其角色绑定解释，而不是由时间或图上的边解释。Definition 中的 `all`、`any`、`count`、`sequence`、payload 条件和代码 reaction 都是依赖语义的一部分。计划路径只是可能事件通路的有损索引；实际路径只是某次 activation 使用了哪些事件并发出了哪个事件的执行证据。它们都不能替代 Definition。fan-out、fan-in、pipeline、race、派生等只是 Definition 可以表达的 pattern。

详见：

- [完整系统设计](docs/worksurface-complete-design.md)：领域、协议、文件布局、DSH Session 集成、Orchestration、恢复、并发与权限的权威规范
- [UI 设计](docs/ui-design.md)：原生拓扑、视觉语言、证据侧栏、View Definition 与降级的权威规范
- [文档索引](docs/README.md)：实现映射、机器规范、验证入口与历史材料说明

```sh
source ~/.nvm/nvm.sh
nvm use 24.17.0
pnpm install
pnpm check
```
