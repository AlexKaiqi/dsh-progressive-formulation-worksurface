# @pf-worksurface/cli

目标公开 CLI 是 WorkSurface 模型帮助与 Event Service 的薄客户端：

```text
ws help [author|coordinate|emit|recover]
ws emit <event-name> [--surface <surface-id>] [--key <operation-key>] [--payload <json>]
```

Surface 与 DSH Session 在 Agent 启动前已经唯一绑定。`ws emit <name>` 从受信任的 `DSH_SURFACE_ID` 解析唯一目标，不能打开或切换 Surface。离开 Surface Session 上下文后，管理调用者必须显式提供 Surface；CLI 不进行猜测。

`ws help` 先给出极短场景索引，再按模型实际动作披露 author、coordinate、emit 或 recover 的完整说明。模型 shell 通过稳定的 `"$DSH_WORKSURFACE_CLI" help` 调用同一入口，因为 profile `.bin` 不保证在 `PATH`；人工 shell 中的 `ws` shim 仍可直接使用。Surface 与 Orchestration 目录仍由 Bash、Zsh、Python、Node.js 和编辑器直接构造，不提供 create/derive/clone/write/register CLI。普通 Agent shell 可通过 `DSH_WORKSURFACE_ROOT` author 首个 Surface；活动 Surface Turn 再获得当前 Surface 与 Brief 的三个变量。`orchestrations/<id>/registration.json` 把 Registration 身份与角色绑定文件化；managed emit 先让 Runtime 固定尚未登记的 Registration，再 append 请求的 root event。Definition inspection 与已登记生命周期控制属于 Host/Web/SDK 管理面。

CLI 只做认证 transport、参数编码、结果展示和退出码，不直接打开 persistence、对象库或 projection，也不实现匹配、handler 调度、幂等或 Agent 推进。transport 可替换。
