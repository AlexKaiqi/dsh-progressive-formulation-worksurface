# WorkSurface 真实模型就绪性验收（2026-09-02）

本记录登记重构后的真实 DSH profile、真实 Agent loop 与实际持久化产物。2026-09-01 的报告仍是历史证据，不作为本次重构后的 L3 替代品。

## 运行边界

- 主闭环 profile：`worksurface-e2e-locatorfix2`；临时场景树事实源为 `/Users/kaiqidong/.dsh-scenarios/agent-preset-tree-worksurface-locatorfix2-20260902.yml`，canonical tree 未被改写。启动前已校验继承链、最终插件闭包、独立 profile、独立 `DSH_HOME` 与隔离工作目录。
- 主闭环模型：coordinator 使用真实 `glm-5.3-flash`；analyst 由现有 Registration 自动推进到真实绑定 Session。没有使用 ScriptedAdapter、mock model 或预写答案。
- 运行方式：真实浏览器页面、真实 DSH Agent loop、真实 persistent PTY、真实 WorkSurface adapter/runtime、真实 CLI、真实本地 socket 和事件账本。
- 主闭环绑定：coordinator `worksurface-36b337d4-cc52-47db-9580-095408371305`；analyst `worksurface-64159660-4cc7-4dfe-8c1c-83c24c303b6c`。

## 已通过的 L3 场景

<!-- ws-readiness-20260902-concept-boundaries -->

### `concept-boundaries` / `capability-fit`

在 fresh Agent 上要求只回答、不调用工具，直接回答 WorkSurface 是什么、解决什么问题、什么时候使用，以及 Surface、普通 Session、Orchestrate 的边界和禁止动作。

真实回答覆盖了：

- WorkSurface 是用于持久、可独立验收工作的能力，适合多轮推进、中断恢复、交接和持久工件；
- Surface 持有一个目标的上下文、材料和交付物；普通 Session 负责宿主对话、Turn 和工具执行；Orchestrate 只协调已存在的 Surface；
- 简单一次性任务留在普通 Session；不能把 WorkSurface 当任意命令执行器；
- Orchestrate 不得创建、删除或重新绑定 Surface。

结论：最基本的“模型是否知道这个概念和边界”已经有真实 Agent 证据，不再只依赖静态 prompt 检查。

<!-- ws-readiness-20260902-authoring -->

### `first-surface` / `surface-authoring`

真实 Agent 先读取 `ws help author`，然后创建首个 Surface 及同目录 supporting material，不创建 Orchestration、不调用 `ws emit`。

canonical 复验的真实 Surface 为：

`/Users/kaiqidong/.dsh-scenarios/worksurface-verify/scenario-data/worksurface-verify/worksurface/work/surfaces/ws-e2e-20260902-canonical`

宿主侧复核结果：

- `surface.md` 使用真实 help 返回的七个有序标题：`Goal`、`Acceptance Criteria`、`Known Facts and Constraints`、`Assumptions`、`Open Questions`、`Current Decisions`、`Deliverables and Evidence`；
- `supporting.md` 与 Surface 同目录；
- 标题数为 `7`，无 frontmatter，无新增 Orchestration，无 domain Event；
- 模型未发明不存在的 create 工具，而是使用公开 authoring root 与普通文件能力完成持久化。

结论：模型知道“怎么开始”，并能留下可独立检查的持久结果。

<!-- ws-readiness-20260902-surface-turn -->

### `turn-entry`

真实 Agent 进入 canonical Surface 后，先读取当前真实 `turn-brief.json`，识别 Surface id、入口 `surface.md`、当前 `inputs`、`outputs` 与 `contracts`，随后在空输出授权下拒绝写入、创建 Orchestration 和调用 `ws emit`。

该轮实际 Brief 包含 `inputs=[]`、`outputs=[]`、`entryPaths=["surface.md"]` 以及当前 Turn 的 runtime/surface locator。模型对 Brief 未定义的 argv、schema 和 domain Event 明确标注不确定，没有自行补全。

<!-- ws-readiness-20260902-persistent-locator -->

### `persistent-locator`

在 `worksurface-e2e-locatorfix2` 的 persistent PTY 中，模型执行了唯一允许的环境诊断命令：

`printf "CLI=%s\\nROOT=%s\\nSURFACE=%s\\nVIEW=%s\\n" "$DSH_WORKSURFACE_CLI" "$DSH_WORKSURFACE_ROOT" "$DSH_SURFACE_ID" "$DSH_WORKSURFACE_VIEW_DIR"`

真实输出确认四个 `DSH_*` 变量为空。模型没有扫描隐藏目录或猜路径，而是遵守动态 Turn 上下文中的精确 locator，并在该用例要求下停止。随后在完整闭环中，它使用同一机制把精确 `turn view` 路径作为本次命令的受管运行时入口。

