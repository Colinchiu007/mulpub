# Proposal: 合并提交的 CCG 判定器不得把「整侧导入」当成本次改动（ccg-decider-merge-skip）

## Why

`scripts/ccg-review-decider.js` 的验证层输入只有一种：**暂存区**（`collectStaged()`）。
pre-commit 钩子在 `git merge` 的收尾提交上同样会执行，而那时暂存区的语义是
「**merge 结果 vs HEAD（ours tip）**」—— 里面装的是对方分支整侧带进来的改动，
不是本次会话写的东西。

实测现场（2026-10-18，PR #4098 的合并提交 `2dbda6925`）：

| 读数 | 值 |
|---|---|
| 判定器给的模式 | `dual` |
| 判定理由 | `变更 1880 行 > 30 行阈值` |
| `stats.fileCount` | **606** |
| 实际本次会话改动 | 11 个文件 |

606 = 整整两侧的历史差异。于是每一次 `git merge main` 收尾提交都会产出一条
`mode=dual`、`files=606`、`status=pending` 的判定记录，而：

1. **它会被门禁当成一次真的深度审查欠账**。`check-pr-exec-record.js` 的
   `evaluateDeepReviewDebt` 只看 `mode=dual` 的产物，不看它是怎么产生的 ⇒
   合并提交凭空造出一条欠账，而这条欠账对应的「变更」根本不是本 PR 的内容。
2. **它的 `stagedDiffHash` 键毫无收敛性**：同一个分支在不同时间点 merge 同一个
   `origin/main`，对方一侧的差异随时在变 ⇒ 记录名每次都不同 ⇒ 目录里持续堆积。
3. **它污染事后审计**：`.ccg/reviews/` 是「本次变更被谁审过」的证据面，
   而一份 `files=606` 的记录会让「这个 PR 到底改了多少」这个问题失去可读答案。

同时暴露的第二个问题（遗留 7）：`saveRecord` 的两处写盘点都用
`JSON.stringify(record, null, 2)`，**不补尾换行**。现存 1109 份记录里
969 份（87.4%）末字节不是 `\n`，`git diff` 显示 `\ No newline at end of file`，
每一次 append/合并都在制造一次无意义的末行差异。

两个问题同源：**判定器的「输入是什么」与「输出写哪儿」都缺少对「这是一次合并」
这一事实的识别**。

## What Changes

1. **识别合并态**：新增 `detectMergeState()`，用 `git rev-parse --verify MERGE_HEAD`
   判定当前是否处于 merge 收尾阶段。**不得**硬编码 `<repo>/.git/MERGE_HEAD` ——
   隔离 worktree 下 `.git` 是一个文件，硬编码路径在**本仓唯一允许的工作方式**
   里恒为「不是合并」。
2. **合并态下收敛变更集**：新增 `collectMergeStaged()`，把变更集从
   「暂存区全部」收敛为**两侧都改过的文件交集**：
   `diff(base..HEAD)` ∩ `diff(base..MERGE_HEAD)`（`base = git merge-base HEAD MERGE_HEAD`），
   再以该交集为路径集读取暂存区的 numstat 与逐行 diff。
3. **交集为空 ⇒ `skip` 且不落盘**：`judge()` 增加一条显式分支（在阈值判定之前），
   理由是「合并提交两侧改动文件交集为空 ⇒ 本合并未引入自身改动」；
   `main()` 在该形态下**不写判定记录**，并打印一行说明为什么没写。
4. **交集非空 ⇒ 按交集判，并标注范围**：记录里新增 `mergeScope`
   （`mergeHead` / `base` / `oursFileCount` / `theirsFileCount` / `intersectionFileCount`），
   让「这份 dual 记录量到的是交集，不是整侧导入」可被事后读出来。
5. **内容寻址键与判定口径同源**：`saveRecord` 接受 `opts.diffPaths`，
   让 `stagedDiffHash` 用的路径集与本次判定读的路径集**是同一个**。
   否则「按交集判、按整仓命名」会让记录名继续漂移。
6. **两处写盘补尾换行**：`saveRecord` 的 alt 分支与主分支都改为
   `JSON.stringify(record, null, 2) + "\n"`，消灭 `\ No newline at end of file`。

## 不做什么（明确边界）

- **不纳入 `rebase` / `cherry-pick`**：它们的「变更集」本来就是单个提交重放，
  `git rev-parse --verify MERGE_HEAD` 也不成立（rebase 用 `REBASE_HEAD`，
  且 pre-commit 触发时 index 已是 `--continue` 的目标态）。把三态一起改会让
  「哪一侧是导入方」这个语义在 rebase 的连续重放里失去定义。
- **不改阈值、不改 docs-only 快通道、不改闭环保留逻辑**：本条只回答「输入范围」。
- **不清理历史遗留记录**：969 份无尾换行是历史事实，删除/重写它们属于改「谁来守门」
  之外的破坏性操作，且会让已合并 PR 的证据面失真。

## Impact

| 面 | 影响 |
|---|---|
| `scripts/ccg-review-decider.js` | 新增 2 个导出函数、`judge()` 1 个分支、`main()` 1 个分支、`saveRecord` 1 个选项 + 2 处写盘 |
| `scripts/ccg-review-decider.test.js` | 新增用例（真实 git 仓库 + 真 merge 场景，不伪造 merge 态） |
| 门禁影响 | 合并提交不再产生 `mode=dual` 欠账；交集非空的合并按其真实规模判 |
| 风险面 | `scripts/ccg-review-` 命中 `HIGH_RISK_SURFACES` ⇒ QM-6 必须真外部评审（`tier=external`） |
| 兼容性 | 非合并态路径**逐字节不变**（有无 `diffPaths` 的默认值即历史配方） |
