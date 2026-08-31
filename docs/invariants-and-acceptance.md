# WorkSurface 验证指南

> 本文是验证入口，不重复定义设计。目标不变量来自[完整系统设计](worksurface-complete-design.md)，UI 约束来自 [UI 设计](ui-design.md)。

## 当前实现兼容性门禁

```sh
source ~/.nvm/nvm.sh
nvm use 24.17.0
pnpm check
```

`pnpm check` 当前验证交互图规格与生成 HTML 的摘要、9/9 Showcase receipt，以及旧分层实现自身的一致性：Event、JSON Definition、文件化 Registration、Revision-centric Context schema、强制 Surface 模板、`spec/invariants.json`、包边界、TypeScript、单元测试、eval suite、Host RPC 与 CLI protocol。

这些检查仍然有价值，但通过只表示当前实现兼容，不表示已经满足新的完整设计。

## 当前机器协议

| 文件 | 当前作用 | 目标迁移 |
| --- | --- | --- |
| `spec/invariants.json` | 旧 `WS-01` 至 `WS-23` 实现注册表 | 原子替换为完整设计中的目标不变量与 enforcement/test |
| `spec/event.schema.json` | WorkSurface Event envelope 与 EventRef | 增加 DSH Session EventRef adapter，不复制 DSH event |
| `spec/definition.schema.json` | JSON Definition、condition 与 reaction | 支持 YAML pattern/Code 到统一 Orchestrate IR |
| `spec/binding.schema.json` | Surface 与 DSH Session 的一对一 Binding | 保留为首个 DSH adapter 策略 |
| `spec/authoring-registration.schema.json` | 文件化 Registration | 收敛为 Orchestrate Instance 的一种装配记录 |
| `spec/context.schema.json` | Revision-centric Session context | 扩展为 Materialization/EventRef/provider Context Projection |
| `spec/surface-template.md` | 当前强制 Surface 契约 | 降为可选 Surface Profile/template fixture |
| `packages/dsh/spec/host-rpc.json` | Host transport 方法与版本 | 保持 transport，不升级为领域模型 |

## 目标迁移验收

完成概念迁移至少必须新增以下可执行门禁：

1. 没有 `surface.md` 的 Surface 可以合法存在并被上下文 provider 投影。
2. 文件 fragment、结构化对象局部、事件范围和外部 artifact 元素都能通过 adapter locator 定位；冻结引用必须携带可重放 boundary。
3. 一个 Turn/Step 维护的 Surface 内容能在后续 Context Projection 中按同一逻辑地址读取；omitted 内容不会丢失。
4. Revision 只证明文件 Materialization snapshot，不被当作全部 Surface 内容事实。
5. WorkSurface 能稳定引用 DSH `turn/*`、`step/*`、`tool/*` 事件而不复制它们。
6. YAML pattern 与 Code 对相同输入产生相同标准 Effect 语义。
7. `turn/end`、`step/end`、Tool Call 成功和上下文发布均不会产生 `surface.completed`。
8. Session、Turn、Step、Tool Call 的 UI、恢复和日志映射与 DSH 定义一致。
9. Context Plan 明确区分 `included`、`omitted`、`required`，并拒绝把 omitted 描述为已消费。
10. Runtime 自动补齐可信 Session/Turn/Instance/Activation/causality/capability 字段，模型不需要记忆内部 ID。
11. 删除 topology、Context Plan cache、UI projection 与 live state 后可以从权威事实重建。
12. 一个 Surface 可以拥有多个有序 Episode，沉淀 Episode 不改变 SurfaceId。
13. Episode 能稳定引用实际 DSH Step、Tool Call 与 Surface 修改，且不会复制 transcript。
14. Episode 边界由显式协议决定，不能通过 `turn/end`、`step/end` 或工具成功隐式推断。
15. Episode 推进中可以产生自定义 Event，Orchestrate 能按事件名与 payload 可靠匹配，例如 `research.completed`。
16. Event payload 同时支持 inline JSON 与 content ref；用于重放、跨 Surface 传递或验收证据的 ref 必须固定 boundary。
17. Orchestrate 只依赖已经可靠接纳的 Event 形成推进决策；Event 重放得到相同 Activation / Effect。
18. WorkSurface Runtime 的测试只覆盖 Surface / Episode 推进控制，并通过 adapter 验证 DSH 调用；不得要求或伪造 DSH 的同名 Runtime 抽象。

## 当前可靠性证据

下列机制与目标设计兼容，可以作为迁移基础：

| 故障边界 | 当前证明位置 |
| --- | --- |
| 同 EventId 重试、同 id 异内容冲突、跨实例锁内决策 | `packages/core/tests/file-event-store.spec.ts` |
| 文件 snapshot/materialize、异常目录与不可变对象 | `packages/core/tests/revision-store.spec.ts` |
| Surface/Session Binding、authoring WIP 与 publication CAS | `packages/dsh/tests/session-surface.spec.ts` |
| Host 重启选择性恢复中断 Session 与持久 `next-turn` | `packages/dsh/tests/session-admission.spec.ts`、`packages/dsh/tests/session-admission-agent-loop.spec.ts` |
| Operation record、target append、settlement 分段恢复 | `packages/dsh/tests/engine.spec.ts` |
| live wakeup 丢失、重复、乱序后 replay 收敛 | `packages/dsh/tests/engine.spec.ts` |
| handler operation key、固定 Definition revision 与目标授权 | `packages/dsh/tests/code-handler.spec.ts` |
| projection 删除后按事件重建 | `packages/core/tests/view-projection.spec.ts`、`packages/web/tests/web.spec.ts` |

## 人工集成验收

涉及真实 DSH、Cordis Slot 或浏览器布局时：

1. 构建并确认 `web` profile 实际链接当前源码包；
2. Host 变更后重启 DSH，Client-only 变更后强刷浏览器；
3. 检查 Surface 选择、循环拓扑、条件证据、暗色主题和窄屏布局；
4. 删除临时锚点与 projection 后刷新，确认 replay 收敛；
5. 分别观察 Session、Turn、Step、Tool Call、上下文发布和显式 `surface.completed`，确认 UI 没有折叠成一条状态。

真实 profile 不可用时，可以运行 `node packages/web/evals/browser-harness.mjs` 做布局、键盘和侧栏验收；测试壳不替代真实 DSH 集成。
