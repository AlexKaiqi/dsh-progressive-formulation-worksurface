# Orchestrate code 可执行样例

语义与边界只在 [`docs/orchestration-code-contract.md`](../../docs/orchestration-code-contract.md) 维护。本目录提供行为证据：

| 文件 | 证明什么 |
| --- | --- |
| [`prepare-parallel-surfaces.py`](prepare-parallel-surfaces.py) | Surface 的复制和派生发生在 Registration 之前 |
| [`delegate/registration.json`](delegate/registration.json) | local handle 只绑定已存在 Surface；Event route 是静态装配 |
| [`delegate/artifact/`](delegate/artifact/) | 精确的 Orchestrate Revision 根；包含 code、局部 Contract 和 support files |
| [`delegate/artifact/orchestrate.py`](delegate/artifact/orchestrate.py) | `when / who / how` 由普通代码、已绑定 handle 和普通文件操作表达 |
| [`delegate/run/`](delegate/run/) | Runtime 给 code 的 staged run view |
| [`fanout-join/`](fanout-join/) | 同一输入写入两个已绑定 Surface；Input Ledger 齐备后才 join 并推进 coordinator |
| [`serial-loop/`](serial-loop/) | 串行推进 worker；未收敛时重写并再次推进同一 Surface，收敛后回到 coordinator |

[`scripts/validate-schemas.mjs`](../../scripts/validate-schemas.mjs) 会在临时目录实际执行这些样例，并验证输入只读、Surface 集合不变、文件传递、Event capability、result、Input Ledger 和 Operation batch/settlement 的一致性。

每个样例都把 `registration.json`、`artifact/` 和 `run/` 分开。Runtime 只对 `artifact/` 调用 `RevisionStore.snapshot(..., 'artifact')`；Registration 路径相对这个根解析，Registration metadata 与运行输出不进入 Orchestrate Revision。
