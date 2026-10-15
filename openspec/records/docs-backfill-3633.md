---
record: docs-backfill-3633
task: 回填 #3633 远程同步 PASS + 销账，并落地被移出代码 PR 的 CHANGELOG / learnings 条目
date: 2026-10-15
sync_status: PENDING
sync_reason: 本回填 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话
---

## 本次执行记录：回填 #3633 远程同步 PASS + 销账，并落地 CHANGELOG/learnings（fix-toutiao-title-suffix）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 纯文档/流程变更 ⇒ 共享根就地编辑 + PR 落地（不在共享根执行任何 git checkout/switch；开写前 `git merge --ff-only origin/main` 确认未滞后） |
| 判定（docs-only） | PASS | `node scripts/classify-docs-only.js --base=origin/main --head=docs-backfill-3633` → **docs-only=true**（files=5，全部命中 `CI_IGNORED_PATHS`）⇒ 重型 job 由 `changes` 层短路，`skipping` 为预期。判定在 **commit 之后**取证（预提交时 `HEAD==base` ⇒ 空 diff 会得到假的 `docs-only=false files=0`） |
| 第一性原因（QM-5 ①） | PASS | #3633（merge `c5b52322862b0cf7a4aaa6492f9738550637bc12`，2026-10-15T18:21:47+08:00）已合并。本体 PR **刻意未带** `.quality-gates.md` 与 ledger（共同追加热点 ⇒ 结构性活锁），故本回填 PR 补本体 QG 块（最终 PASS 形态） |
| 逃逸分析（QM-5 ②） | PASS | 沿用已沉淀判据：两形态同时写（bullet 以状态词收尾 + `\| 远程同步 \|` 表格行）、回填与销账同次提交。本轮实测该判据成立：`check-gate-record-debt.js` rc=0 |
| 修复 + 回归保护（QM-5 ④） | PASS | 四件事同次提交：① 本体记录 `openspec/records/fix-toutiao-title-suffix.md` 远程同步 → PASS + merge SHA 并删 frontmatter 三字段；② `.quality-gates.md` 顶部新增本体 QG 块（直接写最终 PASS 形态，含 QM-1 三层判据证据与 5 条未闭合）；③ `CHANGELOG.md` 11 行 + `01-docs/learnings.md` 58 行（为破热点载体活锁而从代码 PR 精确回退的两段内容）；④ 本记录自身 |
| 防止再次发生（QM-5 ⑤） | PASS | 两条新教训进 `01-docs/learnings.md`：**① 本机 DSH 会话环境带 `ELECTRON_RUN_AS_NODE=1` 会让任何 Electron 应用静默退出（rc=0/零输出），「只看 stderr 不看存活」的判据会对其判 PASS（假绿）**；**② `Get-Process` 与 `tasklist` 对已退出进程会给出不一致的残留条目，终止同名多进程实例必须按 PID 并交叉核对两个工具**。另 AGENTS.md QM-2 新增「⛔ 发布内容保真合同（trigger-value isolation）」四条不可破 |
| 反证 | N/A | 纯文档改写，无运行代码可变异；本体反证见 #3633（扰动值改回事故写法 ⇒ **4 条指名红**：B 组 1 + D 组结构锁 3） |
| 编码与行尾 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐文件一致（`.quality-gates.md` +22、`learnings` +58、`CHANGELOG` +11、本体记录 +1/-4）；无冲突标记（四文件扫描 0 命中） |
| QM-1 / QM-4 | N/A | 未触生产代码与渲染层（本体 QM-1 见 #3633：打包 rc=0、打包字节 sha256 与修复源码逐字节相等） |
| QM-6 双模型外部评审 | 未执行 | 纯文档改写；本体深度审查亦未执行（`deepReview.status=pending`），如实登记，不以自审冒充通过 |
| 记录欠账 | PASS | `check-gate-record-debt.js` rc=0（顶部记录带行、两源未收口行均已登记、记录标题无重复、登记字段无残留） |
| 远程同步 | PENDING | 待本回填 PR 合并后由后续 docs PR 回填 merge SHA 并销账（回填与销账同次提交） |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅（`check-no-brand-residue.js` PASS）| 文档同步 ✅（CI doc-gate）| 远程同步 PENDING

### 备注：本 PR 的重建过程（一次真实冲突与其正解）

首版提交 `da1b7fcef` 基于 `c5b523228`；随后上游 `fa8184ef4` 也改了 `.quality-gates.md` ⇒ 分支变 `CONFLICTING`。**没有选择 rebase 消解**，而是在 `fa8184ef4` 之上**重新施加**同一组改动（共享根 `main` 上 commit → `git branch -f` → `git reset --keep origin/main` → 推送），零冲突。原因是上游该次改动是**追加到文件末尾**（`ops-dead-ipc` 块位于第 11625 行），与本片「顶部插入」位置不同 ⇒ 重放天然无冲突；顶部的 `publish-add-account-entry` 块与末尾的 `ops-dead-ipc` 块均原样保留（已核对块序号 1/23/63）。
