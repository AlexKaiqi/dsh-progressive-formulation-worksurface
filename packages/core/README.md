# @pf-worksurface/core

Core 拥有标准 `surface.md` 模板与校验、Event envelope、Orchestrate Definition AST、不可变 revision store、append-only file event store、subscription/activation fold，以及 possible/actual flow 投影。依赖语义保留在精确 Definition 中，投影不是依赖模型。Core 不依赖 DSH 执行循环，也不存在 Work Session、binding 或 Relation store。

`RevisionStore` 保存不可变 bytes 与含路径、类型、可执行位、大小和哈希的 manifest；哪个 revision 当前 published 由 Surface event stream 决定。它提供人工 pin 和带年龄保护的 mark-and-sweep：调用方从 Event/Registration 事实发现可达 Revision，年轻对象不会与并发 snapshot 竞争。`FileEventStore` 为每个 Surface/Registration subject 提供幂等 append、冲突检测、重放与 live wakeup。
