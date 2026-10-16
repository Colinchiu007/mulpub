---
record: qm6-exec-chain-pointer
task: 纠正 AGENTS.md「QM-6 与既有门禁的关系」中失效的 skill 引用，改指向本仓真实机械链
date: 2026-10-16
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话（按「PR 自动合并」收尾清单 1–4 条回填，并整段删除本三个 sync_* 字段）
---

## 本次执行记录：纠正 QM-6 门禁落点指向（qm6-exec-chain-pointer，2026-10-16）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 纯流程文档（`AGENTS.md` 一处 + 本记录）。分层规则允许就地编辑 + 经 PR 落地。现场冲突如实记：`scripts/pre-code-edit-guard.ps1` 对共享根报 `BLOCKED`（其判据针对运行时代码），`scripts/start-mp-task.ps1` 建 worktree 被 `mp-worktree-health.ps1` 拒（`clean:false` 源于**他会话**在共享根留下的未提交 `01-docs/learnings.md` 与一个未跟踪 PLAN 文件，本次未 stash、未代其提交、未碰那两个文件）——经使用者显式裁决走 docs-only 就地路径。`scripts/session-guard.ps1 -Branch main` 已声明（`.agent_context/expected-branch` = `main`） |
| 判定（docs-only） | PASS | commit 后在**最终 base** 上取证：`node scripts/classify-docs-only.js --base=origin/main --head=qm6-exec-chain-pointer` ⇒ `docs-only=true files=3`（`AGENTS.md` + 本记录 + 一份 CCG 判定产物 `.ccg/reviews/fc56bb878….json`）。首跑是在旧 base `4f1661320` 上取的、当时读作 `files=4`；rebase 到 `757ecd1a1` 后重取即本数（旧数不沿用） |
| 第一性原因（QM-5 ①） | PASS | `git log -S'已同步固化此强制卡点' -- AGENTS.md` 唯一命中 `5bf7b522e`（2026-09-13T14:21:43Z，PR #1802「docs(AGENTS): 新增 QM-6 强制 CCG 双模型外部评审」）⇒ 该句**写下当时即未落地**，不是后来被回退：`git log -S'QM-6' -- .quality-rhythm/SKILL.md .codex/skills/quality-rhythm/SKILL.md` 零命中，三份安装副本（用户级 + 两份 vendored 镜像）全文亦无 QM-6 编号 |
| 逃逸分析（QM-5 ②） | PASS | 单元/集成/E2E/视觉四层对本文断言**结构性无关**（无可执行对象）。逃逸发生在审查层：原句是「见质量节拍 skill 仓库」的**跨仓断言**，本仓没有任何判据能查外部仓，于是它既测不红也不测不绿。AGENTS.md 已有同族纪律「不得承诺一个不在该代码路径上的错误码」，但只约束错误码，未覆盖跨仓指向（`scripts/check-pr-exec-record.js:418` 那条补注即前例）。取证口径注意：首轮我误判成「skill 全文无 CCG」，实为 `grep -r … | head -40` 截断致失明——`grep -a` 单文件重测得 `SKILL.md:797`/`:855` 确有 CCG 与「双模型审查」字样 |
| 系统性漏洞（QM-5 ③） | PASS | 具体落点：AGENTS.md 指向本仓脚本/产物形态的断言**没有存在性校验**。本次改写把指向换成 3 个可当场复核的对象（`scripts/ccg-review-decider.js`、`.ccg/reviews/<40 hex>.json` 形态、`check-pr-exec-record.js` 的 `CLOSED_DEEP_REVIEW_STATUSES` 三值），但那三者将来改名/删除仍无人报警——属「门禁断言随实现迁移同步」在本仓文档侧的空白 |
| 修复 + 回归保护（QM-5 ④） | PASS | 原句替换为机械链四步 + 一条 ⚠️ 残余风险（`self_play_resolved` 也在闭环集 ⇒ 自扮演即可判绿）。手工复核命令两条：① `grep -na "已同步固化此强制卡点" AGENTS.md` ⇒ 应 0 命中；② `grep -na "CLOSED_DEEP_REVIEW_STATUSES" -A4 scripts/check-pr-exec-record.js` 的三值须与新句逐字一致。无新增测试文件（纯文档） |
| 防止再次发生（QM-5 ⑤） | PENDING | 本片**未新增机械锁**，如实登记遗留：跨仓引用本仓无法自证；本仓侧「AGENTS.md 点名对象必须存在」的存在性锁待另片（属 `scripts/` 工具脚本变更 ⇒ 混合 PR，不走 docs-only） |
| 行尾与 diff 对账 | PASS | 两口径（`git diff --numstat` vs `--ignore-cr-at-eol --numstat`）逐文件同数：`AGENTS.md` 6/1、CCG 判定产物 26/0、本记录 35/0。工作副本纯 CRLF（CR 数 == LF 数，无裸 CR 无裸 LF——1 个孤立 CR 会让 `text=auto` 对整文件失效），index blob 归一为 LF，`git ls-files --eol` = `i/lf w/crlf attr/text=auto` 与同目录既有记录同档 |
| 接线棘轮 | N/A | 未新增 `*.test.js` |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与渲染层 |
| QM-6 CCG 双模型外部评审 | 未执行 | 纯流程/文档变更按本文档豁免 QM-6；且本片正是在修订对该门禁的说明，不以自审冒充通过 |
| 记录欠账 | PASS | `node scripts/check-gate-record-debt.js` ⇒ rc=0 且不再点名本文件（首跑曾点名「整块缺 远程同步 行」——本 PR 修的正是这个盲区，而我自己第一版就漏了表格行只写了 bullet，被门禁当场抓住；补行后复跑通过）；`node scripts/check-record-qm5-rows.js` ⇒ OK（必需步骤 ① ② ④ ⑤，检查域内记录 180、欠账登记 27、全仓未登记缺行 0） |
| 远程同步 | PENDING | 本 PR 尚未合并，merge SHA 不存在。合并后由后续 docs PR **同一次提交**内改写本行与下方 bullet 为 `PASS` + merge SHA（`git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 取证）+ 回读本次合并触发的 main push 读数（收尾清单第 7 条；纯记录类改动若因 push `paths-ignore` 按设计不跑，则如实记 `NO_RUN(by design)` 并转核该判据最近一次 main 读数），同时整段删除 frontmatter 的三个 `sync_*` 字段。远端分支已删以 `git ls-remote --heads origin qm6-exec-chain-pointer` 返回 0 行为证 |

- 保留门禁：判定 docs-only=true ✅ | 行尾对账 ✅ | 品牌残留 ✅（`check-no-brand-residue.js` PASS；扫描数随每笔提交自增故不记总数） | 文档同步 ✅（`openspec-sync-check.js` OK：387 tasks / 52 active / 231 archives） | 记录欠账 ✅ | 远程同步 PENDING

### 遗留（不假装已闭合）

- QM-5 ⑤：`AGENTS.md` 点名对象的「存在性锁」未落地（本片只修指向，不建门禁）。
- 闭环集含 `self_play_resolved` ⇒ 外部模型零参与也能判绿；是否镜像引擎的「高危域不得自扮演」口径到 `check-pr-exec-record.js`，属改「谁来守门」，待使用者裁决后单独起片。
- 现场运行态（与本片无关但 pre-flight 出声）：共享根写保护隔离区 `quarantineCount=351 / violations=356`（阈值 50）、`worktreeCount=36`（阈值 5）。
- rebase 与撞名处置：PR 首推后 `mergeable=CONFLICTING`，冲突**不在** `AGENTS.md`（上游 #3741 改在 `:126` 区，本片改在 `:1006` 区，`Auto-merging` 通过），而在 add/add 的 `.ccg/reviews/4f1661320854ea079b9b96d69739c89c31314de9.json`——本机 pre-commit 钩子按**父 SHA** 命名产物，两个会话站在同一父提交上必然撞名。按既有口径取主干那份，本分支不带该文件（故 `files` 从 4 减到 3）。重建走临时索引（`GIT_INDEX_FILE` + `read-tree`/`update-index`/`commit-tree`），共享根始终停在 `main`、未 checkout、未 stash 他会话的 `01-docs/learnings.md`。
