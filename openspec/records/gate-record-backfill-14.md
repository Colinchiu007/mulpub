---
record: gate-record-backfill-14
task: 回填 gate-record-backfill-13（#3229）与 gate-record-status-consistency（#3274）的远程同步行并销账
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个动这些文档的会话（PR 号待 `gh pr list --repo Colinchiu007/Multi-Publish --head gate-record-backfill-14 --json number,state,headRefOid` 回读取入，不得凭印象；合并后按 git log origin/main --grep='(#NNNN)$' --format=%H|%cI 取 merge SHA，回填远程同步行并整段删除 frontmatter 的三个 sync_* 字段；**同一次还要把正文「保留门禁」那句 bullet 一起改写** —— 本仓 #3274 起有 Gate 2c 的同篇对账判据，两处不一致会当场判红）
---

## 本次执行记录：回填 #3229 / #3274 的远程同步欠账（gate-record-backfill-14，2026-10-11）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（**提交后**复跑）→ 结果见「本地门禁」表
- 变更类型与隔离声明：纯文档/流程变更，按分层规则可就地编辑；仍走隔离 worktree `mp-gate-record-backfill-14`（分支 `gate-record-backfill-14`）经 PR 落地，因回填要跑取证脚本且共享根有他人在飞文件
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 编码完整性 ✅ | 文档同步 PENDING（随 CI） | Gate 2c ✅ | 远程同步 PENDING（本条自己的欠账）

### 这一轮是本仓新判据的第一次实战

#3274 刚把「同一篇记录的表格行与声明式 bullet 必须同侧」变成 Gate 2c 的拦截项。本轮回填的**两篇记录都同时带着这两种形态**，所以"回填即改一处"这个旧习惯现在会当场变红——这正是要的效果，也是它的第一次真实自检：

| 记录 | 动之前（两处） | 动之后（两处） |
| --- | --- | --- |
| `gate-record-backfill-13` | 表格行 `PENDING` + bullet `远程同步 PENDING（本条自己的欠账）` + frontmatter 三字段 | 两处均 `PASS（PR #3229 → main a3e632c3c @ 2026-10-10T00:07:00+08:00）` + **三字段同次删除** |
| `gate-record-status-consistency` | 表格行 `PENDING` + bullet `… \| 文档同步 PENDING（随 CI） \| 远程同步 PENDING（本条自己的欠账）` + 三字段 | 两处均 `PASS（PR #3274 → main d515fbc60 @ 2026-10-11T00:19:08+08:00）`；另把 `文档同步` 由 `PENDING（随 CI）` 改成 `PASS` —— 该 PR 的 `文档同步检查` 在 CI 上是 pass，按「状态列只写当下状态、不写历程」的口径必须回填 |

净效果 **2 收 1 开**（开的是本条）。

### 证据（每条三源，缺一不回填）

| 记录（== 分支名） | PR | main 上的 squash 提交 | committer | 远端分支 |
| --- | --- | --- | --- | --- |
| `gate-record-backfill-13` | #3229 | `a3e632c3cba0646715a79c34f4aad262ae1083fe` | 2026-10-10T00:07:00+08:00 | `git ls-remote --heads origin` = 0 行 |
| `gate-record-status-consistency` | #3274 | `d515fbc608855bedbcf160776d55a675bca0ca18` | 2026-10-11T00:19:08+08:00 | 同上 0 行 |

两笔均在本轮**当场重跑**取证：`git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 各恰好 1 行、`git ls-remote --heads origin <branch>` 各 0 行；不凭上一轮记忆抄写。

### ledger 销账

两篇的标题都不在 `scripts/gate-record-debt-ledger.json`（该文件键全是 `.quality-gates.md` 的历史标题）⇒ **无登记项可删**，逐个核对得出。本轮只新增自己的登记（新载体的 frontmatter 三字段），未新增 ledger 键，账池因此**净减一笔**。

### 本地门禁

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| Gate 2c（含新判据）自证 | `node scripts/check-gate-record-debt.js` | 见结论；必须 rc=0 且「矛盾 = 0」——即本轮回填的两篇在两处形态上都已同侧 |
| 品牌残留（硬红线） | `node scripts/check-no-brand-residue.js` | 见结论 |
| 编码完整性 | `node scripts/check-text-encoding-integrity.js` | 见结论 |
| 行尾两口径对账 | `git diff --numstat` vs `--ignore-cr-at-eol --numstat` | 见结论（两份记录均为 `i/lf w/crlf attr/text=auto`，脚本按 CRLF 逐行写回并断言 loneLF=0） |
| docs-only 判定 | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` | 提交后复跑，见结论 |
| 执行记录取证 | `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` | 见结论 |

| 门禁 | 状态 | 取证与后续动作 |
|------|------|-----------|
| 远程同步 | PENDING | 本 PR 尚未合并，merge SHA 还不存在。合并后由后续回填轮把**本行与上面「保留门禁」那句 bullet 一起**改写为 PASS 并同次删除 frontmatter 三字段；取证一律用 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` + `git ls-remote --heads origin gate-record-backfill-14`（须 0 行），不得凭记忆抄写 |
