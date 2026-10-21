## Why

`debt-baseline-recheck` 落地后的**第一次真实运行**（run `39563222046` / job `119099176198`，触发点就是我那笔合并 `c074b91b6`）自己报了这样一行：

```
[recheck] rows=30 IN_BASELINE=0 VIOLATES=0 UNJUDGEABLE=30 CHECKER_FAILED=0 base=c074b91b62
```

而作业结论是 **success**。逐条数该步日志的 `pr=<n> verdict=` 行：**15 笔 `UNJUDGEABLE/worktree-setup` + 15 笔 `UNJUDGEABLE/conflict`，`runChecker` 一次都没被调用**。也就是说：这一轮**一条都没量**，却把"全绿"报了出去——本仓把这类形态记作「装饰性门禁」的又一种落点，且正是我上一刀（切片 C）在设计 D6 里立誓要防的那一格（"量到了才退 0"）。当时的名单漏了一档：`worktree-setup` 是 `UNJUDGEABLE_REASONS` 的成员，却**不在** `TOOL_FAULT_REASONS` 里，于是失明读起来像判决。

三条同源缺陷，都是这次运行暴露的、不是推测出来的：

1. **故障名单是手抄的第二份真源**。`UNJUDGEABLE_REASONS`（5 档）与 `TOOL_FAULT_REASONS`（3 档）各写一遍，新增一档不会有人被提醒去归类——`worktree-setup` 就是这么漏的。
2. **退出码不看"量没量到"**。`summarize()` 只在命中故障名单时非零；全部 `worktree-setup` 的一轮照样退 0。
3. **`UNJUDGEABLE` 不可归因**。`commit-tree` 失败与 `worktree add` 失败被写成**同一个** `worktree-setup`，且整条链没有带出失败命令的 stderr；这次运行的日志里没有任何 git 报错原文，所以「CI 上到底哪一步坏了」到现在仍是**未证实**。

## What Changes

- **归因按阶段拆开**（`scripts/check-debt-recheck.js`）：`worktree-setup` 只留给「seam 没装配好」这一种工具自身装配问题；两个真 git 阶段各用自己的档名 `merge-commit-failed` / `merge-worktree-failed`。`UNJUDGEABLE` 条目新增 `stage` 与 `detail`（失败命令的首条非空 stderr，截断），逐条日志与评论表格都把它打出来——**下一轮自动运行会自己说出口**，不需要人去猜。
- **故障归类改成一处真源**：新增 `REASON_CLASS`（reason → `tool-fault` | `other-pr`），`UNJUDGEABLE_REASONS` 与 `TOOL_FAULT_REASONS` 都由它派生；`conflict` 是唯一的 `other-pr`。新增一档忘记归类 ⇒ 当场红（判据遍历表，不看名单抄没抄）。
- **退出码加一条不依赖名单完备性的结构不变式**：`rows>0` 且 `IN_BASELINE+VIOLATES=0` 且**并非每一行都是 conflict** ⇒ 非零退出。全 conflict 的一轮仍退 0 并打印 `MEASURED=0(all-conflict)` 留痕——这是对原报缺陷②的**刻意收窄**，理由写在 design D3，不是遗漏。
- **补一条「生产默认装配」锁**：现有 25 条锁全部把 `classify/commitTree/worktreeAdd/runChecker` 注入了假实现，于是默认闭包里的任何笔误（路径拼错、少传一个 `-p` 父提交、**丢掉 stderr**）在测试面**结构性不可见**。新增用例只注入网络面 `gh` 与一个真临时仓库作 `repoDir`，让默认实现真跑一次 git 链。
- **子项（计划外、由 max-lines 逼出）**：加完上述判据后本体到 503 行，撞 `.github/scripts/check-max-lines.js` 的 `limit=500`（该判据按 **git 索引**取域，所以 `git add` 之前本地照旧绿）。按既有裁决拆结构而非上调基线，切成 `scripts/lib/debt-recheck-core.js`（纯判决，零 IO）+ `scripts/lib/debt-recheck-live.js`（真 git/gh/env）+ 入口门面，workflow 的调用面逐字不变。**连带必须同改**：读源码的结构锁扫描域从 1 份变 3 份——拆分后入口只剩 41 行，"这个文件里没有指标名"这类判据当场退化成恒真（实测就红了个"绿得毫无道理"），改法是并集扫 + 逐份与总量下界。详见 design D6。
- **子项（设计评审 i5 落码）**：`gitRunner` 与 `runChecker` 的子进程 env 剔除 `GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE` 并在剔除时出声一次。这不是假设性加固：本机五格探针实测 `git -C A` 在 `GIT_DIR=B/.git` 下**读到 B**（`-C` 挡不住它），而路径类判据（`--show-toplevel`）在同一现场仍回 A ⇒ 只能用内容判据。详见 design D7。

## 不做（划清边界）

- **不修根因**。CI 上失败的确切那一步还没取到证据；先让下一次运行自己把 stderr 首行报出来，再按它修。为一个假设改代码会把「我看像是 committer 身份没配」写成一个没有证据的修复。
- **不改 `.github/workflows/`**。退出码语义由 `shell: bash` 的 step 天然承载（非零即失败），`MP_RECHECK_COMMENT` 仍是 `"0"`——写评论这件事按既有裁决要人工过目。
- **不阻断任何 PR**。本作业不是 required check，也不动 ruleset/分支保护（用户 2026-10-20 四档里选的仍是「只做重算 + 点名」）。
- **不引入第二份债务度量**：判据本体仍是 `scripts/check-debt-budget.js` 唯一实现，本刀只动"什么时候、在哪个树上调它"和"量不到怎么说"。

## Impact

- 受影响行为：`scripts/check-debt-recheck.js` 的档位词表、逐条日志形状、`summarize()` 退出码，以及评论表格里 `UNJUDGEABLE` 那一列的可读现场。
- **落地后这个作业会变红**（预期，不是事故）：只要 CI 上那 15 笔还在 `merge-*-failed`，每轮都是工具故障 ⇒ 非零退出。它是非 required check，不挡任何 PR，而"红着并且说得出为什么红"正是本刀要的形态——现在这条绿是假的。
- 分层：改 `scripts/` 工具脚本自身 ⇒ **混合 PR**（`classify-docs-only` 判 false），走完整质量节拍；且 `scripts/check-*` 命中 `HIGH_RISK_SURFACES` ⇒ QM-6 需真外部评审（`tier=external` + 可核指针），不得自扮演收口。
- 接线：`scripts/check-debt-recheck.test.js` 已在 `quality-gate.yml` Gate 2b 点名，本刀只加用例、不加新文件（若新增文件必须同 PR 接线）。
- 成本口径：本轮实测 `fetch+merge+judge_ms` 每条 242–296 ms、整步 13.3 秒，但这批数**不含** `runChecker`（一次都没跑到），因此 proposal 里仍不得写"一轮约 N 分钟"。
