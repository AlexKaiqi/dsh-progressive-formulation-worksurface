# WorkSurface 验证指南

> 本文是验证入口，不重复定义设计。核心不变量来自[完整系统设计](worksurface-complete-design.md)，UI 约束来自 [UI 设计](ui-design.md)。

## 唯一门禁

```sh
source ~/.nvm/nvm.sh
nvm use 24.17.0
pnpm check
```

`pnpm check` 调用 `scripts/check.py`，依次验证：

1. Event、Definition、文件化 Registration、Context schema 和示例；
2. 标准 `surface.md` 模板；
3. `spec/invariants.json` 的编号、enforcement point、测试路径与显式不变量断言标签；
4. Core/Web/CLI 静态边界；
5. TypeScript、bundle、单元测试和 eval suite；
6. Host RPC 与 CLI protocol 同步。

## 机器可读规范

| 文件 | 作用 |
| --- | --- |
| `spec/invariants.json` | `WS-01` 至 `WS-23` 的规范注册表；每项必须指向 enforcement point 和可执行测试 |
| `spec/event.schema.json` | Event envelope、subject、EventRef、meta 与 JSON payload |
| `spec/definition.schema.json` | Definition、role、history、key、条件与 reaction |
| `spec/binding.schema.json` | SurfaceId 与 DSH SessionId 的一对一绑定文件格式 |
| `spec/authoring-registration.schema.json` | `orchestrations/<id>/registration.json` 的稳定 ID 与 role bindings |
| `spec/context.schema.json` | Surface Session 的只读上下文 |
| `spec/surface-template.md` | Surface 七节主契约的唯一模板 |
| `packages/dsh/spec/host-rpc.json` | 可替换 Host transport 的方法集合与版本 |

Markdown 不变量摘要不再单独维护，避免和 `spec/invariants.json` 漂移。设计变化必须先更新权威设计，再同步 registry、schema、实现和测试。

## 恢复与并发验收

| 故障边界 | 证明位置 |
| --- | --- |
| 同 EventId 重试、同 id 异内容冲突、跨实例锁内决策 | `packages/core/tests/file-event-store.spec.ts` |
| snapshot/materialize、只读输入、异常目录和不可变对象 | `packages/core/tests/revision-store.spec.ts` |
| Surface/Session 绑定前产生的孤儿 Revision 由年龄保护并可回收 | `packages/core/tests/revision-store.spec.ts`、`packages/dsh/tests/session-surface.spec.ts` |
| 唯一 binding 写入后可恢复 authoring WIP、已关闭 Turn 的能力拒绝 | `packages/dsh/tests/session-surface.spec.ts` |
| publication append 后修复 authoring checkout | `packages/dsh/tests/session-surface.spec.ts` |
| Session 恢复沿用原执行历史，不创建第二个执行身份 | `packages/dsh/tests/session-surface.spec.ts`、`packages/dsh/tests/session-adapter.spec.ts` |
| Host 重启自动续推 `interrupted`、`aborted/disposed` 与持久 `next-turn`；完成或空闲 Session 保持休眠 | `packages/dsh/tests/session-admission.spec.ts`、`packages/dsh/tests/session-admission-agent-loop.spec.ts` |
| 原生产品 admission 在 Agent 发布前绑定并保持 Session 空白，用户 composer 输入后才开始 Turn | `packages/dsh/tests/session-admission.spec.ts`、`packages/dsh/tests/session-admission-agent-loop.spec.ts`、`packages/web/tests/web.spec.ts` |
| 公共作者目录中的 Session WIP 保守保留；临时 materialization 按 retention 清理 | `packages/dsh/tests/session-surface.spec.ts` |
| Turn 结束但没有 publication 时不伪造 Surface 状态 | `packages/core/tests/view-projection.spec.ts` |
| 用户后续输入开启新 Turn，并沿用该 Surface 作者目录中的持久 WIP | `packages/dsh/tests/session-surface.spec.ts` |
| 第二个 Session 绑定同一 Surface、同一 Session 绑定第二个 Surface均被拒绝 | `packages/dsh/tests/session-surface.spec.ts` |
| operation record、target append、settlement 分段恢复 | `packages/dsh/tests/engine.spec.ts` |
| live wakeup 丢失、重复、乱序后 replay 收敛 | `packages/dsh/tests/engine.spec.ts` |
| handler operation key、固定 Definition revision 和目标授权 | `packages/dsh/tests/code-handler.spec.ts` |
| projection 删除后按 Event/Registration 重建 | `packages/core/tests/view-projection.spec.ts`、`packages/web/tests/web.spec.ts` |

## 人工集成验收

涉及 Host 装配、Cordis Slot 或真实浏览器布局时，在仓库门禁之外执行：

1. 构建并确认 `web` profile 实际链接当前源码包；
2. Host 变更后重启 DSH，Client-only 变更后强刷浏览器；
3. 在原生 `conversation.view` 中检查 Surface 选择、循环拓扑、条件/通路侧栏、暗色主题和窄屏布局；
4. 删除浏览器临时锚点状态并刷新，确认 Host replay 得到等价投影；
5. 模拟 Surface Session 的 Turn 运行、等待用户、失败、恢复与 publication conflict；执行状态看唯一 Session，Surface 图只显示 publication 与显式业务解释。

真实 profile 不可用时，可运行 `node packages/web/evals/browser-harness.mjs`，使用真实 `client.js` 与 `styles.css` 对原生 Slot 组件执行浏览器布局、键盘与侧栏验收；该测试壳不替代 Host/Cordis 的真实 profile 装配。

人工验收不能替代 `pnpm check`，静态门禁也不能替代真实 profile 与浏览器验证。
