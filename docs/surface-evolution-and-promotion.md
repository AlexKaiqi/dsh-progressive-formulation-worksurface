# Surface 演化、复用与 Promotion 设计

> 状态：目标设计提案，2026-09-01；尚未进入默认 v5 Runtime。本文定义产品方向、概念边界和分阶段准入条件，不把未实现的 Schema、Store、Event 或 UI 写成当前能力。当前事实仍以[目标设计基线](design-baseline.md)、[实现索引](architecture.md)、[`spec/design/`](../spec/design/) 和 [`WS-01` 至 `WS-27`](../spec/invariants.json) 为准。

## 1. 目标

WorkSurface 不只保存一次任务的结果。它应让一次次真实推进形成可检索、可比较、可追溯的实例，再把跨实例稳定的部分逐步提升为模板、方法、策略或其他由目标系统拥有的复用资产。

整体闭环是：

```text
新任务
  ↓ 检索相关 Surface
fresh / fork / instantiate
  ↓
新 Surface + 唯一 DSH Session 完成一次具体推进
  ↓
Revision、结果、验证、偏离和反例
  ↓ 多个实例提供证据
Promotion Surface 提炼稳定项与变化项
  ↓ 独立验证和显式发布
可版本化的复用资产
  ↓
后续 Surface 再实例化并产生新反馈
```

这里的长期价值不要求存在一个被所有任务共同修改的永久 Surface。长期价值来自三类事实：

- 每个 Surface 保存的情境化实例；
- Surface 从哪个精确 Revision 或模板产生的来源证据；
- 经多个实例验证后独立发布的复用资产。

## 2. 当前边界保持不变

本设计不改变以下当前原则：

- 一个 `SurfaceId` 仍固定绑定一个 DSH Session；这个 Session 承载该 Surface 的完整推进历史；
- Turn、Step、Tool Call 继续完全由 DSH 定义，WorkSurface 不复制执行历史；
- Surface 内容继续是普通文件，发布后由不可变 Revision 表示；
- Surface head 继续由 admitted、applied、published Event replay 得出，不增加可变 head 真源；
- Orchestrate 只描述已经存在的 Surface 之间如何推进，不创建、复制、派生或删除 Surface；
- 模型继续使用普通文件、Bash、Python 和 Node，不增加模板 DSL 或通用行为 DSL；
- UI、检索索引和推荐结果都是可删除投影，不成为来源、结果或 Promotion 的事实源。

Surface 的创建、复制和模板实例化属于 Registration 之前的 authoring/admission。它可以由 Host、UI 或上层任务入口显式发起，但不加入当前 `ws emit` 模型命令，也不允许 Orchestrate 在运行中静默扩张 Surface 集合。

## 3. 第一性原则

### 3.1 实例先于抽象

没有真实使用证据时，不提前设计通用模板。先让具体 Surface 完成工作，再从重复出现的结构、方法、约束和选择中识别候选抽象。

### 3.2 复用必须保留情境

Surface 中的内容之所以成立，往往依赖当时的目标、约束、代码状态、模型能力和验收方式。复用不能只复制结论；必须能够回到精确来源 Revision，看到其成立条件和结果证据。

### 3.3 新目标产生新实例

同一个 Surface 可以在原 Session 中继续完成同一目标的澄清、修复、验证和恢复。以下情况默认创建新 Surface：

- 目标或验收条件发生实质变化；
- 需要保留旧方案并探索另一条路径；
- 新任务只是与旧任务相似，而不是旧任务的继续；
- 需要比较不同模板、模型或策略；
- 原 Surface 已形成值得保留的完整成功或失败案例。

### 3.4 复用按精确版本发生

创建新 Surface 时解析“最新”只是一项 authoring 决策。一旦创建，来源必须固定到精确 Revision。上游后来发布新 Revision，不能隐式改变既有 Surface。

### 3.5 Promote 最小稳定单元

