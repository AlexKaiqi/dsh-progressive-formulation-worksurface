# WorkSurface 实现索引

> 本文不是第三份设计规范。领域与 DSH Session 集成语义以[完整系统设计](worksurface-complete-design.md)为准，展示语义以 [UI 设计](ui-design.md)为准。

## 设计到实现

| 设计范围 | 主要实现 | 协议与测试 |
| --- | --- | --- |
| Surface、Event、Registration、Definition 原语 | `packages/core/src/event-model.ts` | `spec/event.schema.json`、`spec/definition.schema.json`、`packages/core/tests/event-model-v1.spec.ts` |
| append-only subject streams、幂等与冲突 | `packages/core/src/file-event-store.ts` | `packages/core/tests/file-event-store.spec.ts` |
| 不可变 Revision、snapshot、materialize、pin 与 mark-and-sweep GC | `packages/core/src/revision-store.ts` | `packages/core/tests/revision-store.spec.ts` |
| Definition revision cache 与重建 | `packages/core/src/definition-store.ts` | `packages/core/tests/definition-v1.spec.ts` |
| 条件、activation、planned/actual 投影 | `packages/core/src/orchestration.ts` | `packages/core/tests/definition-v1.spec.ts` |
| Surface/Session 唯一绑定、公共 authoring WIP、CAS 与恢复 | `packages/dsh/src/session-surface.ts` | `spec/context.schema.json`、`packages/dsh/tests/session-surface.spec.ts` |
| 原生产品入口创建/恢复真实 DSH Surface Session；Host 重启后选择性自动续推中断 Session | `packages/dsh/src/session-admission.ts`、`packages/web/client.js` | `packages/dsh/tests/session-admission.spec.ts`、`packages/dsh/tests/session-admission-agent-loop.spec.ts`、`packages/web/tests/web.spec.ts` |
| Registration replay、managed emit、自动 admission followup 与 operation 对账 | `packages/dsh/src/engine.ts`、`packages/dsh/src/session-adapter.ts` | `packages/dsh/tests/engine.spec.ts`、`packages/dsh/tests/session-admission-agent-loop.spec.ts` |
| 精确 Definition Revision handler | `packages/dsh/src/code-handler.ts` | `packages/dsh/tests/code-handler.spec.ts` |
| DSH Session/Turn adapter 与模型环境 | `packages/dsh/src/session-adapter.ts`、`packages/dsh/src/model/session-instructions.ts` | `packages/dsh/tests/session-adapter.spec.ts` |
| 基于事实的模型上下文、provider occurrence 与 render audit | `packages/dsh/src/context/`、`packages/dsh/src/session-adapter.ts` | `docs/context-management.zh.md`、`packages/dsh/tests/context-runtime.spec.ts` |
| 普通文件能力构建 Surface/Orchestration、managed `ws emit` 登记与 Host transport | `packages/cli/src/bin.ts`、`packages/dsh/src/host.ts`、`packages/dsh/src/service.ts` | `spec/authoring-registration.schema.json`、`packages/dsh/spec/host-rpc.json`、`packages/cli/tests/`、`packages/dsh/tests/session-admission-agent-loop.spec.ts` |
| publication 与业务状态 replay projection | `packages/core/src/view-projection.ts` | `packages/core/tests/view-projection.spec.ts` |
| 原生拓扑、事件唤醒重放与证据侧栏 | `packages/web/client.js`、`packages/web/index.js`、`packages/web/styles.css` | `packages/web/tests/web.spec.ts`、`packages/web/evals/suite.json`、`packages/web/evals/browser-harness.mjs` |

## 包边界

```text
core
├── cli
├── dsh ──uses──> cli protocol
└── web ──reads──> dsh service projection
```

- `core` 只拥有领域值、校验、持久事实实现和纯 replay/fold，不依赖 DSH Session 或 Agent。
- `cli` 只拥有事件 transport：模型用普通文件能力构建 Surface、Definition 和文件化 Registration，CLI 只 emit 当前 Surface 事实；它不直接打开或修改 authoring、event、revision 或 projection 文件。
- `dsh` 组装 Host、Surface/Session 唯一绑定、Turn adapter、管理面与持久目录；一个 Surface 的执行历史与恢复身份就是它唯一的 DSH Session。
- `web` 读取 Host 生成的可删除投影和精确 View Definition Revision；“进入推进”只委托 Host admission 并调用 DSH 原生 Session 导航，浏览器不写关系、binding 或执行状态。

## 公开与私有目录

公开作者目录只有平铺的 `surfaces/<surface-id>/` 与 `orchestrations/<orchestration-id>/`；Surface Session 的 cwd 就是这个公共根，当前 Surface 由 `DSH_SURFACE_DIR` 精确定位。私有 root 保存 Revision objects、Surface/Registration streams，以及 `surface-sessions/<surface-id>/{binding.json,context.json}`。绑定文件同时保证一个 Surface 只有一个 Session、一个 Session 只有一个 Surface；socket 和短期 capability 仍是可替换 transport 状态，不进入领域协议。

旧 `v2` Work Session 数据与错误多对多实现产生的 `v3/sessions/<session>/<surface>` 数据只允许通过 `legacy.report` 检查。当前一对一协议使用隔离的 `v4/`，不自动迁移、修改或删除旧数据。
