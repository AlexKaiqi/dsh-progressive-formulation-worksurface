# WorkSurface Web 端到端评估

这里维护 `@pf-worksurface/web` 的产品级评估体系。它和单元测试关注点不同：单元测试验证函数与领域不变量；这里验证真实 DSH 中用户能够完成的整条链路。

## 评估资产

- `suite.json`：版本化的评估维度、fixture 约束、用例目的、步骤、预期结果和证据要求。
- `fixtures/`：生成固定 3 节点、2 条信息依赖 WorkGraph 的文件模板。
- `seed.mjs`：把固定 fixture 绑定到三个真实 DSH Session。
- `runs/`：不可覆盖的实际执行记录；一次执行新增一个带日期和环境标识的 JSON。
- `validate-suite.mjs`：检查维度覆盖、用例结构、run/suite 版本和 release gate。

## 用例与验证目标

| 用例 | 主要验证目标 | 级别 |
|---|---|---|
| E2E-01 插件加载与视图入口 | Cordis 配置、服务注入、浏览器模块注册、资源加载 | release |
| E2E-02 Session 定位整张 WorkGraph | 根/子 Session 到同一顶层图的解析和 current 高亮 | release |
| E2E-03 信息依赖与 Surface 详情 | revision-pinned BlockRef 边以及 Surface/Block 主内容 | release |
| E2E-04 对话附着与双向导航 | Session 对话投影、节点打开 Session、返回同一根图 | release |
| E2E-05 未绑定错误与轮询恢复 | 过渡错误、自动恢复、旧错误清除 | release |
| E2E-06 图视图基础交互 | 缩放和返回宿主对话 | release |
| E2E-07 Agent 委派全生命周期 | Agent 自动产生 Surface、绑定、Projection 和图更新 | extended |
| E2E-08 高密度概览与稳定刷新 | 紧凑状态摘要、无变化轮询去重和局部更新状态保持 | release |

`release` 用例必须全部通过才能记录一次有效 release run。`extended` 用例允许记录 `not_run`，但不能从 catalog 删除来掩盖覆盖缺口。

## 执行流程

先构建仓库并校验评估定义：

```sh
npm run build
npm --workspace @pf-worksurface/web run eval:check
```

准备一个位于安全持久路径、仅用于本次测试的空 Store。不要使用生产 Store，也不要放在 `/tmp`。从隔离 DSH profile 选择三个不同的真实 Session，其中根和 source Session 至少各有一条对话，然后执行：

```sh
npm --workspace @pf-worksurface/web run eval:seed -- \
  --root /absolute/path/to/isolated-eval-state \
  --root-session session-root-id \
  --source-session session-source-id \
  --target-session session-target-id
```

把隔离 DSH profile 的 WorkSurface root 指向同一路径，安装或 workspace-link 当前插件，启动 DSH Web。严格按 `suite.json` 的用例顺序执行，并收集每个用例声明的 evidence。

## 记录结果

1. 复制最近的 `runs/*.json` 为新的日期和环境文件名，不覆盖历史记录。
2. `suiteId` 和 `suiteVersion` 必须与当前 `suite.json` 一致。
3. 每个 catalog 用例必须恰好有一个结果；失败、阻塞和未执行都必须如实记录。
4. observation 记录可复核的值，例如节点数、边数、Session ID、对话计数、computed display 或 console 时间边界，不能只写“正常”。
5. 执行 `npm --workspace @pf-worksurface/web run eval:check`。release 用例存在非 `passed` 结果时，记录校验失败。

## 维护规则

- 产品行为变化时，先修改评估维度或用例，再修改实现。
- 修复真实 E2E 缺陷时，必须补充相应自动回归测试，并在 run 的 `findings` 中记录。
- `suite.version` 在用例语义、fixture 或验收条件变化时递增；纯文字修正不需要递增。
- 历史 run 永不改写。旧版本 suite 保存在 `snapshots/`，校验器会按 run 的 `suiteVersion` 选择对应快照。
- Store seed 只验证已有数据的 Web 链路；E2E-07 单独覆盖真实 Agent 产生数据的生命周期，二者不能互相冒充。
