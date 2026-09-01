# 可重复管线、参数与多模态方向

> 状态：目标设计，不是当前 Runtime 契约。本文只固定已经能从产品目标推出的边界；具体 Schema、节点目录和执行 API 必须由真实场景与可执行纵切验证后准入。`Invocation` 是本文使用的工作名称，进入 `spec/design/` 前仍可调整。

## 结论

WorkSurface 后续要支持的不是“把同一个 Surface 再跑一次”，而是从冻结的可复用定义创建一次新的、可追溯的工作实例：

```text
Template Revision
  + immutable Parameter Bindings
  + typed Input Artifact Refs
  + execution policy / credential refs
        ↓ preflight + review
Invocation
        ↓ instantiate
new Surface instances + exact Registration
        ↓ DSH Session / Orchestrate execution
Runtime Event + Revision + Output Artifact evidence
```

同一组输入可以再次发起新的 Invocation，但不能复用并改写上一次运行的 Surface、Session、Event stream 或 Revision。所谓“可重复”首先表示定义、输入、参数和证据可追溯；含模型或外部服务的运行不承诺字节级确定性。

## 最小领域分层

### Template Revision：可重复的定义

Template Revision 是不可变的复用单位，描述：

- Surface 的目标、验收条件、初始目录骨架和证据要求；
- 参数 Schema 与输入/输出端口 Contract；
- 所引用的 Orchestrate code Revision；
- 只用于共同理解的画布布局与说明。

Template 不是正在推进的 Surface，也没有 DSH Session、当前 head 或运行状态。草稿可以修改；可运行版本必须先校验并冻结为 Revision。

### Invocation：一次参数化实例化

Invocation 固定一次运行所需的所有外部选择：Template Revision、参数绑定、输入 ArtifactRef、模型/执行策略引用，以及必要的 credential ref。它是“这次究竟跑了什么”的根证据。

每个 Invocation 创建新的 Surface 实例；每个 Surface 仍只绑定自己的唯一 DSH Session。Registration 只绑定本次实例化后的具体 Surface，不绑定抽象模板。

### Runtime facts：实际发生的结果

Event、Operation、Surface Revision 和 DSH Session/Turn/Step 继续证明实际执行。UI 可以把它们 overlay 到模板结构上，但不能用模板连线代替已发生事实。

## 参数与变量

UI 中应把以下四类东西明确分开，避免一个含义不清的全局“Variables”面板：

| 类别 | 作用域 | 是否可变 | 例子 |
| --- | --- | --- | --- |
| Template parameter | Template 声明、Invocation 绑定 | 运行开始后不可变 | 目标语言、尺寸、数量、阈值 |
| Input artifact | Invocation | 引用不可变内容或精确外部版本 | 图片、音频、视频、PDF、数据集 |
| Runtime output | Event / Surface Revision / ArtifactRef | append-only | 分析结果、生成媒体、评分、发布包 |
| Code-local variable | 单次 Orchestrate 进程 | 进程内可变，不进入公共协议 | 循环计数、临时路径、中间计算 |

参数使用 JSON Schema 或等价的结构化 Contract 描述类型、必填、默认值、枚举、范围和 UI hint；绑定值在 preflight 后快照。秘密值永远只保存 credential ref，不进入 Template、Invocation、Event payload、浏览器普通状态或 Git。

跨节点传递的业务值必须成为有类型的 Event payload 或 ArtifactRef，不能依赖隐藏的可变全局变量。这样重启、重跑、fork 和审计才能得到同一输入边界。

## 多模态输入与输出

多模态不应变成每个节点各自发明的 base64 字段。统一使用带内容身份的 ArtifactRef，最少包含 digest、media type、size 和受控定位信息；名称、尺寸、时长、页数、编码等属于可验证 metadata。

端口 Contract 描述它接受的语义与媒体集合，例如 `text/*`、`application/json`、`image/*`、`audio/*`、`video/*`、`application/pdf` 或同类 ArtifactRef 列表。大对象不复制进 Event payload；Event 只携带 ArtifactRef 和必要的领域元数据。

预览图、波形、播放器、PDF 缩略图和模型可读转写都是可删除投影。原始资产、派生资产和转写必须分别有自己的内容身份与 provenance，不能把预览缓存当作原件。

## 四种容易混淆的重复操作

- **Replay**：重放同一次 Invocation 的持久事实，不执行任何副作用。
- **Retry / Resume**：恢复同一次 Invocation 中未结算的 Operation，沿用幂等键，不创建重复结果。
- **Rerun**：用相同 Template Revision 和绑定创建新的 Invocation、新 Surface 与新证据链。
- **Fork**：从既有 Invocation 复制可见绑定，修改部分参数、输入或 Template Revision 后创建新的 Invocation。

UI 必须使用这些精确动作名，不能用一个含糊的“Run again”同时覆盖恢复、重跑和分叉。

## UI 信息架构

同一个 node editor 底座最终分为三个明确模式：

### Design

- 中央画布编辑 Template 草稿的 Surface 节点、类型端口和结构连接；
- 右侧 Inspector 编辑选中节点的目标、验收、参数 Schema、端口 Contract 与媒体要求；
- 连接只表达实例化结构和 Event/Artifact Contract；条件、转换、fan-out、join 与循环仍由普通 Orchestrate code 拥有；
- 顶部展示 draft、validation、review、frozen Revision 状态，只有通过 preflight 的 Revision 才能进入 Run。

### Run

- 选择精确 Template Revision；
- 由参数 Schema 生成表单，文件/媒体槽生成相应 picker、预览和校验；
- preflight 展示缺失参数、端口不匹配、模型/凭据可用性、权限以及可估算成本；
- 用户确认后创建 Invocation、Surface 实例与 Registration；运行中的画布只显示 overlay，不允许悄悄修改冻结模板。

### Evidence

- 重放当前已经实现的 declared route 与 recorded Event 因果；
- 可以按 Invocation 查看输入绑定、各 Surface/Session、输出资产、失败和结算；
- 支持 replay、rerun、fork、结果比较和 provenance 检查，但所有新执行都显式创建 Invocation。

当前 Web 实现属于 Evidence 模式。现在不显示不可用的 Design/Run 假入口；但命名、节点/端口组件、Inspector、布局状态和图数据适配层都应避免只服务当前关系图。

## 当前不应提前固定

因为尚无具体场景，现在不准入以下内容：

- 通用节点市场、任意插件节点 ABI 或 ComfyUI workflow JSON 兼容层；
- 全局可变变量、表达式语言或第二套行为 DSL；
- 固定的多模态模型供应商、媒体存储后端或上传协议；
- 把每种媒体处理动作预先做成领域节点；
- 把 Template、Invocation 或 ArtifactRef 写成“已实现”。

下一步应选两个差异足够大的纵切：至少一个文本/结构化场景和一个包含图片、音频、视频或文档的多模态场景。两者共同需要的最小 Parameter、ArtifactRef、Template Revision 与 Invocation 契约，才有资格进入 `spec/design/` 和 Runtime。
