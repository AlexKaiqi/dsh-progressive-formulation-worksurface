# WorkSurface

WorkSurface 是 DSH 之上的**工作上下文推进层**。领域主轴先收敛为两个概念：

- **Surface**：可寻址、持续维护的结构化工作上下文。具体包含什么由当前问题决定；目录、文件、外部对象和对话都只是它可能引用的 materialization。模型可定位并维护局部，但每个 Step 只投影当前所需内容。
- **Episode**：一个 Surface 上一次有边界的推进。一个 Surface 有一系列有序 Episode；每个 Episode 包含或引用本次推进中的模型步骤、工具调用、Surface 修改、结果与证据。

Event、Orchestrate 和 WorkSurface Runtime 是围绕这条主轴工作的推进机制：Episode 推进中可以产生自定义 Event；payload 可直接携带信息，也可携带文件等内容引用；Orchestrate 依赖 Event 形成推进决策；WorkSurface Runtime 负责控制 Surface / Episode 如何继续。

Orchestrate 的 YAML 与 Code 都只是作者 Source，必须经过 compile / adapt 形成同一种不可变 Definition IR；Instance 再用 DefinitionRef 绑定实际 Surface。推进控制层只接受 `Definition + Instance + Event[]`，并只产生标准 `Effect[]`，不会直接解释 YAML 或作者代码。

WorkSurface Runtime 是本文对“推进控制器”的暂用名，不是 DSH 术语，也不假设 DSH 存在同名抽象。当前实现只是通过 adapter 借用 DSH Session 承载实际模型与工具执行。

首个 DSH adapter 暂时采用一个 Surface 绑定一个 DSH Session，由该 Session 承载 Episode 的实际执行与权威日志；这是实现策略，不是 Surface 或 Episode 的定义。Episode 不预设与 DSH Turn 或 Step 一一对应。Session、Turn、Step、Tool Call 仍严格沿用 DSH 原义。

模型继续使用 Bash、Zsh、Python、Node 和普通文件能力组合复杂工作。WorkSurface 尽量不增加模型工具；推进控制层只注入少量稳定变量和入口，并自动补齐可信身份、因果与权限字段。`surface.md` 可以作为文件型 Surface 的可选 Profile，但不是通用协议要求。

详见：

- [可交互系统设计图](docs/interactive/worksurface-system.html)：从五个审查视图探索 Surface / Episode、Orchestrate 编译边界、事件驱动推进与执行承载边界
- [完整系统设计](docs/worksurface-complete-design.md)：定位、边界、核心概念、关系、DSH 语义、恢复和不变量
- [UI 设计](docs/ui-design.md)：上述事实与语义的可删除投影
- [模型上下文](docs/context-management.zh.md)：开放 Surface 如何投影为一次模型调用的上下文
- [实现索引](docs/architecture.md)：目标设计与当前代码的对应关系及迁移差距
- [文档索引](docs/README.md)：规范、实现和验证入口

```sh
source ~/.nvm/nvm.sh
nvm use 24.17.0
pnpm install
pnpm check
```