只提升跨情境仍成立的最小单元。稳定的是验收清单，就提升清单或方法；稳定的是程序行为，就提升代码；只有完整目录结构和初始工作模型都稳定时，才提升为 Surface Template。

### 3.6 自动发现不等于自动发布

系统可以根据相似 Surface、重复 diff、模板偏离和结果证据提出候选，但不能仅凭统计相似度自动建立规范。正式发布必须经过明确所有者、适用范围、反例、验证和人工或目标系统授权。

## 4. 概念责任

| 概念 | 严格含义 | 身份与真源 | 当前状态 |
| --- | --- | --- | --- |
| Surface | 一次具体情境下持续维护的工作实例 | `SurfaceId`、Surface stream、文件 Revision、唯一 DSH Session | 已有 |
| Surface Revision | 一个合法 Surface 目录的不可变内容边界 | `Revision = sha256:*`、RevisionStore manifest/blob | 已有 |
| Surface Origin | 新 Surface 初次 admission 时固定的产生方式和精确来源 | 目标 `surface.origin.recorded` runtime-only Event | 提案 |
| Surface Catalog Entry | 供发现和排序使用的可重建投影 | Origin、Revision、Surface 文件、业务 Event 和可选 view interpretation 的组合 | 提案 |
| Promotion Surface | 以提炼并验证某个复用资产为目标的普通 Surface | 普通 `SurfaceId`、Session、Revision 和业务证据 | 使用已有概念的工作模式 |
| Surface Template | 能确定性物化为新 Surface 初始作者目录的原生复用资产 | `TemplateId` + 精确 artifact Revision + publication record | 提案 |
| 其他复用资产 | Skill、Policy、Orchestrate code、ADR、reference 等 | 由各自目标系统定义和维护 | 不建立 WorkSurface 通用 aggregate |

`Promotion` 是一种有明确输入和验收的工作流程，不建立独立 `PromotionId`、Event subject 或第二套状态机。Promotion 的推进历史就是 Promotion Surface 的 DSH Session；候选、反例、验证和交付物就是它的普通文件与业务 Event。

WorkSurface 也不建立一个包容所有 Skill、Policy、代码和文档的 `ReusableAsset` aggregate。目标系统负责资产身份、发布、兼容性和执行语义；WorkSurface 只保留精确来源、证据和交付引用。首个需要 WorkSurface 原生拥有的资产类型是 Surface Template，因为它直接参与 Surface admission。

## 5. Surface Origin

### 5.1 身份和不可变性

每个 Surface 最多有一条 `surface.origin.recorded` Event，位于该 Surface 的 authority-scoped Event stream，由 Runtime 产生，并且必须早于首次 `surface.revision.admitted` 和 `surface.session.bound`。

重复相同内容是幂等恢复；同一 Surface 出现不同 Origin 是冲突。Origin 不进入模型可编辑目录，也不能在后续 Turn 中修改。

目标结构的语义等价于：

```ts
type SurfaceOrigin =
  | {
      version: 1
      mode: 'fresh'
      source: 'default-surface-template'
    }
  | {
      version: 1
      mode: 'fork'
      base: { surfaceId: string; revision: Revision }
    }
  | {
      version: 1
      mode: 'instantiate'
      template: { templateId: string; revision: Revision }
    }
```

首版只允许一个主要来源：一个 Surface Revision 或一个 Template Revision。多个相关 Surface 可以作为 Promotion 或任务判断的证据，但不在 admission 时执行隐式多父合并。

### 5.2 三种 admission

`fresh`

从当前规范的默认 Surface 骨架建立新的作者目录。它表示没有复用某个业务实例，不表示系统没有使用内置文件模板。

`fork`

从一个精确的 Surface Revision 物化完整目录。它适合新任务与旧任务高度相似、保留旧情境后再改写成本最低的情况。新 Surface 拥有新 ID、新 Event stream、新 head 和新 Session；它不共享可变文件，也不继承旧 Session transcript。

`instantiate`

