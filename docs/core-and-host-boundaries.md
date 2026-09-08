# 核心目标、宿主边界与验收

WorkSurface 的目标是让 Agent 持续维护可恢复的工作上下文，并依据已发生的事实协调多个工作单元。block-to-file 的目标是把消息中的文件提案准确写入选定的文件后端，给出可重试、可修正的结果。两者组合后，文件提案可以写入 WorkSurface 草稿；文件写入成功、Surface 发布成功、业务验收通过分别需要各自证据。

## 责任划分

| 责任 | 所属位置 | 不由它决定的事项 |
| --- | --- | --- |
| 内容寻址的目录版本、文件观察、版本比较、持久写入意图和投影恢复 | core `RevisionStore` / `FileWorkspace` | Agent、Session、消息代码块、是否发布或验收 |
| Surface 最新版本的事实折叠、草稿与候选比较、发布和 apply 恢复 | runtime `SurfaceContentRuntime` | 创建哪种执行者、模型选择、提示注入 |
| Contract 权限、Registration、输入去重、批次记录、预留、执行与结算 | core stores + runtime `CodeFirstOrchestrator` | DSH 的 Turn/Step、宿主重试频率、业务判断 |
| 何时使用 WorkSurface，以及 Surface / Event / Orchestrate 的概念 | design | 宿主 API、命令路径、单 Surface 绑定多少执行者 |
| Session 绑定、启动/继续、Bash 环境、CLI socket、外部事件投影、上下文预算 | DSH adapter | 改写核心版本或编排语义 |
| 代码块解析、提案解析和限制、事务后端接口 | block-to-file `/core` | DSH 事件、Surface 发布、业务验收 |
| 将 b2f 四方法后端映射到同一个 FileWorkspace | DSH 可选组合 adapter | 强制所有 WorkSurface 安装启用 b2f |

specific Turn Brief 按宿主消息身份持久保存，消费消息时才恢复相应 instruction、inputs 和受限 outputs；普通下一 Turn 说明不能覆盖这份授权。

当前 DSH 的“一 Surface 对应一个 Session”、默认模型选择、128k 上下文预算、原生 followup 投递及本机子进程运行均是适配策略。替换宿主应复用核心与运行时，提供执行和外部输入端口。核心与运行时不能依赖 DSH 类型或导入 b2f 插件入口。

新协议 API 使用通用的 `execution` / `adapter` 标识。持久数据校验仍接受旧 `dsh-session` / `dsh-adapter` 标识，以便读取已有记录；这属于兼容边界，不是新宿主必须采用的核心概念。

## 写入、发布与恢复

`FileWorkspace.observe()` 在共享写锁下观察文件，不恢复或改写工作文件。`snapshot()`、`edit()` 和 `transaction()` 先恢复已经存在的写入意图，再处理新操作。单纯读取现有工作内容不能从历史版本覆盖未发布修改。

受管写入固定不可变候选并持久化意图，然后按精确差异投影到工作文件。只有全部文件可读取且完成持久回执后才返回成功。投影失败包含已记录的候选版本；恢复继续同一意图。所有针对同一作者根的受管写者必须使用同一个 workspace stateRoot 和锁。

Surface 的最新版本只来自注入的精确 Contract identity（authority、scope、name、digest），不能只按事件名字识别。发布对当前 head 做版本比较；apply 同时检查 head 和未发布草稿。编排中没有内容变化的候选不改工作文件。Operation 的记录和 Surface 发布共享工作区事务边界；已记录批次预留的 Surface 不允许其他发布越过它。

DSH 在读取或重建持久 Session context 之前接入当前版本来源。重启不能用旧 v4 publication 或初始 binding 覆盖 v5 head。作者目录中存在的未发布文件被保留，只有缺失目录才由已记录版本重建。旧 v4 数据仍是兼容路径，不与 v5 事件混写。回收根必须同时包含 v5 登记代码、已记录批次的 base/candidate 和 Surface 引用；仅扫描旧 v4 事件不足以保证长期中断后恢复。

已接纳输入的重复投递会继续未完成工作；失败写入可检查的诊断，不能被当成已结算。独立 Registration 使用独立队列，失败或慢任务不阻塞无关 Registration。启动和 `ws recover` 补扫绑定 Session 的持久外部输入并执行恢复；后者返回失败 Registration、未完成计数及作者目录校验失败。

便携文件系统不能向不参与锁的普通读取者提供跨多个文件的原子视图。外部编辑通过整批前置、逐文件及最终检查保留或拒绝，不能静默覆盖。当前整目录替换对文件与目录互换的结构变化在写入意图前明确拒绝；普通文件增删改支持。这些约束不能宣传成无条件合并或任意目录事务。

## Agent 接入与验收

CLI 是普通 Bash 工具。平台无关入口使用 `WORKSURFACE_*`；DSH adapter 保留 `DSH_*` 兼容别名。真实执行 Bash 的宿主工具必须消费当前 shell environment，注册一个 provider 或在提示中提供替代路径不能算环境注入通过。

| 验收 | 输入条件 | 必须观察到的证据 |
| --- | --- | --- |
| ENV-A1 | 启用插件的真实 Agent Bash | 首次命令即可访问 CLI 和作者根；Turn 切换、撤销、持久 shell 重建后没有旧 scope 残留 |
| WS-M1 | 新会话，只给正常能力说明 | Agent 不调用工具或 help，即可正确回答是什么、何时使用、Surface / Event / Orchestrate 的分工 |
| WS-M2 | 另一新会话，只给创建及编排需求 | Agent 自主找到并调用 help，解释可执行的创建、登记和推进流程；没有额外命令、字段或示例提示 |
| WS-M3 | 真实宿主、真实模型、隔离目录 | Agent 创建 Surface、登记编排、完成实际跨 Surface 推进；旧 Host PID 确实退出，新 PID 使用原持久数据恢复，身份、版本和未完成工作正确且没有重复效果 |

单元测试证明确定性规则；真实模型和真实 Host 进程验收分别证明发现能力、实际工具接线和重启恢复。构造第二个对象、模拟模型输出或帮助文本快照不能替代 WS-M1/M2/M3。

作者使用普通文件能力创建目录；`ws sync` 校验并登记，`ws list` 查看已有 Surface，`ws run <id> --instruction … --key …` 表达宿主启动或继续请求。这个请求属于外部执行决策，不改变 Orchestrate 只能编排既有 Surface 的边界。

在受管 Surface Turn 中，Agent 写完供下游使用的文件后，先显式执行 `ws publish --key <稳定发布标识>` 发布当前文件版本，再按业务输出的条件执行 `ws emit`。发布操作单列在 Turn Brief 的 `filePublication` 中，业务 `outputs` 为空仍可发布文件。目标 Surface 由有效的当前 Turn capability 决定，不能通过指定其他 Surface 绕过作用域。相同 Turn 内重试同一次发布保留 key，新一次发布使用新 key；重试不会把后来产生的草稿一起发布。

`sync` 对已接纳的 Surface 不更新其发布版本；业务 `emit` 也不隐式发布文件。涉及文件的编排测试必须从已接纳的初始版本开始，在活动 Turn 生成新草稿，然后经显式发布及业务事件触发运行；把新文件预先放进初始版本无法验证这条完整路径。

DSH 的发布适配只接受公共作者根中的当前 Surface。旧版私有 worktree 的草稿保留，发布请求明确拒绝；不能以公共根的旧文件替代其实际工作目录并报告成功。本次不提供自动迁移。
