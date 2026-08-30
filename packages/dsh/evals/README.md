# DSH 事件编排验收

`npm run eval:check` 会先确认 `suite.json` 引用的测试文件真实存在，再执行行为测试。套件覆盖历史边界与业务 key、operation record/settlement 崩溃恢复、Surface/Session 唯一绑定与持久 worktree、Turn capability、publication CAS、handler Event API 边界，以及 CLI/Service transport 等价性。真实 profile 和模型 loop 证据仍是独立的发布验收门。
