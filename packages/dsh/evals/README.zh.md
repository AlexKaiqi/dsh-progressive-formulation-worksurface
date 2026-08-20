# WorkSurface 真实模型行为评估

这里回答的不是“prompt 有没有写”，而是“真实模型是否知道什么时候用、能否正确使用，以及能否稳定恢复和交付”。静态模型契约仍由 `tests/model-awareness.spec.ts` 负责；这里的每个 trial 必须启动全新真实 DSH Session，并保留原始轨迹。

## 覆盖范围

| 用例 | 验证问题 |
|---|---|
| MODEL-E2E-01 | 用户不点名 WorkSurface 时，复杂任务是否主动采用 |
| MODEL-E2E-02 | 简单任务是否正确跳过，避免过度编排 |
| MODEL-E2E-03 | 是否真正会 checkout、编辑、精确 base commit 和报告 revision |
| MODEL-E2E-04 | 是否正确区分 Block 与独立 Surface |
| MODEL-E2E-05 | 是否能做多子任务委派，并形成真实 revision-pinned 信息依赖 |
| MODEL-E2E-06 | stale revision 后是否能重新 checkout、合并和提交 |
| MODEL-E2E-07 | 最终回答是否和 Store、绑定、图边完全可追溯 |
| MODEL-E2E-08 | 多次运行和模型矩阵中的通过率、关键违规与效率 |

精确 prompt、trial 数、criterion 和通过标准维护在 `suite.json`。修改 guidance、工具描述、CLI 帮助、子 Agent persona、错误文案或模型版本时，都应执行受影响用例。

## 执行规则

1. 每个 trial 使用新的隔离 Session 和空 WorkSurface root。
2. 原样使用 catalog prompt，不额外暗示 WorkSurface、命令或正确步骤。
3. MODEL-E2E-06 由夹具在第一次 checkout 后制造一次并发提交。
4. 每个 criterion 必须从 Session 轨迹、工具参数、Store revision、绑定或图快照中给出证据。
5. 结果按 `run.schema.json` 保存到 `runs/<date>-<model>.json`；原始 Session 不删除。
6. release 用例任何 criterion 失败即为失败；MODEL-E2E-08 使用 suite 中的统计阈值。

运行静态 catalog 校验：

```sh
npm --workspace @pf-worksurface/dsh run eval:check
```

当前目录尚未提交一次完整真实模型矩阵 run。这表示用例和证据协议已经覆盖，但不能声称模型行为已经通过；首次执行后必须新增 run 记录，不能回填或伪造结果。