从一个已发布的精确 Surface Template Revision 物化 `content/`。模板只提供稳定骨架和初始内容；新任务 instruction 仍通过首 Turn Brief 给出，模型在新 Surface 中完成情境化。

### 5.3 创建和恢复顺序

目标 admission 应以显式请求为输入，并按可恢复顺序执行：

1. 校验目标 `SurfaceId` 尚未占用；
2. 解析并校验精确 base/template Revision；
3. 在隔离临时目录物化完整候选内容；
4. 校验路径、普通文件、符号链接禁令和合法 `surface.md`；
5. 对目标 Surface 建立排他 reservation；
6. 持久化幂等 `surface.origin.recorded`；
7. 将候选目录 durable rename 到 authoring path；
8. snapshot 并追加 `surface.revision.admitted`；
9. 在首次 Turn 前建立唯一 DSH Session binding；
10. 释放 reservation，返回已固定的 Surface 和 Session。

若进程在 Origin 落盘后、目录可见前崩溃，恢复必须从 Origin 中的精确来源重新物化；若发现目录内容与来源和 admission 结果均不一致，则拒绝启动，不猜测哪一份正确。没有持久 Origin 的临时目录不是 Surface 事实，可以安全清理。

现有“扫描普通 authoring 目录并 admission”的路径可兼容地视为 `fresh`。在原生 fork/instantiate 协议实现前，手工复制目录不能伪装成有可验证来源的派生实例。

## 6. Revision、谱系和继续推进

Origin 只描述 Surface 的出生来源，不取代 Surface 自己的 Revision 链：

```text
source Surface Revision
        ↓ origin: fork
new Surface admitted Revision
        ↓ same Surface Session
published Revision 1
        ↓
published Revision 2
```

同一目标的继续推进仍发生在同一个 Surface 和 Session 中。新 Surface 的 Revision 不与来源 Surface 形成共享 head，也不要求来源保持 active。

谱系是从各 Surface 的 Origin Event 投影出的有向图。图中的边表示“初始内容来源”，不表示：

- 后代持续依赖上游最新状态；
- 上游修改必须传播；
- 两个 Session 共享消息或执行上下文；
- 后代完成意味着上游完成；
- 来源 Surface 比后代更权威。

失败、放弃和被替代的 Surface 仍可以提供反例证据，不应因 UI 归档而从谱系中删除。

## 7. Surface 发现和复用决策

### 7.1 Catalog 是投影

Surface Catalog 不保存第二份 Surface 事实。一个 Entry 由以下内容确定性或可审计地投影：

- `SurfaceId`、当前 head Revision 和 Origin；
- `surface.md` 及其他允许索引的普通文件；
- 已使用的 Template Revision；
- Surface stream 中明确的业务 Event；
- 可选 `WorkSurfaceViewDefinition` 对业务 Event 的生命周期解释；
- 创建时间、Revision 时间和最后一次验证证据；
- DSH Session 的存在和当前执行状态，但不以 Turn 结束推断业务成功。

标题、摘要、关键词和向量可以由索引器从精确 Revision 生成，但必须携带 `sourceRevision` 和生成器版本；删除后应能重新生成。索引器不得反向修改 Surface。

### 7.2 检索顺序

新任务的候选发现采用分层策略：

1. 权限、项目、领域、代码路径、技术栈等硬约束过滤；
2. 精确 Template、组件、Contract 和标签匹配；
3. 谱系邻近和共同来源；
4. 普通文本与可选语义相似度召回；
5. 验证证据、适用范围、新鲜度和已知反例排序。

向量相似度只帮助召回，不建立来源、版本、成功或兼容性事实。

### 7.3 结果必须可解释

每个候选至少展示：

- 命中的目标、约束、路径或模板；
- 与新任务相同和不同的条件；
- 候选的精确 Revision；
- 已知结果与验证证据；
- 新鲜度和适用范围风险；
- 推荐动作：继续、fork、instantiate 或只读参考。

