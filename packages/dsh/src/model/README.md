# 模型表面

`global-instructions.ts` 维护所有 Agent 都需要的 WorkSurface 适用边界和 `"$DSH_WORKSURFACE_CLI" help` 发现入口；操作细节由 CLI 的 `author`、`coordinate`、`publish`、`emit`、`recover` help 维护。普通 Agent shell 获得公共 `$DSH_WORKSURFACE_ROOT` 与不依赖 `PATH` 的 `$DSH_WORKSURFACE_CLI`，可以创建首个 Surface。宿主必须向真实 Bash 调用注入这些变量，缺失时模型应报告注入失败。

`session-instructions.ts` 为已绑定的 Surface Session 提供固定 Scope 和 help/Brief 使用纪律。adapter 在 `system-prompt/assemble` 阶段追加当前 Turn 的 Surface 目录、Brief、authoring root 和 CLI locator；这些路径用于检查，不能替代 Bash 环境注入。Brief v2 提供 instruction、受限输入、独立的 `filePublication` 以及允许的业务 `outputs`、payload Schema 和命令模板。执行前按 help 解析环境路径并替换参数占位符，随后直接以 argv 调用。

文件写入保留作者的 WIP。编排需要读取这些变更时，当前 Turn 先通过 `filePublication` 的 `publish --key` 显式发布，再发送被授权的业务输出。发布不代表业务验收通过，业务 emit 也不自动发布文件；`outputs=[]` 不影响文件发布。DSH 的 `surface.publish` RPC 从当前 Turn capability 唯一确定 Surface，拒绝另传 scope，要求非空白稳定 key、接受可选字符串 summary。相同 key 用于不确定结果的重试，新发布使用新 key；版本比较、幂等记录和文件快照由 Runtime 处理。旧 `emit surface.revision.published` 入口委托同一发布方法，仅用于兼容。

仍使用旧私有 worktree 的 Session 会被明确拒绝发布，避免误将公共目录发布成功却遗漏其私有草稿；此接口不执行工作副本迁移。
