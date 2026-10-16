# Proposal: fix-worktree-remove-dirty-gate

> 本文件是**可评审对象**，刻意保持精简；取证链、评审轮次处置与被否证的替代方案在 `design.md`。

## Why

`safe-worktree-remove.ps1` 的脏判据取自 `git status --porcelain`，该命令**不列被 `.gitignore` 忽略的文件**；且未注册时判据塌成空数组——"构造出来的 0"被当成"测到的 0"。实测后果：预演报 `worktree dirty : 0`，而该 worktree 根目录有 20.8MB 会话产物；`-ConfirmDirtyDiscarded` 这道门在最需要它的状态下**永不触发**。

## What Changes

- 新增三个纯函数（`scripts/worktree-fs-longpath.ps1`）：`Get-WorktreeContent`（三态 `Basis`：measured-git / measured-fs / unproven）、`Resolve-ContentDisposition`、`Resolve-DriftDisposition`。
- 内容不可判定时**拒绝删除并新增 exit 10**；`-ConfirmDirtyDiscarded` 不得放行 `unproven`（确认不能替代测量）。git 读不到时改用文件系统实测条目数，**禁止回落空数组**。
- ignored 内容**只出声、不设门槛**：体积不是可用的门禁轴（`node_modules` 必被忽略且必然大），阻塞条件留给你能真正判断的"测不到"。
- ignored 的**取数方式**是独立的第二次 git 调用（`--porcelain --ignored`，默认 untracked 档，被忽略的目录**折叠成一条**）：实测 `-uall --ignored` 在任务 worktree 上吐 **55,191 行**、共享根吐 **127,654 行**，守卫会在每一次删除上付这笔递归；折叠档只有 10–80 行。因此 `ignored=N` 的单位是**条目**不是文件数，且 git 答不上时打印 `n/a(not measured)` 而**不是 0**——把"没测"印成 0 正是本刀要消灭的那个构造性零。
- R7 漂移分级：main 出现 `D/U` 才算级联并保持 exit 3；并发 `M/A/??` 打印 `R7 BENIGN-DRIFT` 后放行（本仓共享根高频被并发写，旧判据已把告警烧成噪声）。
- 打印面在 WhatIf 分支**之前**完成，预演与实跑同源。
- 回归锁扩写 `worktree-fs-longpath.test.ps1` 第 12–17 节（**28 条**真值表/夹具/顺序断言，总 PASS 41→**57**）+ 三重反失明防护（前置存在断言、节内异常计入 failures、断言执行条数）。打印面本身被提成纯函数 `Format-ContentSummary` 并进入真值表——**未测得的档位印 `n/a(not measured)`，禁止印 0**。

## Non-goals

- 不把 ignored 计入既有 `dirty` 计数（会逼调用方习惯性加 `-Force`，门禁退化为装饰）。
- 不改 `D/U` 的硬失败面（级联仍是当场 exit 3）；`??`/`M`/`A` 这类并发漂移**由拦改放行 + 打标**（这是本刀的既有事实，不是"不放宽"——措辞与 What Changes/Risk 对齐，评审轮 3 i1 纠正）。
- 不在本刀做证据镜像豁免（需新增目录级长路径**复制**实现，仓促落地会做出不可靠的保护）。

## Risk

- 改的是**会话隔离守门脚本**。退出码 2/4/5/6/7/8/9 语义逐字不变；**exit 3 的拦截面确实收窄**（原先任何漂移都拦，现仅 `D/U` 拦），代价与判据见 design 决策 6。
- 新退出码 10 必须同步进说明书。**仓内唯一真源是守卫自己的 docblock（完整 0–10，本刀补齐）**——它随 PR 落地、可被 diff 审到；SKILL.md 在**另一个仓库**（nacos skill-repo），"同 PR 同步"在这边无法被门禁强制，所以按 tasks 6.3 单独完成并留两份副本的实跑证据（各 57 PASS 口径见 design）。