如果用户要继续同一目标，恢复原 Surface；如果是相似但独立的新目标，创建 fork；如果稳定结构已经发布为模板，优先 instantiate；如果差异大，只把旧 Surface 当证据而不复制。

## 8. Promotion 工作流

### 8.1 Promotion Surface

Promotion 使用一个普通 Surface 表达。它的 `surface.md` 应明确：

- Goal：准备发布哪类复用资产；
- Acceptance Criteria：在哪些独立实例中验证，允许哪些差异；
- Known Facts and Constraints：来源 Surface Revision、目标系统发布契约和兼容边界；
- Assumptions：哪些内容被假定为稳定；
- Open Questions：已知反例和未覆盖情境；
- Current Decisions：稳定项、变量项和适用范围；
- Deliverables and Evidence：候选资产、测试、对照结果和最终发布引用。

候选描述可以先作为普通 JSON/Markdown 文件存在于 Promotion Surface 中，不在没有运行消费者前建立全局 Candidate Store。

### 8.2 候选证据

一个可发布候选至少包含：

- 目标资产类型和目标所有者；
- 精确来源 `SurfaceId + Revision` 集合；
- 稳定项假设；
- 可替换或待参数化的变化项；
- 失败案例和反例；
- 适用范围与明确排除项；
- 预期收益；
- 验证方法和验收结果。

重复次数不是充分条件。一个模式即使出现很多次，也可能只是复制了同一个错误前提。Promotion 必须证明它跨独立情境成立，并且抽象后的使用成本低于重新从实例开始的成本。

### 8.3 生命周期

Promotion 的产品阶段是：

```text
observed
→ candidate
→ validating
→ accepted / rejected
→ published in target owner
→ observed through later Surface usage
```

这些阶段首先是 Promotion Surface 中由业务 Event 和 View Definition 解释的显示语义，不要求 Runtime 增加通用 Promotion 状态机。目标资产发布后，它自己的 owner 负责 version、deprecated、superseded 和执行行为。

### 8.4 自动化边界

后台或按需分析可以提出：

- 多个 Surface 中重复出现的目录结构或章节；
- 多个 fork 中重复发生的相似修改；
- 使用同一模板后反复出现的偏离；
- 某类任务中重复出现的模型选择；
- 成功实例和失败实例之间稳定的差异。

分析输出只是带证据链接的 recommendation projection。只有用户或明确授权的维护流程创建 Promotion Surface、完成验证并调用目标系统发布能力后，候选才成为资产。

## 9. Surface Template

### 9.1 为什么首个只实现 Template

Surface Template 直接参与 WorkSurface admission，所以 WorkSurface 必须定义它的精确身份、内容边界和物化规则。Skill、路由 Policy、Orchestrate code 和 ADR 已有或应有各自 owner，不应为了统一 UI 被塞进一个新的万能 Store。

### 9.2 身份和内容

一个 Template 具有稳定 `TemplateId`。一个可使用版本由现有 RevisionStore 中 `kind: artifact` 的精确 Revision 标识。artifact 根的最小布局为：

```text
template.json
content/
  surface.md
  ...普通初始文件
```

`template.json` 首版只声明：

- `version`；
- 与 publication request 一致的 `templateId`；
- 标题、目的和适用范围；
- `contentRoot: "content"`；
- 必须存在的 entry paths；
- 兼容的 Surface schema version；
- 可选验证命令或验证 artifact 引用。

首版不提供文件覆盖、继承、多模板叠加、条件展开、任意表达式或 patch DSL。任务具体值由首 Turn instruction 和模型普通文件编辑完成，而不是由模板语言生成。

### 9.3 Publication

Template publication 必须保存不可变记录，至少固定：

- `TemplateId`；
- exact artifact Revision；
- producing Promotion Surface 及其 exact Revision；
- published time；
- 可选 superseded Template Revision；
- 验证结果引用。

准确 Store、schema、append/replay 和并发协议必须在实现 Template 的同一个变更中交付。建议使用独立、append-only 的 Template publication stream 或等价不可变 record，不使用一个可被覆盖的 `latest.json` 作为真源。

