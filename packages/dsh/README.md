# @pf-worksurface/dsh

DSH 集成层装配 file event store、content-addressed RevisionStore、Registration reconcile、Session/Turn adapter 与 Host RPC。公开领域只使用 Surface、Orchestration、Registration、Revision 与 Event；执行直接复用 DSH 的 Session、Turn 和 Step，不建立第二套执行身份。

Surface 开始推进前一次性绑定唯一 DSH Session，并固定 inputRevision 与 expectedHead。绑定写入 `surface-sessions/<surface-id>/binding.json` 和该 Session 的 `worksurface/binding` 事件；Surface 独占一个持久 worktree。后续 Turn 自动继续该 worktree，不能选择或切换 Surface；Turn 关闭或被中断时，其短期 capability 失效。发布时先 snapshot worktree，再做 CAS；冲突保存 outputRevision 并记录 `surface.publish.conflicted`。

启动恢复把 `sessionPersistence` 作为必需装配依赖，重放唯一绑定、publication Event 和 Session 日志，修复可丢弃的 authoring checkout，并从全部 Surface/Registration Event 与 binding 发现 Revision GC 根。冷 Session 的最后 Turn 若由 persistence 标记为 `interrupted`、由 DSH 以 `aborted/disposed` 关闭，或 inbox 仍有持久 `next-turn`，Host 会恢复同一 Agent/Session 并提交一条插件来源的保守续推；已完成、等待用户、普通空闲或尚未物化出持久日志的空白 Session 不会被唤醒。单个损坏 Session 或 Registration 会记录警告但不会阻塞其余启动恢复；每次启动记录恢复与 reconcile 计数。Event 未引用的旧孤儿 Revision 可以回收；Surface Session worktree 保守保留，只清理超过 retention 的临时 materialization。

只有 Surface Session 会收到模型说明和环境。该 Session 创建时的 cwd 就是 Surface worktree；每个活动 Turn 注入同一 `DSH_SURFACE_ID`、`DSH_SURFACE_DIR`、`DSH_CONTEXT_FILE` 以及 transport capability。模型不能 `open` 或切换当前 Surface，但可以先在自己的 worktree 中写契约和 Definition 草稿，再通过 `ws surface create`、`ws orchestrate register` 交给 Host 校验并落盘；注册成功后用 `ws emit` 发无依赖根事实。执行状态、等待输入、模型调用失败和重试由这个 DSH Session 的 Turn/Step 事件表达。

原生 WorkSurface UI 通过 Host admission 确保 Surface 的 Session。首次进入使用 `ctx.agents.create()` 的 unpublished setup 组合默认 Agent preset、写入唯一 binding，并把 Surface worktree 作为 Session cwd；它发布一个尚无 Turn 的空白 Session，不替用户提交消息。再次进入同一 Surface 返回 live Session，或经 DSH persistence 恢复同一 SessionId，绝不创建第二个执行身份。

Orchestration Registration stream 固定 Definition Revision、绑定与历史边界，并记录 activation、operation record 和 settlement。声明式 reaction 与 revision 内 handler 都通过相同 Event API 发出稳定幂等事件；managed followup 会 admission 未绑定目标或恢复冷 Session，并在 Session flush 证明 durable receipt 后才写 settlement。公开作者目录保持平铺；私有 streams、revision objects、worktrees、socket 和 capability 不进入该布局。新一对一状态协议使用 `v4/`；旧 `v2` 与多对多 `v3` 数据只读报告，不自动迁移或删除。