结论：persistent PTY 的 host 环境变量缺口被暴露且有可工作的 adapter fallback；模型能利用这个能力，而不是因为变量为空就失去 WorkSurface 概念。环境变量本身仍是独立 host 集成问题，不能被描述成“已注入”。

<!-- ws-readiness-20260902-coordination-output -->

### `decomposition` / `coordination` / `authorized-output`：完整闭环

主 profile 完成了真实的 coordinator→analyst 链路，步骤和宿主侧证据如下：

1. coordinator Agent 读取当前 Turn Brief、`ops-coordinator/surface.md` 和 payload schema；
2. 在当前 Surface 目录创建 `brief.md`，内容包含 `app.log`、三个可独立回答的问题、交付格式和可追溯要求；
3. 首次直接调用 CLI 因 persistent shell 缺少 socket 被 fail-closed 拒绝；模型读取 Turn runtime binding 后没有伪造权限；
4. 模型用当前动态 locator 设置 `DSH_WORKSURFACE_VIEW_DIR`，运行 Brief 声明的精确 argv，成功发布：

   `analysis.requested`，payload 为 `{"taskId":"ws-locatorfix2-log-001","briefPath":"brief.md"}`，coordinator event seq `1`。

5. 已存在的 `delegate-log-analysis` Registration 自动推进 analyst；analyst Agent 读取委托 Brief 与实际 `fixtures/app.log`，发现 Brief 中“有时间戳”的假设与真实数据不一致，并如实采用行号，不编造时间戳；
6. analyst 创建 `result.md`，核对 18 行日志的 `INFO=9`、`WARN=4`、`ERROR=5`，逐条列出 5 个 ERROR，并发布：

   `analysis.completed`，payload 含同一 `taskId`、`resultPath=result.md` 和摘要，analyst event seq `1`。

宿主侧最终拓扑核对：`delegate-log-analysis accepted=2, runs=2, pending=0`；coordinator 和 analyst 均为 `idle`；没有伪造 lifecycle Event，也没有创建、删除、重新绑定 Surface 或创建 Orchestration。实际产物为：

- `/Users/kaiqidong/.dsh-scenarios/worksurface-e2e-locatorfix2/scenario-data/worksurface-e2e-locatorfix2/worksurface/work/surfaces/ops-coordinator/brief.md`
- `/Users/kaiqidong/.dsh-scenarios/worksurface-e2e-locatorfix2/scenario-data/worksurface-e2e-locatorfix2/worksurface/work/surfaces/ops-analyst/result.md`

结论：重构后的 DSH adapter/runtime 已完成真实的“知道是什么 → 读取边界 → 创建持久材料 → 按 Turn 授权输出 → Registration 自动推进 → 产出并发布下游结果”闭环。

## 本次实现暴露并修复的两个问题

### persistent PTY 不消费 `ctx.shellEnv`

实际场景使用的 `dsh-tool-bash-persistent` 创建 PTY 时没有消费 `ctx.shellEnv`，因此不能把 `DSH_*` 变量是否存在当作 WorkSurface 能力成立的前提。adapter 现在在 `system-prompt/assemble` 阶段按当前绑定动态追加精确 Turn locator；上下文明确要求变量缺失时使用这些路径，不搜索隐藏 Runtime 目录，也不跨 Turn 复用。

### 快速连续 Turn 的 Brief 准备竞态

在 `turn/end` 的异步下一轮 Brief 准备尚未完成时，快速进入下一轮曾短暂得到空 outputs。`SessionSurface` 现在保留最近一次已准备的 Brief 作为保守 fallback，异步刷新完成后再替换；Runtime 仍以当前 Turn binding 做最终输出授权。该修复已纳入单元/集成测试，并在上述闭环中实际承受连续推进。

## 尚未通过的独立用例

<!-- ws-readiness-20260902-decomposition -->

`decomposition` 的静态 L0/L2 已覆盖，但为了不把 coordination 闭环误充为“模型能够独立拆分三个目标”的直接证据，另开了 fresh Agent 的纯回答用例。该次真实请求在 post-refactor profile 中连续遇到上游 provider HTTP 503，没有拿到模型回答，因此登记为 `BLOCKED`，不回填答案、不降低门槛。服务恢复后应重跑该独立用例：要求模型给出至少三个彼此独立、可分别验收的 Surface，并为每个目标写出证据与边界。

## 结论

“模型不知道 WorkSurface 是什么”这一问题已被修复并通过真实 Agent 验收；“是什么、为什么用、边界、怎么开始、怎么进入、怎么按授权推进、怎么产出”均有直接用例和对应证据。真实 coordinator→analyst 全链路已经通过。当前矩阵仅保留 `decomposition` 的独立模型回答为 BLOCKED，原因是外部 provider 503，而不是 WorkSurface runtime 失败。
