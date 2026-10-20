---
record: cl-qm6-review-writeback
task: 把 PR #3988 的 CHANGELOG 条目落进主干（该条目经用户裁决从混合 PR 的净差量拆出）
date: 2026-10-20
---

## 本次执行记录：QM-6 后端回写条目的补落（cl-qm6-review-writeback，2026-10-20）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 改动集只有 `CHANGELOG.md`（顶插 15 行）与本记录文件 ⇒ 纯文档/流程变更，不属运行时代码；按 AGENTS「分支隔离」这条**不需要独立 worktree**，本 PR 在既有隔离工作区里以新分支落地，仍经 PR + CI，不存在直推 `refs/heads/main` 这条路 |
| 为什么这条条目不在 #3988 里 | ✅ | #3988 是**混合 PR**（改 `scripts/deep-review.sh` 与其 lib/测试），每 rebase 一次要重跑约 50 分钟全量 CI；而主干 `CHANGELOG.md` 是顶插型写面，实测约每 20 分钟多一笔 ⇒ 每次 checks 收敛的那一刻该 PR 都已重新 `CONFLICTING`（现场 main 前进四轮、一次 `gh pr merge --squash` 被 GitHub 以 `merge conflicts` 拒）。这是**节奏问题不是口径问题**，经用户裁决把这一行拆到 docs-only 通道——那条通道走精简门禁，窗口是分钟级，顶插竞态打不穿它 |
| 拆法是否被门禁允许 | ✅ | 当场核判据本体：`scripts/check-changelog-growth.js`（Gate 2c3）是「只可增长」棘轮，口径是「base 里每个标题在 head 至少还剩 1 份」，**不要求每个 PR 新增条目**。#3988 拆出该文件后实测 `base 576 条 → head 576 条、字节 3021762 -> 3021762` 仍 PASS；`check-changelog-duplicate-entries` 冗余份数 0。合入本 PR 后同两条判据必须报 `576 → 577` |
| 落块方式 | ✅ | 未手工拼行尾：由一次性驱动取 `git show origin/main:CHANGELOG.md` 的 blob 为底 + 只插我这 15 行，并断言 ①产物行数 == 15 + base 行数（接缝复刻即拒写）②base 的每一行都仍在产物里出现（多重集，缺一行即拒写）③块内与产物内 `loneCR=0`（孤立 CR 会让 `text=auto` 整份失效、把 15 行膨胀成全文件幽灵 diff）|
| 计数与旧数 | ✅ | 条目里三处数字改成**演进链**而非原地覆盖：`ccg-review-backends.test.js` 17 → 26 → **28**（第二轮评审处置加了 i1/i4 两条回归锁）、`deep-review-deps.test.js` 35 → 40 → **41**（+1 即 i2 一致性锁）、`check-pr-exec-record` 81 → **113**（他人 PR 把该文件加长了 32 条，不是本 PR 引入）。消费者并集在最终基线重取为 52/9/10/113 + 28/41 = **253 passed / 0 fail** |
| 行尾与 diff 对账 | PENDING | 待本次提交后现取：`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐文件相等，且 `git ls-files --eol` 无 `i/-text` |
| 品牌残留 / 文档同步 | PENDING | 待现取：`node scripts/check-no-brand-residue.js`、`node scripts/check-doc-abs-paths.js`（记录与条目均用占位/相对路径，不写本机绝对路径） |
| QM-1 打包 / QM-4 视觉 / QM-6 | N/A | 改动集零 `apps/desktop/electron/**`、零 `packages/rpa-engine/**`、零 UI/样式，且为纯文档变更 ⇒ 按 docs-only 通道跳过打包、视觉与双模型评审 |
| 远程同步 | PENDING | 本 PR 合入后由 `scripts/lib/merge-ledger.js` 按主干历史推导收口，不回填、不手写状态词 |

- 保留门禁：行尾对账 PENDING | 品牌残留 PENDING | 文档同步 PENDING | 远程同步 PR #TBD

## 1. 这个 PR 只有一行内容，但它补的是 #3988 的一处交付偏差

#3988（`fix(qm6): 评审时换后端必须回写判定记录`，merge `06a5b291d`）的**代码与规格全部落在主干**，删分支前的合并自检 `scripts/check-branch-merged.js --ref <该 PR tip> --merge 06a5b291d` 报 `files=12 identical=12 lost=0 unattributed=0`。唯一没落的是 CHANGELOG 那一行，因为它当时还在同一个 diff 里、并把该 PR 钉在永不胜出的顶插竞态上。

- 偏差的完整说明在 `openspec/records/qm6-review-request-writeback.md` 第 7 节（含 enforce 红因、`tier` 为何没能由工具写出、以及该记录第 6 节两处不实的就地标注）。
- #3988 的 PR 正文末尾也补了「到达方式修订」一节，把第 29 行原来写的 `AGENTS.md` / `CHANGELOG.md` 改成现状，**原句不静默删除**。
