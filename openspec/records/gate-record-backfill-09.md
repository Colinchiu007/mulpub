---
record: gate-record-backfill-09
task: 批量回填 6 篇「PR 已合并但远程同步仍 PENDING」的新载体执行记录并销账（#2763/#2769/#2784/#2915/#2947/#3089）
date: 2026-10-07
---

## 本次执行记录：批量回填 6 篇新载体记录的远程同步欠账（gate-record-backfill-09，2026-10-07）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（**提交后**复跑）→ 结果见下表「classify-docs-only」行
- 保留门禁：变更类型与隔离声明 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | Gate 2c ✅ | 远程同步 PASS（已合并 #3092 → main `1dd530d1b`，三源取证见同篇权威表格行）

### 为什么要专门开一批来收这笔账

main 上曾同时挂着 **6 篇** `sync_status: PENDING` 的新载体记录，而它们的 PR 全部早已 squash 合并、远端分支全部已删。
「已合并却仍写着没干完」的记录会被下一个读到它的会话当成"还有活"，是重复开工的入口 —— 这正是 `check-gate-record-debt.js`
当初上线要解决的问题。仓库对「回填型 PR 在 `check-pr-exec-record` 下没有既不留新账又不堆豁免的出路」的实际处置是
**周期性攒一批一起收**（先例：#2915 `final-backfill` 一次收 5 篇、#3039 `sync-backfill-batch-07` 一次收 12 篇、#3089 收 3 篇），
本 PR 是同一机制的第四批：净效果 **6 收 1 开**。

### 证据（每条三源，缺一就整条排除，不半量回填、不猜）

判据脚本 `collect-debt-evidence.js` 的硬门是：① `gh pr list --state merged --head <slug>` 必须**恰好命中 1 个 PR**
（分支被多个 PR 复用 ⇒ 整条排除，这是 #3039 那批踩过的形态）；② main 上必须存在主题以 `(#N)$` 结尾的提交，取其 SHA + committer 时间；
③ `gh pr view <N> --json mergeCommit` 的 oid 必须与 ② **同一个 SHA**（两源互证，防 squash 后 force 推造成的漂移）；
④ 目标记录文件里 `| 远程同步 | PENDING` 行必须**恰好 1 条**（多条就说不清改哪条）；⑤ `git ls-remote --heads origin <slug>` 返回 0 行。

| 记录（== 分支名） | PR | main 上的 squash 提交 | committer |
| --- | --- | --- | --- |
| `exec-record-wiring-71a` | #2763 | `d70d7e7a32b7e26227eac45a0db48e17b62e1ade` | 2026-10-02T10:11:09Z |
| `gate2c2-landing-correction` | #2769 | `80a4a9f5a498d654cd120ab880be3b53cbc8a281` | 2026-10-02T10:43:22Z |
| `qm6-agents-dedup` | #2784 | `302b3147550639c5cac480ef42787dd6f048945a` | 2026-10-02T15:34:16Z |
| `final-backfill` | #2915 | `5e62a1bc6b13ec808346760524bf691272070a49` | 2026-10-05T05:12:35Z |
| `log-notify-w2-d2` | #2947 | `f7f022e529aea2605fc143dcab0726a02c55911f` | 2026-10-06T04:14:02Z |
| `gate-record-backfill-08` | #3089 | `f844f175125a5fc71448afd79b630490e00c3594` | 2026-10-07T12:59:56Z |

`collect-debt-evidence.js` 实跑输出：`ROWS=6/6`、`STOPS=[]`、`EVIDENCE_WRITTEN=true` ⇒ 六条全过全部五道门，无排除项。

