---
record: gate-record-backfill-15
task: 回填 visual-readiness-gate（#3297）与 gate-record-backfill-14（#3292）的远程同步行并销账，并纠正 PRD §8 的处置前行号
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个动这些文档的会话（PR 号必须回读：`gh pr list --repo Colinchiu007/Multi-Publish --head gate-record-backfill-15 --json number,state,headRefOid`，不得凭印象；合并后按 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 取 merge SHA，把本篇远程同步状态改写为 PASS + SHA + 时间，并**同一次**整段删除 frontmatter 的三个 sync_* 字段；两处形态（bullet 与表格行）若都在本篇出现必须一起改写 —— Gate 2c 有同篇对账判据）
---

## 本次执行记录：回填 #3297 / #3292 的远程同步欠账（gate-record-backfill-15，2026-10-11）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（**提交后**复跑）→ 结果见「本地门禁」表
- 变更类型与隔离声明：纯文档/流程变更，按分层规则可就地编辑；仍走隔离 worktree `mp-gate-record-backfill-15`（分支 `gate-record-backfill-15`）经 PR 落地，因回填要跑取证脚本且共享根有他人在飞文件
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 编码完整性 ✅ | 文档同步 PENDING（随 CI） | Gate 2c ✅ | 远程同步 PENDING（本条自己的欠账）

### 这一轮回填了两篇，其中一篇顺手纠了自己写下的过度声明

| 记录（== 分支名） | PR | 动之前 | 动之后 |
| --- | --- | --- | --- |
| `visual-readiness-gate` | #3297 | frontmatter 三字段 + 表格行 `PENDING`；「待回填的现场证据」里写的是"这是「根因真的被修掉」的唯一现场证据" | 三字段删除 + `PASS（main 942506fe9 @ 13:28:12+08:00）`；**那句过度声明同步改写**：该现场证明的是「Gate 7 在这个 head 上真的判了、没有就绪故障被吞」，而"根因被修掉"不能单独记在本 PR 头上 —— 选择器那一半 main 已由另一会话独立改掉（见 PRD §2b） |
| `gate-record-backfill-14` | #3292 | frontmatter 三字段 + bullet 与表格行**两处** `PENDING` | 三字段删除 + 两处同次改 `PASS（main b08681f17 @ 10:58:17+08:00）`；`文档同步` 也从 `PENDING（随 CI）` 改 `PASS`（`文档同步检查` 在 #3292 的 CI 上是 pass，状态列只写当下状态、不写历程） |

同场纠正：`01-docs/PRD-VISUAL-READINESS-GATE-2026-10-11.md` §8 表里"逐行对照 `all-views:151-172` 与 `supplementary-views:280-301`"是**处置前**的行号 —— 那两段模板在 `buildSuiteError` 收敛后已不存在，原样留着会让下一个会话按行号去找一段不存在的代码。就地标注为「处置前的行号，现只留 buildSuiteError 调用点」。

### 证据（每条三源，缺一不回填）

| 记录（== 分支名） | PR | main 上的 squash 提交 | committer | 远端分支 |
| --- | --- | --- | --- | --- |
| `visual-readiness-gate` | #3297 | `942506fe958d0f3c08f2a212b6aef4f328ab091d` | 2026-10-11T13:28:12+08:00 | `git ls-remote --heads origin visual-readiness-gate` = 0 行 |
| `gate-record-backfill-14` | #3292 | `b08681f178531cfabe2427563e9845b5bed0f3ce` | 2026-10-11T10:58:17+08:00 | `git ls-remote --heads origin gate-record-backfill-14` = 0 行 |

两笔均在本轮**当场重跑**取证，不凭上一轮记忆：① `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 各恰好 1 行；② `gh pr view NNNN --json state,mergeCommit,headRefName` = `MERGED` 且 oid 与 ① 同一个、`headRefName` 与记录文件名一致（归属核对，不靠分支名猜 PR）；③ `git ls-remote --heads origin <branch>` 各 0 行。

> 取证手法上的一条修正（当场踩到）：`git log --format=%H|%cI|%s` 经 `execSync` 走 cmd.exe 时，`%cI%` 会被当环境变量吃掉，命令**失败**但错误信息被 `split('\n')` 数成 3 行 —— 于是"恰好 1 行"的判据被读成 3 行假证据。改走 `execFileSync('git', [...])`（不经 shell）后计数才是真的。判"某 grep 命中几行"之前，先确认那条命令本身成功过。

### ledger 销账

两篇的标题都不在 `scripts/gate-record-debt-ledger.json`（该文件键全是旧载体 `.quality-gates.md` 的历史标题）⇒ **无登记项可删**，逐个核对得出；本轮只新增自己的 frontmatter 三字段，账池因此**净减一笔**（2 收 1 开）。

### 本地门禁

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| Gate 2c（含同篇对账判据） | `node scripts/check-gate-record-debt.js` | 见提交前实跑：须 rc=0 且登记字段无残留、矛盾 0 |
| 品牌残留（硬红线） | `node scripts/check-no-brand-residue.js` | 见提交前实跑 |
| 编码完整性 | `node scripts/check-text-encoding-integrity.js` | 见提交前实跑 |
| 行尾两口径对账 | `git diff --numstat` vs `--ignore-cr-at-eol --numstat` | 见提交前实跑（三份文件均 `i/lf w/crlf attr/text=auto`，脚本按 CRLF 逐行写回并断言 loneLF=0） |
| docs-only 判定 | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` | 提交后复跑，须 `docs-only=true` |
| 执行记录取证 | `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` | 见提交前实跑 |

| 门禁 | 结果 |
| --- | --- |
| 远程同步 | PENDING（本条自己的欠账） |