“latest”只是从 publication facts 派生的选择结果。实例化请求必须先把它解析为精确 Revision，再写入 Surface Origin。

### 9.4 兼容和替换

已发布 Template Revision 永不原地修改。新版本可以 supersede 旧版本，但：

- 已创建 Surface 继续引用旧 Revision；
- 不自动迁移历史 Surface；
- 比较两个模板版本时创建两个独立 Surface；
- 替换正在使用的模板等价于创建新的派生 Surface，不是热更新当前目录；
- deprecated 版本仍可为旧 Surface 提供 provenance 和重放。

## 10. 使用反馈和再次提升

Template 实例化后，Origin 已记录精确版本。后续反馈从真实 Surface 中产生：

- 哪些模板文件被保留、删除或大幅改写；
- 哪些预设步骤未能执行；
- 哪些新文件和检查在同类任务中反复出现；
- 最终产物是否通过业务验收；
- 哪些失败与模板假设有关；
- 哪些变化只属于特定项目或技术栈。

首版只保存来源和结果证据，不声称能从普通文件 diff 自动区分“任务正常填充”和“模板偏离”。当积累足够实例后，才考虑在 Template manifest 中加入经过验证的 stable path、task-owned path 或 slot 契约。没有评测前不引入这些字段。

大量相同偏离通常意味着模板需要新增变化点；一部分 Surface 稳定地朝两个方向演化，通常意味着应拆分模板；某段内容频繁被删除，通常意味着它不应处于默认模板。

## 11. 多模型路由作为 Promotion 例子

多模型路由不从一套预设中央规则开始，而从具体 Surface 的实际选择和结果逐渐形成：

```text
任务 Surface 中的模型选择和结果
  ↓ 多个实例
任务分类、质量要求、成本/延迟约束
  ↓ Promotion Surface
Routing Policy Candidate + Eval Set
  ↓ 目标 owner 验证并发布
provider-owned Routing Policy Revision
  ↓ 新 Surface/Agent 创建时解析
实际模型 + fallback + usage observation
```

适合提升的稳定内容包括：

- 任务 taxonomy；
- 能力角色和最低质量要求；
- 升级到强模型的条件；
- 成本、延迟和隐私约束；
- fallback 原则；
- 评测集和验收方法。

不适合固化在 Surface Template 中的易变内容包括具体模型可用性、实时价格、凭据、限流和瞬时连接状态。这些继续由 `modelCatalog`、portrait、probe、usage observation 和 provider runtime 拥有。

Routing Policy 应尽量表达能力角色，而不是把产品型号当作长期不变量。目标 owner 在创建 Agent 前把 Policy Revision、当前 catalog 和运行约束解析为实际模型。选择证据应记录在 owner 的持久事实或 DSH Session 创建事实中；在共同稳定的跨系统 `AssetRef` 协议出现前，不把 provider-specific Policy 假装成 WorkSurface 原生 Template。

## 12. Orchestrate 的作用

Orchestrate 可以推进 Promotion 已经拥有的 Surface，例如：

- 当候选准备完成时推进预先建立的验证 Surface；
- 收集多个验证 Surface 的完成 Event；
- 把对照结果写回 Promotion Surface；
- 在全部验收条件满足后产生“ready for explicit publication”业务事实。

Orchestrate 仍不能：

- 为每个推荐自动创建 Surface；
- 创建或删除 Template identity；
- 绕过目标 owner 的发布授权；
- 在运行中增加未注册的验证 Surface；
- 根据相似度自动把候选标为规范；
- 让既有 Surface 自动跟随新 Template Revision。

需要并行验证时，相关 Surface 必须在 Registration admission 前由普通 authoring 显式准备。

## 13. 并发、幂等和恢复

实现本设计时必须满足：

