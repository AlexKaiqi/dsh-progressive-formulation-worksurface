# 渐进式形式化 WorkSurface

[English](README.md) | 中文

渐进式形式化 WorkSurface 是一个 DeepSeek Harness 插件产品。它为 parent Agent 提供持久、文件原生的 WorkSurface、普通脚本编排工具，以及通过 revision 固定的子 Agent 协作。

仓库包含四个实现包。其中前三个组成 canonical WorkSurface 插件，Web 包是可选的可视化伴侣：

- [`@pf-worksurface/core`](packages/core) 负责不可变文件存储、Projection 和 effect journal。
- [`@pf-worksurface/cli`](packages/cli) 提供经过认证的 `ws` 进程客户端。
- [`@pf-worksurface/dsh`](packages/dsh) 是可安装的 DeepSeek Harness 插件与 profile 组合包。
- [`@pf-worksurface/web`](packages/web) 在 Web profile 中提供“对话 / 工作面图”切换、Surface DAG 与关联 Session 对话。

`/dsh` bundle 会组合 `@deepseek-ai/dsh-block-to-file` 作为模型可见的文件物化层；`/core` 仍独立于 Harness runtime。

数据边界是：顶层 Session 拥有整张 WorkGraph；一个独立 Surface 对应一个 Agent Session；Surface 内的 Block 是概念、证据或决策。只有需要独立 Agent、验收、版本或生命周期的 Block 才提升为 Child Surface。图上的连线来自实际 Projection 中 revision-pinned 的 BlockRef，不使用结构性 `parent` 字段冒充信息依赖。

Web 插件的产品级端到端评估维度、用例、固定测试数据和真实 DSH 执行记录维护在 [`packages/web/evals`](packages/web/evals/README.zh.md)。它与单元测试分开管理，并在 Web 包构建时校验。

模型是否真正知道何时使用、如何提交、如何划分 Block/Surface、如何委派与恢复错误，由 [`packages/dsh/evals`](packages/dsh/evals/README.zh.md) 的真实模型行为评估维护；它不以静态 prompt 断言冒充模型能力。


## 开发

需要 Node.js `^22.19.0 || >=24.0.0` 与 pnpm 11.7.0。

```sh
pnpm install
pnpm check
```

当前包族面向 DeepSeek Harness `0.1.0-rc.6`。安装方式、运行时行为、配置及模型可见行为见 [`dsh` 包说明](packages/dsh/README.zh.md)。

## 仓库范围

本仓库仅包含渐进式形式化 WorkSurface 插件。Plugin Inventory 在另一个独立仓库中维护。
