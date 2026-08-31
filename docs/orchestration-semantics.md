# Orchestrate 语义与模型 authoring 基线

> 状态：基于 `OrchestrationDefinition v1`、`deriveActivations()`、
> `WorkSurfaceEngine` 和 DSH followup 路径的设计审计。本文描述语义与能力边界；
> 持久协议仍以 `spec/*.schema.json` 为准。

## 1. 评价对象

Orchestration 的作者是模型。模型在 Surface Session 中创建
`definition.json` 和 `registration.json`，随后用 `ws emit` 产生业务事实。

因此 authoring 形式必须按模型侧总成本评价：

```text
总成本
  = 不可约简的领域语义
  + 格式与专有词汇的额外说明
  + 生成错误
  + 诊断和修复轮次
```

角色、事件、相关 key、匹配条件、目标和影响方式属于不可约简的领域语义。
YAML 缩进、专有 pattern 名称、展开规则和 builder API 都属于额外成本。
Runtime 最终执行统一 Definition 是实现事实，不会降低模型 authoring 成本。

当前选择：模型直接生成由 `definition.schema.json` 约束的 JSON。需要计算或
批量构造时，使用模型已经掌握的 Python、TypeScript 或 shell 生成同一个
`definition.json`；不增加 YAML pattern DSL 或自定义 builder API。

## 2. 当前最小执行单元

```text
Surface Event
  → Subscription.when
  → Activation(registrationId, subscriptionId, businessKey, source EventRefs)
  → Operation(activationId, operationKey)
  → target Surface Event | target DSH followup message
```

Activation 对同一 `(Registration, Subscription, businessKey)` 最多出现一次。
Operation 在产生目标效果前记录，重启后可重放；目标 EventId 或 MessageId 稳定。

## 3. 委派

期望轨迹：

```text
coordinator: task.requested{taskId}
  → Activation(delegate-task, taskId)
  → Operation(assign-worker)
  → worker DSH followup
  → worker: task.completed{taskId, result/ref}
```

当前已实现：单事件匹配、Activation、可靠 followup、目标 Session 路由。

当前缺失：followup 只投递字符串。worker 没有收到 source Event、Activation、
Definition Revision 或允许输出的事件契约，只能从自然语言猜测
`task.completed` 的名称和 payload。

结论：当前是可靠消息投递，不是完整的结构化委派协议。

## 4. 串行

期望轨迹：

```text
A: stage.requested{caseId}
  → followup B
B: stage.prepared{caseId}
  → followup C
C: stage.completed{caseId}
```

当前可以用多个 Subscription 通过显式完成事件连接；Definition 数组顺序不产生
因果关系。每一段使用新的 Subscription 和 Activation，相关性由业务 key 保持。

当前没有“serial”原语，也不需要为了名称增加一个原语。只有当系统需要统一的
失败传播、取消或补偿语义时，才需要新增持久状态与协议。

## 5. fan-out / join

期望轨迹：

```text
coordinator: review.requested{caseId}
  → Activation(fanout, caseId)
  → Operation(assign-a) → reviewerA followup
  → Operation(assign-b) → reviewerB followup

reviewerA: review.completed{caseId}
reviewerB: review.completed{caseId}
  → Activation(join, caseId, [EventRef A, EventRef B])
  → next effect
```

当前可以声明多个 followup Operation，并用 `all` 或 `count` 汇合事件。
但 Operation 由 Engine 逐个提交；目标 Session 后续是否并行运行不由 Definition
表达。系统也没有 group identity、最大并发、失败阈值、取消剩余分支或超时策略。

结论：当前支持 fan-out 的可靠逐项派发和事件 join，不支持一个具有策略语义的
“parallel”原语。

## 6. loop

期望轨迹：

```text
iteration.requested{caseId, iteration: 1}
  → work
iteration.completed{caseId, iteration: 1, converged: false}
  → iteration.requested{caseId, iteration: 2}
  → ...
iteration.completed{caseId, iteration: N, converged: true}
```

当前 ActivationId 固定为
`hash(RegistrationId, SubscriptionId, businessKey)`。如果 businessKey 只有
`caseId`，同一 Subscription 不会再次激活；若把 iteration 放入 key，每次迭代
可以形成不同 Activation，但 Definition 仍没有：

- 如何计算下一 iteration；
- 终止条件；
- 最大迭代数；
- 每轮输入如何由上一轮输出构造；
- 失败、取消与重启后的 loop 状态。

这些可以由 handler 代码显式产生下一事件，但不能称为 declarative loop 支持。

## 7. `any` 不是 race

`any` 按 Definition 中的子条件声明顺序选择第一个已经满足的分支。它不比较跨
Surface 的完成时间，也没有赢家固定、取消输家和迟到事件处理。因此当前不存在
race pattern。

## 8. 对 Definition 演进的约束

在增加任何 pattern 语法前，先回答它是否新增了不可由现有
Event → Activation → Operation 组合表达的持久语义：

- 没有新增语义：保留为普通 Definition 组合或示例，不增加 DSL 词汇；
- 新增持久语义：先定义身份、记录、fold、恢复和失败规则，再扩展 JSON Schema；
- 只是为了少写几行：必须通过模型生成和修复评测证明收益超过额外上下文。

当前优先级不是 pattern shorthand，而是补齐：

1. 业务 Event Contract；
2. Activation 的结构化 Delivery Context；
3. 当前角色允许产生的事件及 payload Schema；
4. `ws emit` 与固定 Definition/Delivery 的校验关系。