- 同一 `SurfaceId` 的 admission 只能成功一次；相同 Origin 请求幂等，不同 Origin 冲突；
- fork/instantiate 始终读取 exact Revision，不读取可变 authoring 源；
- 目标 authoring 目录只在完整校验后可见；
- Origin、目录物化和 admitted Event 之间的崩溃窗口能够从持久请求或 Origin 恢复；
- 同一 `TemplateId + Revision` 重复 publication 内容相同时幂等，不同 provenance 或 manifest 时冲突；
- Template publication 不能引用未持久化的 artifact Revision 或不存在的 Promotion Surface Revision；
- Catalog 重建、通知丢失和重复索引不影响事实；
- recommendation 重复生成不会自动创建重复 Promotion Surface 或发布记录；
- 所有比较、验证和后续实例化都保留精确 Revision，而不是只保存标题或 `latest` alias。

## 14. 权限和数据边界

Surface 检索必须先执行权限过滤，再生成摘要、关键词或 embedding。无权读取的 Surface 不得通过标题、相似度、谱系边或计数泄露存在性。

Template publication 只能包含目标 owner 允许公开给消费者的普通文件。凭据、Session transcript、一次性 transport、Host 私有 Binding 和未脱敏工具结果不得进入模板。

fork 会物化来源 Revision 的全部文件，因此只允许在相同或更严格的授权边界内进行。跨边界复用应通过经过审查的 Template 或目标系统资产，不直接 fork 私有 Surface。

## 15. UI 投影

UI 可以增加三个相互独立的投影视图：

### 15.1 新任务候选

展示相关 Surface 和 Template，解释相同点、不同点、来源 Revision、验证结果和推荐动作。用户确认后才发起 fresh/fork/instantiate admission。

### 15.2 Surface 谱系

节点是 Surface，边来自 `surface.origin.recorded`。Template 实例化边指向精确 Template Revision。图只表示出生来源，不表示当前依赖或自动传播。

### 15.3 Promotion 证据

以 Promotion Surface 为中心展示来源案例、反例、验证 Surface、候选交付物和最终目标资产引用。自动发现的 recommendation 与已接受事实必须使用不同视觉编码。

上述 UI 均不改变 Surface、Template 或目标资产；删除 projection 后必须能从持久事实重建。

## 16. 价值评测

Promotion 只有在降低长期总成本时才有价值。至少跟踪：

- 相似任务从开始到形成正确系统理解所需时间；
- 为完成任务读取和注入的上下文 token；
- fork/instantiate 后首次验收通过率；
- 模板被删除或大幅改写的比例；
- 因过期假设导致的失败或返工；
- 一个候选从 observed 到 published 的维护成本；
- 资产发布后被独立 Surface 使用的次数；
- 使用资产和不使用资产的质量、成本和修复轮次对照；
- 模板或策略版本回滚、deprecated 和分裂的频率。

可用一个简单判断约束过早抽象：

```text
复用收益
= 避免的重复理解与构建成本 × 独立使用次数
- 候选提炼、验证和维护成本
- 额外上下文噪声
- 过期或错误抽象的风险成本
```

无法用真实 Surface 对照证明收益的模板，只是方便作者的草稿，不应自动成为默认资产。

## 17. 分阶段落地

### 阶段 A：来源和 fork

交付：

- Surface admission request 与 `surface.origin.recorded` Schema；
- fresh/fork 的 exact Revision materialization；
- Origin-before-admitted-before-bound 顺序；
- reservation、崩溃恢复、冲突和幂等测试；
- 从 Origin 重建的基础谱系投影。

此阶段不实现 Template、自动推荐或语义搜索。

### 阶段 B：Catalog

交付：

- 可删除 Catalog projection；
- exact filter、全文召回和结果解释；
- permission-first indexing；
- sourceRevision 和索引器版本；
- 删除、重建、重复通知和陈旧索引测试。

此阶段的检索只帮助用户选择继续、fork 或只读参考。

### 阶段 C：Surface Template

交付：

