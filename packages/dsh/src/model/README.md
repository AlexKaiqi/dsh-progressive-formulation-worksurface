# 模型表面

`session-instructions.ts` 是当前唯一模型可见事实源，并且只注入已经绑定 Surface 的 DSH Session。它明确说明当前 Session 就是唯一 Surface 的推进历史，模型不能打开、选择或切换当前绑定；模型读取 `DSH_CONTEXT_FILE`，在公共 `DSH_WORKSURFACE_ROOT` 中用普通工具构建 `surfaces/` 与 `orchestrations/`，通过 `DSH_SURFACE_DIR` 定位当前 Surface，并只用 `ws emit` 记录领域事实或发布 Revision。Runtime 在 managed emit 前固定文件化 Registration，执行进度、等待输入、模型调用失败和重试沿用该 Session 的 Turn/Step 语义。它不暴露 create/register 命令、直接副作用编排或第二套 command 模型。
