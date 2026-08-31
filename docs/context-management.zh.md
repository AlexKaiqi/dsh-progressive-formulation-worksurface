# 基于事实的模型上下文

Surface 是可寻址、持续维护的结构化工作上下文，不是预先规定的文件集合。一次模型调用看到的内容由 Context Projection 构建：

```text
DSH Session Log
+ Surface Materializations
+ WorkSurface EventRefs
+ Provider Outputs
        ↓
Context Snapshot / Context Plan
        ↓
Model Adapter
```

DSH `session.surface` 仍是对话历史的唯一所有者；WorkSurface 不复制 transcript。首个 DSH adapter 根据 Binding 找到当前 Surface，再由 provider 决定这个 Surface 在当前问题下有哪些可用上下文。文件目录、数据库记录、外部 artifact 和事件范围都只是 provider/materialization 类型，通用协议不要求 `surface.md` 或固定章节。

每个候选内容都必须具有逻辑地址 `SurfaceId + adapter + locator [+ boundary]`。`locator` 可以定位文件 fragment、结构化对象局部、事件范围或外部 artifact 内部元素。没有 boundary 的 working address 指向持续维护的当前内容；用于重放、跨 Surface 引用或事件因果的地址必须固定到 Revision、EventRef、Session event boundary 或外部版本。

持续维护发生在模型调用之间：模型通过普通工具修改获授权的 Materialization，后续 Turn/Step 的 Context Projection 从最新允许状态重新选择内容。Surface 因而是模型可访问和可维护的长期工作表示，但不是每个 Step 都完整注入的 prompt。

这些连续推进按 Episode 组织。Episode 包含或引用本次推进使用的上下文边界、模型步骤、工具调用、Surface 修改、结果与证据；后续 Episode 从同一个 Surface 的最新允许状态继续。Episode 不复制 DSH transcript，也不预设等同于一个 Turn 或 Step。

Episode 推进中产生的自定义 Event 可以在 payload 中直接内联较小信息，也可以携带文件、Surface 局部、blob 或外部 artifact 的 content ref。Context Projection 消费 ref 时按 adapter 解析；用于重放、跨 Surface 传递或验收证据的 ref 必须固定 boundary，working ref 只能读取当前内容。

每个输入必须固定到可重建边界：文件 materialization 使用不可变 Revision，DSH 历史使用稳定 Session event boundary，WorkSurface 事实使用 EventRef，外部 provider 使用其可验证版本或内容摘要。Revision 因此只是文件 materialization snapshot，不等于全部 Surface 内容事实。

Context Plan 对每个候选项明确记录：

- `required`：必须进入当前调用；超出预算时显式失败；
- `included`：实际进入模型输入；
- `omitted`：已发现但因预算或策略未进入，不能描述为模型已经消费。

同一 occurrence 的 providers 可以并发执行，再按稳定 `(order, providerId)` 顺序结算。需要恢复的输出先持久化为内容寻址对象或稳定外部引用，然后由 Context Snapshot 引用；恢复时复用已结算事实，不重复产生未知副作用。

请求被接受后，render audit 只记录 Context Plan、included/omitted/required 身份、token 估算、模型 route 与内容哈希，不记录 prompt 或 provider 原文。相关 WorkSurface context events 必须是 downstream-ignorable；未安装插件的 Harness 可以保留并跳过，安装插件后可以重建投影。

WorkSurface 推进控制层只向模型注入少量稳定入口和当前位置指针，内部 SessionId、Turn、InstanceId、ActivationId、因果链和 capability 由可信实现补齐。这里不要求 DSH 存在同名 Runtime。模型继续使用 Bash、Zsh、Python、Node 和普通文件能力处理投影后的内容。

压缩、tool-result prune 以及 `Session → Turn → Step → Tool Call` 生命周期继续由 DSH 负责，WorkSurface 不建立第二套对话维护机制。