- `TemplateId`、manifest Schema 和 artifact snapshot；
- publication record/store/fold；
- instantiate admission 与 Origin；
- supersede/deprecate projection；
- exact Revision、并发 publication、崩溃恢复和旧版本实例化测试。

首版禁止 overlay、继承和条件 DSL。

### 阶段 D：Promotion 实证

交付：

- 至少一个由多个真实 Surface 产生 Template 的完整案例；
- 明确反例和独立验证；
- 使用新 Template 的后续 Surface；
- 使用前后理解成本、修改量、质量和修复轮次对照；
- recommendation 与正式 publication 的 UI 区分。

只有实证表明字段稳定后，才把 Candidate 或偏离信息提升为机器 Schema。

### 阶段 E：目标系统资产

选择一个真实目标 owner，例如模型路由插件：

- 在 Promotion Surface 中产生 Policy 和 Eval Set；
- 由 provider owner 发布和版本化 Policy；
- 新 Agent 创建时固定 Policy Revision 和解析结果；
- 将使用结果作为后续 Promotion 证据；
- 评估是否真的需要跨 owner 的通用 `AssetRef`，而不是提前建立。

## 18. 新协议的原子准入要求

本文不增加当前机器协议。开始实现任一阶段时，必须在同一变更中交付：

1. 新身份及与 `SurfaceId`、Revision、Session 的关系；
2. TypeScript 类型和 JSON Schema；
3. authoring/admission 输入与 Runtime-owned 持久事实的边界；
4. Store、append、锁、fsync 和 replay/fold；
5. 幂等键、冲突和崩溃窗口；
6. model-visible 信息和 runtime-only 信息的明确分离；
7. 正常、冲突、重启、权限和 projection 重建测试；
8. `spec/invariants.json` 中的新连续不变量编号；
9. 实现索引、UI 设计、交互图和本文状态同步更新；
10. 真实 Surface 复用和 Promotion 的可执行验收证据。

在这些条件完成前，`Surface Origin`、`Surface Template` 和 Catalog 只是目标设计，不得在 UI 或 README 中标记为可用。

## 19. 已作出的设计判断

- Surface 是具体工作实例，不提升为跨任务共享可变知识库；
- `Surface ↔ DSH Session` 1:1 保持不变；
- 新目标通过新 Surface 表达，复用通过 exact Revision 派生表达；
- 同一 Surface 内的 Revision 链与 Surface 之间的出生谱系是两种不同关系；
- 首版派生只允许一个主要来源，不做多父 merge；
- 后代不自动跟随来源或 Template 更新；
- Promotion 是普通 Surface 工作流，不增加通用 Runtime 状态机；
- WorkSurface 不拥有所有复用资产；首个原生资产仅为 Surface Template；
- Template 首版只有确定性目录物化，不提供 overlay、继承、slot 或 patch DSL；
- 自动系统只提出带证据的 recommendation，不自动 publish；
- Catalog、摘要、向量和 UI 都是可删除投影；
- 模型路由等资产由目标 owner 执行和版本化，WorkSurface 提供实例证据与 Promotion 工作面。

## 20. 仍需通过实证回答的问题

- Surface 相似性中，哪些结构化字段值得成为稳定 authoring contract；
- fork 整个 Revision 与只参考相关文件各自适合哪些任务；
- Template 是否需要参数和 slot，以及哪些字段能由真实偏离证明；
- Outcome 能否跨领域形成通用最小协议，还是继续由业务 Event 和 View interpretation 表达；
- 自动推荐应在任务开始前同步运行，还是作为可缓存的后台 projection；
- Template publication 应使用独立 Event subject 还是 immutable record store；
- 何时有足够多的跨 owner 使用案例，值得引入通用 `AssetRef`；
- 多模型路由中哪些稳定规律属于 Policy，哪些仍应留在实时 catalog 和 evaluator。

这些问题不靠补充术语提前解决。先完成阶段 A、B 和一个真实 Promotion 闭环，再用实际 Surface、偏离、成本和失败证据决定协议。
