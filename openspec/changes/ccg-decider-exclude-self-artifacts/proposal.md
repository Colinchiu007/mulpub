# Proposal: 审查模式判定的取证面排除判定器自身产物

## Why

`scripts/ccg-review-decider.js` 决定"这次改动要几路外部审查"（`mode ∈ skip|single|dual`），它的结论被 pre-commit 落进 `.ccg/reviews/<sha>.json`，而**这份产物本身会被 git 收进同一个提交**。于是判定器开始消费自己写下的散文。

三条实测（全部由判据自己打印的数交叉核对，非推断）：

1. **同一份改动，两条采集路径判出两种结论**。本仓 `collectStaged()`（验证层·暂存区，pre-commit 实际走的那条）早已对两个 git 参数带 `:(exclude).ccg`；`collectRange()`（验证层·已提交区间，`ccg-gate.js` 在"暂存区为空 ⇒ 事后补跑"时走的那条）**没有**。在飞 PR `#4079` 的差量上量到：

   | 取证面 | changedLines | fileCount | codeFileCount | sensitiveContentHits | mode |
   |---|---|---|---|---|---|
   | 区间档（现状，含 `.ccg`） | 191 | 9 | 4 | 3 | **dual** |
   | 验证层口径（排除 `.ccg`） | 132 | 8 | 3 | 0 | **single** |

   而那 3 处"敏感内容"命中逐条归属后，**全部来自 `.ccg/reviews/*.json`**，命中的词是该 PR 自己的方案正文里的「授权」二字。即：**判定器把"我为什么被允许改判据"这句话，读成了"这次改动涉及加密"**。

2. **面上成本**。origin/main 最近 120 笔合并提交，按上述两档各判一次：**44 笔（37%）的 mode 因此改变**，迁移分布 `dual→single` 15、`dual→skip` 15、`single→skip` 14、其余同档。

3. **QM-6 侧的真实代价**。`scripts/check-pr-exec-record.js` 的 `evaluateDeepReviewDebt` 要求本次变更集内**每条 `mode=dual` 产物**的深度审查状态闭合。多出来的 `dual` 不是"更严格"，而是**凭空造出一笔必须靠真跑一次外部模型才能平的债**——而外部评审后端本日仍不可得（proposer 轴 IP 级封禁）。本会话已实地撞上两次：一次是 20 行的测试改动被判 `dual`，一次是补跑档与提交档互不认账。

根因不是"敏感词表太宽"，而是**取证面把裁判自己的输出当成了被测代码**：`.json` 在 `codeExtensions` 里，产物里的散文因此既是"规模"又是"敏感内容"。同一个原则本仓已经写过一次并落过一次——`recordFileName()` 的内容寻址键排除 `.ccg`，注释原话是"判定器自己的输出文件不该影响对它的判定"。本刀把这条原则补到它尚未覆盖的那一维。

## What Changes

- **单一判据、一处实现**：新增按路径识别自身产物的谓词（`.ccg/` 下的文件），并在三处消费它——
  1. `judge()` 计算 `codeFiles`（决定规模）时排除；
  2. `collectFromDiff()` 分流变更行时，把这些文件的行归入新增的 `ccgChangedLines`，**不再**并入 `codeChangedLines`（决定敏感内容命中）；
  3. `judge()` 为被排除的内容单独产出 `ccgSensitiveContentHits`，**只报告、不改判定**——与既有 `docSensitiveContentHits` 完全同构（那是 2026-10-15 修「文档里分析加密被判成改动涉及加密」时定下的口径）。
- **排除动作只住在 JS 一处**：`collectStaged()` 两个 stats 参数里的 `:(exclude).ccg` **摘掉**。设计初稿写着"保留不动、两处幂等重叠"，被 critic 轴 Critical#2 否证——pathspec 让 `.ccg` 在 git 层就消失，JS 层收不到那些行 ⇒ 暂存档的 report-only 计数**恒为 0**，"唯一观测点"只剩补跑档有。`stagedDiffHash` / `recordFileName()` 那一次独立的 git 调用照旧带 pathspec（职责是内容寻址命名，已被 `scripts/deep-review-deps.test.js:399` 锁住，本刀不动）。
- **口径对齐**：`collectRange()` 与 `collectStaged()` 对同一份改动必须判出同一个 `mode`。本刀用**行为锁**钉住这一点（真建临时 git 仓库、真跑两条路径），不留"读源码看有没有那个 pathspec"式的结构锁。而同判锁必须与**绝对参考锁**成对——只断"两档相等"是恒真的（谓词退化成恒真时两档一起落到同一个错值），绝对锁要求"含真敏感行的 `.js` 在两档各判一次都必须是 `dual`"。
- **不做**：不引入 git pathspec 到 `collectRange`（理由同上，见 design 决策点 1）；不放宽任何敏感词表；不把 report-only 计数升成阻断判据（同一份散文一处不消费、另一处拦下来是自相矛盾，且实测既有同构字段 `docSensitiveContentHits` 全仓除打印外零消费者）；不改决策层（plan 档）的 `plannedPathHits`——它的实测发生率是 1499 份产物里 **1 条**，为它改动判定面属"用未量到的成本换一条已知的边角"，只在记录里如实留数。

## Impact

- 受影响行为：`scripts/ccg-review-decider.js` 的判定结论（`.ccg/reviews/*.json` 里的 `mode`/`reason`/`stats`），以及由它派生的 QM-6 深度审查欠账条数。
- 受影响消费者面：`scripts/ccg-gate.js`（pre-commit 第 4 道）、`scripts/deep-review.sh`、`scripts/check-pr-exec-record.js`（读产物判欠账）、`scripts/deep-review-deps.test.js`（锁哈希配方的 pathspec 同源——本刀不动哈希配方，故不受影响）。
- 回归锁：`scripts/ccg-review-decider.test.js`（现有 52 例）新增 5 条行为锁，含 1 条"排除动作不得把敏感判定整条关掉"的对偶锁。
- 分层：动 `scripts/` 工具脚本自身 ⇒ **混合 PR**（`classify-docs-only` 判 `false`），走完整质量节拍；隔离走 `scripts/start-mp-task.ps1`。
- 归档待办（本刀不做，写进 tasks 以免遗失）：新 capability `ccg-review-mode-decider` 落地后由 `openspec archive` 生成主规格；**刻意不落进 `openspec-integration`**，以避免顺带背上 `.quality-rhythm/integrations/openspec/spec-contract.md` 镜像同步与 Purpose 条数改写的债——那两处各由 `scripts/quality-rhythm-spec-mirror.test.js` 与 Purpose 门禁硬守，能不碰就不碰。
