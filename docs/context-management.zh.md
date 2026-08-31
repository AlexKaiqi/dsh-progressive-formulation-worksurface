# 基于事实的模型上下文

本文描述 `packages/dsh/src/context/` 的当前实现，不定义通用 Surface 地址理论。

## 1. 权威输入

当前 `WorkSurfaceContextRuntime` 从两类持久事实构建模型上下文：

```text
DSH Session events / session.surface
+ bound Surface 的不可变 Revision manifest
+ 已结算的 provider occurrence sections
        ↓ buildContextPlan
ContextPlan
        ↓ ModelContextAdapter.render
RenderedContext + RenderManifest
```

DSH Session 仍拥有对话历史；WorkSurface 不复制 transcript。Surface 文件由 `RevisionStore` 按内容摘要读取，provider 的内联文本先写入 `runtimeRoot/context/blobs/<sha256>.txt`，再以 content ref 进入 Session facts。

## 2. 当前可寻址内容

`ContextContentRef` 目前只有三种：

- `worksurface-file`：`surfaceId + revision + path + contentHash + size`；
- `session-event`：`sessionId + seq + contentHash`；
- `blob`：`id + contentHash`。

当前没有通用 `adapter + locator + boundary` 协议，也没有文件 fragment、数据库局部或外部 artifact adapter。要支持这些对象，必须先扩展类型、解析器、持久化/版本边界和测试。

## 3. Surface Revision 投影

`publishRevision()` 读取一个不可变 Surface Revision，把每个文件映射成 `worksurface-file` ref，并向绑定 Session 追加：

```text
worksurface/context-revision
  surfaceId
  revision
  previousRevision
  manifest { files, manifestHash }
```

`foldWorkSurfaceContext()` 从这些 Session facts 重建当前 Surface Revision 与文件列表。当前 `surface.md` 在 `ContextPlan` 中是 `required + never omit`，其他文件默认是 `high + whole-item`。

## 4. Provider occurrence

Provider 只在注册的 `analysis / acceptance / recovery / maintenance` occurrence 中运行。每个 occurrence 通过 Session facts记录：

- `context/occurrence-created`；
- 每个 provider 的 `context/provider-settled`；
- `context/occurrence-consumed`；
- `context/occurrence-ended`。

Provider 按 `(order, providerId)` 稳定排序，当前实现逐个调用并持久化结算结果。失败记录 `providerId / errorCode / retryable`；required provider 失败会阻止继续。

Lifetime 支持 `request`、`phase`、`until-revision-change`、`until-event` 和 `session`。

## 5. ContextPlan 与 render

`buildContextPlan()` 按 Session 当前 seq 生成不可变计划：

- `conversation-message` / `compaction-checkpoint` 来自 `session.surface.nodes`；
- `surface-file` 来自最新 WorkSurface context revision；
- `runtime-injection` / `recovery-state` 来自有效 occurrence。

每个 item 记录 content ref、来源 fact seq、priority、omission policy、lifetime 和可选 token 估算。`planId` 是规范化计划内容的摘要。

默认 adapter 先纳入所有 `required` 或 `never` item；若它们超过预算则失败。之后按 `high → normal → low` 整项纳入。`RenderManifest` 记录 included/omitted item、token 估算、model target 和内容哈希；原文不写入 manifest。

## 6. DSH 边界

WorkSurface context extension events 被注册为 DSH Session event types，并标记为 downstream-ignorable。压缩、prune 以及 `Session → Turn → Step → Tool Call` 生命周期仍由 DSH 负责。

当前上下文实现没有 `Episode`。ContextPlan、provider occurrence、Turn 和 Step 都不能改名或概括为 Episode；若未来需要这种边界，必须独立实现身份、持久化、DSH seq 引用、恢复和 fold。
