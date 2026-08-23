# Work Session 存储与 WorkGraph 派生

## 决策

WorkSurface 与 Work Session 是同一个工作单元的状态面和历史面。每个 Surface
都拥有且仅拥有一条 append-only Work Session。所有 Surface 目录物理平级；父子
关系存在于 child Surface 自己的 header 和 write-once 委派记录中，不通过目录嵌套表达。

系统没有独立的 canonical WorkGraph 文档或全局 Graph event log。WorkGraph 是
只读投影：从 root Surface 出发，递归跟随与 DSH Session 树对齐的委派记录得到。

Surface 只在对应的 Agent Session 存在时存在。委派创建工作单元、记录不可变的一对一
Session/Surface 身份并固定精确输入 Projection；不再存在独立 draft 阶段。

## Canonical 目录

```text
<root>/
  canonical/
    surfaces/
      <surface-id>/
        HEAD.json
        commits/
        revisions/
          <sha256>/
            surface.md
            blocks/
        session/
          header.json
          HEAD.json
          events/
            000000000000.json
            000000000001.json
    orchestrator/
      definitions/
        <sha256>/
          manifest.json
          program
  runtime/
    orchestrator/
      runs/
      agent-effects/
      attempt-results/
    effect-journal/
    locks/
```

`surfaces/<surface-id>` 始终位于同一深度。Child 通过其 write-once 委派记录和其中
指明的 parent Session 身份被发现。没有委派记录的 Surface 目录是不可达 orphan，
不属于任何 WorkGraph。

## 唯一事实源

每类事实只有一个权威来源：

- `session/events` 解释一个 Surface 如何创建、演进和编排。
- `revisions` 保存 Session event 所引用的精确 Surface 与 Block 不可变内容。
- `orchestrator/definitions` 保存 orchestration event 所引用的精确 program 和 manifest。
  控制程序也可以从公开 attempt workspace 中已提交的 `work/control/` 文件读取；其内容
  在同一目录按内容只存一份，因此可以针对当前 workspace 状态重放同一不可变定义。
- `binding.json` 是 write-once 委派记录，指明执行 Surface 的 Agent Session、消费的精确
  Projection pin 和已提交输出 revision。
- Agent Session log 解释 Agent 内部的 turn、tool 和 message。委派记录与 event 只引用
  Agent Session id，不复制其内部事件。

Surface `HEAD.json`、Session `HEAD.json`、Graph snapshot、run status 和 UI index 都是
物化视图，删除后可以用 canonical event 与不可变内容重建。Surface head 从
`surface/created` 和 `surface/revision-published` fold；Session head 从最后一条连续事件
fold。委派记录不是可重建视图：一次委派的精确输入 pin 是 write-once 事实。

Effect journal 只负责幂等执行和 crash reconciliation。可覆盖的
`started`/`completed` 记录不是领域历史。

## 事件流

每条事件拥有 Surface-local 连续序号。序号用于持久化、回放和确定接受顺序；它不
会给并行 sibling 虚构因果关系。

```ts
interface WorkSessionEvent<T, D> {
  version: 1
  surface: SurfaceId
  seq: number
  eventId: string
  type: T
  data: D
  createdAt: string
  causationId?: string
  correlationId?: string
  attemptId?: string
  idempotencyKey: string
}
```

初始事件词汇保持最小：

- `surface/created` 建立工作单元及其不可变结构 parent。
- `surface/revision-published` 记录已接受的内容 revision 及其 base。
- `orchestrator/defined` 固定一个不可变 definition。
- `orchestrator/run-started` 与 `orchestrator/run-completed`、
  `orchestrator/run-interrupted` 或 `orchestrator/run-failed` 解释一次执行。

Surface 只在对应 Session 存在时存在：委派创建工作单元。Child 存在和
Agent/Session attachment 不属于领域事件。每个 Surface 的 write-once `binding.json`
指明执行 Session、精确输入 pin 与已提交输出；Session 之间的 parent/child 边界由
DSH Session header 的 `parentSession` 所有。没有委派记录的 Surface 是不可达 orphan，
不属于图且可安全回收。仍含 `child/created`、`agent/session-bound`、
`agent/session-completed`、`child/session-started` 或 `child/session-completed` 的 rc.6
事件流会以可操作的 canonical corruption 失败。

事件使用过去式，只记录已接受事实。Command 和被拒绝的校验尝试不进入领域事件流。
外部执行必须在 launch 之前写入 started 事实，使恢复逻辑可以区分“结果未知”和
“从未启动”。

## 递归组合

父级只记录 child 边界：child 的启动身份、固定输入和已接受输出位于 child 的
write-once 委派记录中；child 的结构 parent 位于它自己的 `surface/created` 事实中。
Child Session 负责自己的内部工作；如果 child 继续创建 Surface，同一规则递归应用。

每个 canonical 事实只属于最近的一条 Work Session 或委派记录。Root Session 因而可以
通过递归跟随 child id 完整解释整个过程，同时每条局部事件流保持有界、可独立回放。

结构所有权是一棵树；revision-pinned 信息依赖可以形成 DAG。一个 child Projection
可以消费多个 sibling 或 ancestor Surface 的 Block。依赖必须从委派记录中的精确输入
pin 派生，不能从时间戳或目录祖先关系推断。

## 发布与恢复

不可变内容和 commit metadata 先于发布它们的事件写入。事件之前崩溃最多留下可回收
的不可达 orphan；append event 是领域 commit point。推进物化 `HEAD.json` 时继续持有
Surface lock。缺失或落后的 head 通过 replay 修复；无法由事件流解释的 head 属于
canonical corruption。

操作使用稳定幂等身份。Reconciliation 必须同时确认 immutable commit 和对应 Work
Session event 存在；只找到内容 commit 不能算完成。

外部 effect 先由父级记录 `orchestrator/run-started`，再启动进程，最后只记录一个
terminal outcome。恢复逻辑 reconcile 非 terminal run，不能盲目重复执行。

## 不变量

1. 每个 Surface 目录只有一份 Work Session header，且 `surfaceId` 一致。
2. Session event `seq` 从零开始连续，event id 唯一且可校验。
3. `surface/created` 必须是事件零，并与不可变 Surface metadata 一致。
4. Child 只有通过其 owning Session 的委派记录才能进入 WorkGraph；没有委派记录的
   Surface 是 orphan。
5. Child 只有一个结构 parent，不允许环。
6. Agent Session id 与 Surface 各自最多参与一条委派记录。
7. 委派输入必须引用存在的不可变 revision。
8. Completion 必须引用同一 Surface 的现有 revision，且只能发生一次。
9. Revision publication 必须从已记录的当前 base revision 推进。
10. 父级进入 terminal 前，child 必须 terminal 或显式转移所有权，不能留下无主后台工作。
