# @pf-worksurface/web

面向用户的 DSH 原生 `conversation.view` WorkSurface 拓扑。用户从作者目录与事件事实重放出的 Surface 列表显式选择锚点；conversation target 不充当 SurfaceId。Surface 节点显示有意义标题和由事件重放得到的阶段，subscription 汇合点保留 `all`、`any`、`count`、`sequence` 与代码 handler 的语义差异。

可能通路、已匹配 source EventRefs 和实际托管 operation 使用不同视觉层。Surface 节点显示当前 Definition 中的 role；点击 Surface 会把它设为新的显式锚点。“进入推进”把该 Surface 交给 Host admission，并通过 DSH 原生导航打开其唯一 Session；首次进入创建空白 Session，重复进入恢复或返回原 Session，不自动发送消息。通路与条件分别打开证据侧栏，把 possible、matched、activation、managed operation、关联 Session/Turn 和 publication 逐层呈现，并可检查精确 Definition revision、Registration、绑定、EventRefs、operation 与失败。

可选 `viewRevision` 指向包含 `worksurface-view.yaml` 的精确不可变 Revision。校验后的 View Definition 可以提供标题、分组、标签、稳定布局提示和业务事件展示解释；无效或缺失时使用确定性回退。它不驱动 Agent，也不保存当前状态。浏览器不拥有关系、binding 或执行状态；Session admission 与恢复由 Host 和 DSH persistence 完成。产品 UI 不使用 iframe 或独立地图页。

Web 使用 wakeup-only 长轮询触发完整 Host 投影重放；通知内容不进入状态计算，超时心跳也会重放，因此丢失、重复或页面恢复只影响刷新时机。`evals/browser-harness.mjs` 可在没有 DSH profile 时加载真实 Client/CSS，验收暗色、窄屏、键盘与证据侧栏。
