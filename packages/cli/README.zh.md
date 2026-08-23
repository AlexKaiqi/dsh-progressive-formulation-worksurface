# @pf-worksurface/cli

[English](README.md) | 中文

`@pf-worksurface/cli` 提供普通 Bash 与 Python Orchestrator 使用的 Git 风格 `ws` 进程边界。在 DeepSeek Harness attempt 内，它向私有 Host socket 发送已认证的 NDJSON 请求；在 attempt 外，只有显式提供 `WS_STORE_ROOT` 时，文件命令才能直接操作。

## 命令

```text
ws checkout <surface> <target> [--revision <revision>]
ws commit <working-copy> --base <revision> --key <key> [--retry]
ws show <surface> [--revision <revision>] [--projection --profile <name>]
ws agent run --surface <surface> --task <text> --profile <name> --key <key> --result <path> [--from <template>] [--parent <surface>]
ws help init
```

Effect 命令要求稳定的 key。`--json` 在 stdout 输出一个 JSON 值；失败在 stderr 输出稳定的错误对象；`ws agent run` 原子写入其结构化结果文件。路径和文档内容按 UTF-8 传递，支持空格与非 ASCII 字符。

## 初始化指引

`ws help init` 是面向模型、按需披露的首个有效 revision 编写指引。它要求可编辑 checkout 位于 `WS_ATTEMPT_DIR` 内，定义最低限度的 root state，把 `surface.md` 保持为当前索引，给出新 Block 所需的 front matter 与引用语法，区分事实、假设和已取代内容，并把 child Surface 限定为可独立负责的交付物。它属于本地静态帮助：读取无需 Host credential，也不会改变任何 WorkSurface state。

## 权限模式

存在 `WS_HOST_SOCKET`、`WS_ATTEMPT_ID` 和 `WS_ATTEMPT_TOKEN` 时，CLI 使用 `WorkSurfaceHostClient`；`DSH_WS_*` 别名支持子 Agent 的 shell environment。若存在 attempt-directory 变量但没有 Host socket，CLI 会 fail closed，而不会回退到 canonical 文件。

直接模式要求 `WS_STORE_ROOT`，并为管理和测试提供对既有 canonical state 的操作。`agent run` 仅限 Host，因为只有插件能执行 file-first 物化、attach 或恢复 continuable child Session，并校验 canonical JSON completion。

## 退出状态

成功为 `0`；未找到为 `10`；revision 冲突为 `11`；无效 working copy 与引用为 `12`；幂等 key 冲突为 `13`；授权失败为 `14`；其余稳定失败为 `15`。

## 模型体验

通过普通 Orchestrator 与子 Agent shell 调用间接产生；其结果由 `@pf-worksurface/dsh` 渲染。Agent 只有在运行 `ws help init` 后才会看到初始化指引。

#### KV Cache 影响

不会直接失效；parent tool 或 child shell-tool result 负责追加的模型上下文。

## 已知限制与延期工作

- **仅支持本地 socket 上的 NDJSON** — client 在每个私有 Unix-domain connection 上实现一个请求，没有网络 transport。
- **没有交互式冲突解决器** — revision 冲突会显式返回，必须由 Orchestrator 通过另一次 checkout 或任务特定策略处理。
- **直接模式有意更窄** — 它不暴露 `agent run`，并且绝不能由 attempt environment 启用。
