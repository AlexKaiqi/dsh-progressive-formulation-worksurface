# Orchestrate code：模型可依赖的契约

> 状态：目标设计。当前实现的物理输入协议仍由
> `spec/code-handler-context.schema.json` 描述；本设计不受该实现局限约束。

## 结论

模型生成 Orchestrate code 时，应该直接写：

```python
task_id = os.environ["TASK_ID"]
question = os.environ["QUESTION"]
```

不应该写：

```python
context = json.load(open(os.environ["DSH_CONTEXT_FILE"]))
# 再自行遍历 matches、找事件、解码 key、判断缺失值……
```

环境变量存在的目的，就是把机械工作移到 Runtime。变量的**名称和类型契约**必须让
模型知道；变量的**值、事件检索过程和上下文内部结构**不需要进入模型上下文。
Runtime 内部可以借助文件维护或组装环境，但那是实现方式，不是 code handler 的主要
输入接口。

`DSH_CONTEXT_FILE` 只保留为显式 `context: "file"` 时的完整上下文逃生口。普通代码
不声明、不读取它。大输入也不通过完整上下文逃生口处理，而由 Runtime 先选中具体值，
再把该值定点物化为只读文件。

## 契约分层

| 层 | 模型需要知道 | Runtime 负责 |
|---|---|---|
| Event Contract | 事件名、payload JSON Schema | 写入和匹配前校验 payload |
| Definition `when` | 哪些事件触发 | replay、匹配、形成 Activation |
| Definition `code.env` | code 中可直接引用的变量名、格式 | 选 Event、解 JSON Pointer、校验、序列化、注入 |
| Code | 普通 Bash/zsh/Python/Node 与 effect 构造 | sandbox、超时、日志、进程退出处理 |
| Definition `code.effects` | 允许影响哪些 role、产生哪些事件 | 批量校验、Operation 幂等、投递与重放 |

Schema 是协议本体：

- `spec/design/event-contract.schema.json`
- `spec/design/orchestrate-code-binding.schema.json`
- `spec/design/definition-v2.schema.json`
- `spec/design/orchestrate-effect.schema.json`
- `spec/design/orchestrate-code-host.schema.json`

`spec/design/orchestrate-code-host.json` 是 Runtime 应公布给 authoring 环境的具体 Host
Contract。Markdown 只解释语义，不代替协议。

## 从 Event 到进程环境

Definition 直接把目标变量绑定到 Activation 输入：

```json
{
  "reaction": {
    "code": {
      "command": "python3",
      "path": "handlers/delegate.py",
      "env": {
        "TASK_ID": {
          "from": {
            "kind": "event",
            "role": "coordinator",
            "event": "research.requested",
            "pointer": "/payload/taskId"
          },
          "format": "text"
        },
        "QUESTION": {
          "from": {
            "kind": "event",
            "role": "coordinator",
            "event": "research.requested",
            "pointer": "/payload/question"
          },
          "format": "text"
        }
      },
      "effects": {
        "followup": [
          {
            "role": "researcher",
            "outputs": [
              { "event": "research.completed", "required": true }
            ]
          }
        ]
      }
    }
  }
}
```

执行顺序固定为：

```text
Activation 的 source EventRefs
  → 只在被选中的 matches 中按 role + event 选 Event
  → Event Contract 校验
  → JSON Pointer 取值
  → format 校验与确定性序列化
  → 注入 TASK_ID / QUESTION
  → 启动普通代码
```

模型无需知道 `matches` 的物理 JSON 结构，也不负责从历史 Event stream 检索。

### 选择规则

- `select` 缺省为 `one`：必须恰好命中一个 Activation 输入事件，否则不启动进程；
- `select: "all"`：取所有命中事件，按 EventRef 的 `(subject, seq, id)` 稳定排序，
  对每个事件应用 pointer，形成数组；只允许 `json` 或 `json-file`；
- 绑定只能读取当前 Activation 已选中的 source events，不能借此扫描任意历史；
- `required` 缺省为 `true`。缺少必需值时不启动进程、不产生 Operation，并记录可诊断失败；
  可选值缺失时不设置该环境变量。

### 格式规则

进程环境的物理值始终是字符串；`format` 定义 Runtime 必须先验证的逻辑值以及如何
序列化：

| `format` | Runtime 注入值 |
|---|---|
| `text` | 原字符串 |
| `integer` / `number` | 无区域差异的十进制文本 |
| `boolean` | `true` 或 `false` |
| `json` | 规范 JSON 文本；用于小型对象、数组或 `select: all` |
| `text-file` | Runtime 物化的精确字符串值对应的只读文件路径 |
| `json-file` | Runtime 物化的精确 JSON 值对应的只读文件路径 |

`*-file` 仍是定点输入：Runtime 已经完成事件选择和字段提取，代码不再遍历整份上下文。
超过 Host Contract 公布的直接环境大小限制时，Runtime 不应静默改格式；Definition
必须显式改用文件格式，保证模型写出的代码语义稳定。