### 回填动作与门禁

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 纯记录/流程变更 ⇒ docs-only 通道；仍在隔离 worktree `D:/Data/projects/mp-worktrees/mp-gate-record-backfill-09`（裸分支 `gate-record-backfill-09`，base `f844f1751`）做，共享根 `D:/Data/projects/mulpub` 保持 main clean。建区以产物实证（`rev-parse --abbrev-ref HEAD` = `gate-record-backfill-09`、`log -1` = base），未采信入口 rc |
| 回填与销账同一次 | PASS | 每条记录：`远程同步` 行 PENDING→PASS（含 merge SHA + committer + PR mergedAt + 三源取证写法）**且**删除 frontmatter 的 `sync_status`/`sync_reason`/`sync_backfill_owner` 三行。脚本对每个文件先断言「PENDING 行恰好 1 条」「sync_* 字段恰好 3 个」，任一不符整批抛错停手；收尾逐文件回读 `pending_left=0`、`fm_left=false`、keys=`["record","task","date"]` |
| 行尾 | PASS | 逐行 `split('\n')`，替换行按原行尾补回 `\r`；六个文件写回后实测 `crlf=true` 保持。**这里有一条要记的自纠**：我第一版收尾断言写成 `b[4] === '---'`，而 frontmatter 闭合行带着 `\r` ⇒ 六个文件全报 `frontmatter_intact=false`。这不是文件坏了，是**我的判据没考虑行尾**；改用 `/^---\r?\n([\s\S]*?)\r?\n---/` 重测，keys 全为 `record/task/date`。同族坑见 [[project-mulpub-eol-and-topdoc-merge]] |
| `--grep` 的 `#` 漏写（**本仓已记第四次，我又踩了一次**） | 已纠正 | 枚举脚本第一版写 `--grep=(' + pr.number + ')$`，**漏了 `#`** ⇒ 六条全部 `GREP_MISS`，脚本据此判「未合并」。这次行为是 fail-closed（判不成而不回填），但结论是错的。`01-docs` 记忆里这条已经写过（"漏掉 `#` 会静默返回空"），仍复发 ⇒ 落笔时不能凭手感，`--grep` 的模式必须与被匹配标题**逐字对照一次**；修好以后六条全部取到 SHA。见 [[project-mulpub-merge-gates]] |
| Gate 2c | PASS | `node scripts/check-gate-record-debt.js` ⇒ `OK: 顶部记录带行，两源所有未收口的 远程同步 行均已登记，清单无陈旧项、记录标题无重复、记录文件登记字段无残留`；现场 `远程同步行 251 / 执行记录 452（## 标题 460）/ 已登记欠账 8 / 记录文件 88`（绑 base `f844f1751`，本 PR 未新增 ledger 键 —— 新载体的登记随文件走） |
| classify-docs-only | PASS | **提交后**跑 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ `docs-only=true`、`files=7`（6 篇被回填的记录 + 本记录）。未提交时该脚本会 fail-closed 判 `false`，所以这一行的证据只能在 commit 之后取（与 [[project-mulpub-docs-sync-gate]] 同源） |
| check-pr-exec-record（enforce） | PASS | 本 PR 携带 `openspec/records/gate-record-backfill-09.md`（文件名 == head 分支名） |
| 品牌残留 / 文档同步 / Gate 2c 现场 | PASS | 均**提交后**复跑：`check-no-brand-residue.js` ⇒ `PASS（扫描 7238 个 tracked 文件，无品牌残留…）`；`check-docs-sync.sh --base=main --head=HEAD` ⇒ `✅ 仅文档/流程变更，无需额外同步`；`check-gate-record-debt.js` ⇒ 顶部 `OK` 且现场 `远程同步行 251 / 执行记录 452（## 标题 460）/ 已登记欠账 8 / 记录文件 89`。**记录文件 89 是上一步 88 加本篇** —— 用差值而不是绝对数留证，因为绝对数会随 base 漂（[[project-mulpub-gate-record-debt-blindspot]]） |
| QM-1 / QM-2 / QM-4 / TDD / QM-6 | N/A | docs-only 通道，零运行时文件 |
| 远程同步 | PASS | 已合并：squash 落地 `1dd530d1becffca1faf4bf27b6582291405a4f48`（committer 2026-10-07T13:18:34Z）。取证两源一致：`git log origin/main --grep='(#3092)$' --format=%H|%cI` 唯一命中该 SHA 与时间，`gh pr view 3092 --json mergeCommit` 报同一 oid；`git ls-remote --heads origin gate-record-backfill-09` 返回 **0 行**证远端分支已随合并删除。本篇是那批「6 收 1 开」的账，本批把它开的那 1 条收掉。 本 frontmatter 的三个 `sync_*` 登记字段已在本条由 PENDING 转 PASS 的**同一次提交**内整段删除 |

### 明确排除、不静默修的部分

1. **legacy 源（`.quality-gates.md`）里剩 1 条 `远程同步 PENDING`**（`:6980`，所属标题 `…登录页直接关闭页签误报…（fix-login-credential-capture-error）（2026-08-14）`）。
   它在 ledger 里的登记原因原文写着：该记录块**丢了 `## ` 标题**，门禁按最近标题把欠账记到本条名下，
   且「不代其他会话改写归属」。⇒ **本 PR 不动它**：要修的是给那个记录块补标题（属别的会话的在制品），不是替它猜一个 merge SHA。
2. **ledger 里其余 8 条登记**（多为 2026-08-13 那批历史记录 + `creator-monitor-impl` 等）登记原因都是「收口证据未由本会话取证 ⇒ 只登记、不臆造 merge SHA」。
   本 PR 没有对它们做 `gh pr list --head` → main grep → mergeCommit 三源闭合，所以一条都不碰。
3. 遗留的第 1 条若要收，正确做法是**先补标题再回填**，属独立变更。
