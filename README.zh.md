# 渐进式形式化 WorkSurface

[English](README.md) | 中文

渐进式形式化 WorkSurface 是一个 DeepSeek Harness 插件产品。它为 parent Agent 提供持久、文件原生的 WorkSurface、普通脚本编排工具，以及通过 revision 固定的子 Agent 协作。

仓库包含三个实现包，但它们不是三个独立插件：

- [`@pf-worksurface/core`](packages/core) 负责不可变文件存储、Projection 和 effect journal。
- [`@pf-worksurface/cli`](packages/cli) 提供经过认证的 `ws` 进程客户端。
- [`@pf-worksurface/dsh`](packages/dsh) 是可安装的 DeepSeek Harness 插件与 profile 组合包。

## 开发

需要 Node.js `^22.19.0 || >=24.0.0` 与 pnpm 11.7.0。

```sh
pnpm install
pnpm check
```

当前包族面向 DeepSeek Harness `0.1.0-rc.6`。安装方式、运行时行为、配置及模型可见行为见 [`dsh` 包说明](packages/dsh/README.zh.md)。

## 仓库范围

本仓库仅包含渐进式形式化 WorkSurface 插件。Plugin Inventory 在另一个独立仓库中维护。
