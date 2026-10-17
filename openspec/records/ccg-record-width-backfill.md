---
record: ccg-record-width-backfill
task: 回填 PR #3792 的远程同步（PASS + merge SHA + main push 实测）并把本任务的三条记忆置顶进 learnings.md
date: 2026-10-17
sync_status: PENDING
sync_reason: 本回填 PR 尚未合并，它的 merge SHA 还不存在；远程同步这一行只能在合并后取
sync_backfill_owner: 下一个会话（按 AGENTS.md「合并后收尾清单」回填并删除本段三个字段）
---

## 本次执行记录：回填 #3792 远程同步 + 置顶本任务记忆（ccg-record-width-backfill，2026-10-17）【docs-only】

判定证据：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **`docs-only=true`**。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档/记录：在 worktree `<仓库父目录>/mp-worktrees/mp-ccg-record-width-message` 的裸分支 `ccg-record-width-backfill` 上编辑，经 PR 落地。未触 `apps/` `packages/` `.github/` `scripts/` |
| 第一性原因（QM-5 ①） | ✅ | 见下「两件事」——回填欠的是**收尾链第 3 步**；learnings 欠的是**本轮三条新教训没落进内置记忆** |
| 逃逸分析（QM-5 ②） | ✅ | 见下「为什么当时没发现」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 记录两形态同次改写（表行 + `sync_*` 三字段删除）；learnings 增判据而非只记结论 |
| 防止再次发生（QM-5 ⑤） | ✅ | learnings 三条均为**可复用判据**（单一真源、行为派生、重复率判停），非事件纪要 |
| 行尾与 diff 对账 | ✅ | `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` **两口径完全一致** |
| 接线棘轮 | N/A | 未新增 `*.test.js` |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面 |
| QM-6 CCG 双模型外部评审 | 跳过 | `docs-only=true` 按「docs-only 快速通道」跳过 QM-6（与运行时无关） |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin <branch>` 返回 0 行证远端分支已删；回填后删除上方三个 `sync_*` 字段 |

### 两件事（各自欠的对象不同）

**① 回填 PR #3792 的远程同步（上一件）。**
`openspec/records/ccg-record-width-message.md` 的 `| 远程同步 |` 行由 `PENDING` 就地改写为
`PASS` + merge SHA `c120b5a060160a1235b0d750ec3611dcc1aae550` + 时间，并删除 frontmatter 的
`sync_status` / `sync_reason` / `sync_backfill_owner` 三字段 —— **回填与销账同一次提交**。
同一笔里补了「main push 回读」节：`债务熔断门禁` run 39006890920 = success、
`quality-gate` run **39006890856 = success**（11 个 job 全绿，含本 PR 直接影响的
`Gate Result` / `QG Changes` / `QG Static` / `QG Coverage` / `QG Unit Tests`）。

**这一格必须回读**，因为本次改的是门禁判据本体，而 squash 会把差量落到**更新的 main tip** 上
—— PR 侧全绿不构成 main 会绿的证据（AGENTS.md 记过 #3652 的反例）。

**② 把本任务的三条记忆置顶进 `01-docs/learnings.md`。**
三条都是**可复用判据**，不是事件纪要：

- `lesson:single-source-by-construction-not-by-lock` —— 「两处写同一组约束 + 加锁交叉核对」是错的修法；
  正解是让一处**生成**另一处。含两条配套：「接线要锁『值被使用』而非『符号存在』」、
  「注释剥离必须先规范化 CRLF（JS 的 `.` 不匹配 `\r`）」。
- `lesson:derive-by-behavior-not-by-parsing-literal` —— 判据（的判据）必须从**行为**派生，
  等价改写不该让锁变红；并记录「**免疫反证**比变异全红更能证明锁的质量」。
- `lesson:stop-on-repeat-rate-not-on-issue-count` —— 对抗评审引擎不收敛时，停止信号取**重复率**
  而不是条数；终止时逐条落盘裁定、如实写「未收敛」。

### 为什么当时没发现（逃逸分析）

- **回填层**：AGENTS.md 把回填列为收尾清单第 3 步，但没有任何机械判据能在**合并后**提醒「你这笔还没回填」——
  `check-gate-record-debt.js` 只看「未收口行是否已登记」，而登记字段在合并后依然合法存在。
  ⇒ 回填只能靠会话自觉，**这是残留风险**（已在记录里反复登记，本轮未解决）。
- **记忆层**：三条教训都产生于本轮的四轮评审里，而评审产物在 `.adversarial/`（gitignored）中，
  不进主干 ⇒ 若不复述进 `learnings.md`，下一个会话看不到。这是「知识留在工作目录而不在仓库」的通用形态。
- **本轮新踩并立即修正的一次事故（如实记录）**：写 `learnings.md` 时用 PowerShell 的
  `[System.IO.File]::WriteAllText('01-docs/learnings.md', ...)` **相对路径**，而 .NET 的
  `Directory.GetCurrentDirectory()` 是**进程 CWD（共享根 `D:/Data/projects/mulpub`）**、
  不是 PowerShell 的 `Set-Location` 路径 ⇒ 内容被写进了**共享根**的 `01-docs/learnings.md`。
  发现后立即核对「新增 44 行全部是本轮内容、0 删除行」，`Copy-Item` 备份到 `%TEMP%`，
  再 `git checkout -- 01-docs/learnings.md` 精确还原；复查共享根 `status` 为空、
  `index == HEAD`、stash 数 4（与基线一致）、该文件与 `HEAD` 同 blob ⇒ **未丢他人工作**。
  判据：**PowerShell 里凡用 .NET API 写文件，一律传绝对路径**；相对路径在 .NET 与 PowerShell 之间语义不一致。

### 遗留（不假装已闭合）

- 本回填 PR 自身也需要回填（它同样有 `远程同步 PENDING` 行）。这是**已知的链式递归**，由
  `check-gate-record-debt.js` 的「未收口行已登记」口径容错（登记即放行，不要求立即闭合）。
  链在这里有意停下：本记录与 `ccg-record-width-message.md` 的远程同步不能互相闭合。
- `.ccg/reviews/` 下本轮产生的多条判定记录中，早期几条的 `deepReview.status` 停在
  `self_play_pending` / `self_play_blocked`。那是**该提交当时的真实状态**（引擎无法自我评审、且
  `upheld` 无条件阻断），属留痕不属于腐坏；最终状态的说明写在 `ccg-record-width-message.md` 的
  「QM-6 四轮」与「残留风险」两节里。**未**去回填这些历史记录的状态——改历史状态等于伪造留痕。
