# DSH 事件编排验收

`npm run eval:check` 会先确认 `suite.json` 与 `model-readiness.json` 引用的测试文件和 evidence marker 真实存在、生成的覆盖矩阵没有漂移，再执行全部引用的行为测试。套件覆盖历史边界与业务 key、operation record/settlement 崩溃恢复、Surface/Session 唯一绑定与持久 authoring WIP、Turn capability、publication CAS、handler Event API 边界、CLI/Service transport 等价性，以及八个可直接询问 Agent 的使用用例（概念/边界、适用性、首次 authoring、Turn 进入、拆分、Surface 内容、协调、授权输出）。

`model-readiness.json` 是用例、L0–L3 可观察要求和 evidence ID 的唯一事实源；[`docs/model-readiness-coverage.md`](../../../docs/model-readiness-coverage.md) 由它生成。修改后运行：

```sh
node packages/dsh/evals/model-readiness-matrix.mjs --write
```

低层证据不能满足高层要求。真实 profile/model loop 没有通过时，L3 必须保持 `blocked` 或 `failed`，不能用 Prompt 断言、替身模型或 Runtime 测试改成通过。

## Bash 与真实 Agent 使用验收

`agent-acceptance-prompts.json` 单独固定 ENV-A1、WS-M1、WS-M2、WS-M3 的输入和证据要求。四项不继承上述历史 readiness 结论。M1 只问概念和适用情形；M2 只问创建和编排方式；M3 只给业务资料、协作条件和验收目标，不提供命令、文件骨架或成功答案。

先由场景树新增一个已验证父节点的独立子节点，固定本地包快照；展示继承链、闭包、增量、后代，物化并通过 `diff` / `verify`。保持唯一 preset、profile、DSH_HOME 和业务存储，不覆盖父节点或旧验收包。`start-isolated-host.mjs` 会重新执行场景 `show` / `diff`，核对 home，并启动真实 Host，保存 PID、闭包检查、日志和退出记录。参数是 `--scenario-tool <scenario.mjs> --profile <id> --home <directory> --port <port> --dsh <executable> --output <process-evidence-directory>`。可选 `--credentials-file` 只读取 `OPENAI_API_KEY` 并传给子进程，不保存凭据；实际 provider/model 必须以原始 `request/header` 为准，不能由默认配置推断。

`live-agent-acceptance.mjs` 通过真实 Host 已公开的本地 Web API 创建独立 Session，并提交固定输入。参数是 `--phase env|m1|m2|m3 --url http://127.0.0.1:<port> --profile <id> --home <directory> --output <run-evidence-directory> [--wait-ms <duration>]`。可选 `--provider <route> --model <id>` 通过公开 `session.selectModel` 选择实际可用模型；该接口还会保存 Host 默认模型，调用前必须核实 settings 只写当前隔离节点，不能写全局身份源或其他节点。输出保存原始输入、模型决策、RPC 回执、完整 history 和初步摘要。`still-running` 只表示收集时限到达；须继续观察原始 Session，不应重新提示来冒充恢复。M1 工具调用是机械失败项，其余语义必须人工按原始证据复核。

M3 在真实推进已留下成果、草稿与未完成托管操作时，记录文件摘要和持久事实，只停止上述 Host PID；确认旧进程退出后以同一包快照和原 home 启动新 PID。通过 `--phase resume --session <原始Session-id>` 发出固定继续请求，观察 Agent 使用产品恢复入口。不要补写业务文件、清空账本、重建 Surface 或用新包替换恢复进程。最终交叉检查 Surface 身份、已确认成果、WIP、触发条件、输入与推进记录，并独立验算报告。只有首次/后续 Bash、活动 Turn、真实重启都留下真实工具证据，ENV-A1 才能通过。
