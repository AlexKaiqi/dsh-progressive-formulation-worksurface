# WorkSurface

WorkSurface v1 是建立在 DSH 之上的文件化、事件驱动协调层。本文只描述当前代码已经实现的对象和边界。

当前 Surface 没有独立聚合对象。`SurfaceId` 是贯穿以下物理事实的关联键：

- `work/surfaces/<surface-id>/`：模型持续维护的作者工作目录；当前 Revision 协议要求包含 `surface.md`；
- `v4/events/surfaces/<surface-id>.jsonl`：该 Surface 的 WorkSurface Event stream；
- `v4/surface-sessions/<surface-id>/binding.json`：Surface 与唯一 DSH Session 的固定绑定；
- `v4/revisions/`：发布后的不可变目录快照。

Surface 的实际模型与工具执行由绑定的 DSH Session 承载。DSH 语义保持原样：Session 是完整的 append-only 交互历史；一个 Turn 包含零到多个 Step；一个 Step 是一次模型调用及该调用请求的工具执行。WorkSurface 不另建执行历史。

当前 Orchestration 路径是：

```text
definition.json + registration.json
          ↓ admission / snapshot
exact OrchestrationDefinition + Registration stream + Surface streams
          ↓ replay / reconcile
Activation → durable Operation → emit 或 followup → settlement
```

作者侧目前只有 JSON Definition；没有 YAML compiler，也没有独立 Definition IR。声明式 reaction 与 code handler 都由同一 Engine 调度，但二者尚未收敛成统一 Effect evaluator。

模型继续使用 Bash、Zsh、Python、Node 和普通文件能力。模型侧唯一 WorkSurface 领域命令是 `ws emit`；可信实现补齐事件身份、因果、绑定和 capability。

详见：

- [系统设计交互图](docs/interactive/worksurface-system.html)：Surface、DSH 执行、事件与 Orchestrate 的关系
- [完整系统设计](docs/worksurface-complete-design.md)：当前定位、严格概念定义、流程和未实现项
- [实现索引](docs/architecture.md)：概念到源码与存储的映射
- [UI 设计](docs/ui-design.md)：基于当前事实的可删除投影
- [模型上下文](docs/context-management.zh.md)：当前 Context Runtime 的事实模型
- [验证指南](docs/invariants-and-acceptance.md)：机器不变量、测试证据和新概念准入门槛

```sh
source ~/.nvm/nvm.sh
nvm use 24.17.0
pnpm install
pnpm check
```
