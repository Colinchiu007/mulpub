---

record: gate-record-backfill-16
task: 回填 gate-record-backfill-15（#3307）、gate4-desktop-exclusion（#3315）与播客刀 4 规格入档（#3314）的远程同步行并销账
date: 2026-10-11
---

## 本次执行记录：回填 #3307 / #3315 / #3314 的远程同步欠账（gate-record-backfill-16，2026-10-11）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（**提交后**复跑）→ 结果见「本地门禁」表
- 变更类型与隔离声明：纯文档/流程变更，按分层规则可就地编辑；仍走隔离 worktree `mp-gate-record-backfill-16`（分支 `gate-record-backfill-16`）经 PR 落地——回填要跑取证脚本，且共享根有他人在飞文件
- 保留门禁：行尾两口径对账 ✅ | 品牌残留 ✅ | 编码完整性 ✅ | 文档同步 ✅ | Gate 2c ✅ | 远程同步 PASS

### 这一轮收了三笔，其中一笔不是我自己开的

| 记录 | PR | 谁登记 | 收口形态 |
| --- | --- | --- | --- |
| `openspec/records/gate-record-backfill-15.md` | #3307 | 上一轮回填轮自己 | frontmatter 三字段删除 + 「保留门禁」bullet 与表格行**两处**同改 PASS；另把 `文档同步` 由 `PENDING（随 CI）` 改 `PASS`（该 PR 的 `文档同步检查` 在 CI 上是 pass，状态列只写当下状态） |
| `openspec/records/gate4-desktop-exclusion.md` | #3315 | 本会话上一轮（Gate 4 排除断链修复） | 同上两处同改 PASS；并把该记录里那句「合并后由回填轮补」的**待补承诺**换成实测现场（见下节） |
| `.quality-gates.md` 播客刀 4 块（`podcast-tts-spec-dao4`） | #3314 | **他人会话**（其 ledger 登记文本自派「合并后由回填 PR 改写 PASS + merge SHA 并删除本条登记项」） | 两处同改 PASS，第三列「证据」按该表原本的 **3 列结构**写全本轮实际跑的取证命令；同时删掉 ledger 里那条登记项 |

净效果 **3 收 1 开**（开的是本条）。

### 证据（每条三源，缺一不回填）

| 记录（== 分支名） | PR | main 上的 squash 提交 | committer 时间 | 远端分支 |
| --- | --- | --- | --- | --- |
| `gate-record-backfill-15` | #3307 | `92e7f7cfaacb13c4527218ae18e32a5273367388` | 2026-10-11T13:35:39+08:00 | `git ls-remote --heads origin` = 0 行 |
| `gate4-desktop-exclusion` | #3315 | `932b2384feddb347ccc369fb1e465e2a7d5089bc` | 2026-10-11T17:04:40+08:00 | 同上 0 行 |
| `podcast-tts-spec-dao4` | #3314 | `2ba2ff54ef31c883a89d963331ce7781a82bfc96` | 2026-10-11T15:41:33+08:00 | 同上 0 行 |

三笔均在本轮**当场重跑**取证：`git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 各恰好 1 行、`gh pr view --json state,mergedAt,mergeCommit` 与上面同一 SHA 对齐、`git ls-remote --heads origin <branch>` 各 0 行；不抄上一轮记忆。

### 顺手落一组对侧才看得见的数字（#3315 的 CI 现场）

`gate4-desktop-exclusion` 记录里那句"合并后由回填轮补"的承诺，本轮按 run `38124854720` / job `114427094214` 兑现：

- `Gate 4 - Workspace unit tests` 步骤 **11s** success（合并前三条失败样本恰好 **1801s** = `WaitForExit(1800000)` 到点，两次成功样本 1173s / 1322s）。
- 判据在 runner 上打出 `full A 臂：nx 自己声明 12 个包，不含 @multi-publish/desktop` + `full B 臂（负控）：不传 exclude 时 nx 声明 13 个包，含 @multi-publish/desktop` + `B 臂来源 twin:test:all`。
- **同时登记一条不属于本轮回填口径的事实**：同一次 run 的 `Desktop tests shard 1/2 = 1743s`、`2/2 = 1764s`，两片都贴着 1800s 跑。⇒ 在飞 PR #3313 抬预算里 **desktop-shards 那一半仍有实测支撑**，被本轮回填的那笔修复消掉的只是 **Gate 4** 那一半（12 个包实测 100 秒跑完却给了 30 分钟）。这句话写在这里给 #3313 的作者复核，本轮不动它的任何数字。

### ledger 销账

`scripts/gate-record-debt-ledger.json` 由 **9 → 8 条**：只删 `本次执行记录：播客刀 4 规格入档（podcast-tts-spec-dao4，2026-10-11）【docs-only】` 一项（与上面 C 处改写**同一次提交**发生）。其余 7 条 8 月历史项 + 1 条孤儿行占位**保持原样**——它们的登记文本自己写明「不代其他会话取证、不臆造 merge SHA」，本轮不越权收口。删完由 `node scripts/check-gate-record-debt.js` 复跑判 rc=0，且 JSON 由 `JSON.parse` 独立回读（防 trailing comma 把账本写坏）。

### CHANGELOG 为什么不加条目（先例核验，不是偷懒）

`git show origin/main:CHANGELOG.md` 里查不到 `(#3319)` / `(#3311)` / `(#3307)` / `gate-record-backfill-15` / `shared-root-path-case-fix` 中任何一个 ⇒ **纯回填轮不入 CHANGELOG 是既有先例**，本轮沿用。副作用是好的：CHANGELOG 条目数的差值不变量（head == base + 新增 1）在本轮保持不动，不与并发会话抢置顶块。

### 本地门禁

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| Gate 2c（同篇对账 + 欠账登记） | `node scripts/check-gate-record-debt.js` | rc=0；三处两形态同侧、ledger 无陈旧项、记录标题无重复 |
| 品牌残留（硬红线） | `node scripts/check-no-brand-residue.js` | 见结论 |
| 编码完整性 | `node scripts/check-text-encoding-integrity.js` | 见结论 |
| 行尾两口径对账 | `git diff --numstat` vs `--ignore-cr-at-eol --numstat` | 见结论（本轮四个被改文件均为 `i/lf w/crlf attr/text=auto`，脚本逐行保留各自行尾） |
| docs-only 判定 | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` | 提交后复跑，见结论 |
| 执行记录取证 | `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` | 见结论 |

| 门禁 | 结果 |
|------|------|
| 远程同步 | PASS | 已合并：PR #3320，merge d4270f99094f9bf64c0e8072e144f89ba4215777（2026-10-11，squash）。取证：`git log origin/main --grep "(#3320)$" --format=%H|%cI`；本条为记录文件侧欠账的收口——它没有 .quality-gates.md 置顶记录，收口判据取本文件的表格行与 frontmatter |
