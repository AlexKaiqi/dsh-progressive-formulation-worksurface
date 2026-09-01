# @pf-worksurface/web

面向用户的 DSH 原生 `conversation.view` WorkSurface 关系与证据视图。用户从作者目录与持久事实重放出的 Surface 列表显式选择锚点；conversation target 不充当 SurfaceId。

默认 code-first 图面只有 Surface、Orchestrate 与两种通路：Registration route 投影为虚线声明通路，已持久 Runtime Event 的 `producer` 与 `causes` 投影为实线因果通路。两者不互相推断。任意 Orchestrate 代码的内部条件、循环与 fan-out 不会被 UI 伪造成静态关系。

默认图面采用 MIT 许可的 React Flow 作为节点编辑器交互底座，并用 MIT 许可的 Dagre 生成首次分层布局。画布支持节点拖动、触控板平移、缩放、适配视图、可切换小地图和显式“自动排版”；刷新投影不会把用户微调的位置重置。节点位置和 viewport 仅按锚点保存在当前浏览器的 `localStorage`，可以删除，也不会进入 Surface、Registration、Event、Revision 或 View Definition。当前 UI 不开放连线创建、删除或改写，所有边仍只是 Host 事实的只读投影。

点击 Surface、Orchestrate、虚线通路或实线 Event 会打开同一证据抽屉。抽屉只展示对应的精确事实：SurfaceId 与生命周期证据、Orchestrate revision 与 bindings/routes，或 Runtime Event 的 id、contract、producer、causes、operation key 与 payload。非当前 Surface 在抽屉中提供“以此 Surface 为锚点”。

“进入推进”把当前 Surface 交给 Host admission，并通过 DSH 原生导航打开其唯一 Session；首次进入创建空白 Session，重复进入恢复或返回原 Session，不自动发送消息。

Definition v1 的 subscription/Activation/Operation 拓扑只出现在独立的“v4 兼容”模式，不与 code-first 图面同时渲染。兼容图仍保留 `all`、`any`、`count`、`sequence`、code handler 以及 possible/matched/operation 证据。

可选 `viewRevision` 指向包含 `worksurface-view.yaml` 的精确不可变 Revision。校验后的 View Definition 可以提供标题、分组、标签和业务事件展示解释；无效或缺失时使用确定性回退。它不驱动 Agent，也不保存当前状态。浏览器不拥有关系、binding 或执行状态；Session admission 与恢复由 Host 和 DSH persistence 完成。产品 UI 不使用 iframe 或独立地图页。

Web 使用 wakeup-only 长轮询触发完整 Host 投影重放；通知内容不进入状态计算，超时心跳也会重放，因此丢失、重复或页面恢复只影响刷新时机。`evals/browser-harness.mjs` 可在没有 DSH profile 时加载真实 Client/CSS，验收声明/事实分层、证据抽屉、兼容隔离、暗色和窄屏。

`src/client.js` 是 Client 唯一源码；`tsdown.config.mjs` 固定把 React Flow、ReactDOM 与 Dagre 打进 DSH browser bundle，只把宿主 React 保持为 external。仓库中的 `client.js` 是 `npm run bundle` 可重复生成的发布产物。React Flow 自带样式由 Host 从已锁定依赖提供，再叠加插件自己的 `styles.css`。
