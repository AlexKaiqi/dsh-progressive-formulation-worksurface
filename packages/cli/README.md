# @pf-worksurface/cli

目标公开 CLI 是 WorkSurface Event Service 的薄客户端：

```text
ws emit <event-name> [--surface <surface-id>] [--key <operation-key>] [--payload <json>]
```

Surface 与 DSH Session 在 Agent 启动前已经唯一绑定。`ws emit <name>` 从受信任的 `DSH_SURFACE_ID` 解析唯一目标，不能打开或切换 Surface。离开 Surface Session 上下文后，管理调用者必须显式提供 Surface；CLI 不进行猜测。

Surface 与 Orchestration 目录由 Bash、Zsh、Python、Node.js 和编辑器直接构造，不提供 create/derive/clone/write CLI。Definition 生命周期和 inspection 属于 Host/Web/SDK 管理面。

CLI 只做认证 transport、参数编码、结果展示和退出码，不直接打开 persistence、对象库或 projection，也不实现匹配、handler 调度、幂等或 Agent 推进。transport 可替换。
