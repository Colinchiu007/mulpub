# quality-infra-2026-10：QM-6 记录欠账**只读审计档**（`--audit`）

> 分支：`ci-infra-shard-and-review-audit`（隔离 worktree，与仓库同盘，非 C 盘）
> 状态：**需人工过审**。目标命中 `check-pr-exec-record.js` 的 `HIGH_RISK_SURFACES`
> （`scripts/check-` 与 `.github/workflows/`），按 `AGENTS.md` 属「改谁来守门」，
> agent 不自动合并；QM-6 亦只认 `tier=external` + 可核 evidence。
>
> **本文件只描述已落地的实现。** 同目录下 `design-electron-ci-shard.md` 是**未落地的计划**，
> 刻意分开写——一个是代码、一个是提案，混在一篇会让读者分不清哪些已经改了（外部评审
> 第 1 轮 i3 点名项）。

## Why

`.ccg/reviews/<hash>.json` 是 QM-6 判定的**证据载体**：pre-commit 的
`ccg-review-decider.js` 按 diff 判 `mode`，写一份记录并随提交入库；CI 的
`check-pr-exec-record.js` 只看**本 PR 差量**里的记录，`status` 不在
`{cleared, needs_revision, self_play_resolved}` 内即判欠账。

于是形成一个没人看得见的黑洞：**主干上累积的未闭环记录既拦不住任何 PR，也没有任何地方
能看见它们**。本次实测（`node scripts/check-pr-exec-record.js --audit`，2026-10-20）：

| 指标 | 读数 |
| --- | --- |
| 记录文件 | 1509（主干树 1580） |
| `mode=dual` | 433 |
| 已闭环 | 156 |
| **未闭环** | **277** |
| ├ `pending`（引擎从未给出结论） | 254 |
| ├ `error`（引擎失败，无结论） | 15 |
| ├ `self_play_blocked`（裁决后仍阻断） | 4 |
| ├ `self_play_pending` | 2 |
| └ `self_play_adjudicated`（有裁决但状态词不在白名单） | 2 |
| **未闭环里 findings 总条数** | **17** |

最后一行是关键：**277 条未闭环里只有 17 条 findings**。也就是说这批欠账的主体不是
「277 个没修的问题」，而是「277 份**没有结论**的记录」——这正好对上
`openspec/changes/ccg-convergence-exit` 的诊断（验证层只跑一轮 critic 且把
`currentRound` 报成 `maxRounds`，出口①②不可达，只能落到 self-play / 无结论）。

⇒ **减少这批欠账只能改判定写入方**。清理文件、把 `.ccg/reviews` 加进 `.gitignore`
（拆锁：记录不在 PR 差量里 ⇒ 门禁看不见 ⇒ 整个 QM-6 失明）、批量补 `closureNote`
（判据自己的注释写着它挡不住「认真编一段带轮次和处置的话」）都不是解法。

## What Changes（已落地）

`node scripts/check-pr-exec-record.js --audit [--json] [--limit=N] [--repo=<dir>]`

新增 `scripts/lib/exec-record-audit.js`（全部逻辑）+ `main()` 里约 15 行委派；
**enforce 路径一行未改**（`--audit` 分支早退于一切取证之前，结构上不进判定路径）。

四条硬约束，各由回归锁钉住（`scripts/check-pr-exec-record.audit.test.js`，**9 例**）：

| 约束 | 锁住的失败形态 |
| --- | --- |
| **不判定「已修/未修」** | 记录里没有 branch/PR 字段，也没有 finding→修复提交的链接 ⇒ 那件事在记录层面不可判定。任何据此批量改状态词的实现都是把真债洗成漂亮话 |
| **落地归因比「文件是否在 `origin/main` 树里」，不比 commit sha** | 本仓 squash 合并：主干 commit 是新对象，feature 分支的 sha 永远不在主干历史里 ⇒ 按 sha 判会把每个已合并 PR 都误判成「未落地」 |
| **只读** | 跑完不得留下工作区改动、不得创建提交（审计最大的风险是它自己变成写方） |
| **永不阻断** | 未闭环再多也 exit 0；只有用法错误（如 `--limit=abc`）exit 2 |

## 性能基线（供后续回归对照）

| 指标 | 读数 |
| --- | --- |
| 整仓 1509 份记录耗时 | **1657 ms** |
| git 子进程数 | **2 次**（`git ls-tree` 一次 + 读工作区文件；**不**逐文件 `git show`） |

为什么强调 spawn 数：本仓有 `fix-precommit-reviews-spawn-storm` 登记的成本问题——
拥堵现场单次进程创建 **1175 ms**，逐文件 spawn 会把审计本身变成风暴。
记录数增长是线性读文件（2.5 MB / 全部记录），实际瓶颈在 spawn 而不在 IO；
若将来记录数上量，先量再优化，不预先做流式（外部评审 i4 的诉求由本节这条基线承接）。

## 影响范围

| 文件 | 变更 |
| --- | --- |
| `scripts/lib/exec-record-audit.js` | 新增（只读审计实现） |
| `scripts/check-pr-exec-record.js` | `+15` 行委派（`--audit` 早退分支）+ 用法注释 |
| `scripts/check-pr-exec-record.audit.test.js` | 新增 9 例 |
| `.github/workflows/quality-gate.yml` | 新增 1 行 `node --test scripts/check-pr-exec-record.audit.test.js`（不接则锁不跑，等于给新能力开无人守门的入库通道） |
| `openspec/records/ci-infra-shard-and-review-audit.md` | 执行记录 |
| `openspec/changes/quality-infra-2026-10/design-electron-ci-shard.md` | **未落地计划**（单独成篇） |

## 风险与不假装闭合

- `--audit` 是**可见面**不是拦截面：它不会让那 277 条变少，只是让它们可解释。
- 落地归因只回答「这份记录有没有随某次合并进过主干」，**不回答**「它的 findings 修了没有」。
  这条写在输出的结论段里，避免读者过度解读。
- 未纳入本次：`.ccg/reviews` 的保留策略（2.5 MB / 占 `.git` 0.4%，不是瓶颈）。
