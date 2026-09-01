# DSH 事件编排验收

`npm run eval:check` 会先确认 `suite.json` 与 `model-readiness.json` 引用的测试文件和 evidence marker 真实存在、生成的覆盖矩阵没有漂移，再执行全部引用的行为测试。套件覆盖历史边界与业务 key、operation record/settlement 崩溃恢复、Surface/Session 唯一绑定与持久 authoring WIP、Turn capability、publication CAS、handler Event API 边界、CLI/Service transport 等价性，以及七个可直接询问 Agent 的使用用例。

`model-readiness.json` 是用例、L0–L3 可观察要求和 evidence ID 的唯一事实源；[`docs/model-readiness-coverage.md`](../../../docs/model-readiness-coverage.md) 由它生成。修改后运行：

```sh
node packages/dsh/evals/model-readiness-matrix.mjs --write
```

低层证据不能满足高层要求。真实 profile/model loop 没有通过时，L3 必须保持 `blocked` 或 `failed`，不能用 Prompt 断言、替身模型或 Runtime 测试改成通过。
