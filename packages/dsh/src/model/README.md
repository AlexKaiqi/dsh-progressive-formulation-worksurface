# Model-Aware Content Spec

模型能读到的每一段自然语言、工具描述、CLI 帮助和结构化输出契约，都从实现代码中抽离，
集中在本目录（CLI 侧在 `packages/cli/src/help.ts`）。实现代码只负责组合与执行。

## 文件与变化来源

| 文件 | 唯一变化来源 | 内容 |
| --- | --- | --- |
| `guidance.ts` | Parent 模型的静态系统提示 | `worksurfaceGuidance()`、section order |
| `file-projection.ts` | Projection 的模型可见文件载体 | revision manifest、b2f-compatible fences、只读跨 Surface 文件 |
| `orchestrator-tool.ts` | `run_orchestrator` 工具的模型可见表面 | 工具名、描述、参数 schema 与参数描述、输出 schema/render |
| `child-agent.ts` | 子 Agent 的返回契约与 persona | `AGENT_OUTPUT_SCHEMA`、`childPersona()` |
| `session-root-template.ts` | Session root Surface 的初始模板 | `SESSION_ROOT_TEMPLATE` |
| `packages/cli/src/help.ts` | CLI 面向模型的帮助文本 | `HELP`、`INIT_HELP`、`VERSION` |

规则：一个文件只有一个变化来源。修改提示词、描述或契约时只改对应文件；
修改执行逻辑时改 `service.ts` / `workspace.ts` / `b2f.ts` / `agent-run.ts` / `authority.ts` /
`attempt.ts` / `attempt-gc.ts` / `config.ts` / `capabilities.ts`，不要动本目录内容。

## 模型感知内容的固定测试

- `packages/dsh/tests/model-awareness.spec.ts`
  - Parent guidance 覆盖何时使用、何时不用、b2f 的 `work/root` 路径与工具调用。
  - `run_orchestrator` 工具表面完整：名称、描述、参数，以及含 workspace hash 的输出 schema。
  - 子 Agent persona 覆盖 assigned Surface、b2f checkout root、base revision、`ws commit` 流程和结构化返回契约。
  - Session root 模板包含初始化所需全部章节。
- `packages/cli/tests/help.spec.ts`
  - `HELP` 列出所有命令。
  - `INIT_HELP` 覆盖完整初始化流程。
  - `VERSION` 与 `packages/cli/package.json` 同步。
- `packages/dsh/tests/service.spec.ts`
  - 集成验证：真实 system prompt 和 tool schema 中确实出现上述内容。

任何模型可见文本或契约发生变化时，对应测试必须同步更新；测试失败即表示模型契约发生了变化。

## 编写规则

1. Parent guidance 中不得出现动态 Surface id、revision、绝对路径或 run identity；稳定的
   workspace 相对路径可以写入 guidance，动态信息通过 Projection 上下文块和环境变量注入。
2. 工具描述必须同时覆盖 positive activation（何时用）和 negative activation（何时不用），
   并指向 `ws --help` 与 `ws help init` 作为使用说明。
3. CLI 帮助必须与真实命令解析器保持同步；新增命令或参数时先改 `help.ts` 再改 `bin.ts`。
4. 子 Agent 契约必须明确：只能提交 assigned checkout、必须用精确 base revision、
   只能返回结构化完成对象、每个 output 必须引用已提交 Block。
