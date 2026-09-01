# 模型表面

`global-instructions.ts` 只维护所有 Agent 都需要的 WorkSurface 适用边界和 `"$DSH_WORKSURFACE_CLI" help` 发现入口；具体 authoring 契约由 CLI 的 `author`、`coordinate`、`emit`、`recover` 场景 help 唯一维护。普通 Agent shell 获得公共 `$DSH_WORKSURFACE_ROOT` 与不依赖 `PATH` 的 `$DSH_WORKSURFACE_CLI`，足以 author 首个 Surface。`session-instructions.ts` 只为已经绑定的 Surface Session 补充当前固定 Scope 和 help/Brief 使用纪律。任务专用事实由 `$DSH_WORKSURFACE_VIEW_DIR/turn-brief.json` 按 Turn 提供：当前 instruction、受限输入、允许输出、payload Schema 和精确 emit argv。模型不需要 author authority、namespace、digest、cause resolution、CAS、Operation 或 transport；这些事实由 Runtime 校验和持久化。
