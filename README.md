# WorkSurface

WorkSurface 是一套平台无关的文件化、事件驱动工作设计；当前由 DSH adapter 提供运行接入，未来可由 pi 等宿主复用同一设计与推进 Runtime。当前默认 authoring 面已经收敛到 code-first 目标协议；旧 `Definition v1` 仅作为 `v4` 数据与既有目录的兼容执行路径保留。

当前 Surface 没有独立聚合对象。`SurfaceId` 是贯穿以下物理事实的关联键：

- `work/surfaces/<surface-id>/`：模型持续维护的作者工作目录；当前 Revision 协议要求包含 `surface.md`；
- `v5/authority.json`：持久 authority namespace；
- `v5/events/surfaces/<surface-id>.jsonl`：带 scoped Contract identity 的目标 Event stream；
- `v5/contracts/sha256/`、`registrations/`、`input-ledgers/`、`operation-ledger/`：不可变 Contract、Registration、输入与恢复事实；
- `v4/events/`：旧 Definition v1 兼容事实，不与 v5 envelope 混写；
- `v4/surface-sessions/<surface-id>/binding.json`：Surface 与唯一 DSH Session 的固定绑定；
- `v4/revisions/`：发布后的不可变目录快照。

Surface 的实际模型与工具执行由宿主 Session 承载。DSH adapter 中，Session 是完整的 append-only 交互历史；一个 Turn 包含零到多个 Step；一个 Step 是一次模型调用及该调用请求的工具执行。WorkSurface 不另建执行历史。

代码分层为：`@pf-worksurface/core` 保存领域事实与不可变材料，`@pf-worksurface/design` 保存模型可见概念、边界和 Prompt 模板，`@pf-worksurface/runtime` 负责平台无关的推进、编排和恢复，`@pf-worksurface/dsh` 只负责 DSH Session/Turn、上下文注入、事件投影和执行环境适配。

当前 code-first Orchestration 路径是：

```text
artifact/ + registration.json
          ↓ admission / content-addressed snapshot
exact code Revision + resolved Event Contracts + Registration + Input Ledger
          ↓ staged run / complete validation
authority-global Operation batch → apply → Event / advance → settlement
```

Registration 只装配现有 Surface 与 Event route；业务条件、转换、fan-out、join 和 loop 都是普通代码。没有 YAML/JSON pattern DSL、独立 Definition IR 或模型编写的 effect plumbing。

模型继续使用 Bash、Zsh、Python、Node 和普通文件能力。普通 Agent 收到精简的 WorkSurface 适用边界、`$DSH_WORKSURFACE_CLI help` 入口和公共作者根，可从零 author 首个 Surface；`help author|coordinate|emit|recover` 按模型动作渐进披露具体协议。稳定的 CLI 环境变量避免依赖 profile `.bin` 是否进入模型 shell 的 `PATH`；存在 `ws` shim 时它只是等价便捷入口。活动 Surface Turn 再获得 `DSH_SURFACE_ID`、`DSH_SURFACE_DIR`、`DSH_WORKSURFACE_VIEW_DIR` 与 `turn-brief.json`；唯一领域命令是 Brief 中给出的精确 emit argv。namespace、digest、cause resolution 与 Operation 由 Runtime 补齐。一次性 transport 是 Host 的执行材料而非语义契约；它不进入 prompt、Brief 或稳定环境变量，但同一 OS 用户下的模型 shell 可能读取运行目录，因此安全边界是当前 Turn capability 的绑定与失效，不是 transport 字符串保密。

详见：

- [系统设计交互图](docs/interactive/worksurface-system.html)：Surface、DSH 执行、事件与 Orchestrate 的关系
- [Surface 演化、复用与 Promotion](docs/surface-evolution-and-promotion.md)：实例派生、检索、模板提升和反馈闭环的目标设计提案
- [完整系统设计](docs/worksurface-complete-design.md)：当前定位、严格概念定义、流程和未实现项
- [实现索引](docs/architecture.md)：概念到源码与存储的映射
- [平台适配边界](docs/platform-adapters.md)：设计材料、推进 Runtime 与 DSH/pi adapter 的责任拆分
- [UI 设计](docs/ui-design.md)：基于当前事实的可删除投影
- [可重复管线方向](docs/repeatable-pipeline-direction.md)：Template、Invocation、参数、多模态 ArtifactRef 与 Design/Run/Evidence 边界
- [模型上下文](docs/context-management.zh.md)：当前 Context Runtime 的事实模型
- [验证指南](docs/invariants-and-acceptance.md)：机器不变量、测试证据和新概念准入门槛
- [模型用例覆盖矩阵](docs/model-readiness-coverage.md)：八个直接询问 Agent 的使用用例，覆盖概念、边界、适用性、开始、进入、拆分、authoring、协调和授权输出
- [重构与验证报告](docs/verification-report-2026-09-02.md)：重构后的真实 profile E2E 证据与剩余模型就绪性缺口

```sh
source ~/.nvm/nvm.sh
nvm use 24.17.0
pnpm install
pnpm check
```
