# 模型表面

`session-instructions.ts` 是当前唯一模型可见事实源，并且只注入已经绑定 Surface 的 DSH Session。它明确说明当前 Session 就是唯一 Surface 的推进历史，模型不能打开、选择或切换 Surface；模型读取 `DSH_CONTEXT_FILE`、在 Session cwd 中用普通工具修改当前 worktree，并用 `ws emit` 记录领域事实或发布 Revision。执行进度、等待输入、模型调用失败和重试沿用该 Session 的 Turn/Step 语义。它不暴露直接副作用编排或第二套 command 模型。
