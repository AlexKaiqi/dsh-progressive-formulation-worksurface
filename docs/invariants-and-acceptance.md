# WorkSurface 验证与概念准入

## 1. 当前实现门禁

```sh
source ~/.nvm/nvm.sh
nvm use 24.17.0
pnpm check
```

`pnpm check` 校验：交互图 source/artifact receipt、JSON schemas、`WS-01` 至 `WS-23` 注册表、包边界、TypeScript、单元测试、Host RPC 与生成协议。

当前机器协议包括：

| 文件 | 当前物理作用 |
| --- | --- |
| `spec/event.schema.json` | WorkSurface Event envelope 与 EventRef |
| `spec/definition.schema.json` | `OrchestrationDefinition v1`；也是当前作者 JSON 和 Engine 消费对象 |
| `spec/authoring-registration.schema.json` | 文件化 Registration authoring record |
| `spec/binding.schema.json` | Surface 与 DSH Session 的一对一 Binding |
| `spec/context.schema.json` | DSH Session facts、Revision files、provider occurrence、Context Plan 与 render manifest |
| `spec/surface-template.md` | 当前 Surface Revision 强制要求的 `surface.md` 结构 |
| `spec/invariants.json` | 当前 `WS-01` 至 `WS-23` 的 enforcement/test 索引 |

## 2. 当前关键不变量

以下是机器注册表的结构化摘要，准确清单以 [`spec/invariants.json`](../spec/invariants.json) 为准：

- 一个 Surface 与一个 DSH Session 固定绑定，且在首个 Turn 前完成；Orchestration 和 Registration 保持独立身份。
- Surface/Definition 内容以不可变 Revision 表示；当前 Surface Revision 必须包含合法 `surface.md`。
- Event append 对同 ID 同内容幂等、同 ID 异内容冲突；`seq` 只在一个 subject stream 内有序，跨 stream 用 EventRef。
- Registration 固定 Definition Revision、bindings 和历史边界；Activation 由 Registration、Subscription 和业务 key 决定。
- Operation 在外部效果前记录、之后结算；重启通过 replay 恢复未结算 Operation。
- 执行状态来自 DSH Session/Turn，不写成第二套 Surface 执行生命周期。
- 模型用普通文件工具工作，唯一领域命令是 `ws emit`；Turn capability 在 Turn 结束后失效。
- UI 和 projection 可删除，并从持久事实重建。

## 3. 可执行证据

| 故障或边界 | 主要测试 |
| --- | --- |
| Event 幂等、冲突与并发 append | `packages/core/tests/file-event-store.spec.ts` |
| Revision snapshot/materialize 与不变性 | `packages/core/tests/revision-store.spec.ts` |
| Definition、Registration、Activation 派生 | `packages/core/tests/definition-v1.spec.ts` |
| Surface/Session Binding、WIP、publication CAS | `packages/dsh/tests/session-surface.spec.ts` |
| Engine replay、Operation 恢复、live wakeup 收敛 | `packages/dsh/tests/engine.spec.ts` |
| Code handler 固定 Revision、授权与输出协议 | `packages/dsh/tests/code-handler.spec.ts` |
| DSH Session adapter 与 Turn capability | `packages/dsh/tests/session-adapter.spec.ts` |
| Context plan、provider occurrence、render audit | `packages/dsh/tests/context-runtime.spec.ts` |
| View projection 删除后重建 | `packages/core/tests/view-projection.spec.ts`、`packages/web/tests/web.spec.ts` |

## 4. 新概念准入门槛

任何准备进入当前系统模型的新概念，必须在同一个实现变更中交付：

1. 稳定身份及与既有 ID 的关系；
2. TypeScript 类型和需要持久化时的 schema；
3. 权威存储位置、写入者和并发规则；
4. 明确开始/结束或状态转换边界；
5. 从事实重建的 fold/replay；
6. 崩溃、重试和幂等行为；
7. 到 DSH Session Event 或 WorkSurface EventRef/Revision 的引用协议；
8. 覆盖正常路径、冲突和恢复的测试；
9. 同步更新实现图与设计文档。

`Episode` 当前不满足任何上述物理要求，禁止把它用于当前领域模型、UI 分组或验收语言。YAML compiler、独立 Definition IR 和统一 Effect evaluator 同样只能作为演进提案，不能写成既有边界。

## 5. 人工集成验收

涉及真实 DSH 或浏览器布局时：

1. 构建并确认 `web` profile 链接当前源码包；
2. Host 变更后重启 DSH，Client-only 变更后强刷浏览器；
3. 分别检查 WorkSurface Event/Activation/Operation 与 DSH Turn/Step/Tool Call，不把层级折叠；
4. 删除 projection 或刷新页面，确认 replay 收敛；
5. 检查暗色主题、窄屏、条件证据和失败恢复。

真实 profile 不可用时，可运行 `node packages/web/evals/browser-harness.mjs` 做 UI 验收；测试壳不替代真实 DSH 集成。
