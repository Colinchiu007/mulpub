---
record: fix-pure-backfill-autostaged
task: 出路④「纯回填」被 pre-commit 自动产物恒不可达——判形态前剔除 .ccg/reviews/*.json + 4 条安全边界
date: 2026-10-13
# ↓ 只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除（登记随文件走，不进 gate-record-debt-ledger.json）
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法收口
sync_backfill_owner: 下一个会话（docs 回填 PR）
---

## 本次执行记录：出路④「纯回填」恒不可达修复（fix-pure-backfill-autostaged，2026-10-13）【混合 PR】

- **变更类型**：`scripts/` 工具脚本（门禁判据本体）+ 文档 ⇒ 按 AGENTS.md 分层策略属**流程层**（不需独立 worktree），但按 docs-only 判据属**混合 PR**（改 `scripts/` 工具脚本自身）⇒ 走完整质量节拍。实际仍在隔离 worktree `D:\Data\projects\mp-worktrees\mp-fix-pure-backfill-autostaged`（裸分支同名）中完成。
- **本 PR 改的是「谁来守门」**：按 AGENTS.md「禁止自动合并的情形」第 2 类精神（改门禁判定逻辑需人工过目），**本 PR 不自动合并，交由用户裁决**。
- **共享根保持 main clean**：任务全程只在 worktree 落盘；`pre-code-edit-guard.ps1` 在共享根 exit 1（正确拒绝）；写保护 `Session Isolation Write Guard` = Running。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | worktree `mp-fix-pure-backfill-autostaged`（D 盘）+ 裸分支；`verify-worktree-deps.js` OK；共享根全程 `git status --porcelain` 为 0、停留 main |
| 第一性原因（QM-5 ①） | PASS | **两个特性独立落地后互相矛盾**，git 取证到具体 commit：①出路④「纯回填」判据由 **`e77977892`（#2928，2026-10-05）** 引入，要求「变更集**全部**是载体的 M」；②pre-commit 由 **`aee1ebc9b`（#3396，2026-10-12）** 起自动 `git add` 判定记录 `.ccg/reviews/<sha>.json`（状态 **A**），提交信息自述是「防 .ccg/reviews 未跟踪堆积的**根治**」。⇒ 自动入库**晚 7 天**落地，自 2026-10-12 起**任何走 pre-commit 的 PR 都必然带一个 A 文件**，`statuses.every((e) => e.status === 'M' && …)` 再也无法成立，**出路④恒不可达** |
| 影响面实测（非推断） | PASS | 用真实历史 PR 在 `--mode=enforce` 下逐笔复现：**#3465 / #3466 / #3470 三笔回填 PR 全部 `不通过：1 条理由`、rc=1**。⇒ 该出路自 2026-10-12 起**一次都没生效过**；7 天无人发现，只因 CI 以 `--mode=advisory` 调用（`quality-gate.yml:120`，该模式恒 `exit 0`，只留痕） |
| 逃逸分析（QM-5 ②） | PASS | **四层**。**单元层**——`isPureBackfillChangeSet` 确有独立单测（原 L170-187），但**没有任何一条用例带 `.ccg/reviews/` 的 A 文件**，夹具全是手搓的最小 statuses，**不经过真实钩子** ⇒ 判据在单测里恒真、与现实脱节；**CI 层**——`--mode=advisory` 恒 exit 0，**判据死了也不出声**；**端到端层**——CLI e2e（原 L255）构造临时 git 仓库，**不经过 pre-commit**，永远产不出 `.ccg/reviews/`；**人工层**——AGENTS.md 自动合并判据 4 写着「`--mode=enforce` 为 OK」，但**没人跑过**（本会话前几轮我自己也照结论抄了「OK」，直到实测才推翻） |
| 系统性漏洞定位（QM-5 ③） | PASS | ①**夹具与真实链路脱节**：手搓 statuses 让「钩子产物」这一整类输入从未进入被测面；②**advisory 模式让死判据静默**：CI 恒绿，判据失效**零信号**；③**无「新特性是否让既有判据恒不可达」的交叉检查**：相隔 7 天的两个 PR 各自全绿，矛盾无人发现；④**文档判据与实际执行不一致**：AGENTS.md 写 enforce、CI 跑 advisory，两者从不互校 |
| 修复 + 回归保护（QM-5 ④） | PASS | 新增 `AUTO_STAGED_RE = /^\.ccg\/reviews\/[^/]+\.json$/` 与 `excludingAutoStaged()`，判形态前先剔除钩子自动产物；`isPureBackfillChangeSet` 改为基于剔除后的集合判定（剔除后为空由既有 `length > 0` 兜底 fail-closed）。口径依据：`classify-docs-only.js` 的 `CI_IGNORED_PATHS` 已含 `.ccg/**`，**两套判据对「什么算代码」必须一致**。新增 **1 组 7 断言**回归测试 |
| 安全边界（刻意收紧，与核心回归同等重要） | PASS | 豁免面**只开给** `.ccg/reviews/*.json`，**不放 `.ccg/**`**；7 条断言中 5 条是反向边界：③只有自动产物、无任何载体 ⇒ **仍 false**（否则「只跑钩子不写记录」的空 PR 会被判合法回填）；④载体 M + 自动产物 A + **真代码 A** ⇒ **仍 false**（豁免不得外溢到代码，这是本次修复最危险的滑坡）；⑤载体 M + 自动产物 A + `_exempt` A ⇒ **仍 false**（豁免出路③与纯回填出路④互斥，不得重叠）；⑥`.ccg/` 下**非 reviews/** 的 A ⇒ **仍 false**；⑦自动产物为 M 时同样剔除（形态不因 git 状态字母而变） |
| 变异反证 | PASS | 把 `excludingAutoStaged` 改成 no-op（`return statuses`）⇒ **新增用例立红**（`not ok 9`，36 tests / 1 fail）；按字节还原 ⇒ **36/36 全绿**。反证的是**锁本身在跑** |
| **真 A/B（同一位置、同一 commit、只换脚本）** | PASS | 在 worktree 内 `git stash` 掉本改动后逐笔复跑：**#3466 / #3465 / #3470 修复前 `rc=1 不通过：1 条理由` → 修复后 `rc=0 OK: 本 PR 携带执行记录或带原因的豁免`**。三笔全部翻转 |
| 相关域测试 | PASS | `node --test scripts/check-pr-exec-record.test.js` → **36 tests / 36 pass / 0 fail**；`classify-docs-only.test.js` → **27/27**（其中的 workflow 结构锁只断言 `changes` job 里 `--head=` 的调用点，不碰本脚本内部，已确认无冲突）；`ci-pr-changeset.test.js` → 通过 |
| 其他门禁 | PASS | `check-gate-record-debt` ✅ / `check-no-brand-residue` ✅ / `check-unwired-tests` ✅ / `check-text-encoding-integrity` ✅ |
| 消费者影响面 | PASS | 全仓引用 `check-pr-exec-record` 的 62 个文件中，**除本脚本与其测试外全部是文档/记录/CHANGELOG 的散文引用**，无其他代码依赖；`isPureBackfillChangeSet` / `excludingAutoStaged` 的使用点只在脚本自身与其测试内。导出为**纯增量**（新增 `excludingAutoStaged` / `AUTO_STAGED_RE`），不改既有导出语义 |

### 刻意未做（如实记录，避免越权）

1. **不把 CI 从 `--mode=advisory` 改成 `enforce`**。AGENTS.md 记该模式是「第一步落地时」的过渡，但切 enforce 会让**所有存量 PR** 立刻受判、影响面未评估 ⇒ 属独立决策，不在本 PR 内擅动。
2. **不改 AGENTS.md 的自动合并判据正文**。判据 4 写的「`--mode=enforce` 为 OK」在本修复后**才真正可达**（修复前对回填 PR 恒不可达），即本 PR 是让文档判据与实现重新一致，而非改判据。
3. **不追溯回填前 7 天的历史欠账**。那段时间的回填 PR 靠 advisory 放行，其「OK」结论本身没错（它们确实携带了记录），只是**判据没跑**。

### 过程记录：一次环境阻塞（如实登记）

任务开始时共享根被**另一并发会话**的 31 项已暂存内容阻塞（`.adversarial/oss-reinforcement-plan/**` 24 + `01-docs/research/oss-reinforcement-2026-10-13/**` 4 + `.ccg/` 1 + `.quality-gates.md` 1 + `scripts/gate-record-debt-ledger.json` 1）。因 `start-mp-task.ps1` 与 `session-init.sh` 两个入口均要求 `-RequireClean`，且共享根 index 是**多会话共享**、提交会连带他人 31 项，故按 AGENTS.md 隔离失败纪律**停下来报告用户**，未做任何手动补救（未 `rm` worktree 注册、未动他人暂存、未在共享根落盘）。用户要求先查清阻塞源：定位为该会话分支 `docs/oss-reinforcement-research`（提交 `f6260bee0`，PR **#3472**），其于 **17:39:54** 自行提交并推送后共享根恢复 clean，任务随即按官方入口恢复正常。

### 远程同步回填说明

本 PR 合并后由后续 docs 回填 PR 完成，**同一次提交内**：

1. 本文与 `.quality-gates.md` 的 `| 远程同步 |` 行由 `PENDING` 改写为 `PASS` + merge SHA；
2. **删除本文件 frontmatter 的 `sync_status` / `sync_reason` / `sync_backfill_owner` 三字段**（文件源载体的未收口登记**随文件走**，**不得**往 `scripts/gate-record-debt-ledger.json` 加键——那套 JSON 键只匹配 `.quality-gates.md` 的 `## 标题`）。

| 远程同步 | PENDING |
