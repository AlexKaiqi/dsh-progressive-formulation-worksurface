# 基于事实的模型上下文

WorkSurface 模型上下文只有一条重建链路：

```text
DSH Session 日志 + 不可变 Surface Revision -> Context Plan -> 模型适配器
```

组装 prompt 前，adapter 解析当前 DSH Session 唯一绑定的 Surface，并记录
downstream-ignorable 的 `worksurface/context-revision` 事件。manifest 按路径、
摘要和大小引用该 Revision 的全部不可变文件；投影代码不读取可变作者目录。
对话消息仍由原生 DSH Session Surface 管理，WorkSurface 不复制 transcript。

Context provider 通过 `ctx.contextProviders.register(...)` 注册。同一 occurrence
的 provider 并发执行，再按 `(order, providerId)` 稳定顺序结算。内联输出先写入
内容寻址的 runtime blob，再由 `context/provider-settled` 引用。稳定 occurrence
身份使恢复具备幂等性：恢复后的 Session 重放已结算事实，不会重复调用 provider。

Context Plan 合并原生对话投影、不可变 Surface 文件和当前有效的 provider
occurrence。`surface.md`、对话消息和 required provider section 不允许省略；
其余文件与 section 在目标上下文窗口内确定性选择。仅 required 输入就超过预算时，
组装会明确失败。

请求被接受后，`context/rendered` 只记录 plan、included/omitted item 身份、token
估算、模型 route 与内容哈希，不记录 prompt 或 provider 原文。所有 WorkSurface
上下文事件都携带 `ignorable: true`：未安装插件的 Harness 可以安全保留并跳过，
安装插件后则能精确重建投影。

压缩与 tool-result prune 继续由 DSH Session 的原生能力负责，WorkSurface 不建立
第二套对话维护生命周期。