Definition admission 还必须做 JSON Schema 无法独立完成的交叉检查：role/event 存在；
绑定 selector 属于该 subscription 的 `when` 输入；pointer 与 Event Contract 尽可能静态
兼容；effect 的 role/event 存在且 Event Contract 完整；用户变量不得使用保留的
`WS_`、`DSH_` 前缀。

## Runtime 固定注入的变量

这些变量无需在 `code.env` 重复声明：

| 变量 | 值 |
|---|---|
| `WS_ACTIVATION_ID` | 当前 Activation 身份 |
| `WS_ACTIVATION_KEY` | 已解码的业务 key 文本，不是当前实现的带引号 JSON 字符串 |
| `WS_REGISTRATION_ID` | Registration 身份 |
| `WS_DEFINITION_REVISION` | 不可变 Definition revision |
| `WS_SUBSCRIPTION_ID` | 当前 Subscription 身份 |
| `WS_EFFECTS_FILE` | code 追加 JSONL effect 的目标文件 |

`role → SurfaceId` 不是普通代码的默认输入。代码按逻辑 role 产生 effect，Runtime 根据固定
Registration binding 路由；只有确实需要 SurfaceId 时，才通过 `role-binding` 声明一个
业务变量。socket、短期 capability、Session transport token 等不进入模型可见契约。

## Effect：代码只描述“要产生什么”

代码向 `WS_EFFECTS_FILE` 追加 JSONL。两种记录由
`orchestrate-effect.schema.json` 定义：

```json
{"kind":"emit","role":"coordinator","operationKey":"join:case-7","event":"review.joined","payload":{"caseId":"case-7","reviews":["a.md","b.md"]}}
{"kind":"followup","role":"researcher","operationKey":"assign:task-7","instruction":"Research task task-7."}
```

followup effect 不再重复 `outputs`；Runtime 从固定 Definition 的 `code.effects.followup`
读取目标角色允许产生的 Event Contracts，并生成 Delivery Context。把这份声明再交给代码
复制一遍只会增加出错面。

Runtime 必须先读取并验证整个 effect batch，再产生任何外部效果：

1. JSONL、effect Schema、role/event capability、emit payload Event Contract 全部通过；
2. 同一批次 `operationKey` 唯一；
3. 每个 effect 以 `(activation.id, operationKey)` 建立或恢复 Operation；
4. Operation 先记录，再执行 emit/followup；
5. code 非零退出、超时、输出超限或任一 effect 非法时，整批无效果。

stdout/stderr 只用于日志，不能承载效果。

## 模型上下文应该注入什么

生成某个 code reaction 时，只给模型以下 WorkSurface 专用知识：

1. 当前 subscription 的 `when` 与相关 Event Contracts；
2. `code.env` 每个变量的名称、format、含义；
3. 六个固定 `WS_*` 变量；
4. 该 reaction 的 effect capabilities 与 effect Schema；
5. 最接近的一个代码 pattern 样例。

不注入完整 Activation、所有历史事件、Runtime 存储结构、Host transport 或不相关的
Event Contracts。变量值由 Runtime 在执行时提供，不需要提前塞进模型 prompt。

## 常见 pattern 不是新语言

委派、串行、fan-out、join、loop 先作为 Definition + code 样例存在：

- `examples/orchestrate-code/delegate.py`
- `examples/orchestrate-code/serial.py`
- `examples/orchestrate-code/fanout.py`
- `examples/orchestrate-code/join.py`
- `examples/orchestrate-code/loop.py`
- `examples/orchestrate-code/patterns.definition-v2.json`

它们复用同一套 Event → Activation → env injection → effect → Operation 语义，没有 YAML
展开层。只有当某个 pattern 需要代码无法安全表达的持久语义——例如统一取消、超时、
并发上限、失败阈值或补偿——才增加 Runtime 原语；不能仅因为它有常见名称就增加 DSL。

Schema 门禁会验证 Definition 与所有 bindings，模拟 Runtime 注入变量运行五个 Python
样例，再校验 effect Schema、capability、payload Contract 和 operationKey 唯一性。样例
读取 `DSH_CONTEXT_FILE` 会直接失败。

## 当前实现与迁移边界

当前 `SubprocessCodeHandlerRunner` 的事实仍是：它只提供
`DSH_CONTEXT_FILE`、`WS_HANDLER_OUTPUT`，代码自行读 `matches`，且只支持 emit。这是需要
替换的物理实现，不是目标契约。

迁移顺序应为：

1. Core 接受 Definition v2 的 `code.env` 与 effect capabilities；
2. Runtime 实现 binding resolver 和固定 `WS_*` 注入；
3. 当前 emit JSONL 升级为批量 `emit | followup` effect，并在执行前完整校验；
4. Delivery Context 从固定 Definition 自动生成；
5. 现有 `DSH_CONTEXT_FILE` 降为显式 opt-in fallback；
6. 等同一套契约跑通后，再评测是否存在值得引入的更短 authoring 表达。
