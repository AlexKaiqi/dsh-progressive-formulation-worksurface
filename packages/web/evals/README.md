# Web 投影验收

`npm run eval:check` 会执行引用的 Web 行为测试，验证无 iframe 的原生 `conversation.view`、连通拓扑重放、不同条件汇合点与可能/实际通路、关联 Session/Turn 与 publication、精确 Definition，以及已校验不可变 View YAML；浏览器不维护关系或执行状态。

`node browser-harness.mjs` 默认使用内置确定性 fixture。真实 DSH Host 验收可设置 `PF_WORKSURFACE_E2E_UPSTREAM=http://127.0.0.1:3080`；再用 `PF_WORKSURFACE_E2E_SURFACE=<surface-id>` 把 Surface 选择限定到一个已知 fixture。该模式仍加载当前真实 Client bundle，但 CSS 与只读 topology/surface API 来自已装配的 DSH profile，便于在不复制用户认证令牌的情况下验证 Host/Client 组合。
