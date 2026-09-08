# 核心边界与 Agent 验收记录（2026-09-08）

本次目标是让 Agent 直接理解 WorkSurface 的用途，通过真实 Bash 中的 CLI 自主学习创建与编排，并在宿主进程中断后恢复工作。核心与执行宿主的责任见[核心与宿主边界](core-and-host-boundaries.md)。

## 实现范围

- `FileWorkspace` 统一文件观察、版本比较、受管写锁、持久写入意图、投影和恢复回执。观察草稿不恢复或覆盖文件，重试不会覆盖后来产生的草稿。
- `SurfaceContentRuntime` 从精确 Contract 身份折叠 Surface 版本，并处理发布、候选 apply 和编排预留。该实现不依赖 DSH。
- `CodeFirstOrchestrator` 恢复已接纳但未完成的输入，隔离不同 Registration 的执行队列，保留可检查失败，并保护登记代码和完整版本历史免于回收。
- DSH adapter 负责 Session、具体 Turn Brief、执行环境和外部输入投影。重启恢复当前 head、原工作身份、具体授权及未发布内容；补扫崩溃窗口中的持久输入。
- CLI 提供 `sync`、`list`、`run`、`publish` 和 `recover`。文件发布与业务输出独立，Brief 的 `filePublication` 不占用业务 `outputs`。
- 可选 b2f adapter 把后端协议映射到同一 FileWorkspace，不引入插件硬依赖，也不自动发布草稿。配套 block-to-file 的 `/core` 可独立导入。

## 确定性检查

| 范围 | 结果 |
| --- | --- |
| WorkSurface `pnpm check` | 38 个测试文件、209 项主测试、57 项 DSH eval、8 项 Web eval；Schema、类型、构建及 Host 协议检查通过 |
| block-to-file 配套改动 | 171 项测试、类型检查及构建通过 |
| DSH persistent Bash consumer 配套改动 | 2 个测试文件、19 项测试、类型检查及构建通过 |

覆盖真实文件系统中的跨进程锁竞争、半写读取、SIGKILL owner、文件投影恢复、版本冲突、输入重投、长期中断与回收、具体 Brief 恢复，以及 CLI → RPC → 发布 → 业务事件 → Python 编排 → 实际推进。机制测试没有代替真实模型验收。

## 真实 Agent 验收

最终完整场景为 `worksurface-acceptance-diagnostics-kimi-20260908`，实际模型为 `arc-agent-plan/kimi-k3`。场景由已验证父节点生成，拥有独立 preset、profile、运行目录和存储。六个 WorkSurface 包、b2f 和 Bash consumer 共八个候选包在启动前冻结，两次 Host 使用相同摘要。验收者只提供原始业务需求和固定继续消息，采集证据并控制进程，没有代写业务文件或提示命令、字段及修复方式。

| 门槛 | 结果 |
| --- | --- |
| ENV-A1：真实 Bash 注入 | 首次和后续调用均访问注入 CLI 与作者根；活动 Surface 在中断前后实际发布和 emit，无手工补设环境 |
| M1：立即回答是什么、何时使用 | 新会话 0 次工具调用，直接回答用途、适用边界和概念分工 |
| M2：自主查找创建与编排方法 | 另一新会话自主调用 help，正确说明创建、登记、发布、业务输出及编排授权 |
| M3：创建、编排、中断恢复和交付 | 三个 Surface 与普通 Python 条件编排实际运行，真实 SIGKILL 后恢复原身份、版本和未发布草稿，交付已发布报告 |

M3 使用资料整理、事实核验、报告成稿三个工作单元。只有 `verification_passed: true` 才推进成稿。关键事实如下，时间均为 UTC：

- 11:37:30，Host PID 54099 被 SIGKILL。核验已有通过真实 b2f 写入的未发布 `verify.py`，3265 字节；当前确认版本不含该文件，报告尚未启动。
- 11:38:55，新 Host PID 17466 使用同一持久目录启动。原核验 Session、head 和草稿哈希保持不变，11:38:57 自动发起模型请求，早于验收者对根任务发送继续消息。
- 11:39:58，恢复后的核验执行脚本并发布结果，发出通过事件，编排随后才启动成稿。
- 11:41:28，报告发布；11:41:43 发出 `report.ready`；11:43:50 根 Agent 完成逐条验收。

保留的草稿 SHA-256 为 `413086b889a2a285cb0d65aad3fe53d06b1b751216870deb4ed91caf76245a73`。最终报告版本为 `sha256:a18d687020e4aa1f2a4d909bcaa7ff10c8f81bf391900efa6d67a45cda0901ec`，六份交付与依据文件逐项匹配该不可变版本。

独立业务复核确认两月总量 360 → 400（+11.1111%），三个渠道的环比为 +25%、+16.6667%、−33.3333%，占比和百分点变化正确，六个数据点完整，报告没有因果夸大。三个输入各有唯一 recorded 和 settled，核验和成稿各推进一次，失败记录为零；再次 recover 没有重复效果。

## Bash consumer 的后续修复

上述 M3 的旧 Bash consumer 遇到含 shebang 的命令超时，模型自行改用 b2f 后完成任务。独立真实 Loader + PTY 复现将原因定位到交互式 Bash 对 `!` 的历史展开，76 字节即可触发，长度不是原因。

修复仅对交互命令参数中的 `!` 作 ANSI-C 数值转义，执行层收到的命令和环境字节保持不变，也不改变持久 Shell 选项。原 3431 字节命令在源码和构建产物中分别于约 271ms、238ms 成功完成。

修复后新建独立场景 `worksurface-acceptance-bashfix-20260908`，另外七个包与 M3 候选摘要相同。真实 Agent 再次通过原 ENV-A1，并通过 Bash 创建、直接执行及第二次独立复跑带 `#!/usr/bin/env python3` 的脚本，核对原字节和注入 CLI。没有关闭历史展开、补环境或改走文件块。两会话自然结束，Host PID 56690 正常退出。

完整 M3 使用旧 consumer；新 consumer 的修复按上述专项复验，没有将两个场景描述成同一次执行。

## 失败记录与适用范围

早期真实试验暴露的 Schema 示例缺漏、文件发布入口缺失和 Surface 冲突定位不足均修复后重测。另有模型路由 401、模型未推进、模型错误计算及未处理目标草稿冲突的失败记录，均未被最终成功覆盖。历史 publication 场景实际走过核验 FAIL 后退回整理、报告不启动的负分支；本轮 M3 运行正分支，停止检查点证明核验通过前没有报告执行者。

此次 Agent 业务产物存在非阻断瑕疵：交付索引仍有待产出文字，核验脚本面对未来缺字段输入可能抛出异常。给定任务的全部数据与交付已独立通过，验收者没有修改模型产物。

普通 Bash/编辑器不参与共享锁，不能承诺跨文件原子读取或自动合并。文件与目录互换的结构变化明确拒绝，空目录不进入文件版本。旧 v4 数据保留兼容路径，旧私有 worktree 发布明确拒绝，本次没有自动迁移。

原始 Session、进程记录、候选摘要和停止/完成检查点保留于本机验收档案；本文件提供可随源码传播的摘要。[验收指南](../packages/dsh/evals/README.md)和[原始验收提示](../packages/dsh/evals/agent-acceptance-prompts.json)提供复验入口。
