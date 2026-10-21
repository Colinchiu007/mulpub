---
record: aggregate-changelog-landing
task: 用聚合器把 4 条执行记录条目搬进台账（CHANGELOG.md + 01-docs/learnings.md），其中含本片 publish-config-picker
date: 2026-10-21
---

## 本次执行记录：台账聚合搬运（aggregate-changelog-landing，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档（台账载体）。隔离 worktree `D:/Data/projects/mp-worktrees/mp-aggregate-landing`（**D 盘，非 C 盘**）、裸分支 `aggregate-changelog-landing`，经 `scripts/start-mp-task.ps1 -TaskName aggregate-landing -NoDeps` 正规入口创建。共享根全程 main + clean，未在其运行时路径落盘（一次误放临时文件被 `Session Isolation Write Guard` 当场隔离，见「逃逸分析」） |
| 第一性原因（QM-5 ①） | ✅ | 台账（`CHANGELOG.md` / `01-docs/learnings.md`）是**多会话共用写面**，PR 直改必与并发合并冲突（实测冲突文件只有这两个）。`scripts/aggregate-changelog.js` 是它**唯一的写入口**——但 CI 的 `quality-gate.yml` Gate 2b8 只跑 `--dry-run` 留现场读数、**不写盘** ⇒ 真仓搬运必须有人显式 `--write`。没人跑，`landed` 就一直非零，本片 `publish-config-picker` 的条目与 lessons 就永远躺在 `openspec/records/` 里没进台账 |
| 逃逸分析（QM-5 ②） | ✅ | ①**「dry-run 绿」被读成「已落地」**——dry-run 只打印 `LAND` 清单与首行读数，**一个字节都不写**；两条形态在终端上逐字同形（都有一行 `LAND publish-config-picker`）。②**PR 侧 dry-run 能看到尚未合入 main 的记录**（它读工作区/当前分支的文件），于是「我会搬」与「已经搬了」同形。③台账是共享写面，PR 直接改会与并发合并冲突——正解是走聚合器，不是「这次特殊」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 执行 `node scripts/aggregate-changelog.js --write`，真仓写盘读数：`AGGREGATE records=608 missing=604 malformed=0 learningsShape=0 landed=4 skipped=0 duprisk=0 learningsLanded=4 mode=write`。`landed=4` = `publish-config-picker`（本片）+ `chore-dep-audit-prune-resolved` + `changelog-carrier-aggregate` + `collect-rewrite-wordcount`（聚合器一次搬一批，这是它的设计）。**回归锁**：`scripts/aggregate-changelog.test.js`（21 例）已由 `quality-gate.yml` 的 `changes` 作业 Gate 2b8 点名执行；`check-unwired-tests.js` 读数 OK（114 个测试文件全部接线） |
| 防止再次发生（QM-5 ⑤） | ✅ | ①**台账只由聚合器写**（PR 不直改），搬运入口唯一 ⇒ 不存在「这次手改一下」的旁路；②每次搬运后必须复跑 `--dry-run` 确认 `landed` 归零，否则下一轮仍以为「搬过了」；③搬运 PR 本身也走门禁：变更集必须带执行记录，否则 `check-pr-exec-record.js` 判红（实测本 PR 首跑即红：「PR 未携带执行记录」）——这条把「搬运」也纳入审计面，而不是让它成为热写面的盲区 |
| 行尾与 diff 对账 | ✅ | 两口径逐文件相等：`git diff --numstat` = `61/91/71`（`.ccg` 记录 / `01-docs/learnings.md` / `CHANGELOG.md`），`git diff --ignore-cr-at-eol --numstat` 完全一致；**纯新增、零删除**，故删除数归因为空 |
| 接线棘轮 | ✅ | 本 PR 未新增测试文件。聚合器自身的锁 `scripts/aggregate-changelog.test.js` 已在 `quality-gate.yml` 的 `changes` 作业（**无 job 级 `if:`**，不受 docs-only 短路影响）被 `node --test` 点名执行；`node scripts/check-unwired-tests.js` rc=0「检查域内测试文件 114，OK」 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面：变更集只有 `CHANGELOG.md` / `01-docs/learnings.md` / 一条 `.ccg` 判定记录 / 本执行记录，无 `apps/desktop/electron/**`、无 UI 改动 |
| QM-6 CCG 双模型外部评审 | N/A | CCG 判定 `mode=skip`（改动全部命中文档白名单 ⇒ 走 §11.2b docs-only 快通道），**不需要**外部双家族评审。变更集里那条 `.ccg/reviews/*.json` 是 `mode=skip` 产物（`deepReview.required=false`），不构成深度审查欠账（`check-pr-exec-record.js` 的 `TIER-COVERAGE dual-closed total=0` 读数自洽） |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

### 现场读数

| 判据 | 读数 |
|---|---|
| `node scripts/aggregate-changelog.js --dry-run`（搬运前，合并后） | `AGGREGATE records=608 missing=604 malformed=0 learningsShape=0 landed=4 skipped=0 duprisk=0 learningsLanded=4 mode=dry`；`LAND publish-config-picker` 在清单内 |
| `node scripts/aggregate-changelog.js --write` | `... landed=4 skipped=0 duprisk=0 learningsLanded=4 mode=write`；`01-docs/learnings.md` +91 行、`CHANGELOG.md` +71 行 |
| `node scripts/classify-docs-only.js --base=origin/main --head=aggregate-changelog-landing` | `docs-only=true files=3`（`.ccg/reviews/…json` / `01-docs/learnings.md` / `CHANGELOG.md`），取证在 commit **之后**取的 |
| `node scripts/check-no-brand-residue.js` | rc=0「PASS（扫描 11327 个 tracked 文件，无品牌残留）」 |
| `node scripts/check-text-encoding-integrity.js` | rc=0「OK：无新增编码损坏」 |
| `node scripts/check-pr-exec-record.js --base=origin/main --head=HEAD --head-branch=aggregate-changelog-landing --mode=enforce` | 首跑 rc=1「PR 未携带执行记录」（本篇记录即为此补）；补齐后复跑 rc=0 |

### 遗留（不假装已闭合）

1. **`missing=604` 是常态而非异常**：604 篇历史记录没有 `## CHANGELOG 条目` 小节（它们是纯过程记录，没有对外变更说明）。聚合器只报不阻断。⚠️ 是否要给历史记录补条目、或让「无条目」成为合法形态，属另一件事，不在本 PR 范围。
2. **本 PR 会连带搬走另外 3 条别人的条目**：这是聚合器「一次搬一批」的设计（原子写盘，避免两个会话各搬一半）。⚠️ 代价是本 PR 的变更面大于「只搬我自己那条」；正解是接受这个设计，而不是给聚合器加一个「只搬指定记录」的开关——那会引入「谁有资格指定」的新判据面。
3. **台账搬运目前靠人记得跑 `--write`**：CI 只跑 dry-run 留读数，没有「待搬条目非零就提醒/阻断」的机械闸。⚠️ 本 PR 不加这个闸（那属于「改谁来守门」的性质，需人工过目），如实登记为待办。
