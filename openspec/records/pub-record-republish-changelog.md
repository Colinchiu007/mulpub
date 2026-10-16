---
record: pub-record-republish-changelog
task: PR #3659 合并后的文档收尾——CHANGELOG 条目与 learnings 三条教训落地（执行记录回填已在 #3703 单独完成）
date: 2026-10-16
---

## 本次执行记录：CHANGELOG 与 learnings 收口（pub-record-republish-changelog，2026-10-16）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档变更（`CHANGELOG.md` + `01-docs/learnings.md`，均为既有文件的顶部插入）。在隔离 worktree `D:/Data/projects/mp-worktrees/mp-pub-record-republish` 的 `pub-record-republish-changelog` 分支上完成（基于 `origin/main`=`c9086f1cb`），经 PR 落地——**不占共享主工作区**（共享根当时有他人未提交的 `AGENTS.md` 改动，且此前试提交已被分支守卫正确拦截） |
| 第一性原因（QM-5 ①） | ✅ | 这两项本就**计划**由合并后的 docs PR 落地，不是遗漏：`CHANGELOG.md` 是全仓共用的追加型热点文件，代码 PR 带它会与并发会话互相活锁；执行记录（PRD §10 与本 PR 的执行记录）都已写明「CHANGELOG 与 learnings 按纪律移出代码 PR，改由合并后的 docs-only 回填 PR 落地」。拆成两个 PR 而非塞进回填 PR，是因为 `check-pr-exec-record` 的「纯回填」定义要求变更集全部是记录/台账载体（`openspec/records/*.md`、`.quality-gates.md`、`scripts/gate-record-debt-ledger.json` + `.ccg/reviews/<sha>.json`），夹带这两个文件即不符合定义——实测前一个回填 PR #3698 正是因此被判不通过后关闭重提 |
| 逃逸分析（QM-5 ②） | ✅ | ① 执行记录回填 PR（#3703）与本文档收口 PR 分成两个，避免「一个 PR 同时踩两种门禁定义」；② 插入位置取「文件顶部、他人条目之上」而非尾部，并用脚本校验插入后首行确为我的条目（未覆盖任何既有内容）；③ `classify-docs-only` 在**提交前**取证会因 HEAD==base 返回 `docs-only=false files=0`（AGENTS.md 已预警的取证顺序陷阱），故提交后才正式取证：`docs-only=true files=2` |
| 修复 + 回归保护（QM-5 ④） | ✅ | 内容为文档（无运行行为），回归保护=门禁本身：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true`；`node scripts/check-no-brand-residue.js` PASS；行尾两口径 `numstat` 与 `--ignore-cr-at-eol numstat` 均为 2 行、一致 |
| 防止再次发生（QM-5 ⑤） | ✅ | learnings 里落 3 条可复用教训：① 视觉基线必须用 CI 渲染刷新（本地渲染不同形时门禁拒绝出结论是正确行为）；② 全仓登记型机械锁（如 notify 的 `ALLOWED_KEYS`）本地按需跑套件天然覆盖不到；③ 「搬定义」必须同步改定义/destructure/锁的构造值三处 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐文件一致（各 2 行，无 CRLF 混入）。**删除行数 0**：两个文件均为纯顶部插入，未改动任何既有行 |
| 接线棘轮 | ✅ | 未新增测试文件（纯文档）。既有测试未受影响 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触碰 `apps/desktop/electron/**` 与任何渲染代码，视觉基线（`publish-history{,-dark}.png`）已在代码 PR 内用 CI 渲染刷新并经 QG Visual 验证通过，本 PR 不再触及 |
| QM-6 CCG 双模型外部评审 | N/A（docs-only 通道） | 按 docs-only 快速通道跳过 QM-6；上游代码 PR 的 QM-6 已在其执行记录内闭环（mode=dual、4 条 upheld 逐条修复、如实标注自扮演出口 0.6） |
| 远程同步 | PASS | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin pub-record-republish-changelog` 返回 0 行证远端分支已删；回填后删除上方三个 `sync_*` 字段 |

### 遗留（不假装已闭合）

- 本 PR 不含执行记录回填（那部分已在 #3703 完成，origin/main 上 `openspec/records/pub-record-republish.md` 的两形态已为 `PASS` + merge SHA `2fd74f50876b438f0ccae4cf12713eec77292753`）。
- 上游代码 PR 的 QM-6 为**自扮演出口**（confidenceWeight=0.6），不是真跨家族独立复核；该限制已写进其执行记录，不在本 PR 范围内改变。
- 共享根工作区留有一个他人未提交的 `AGENTS.md` 改动（`fix-mavis-trash-env` 的文档同步）与 `.agent_context/shared-root-violation` 标记（被 `.gitignore` 吞掉、不满足 R0 删除闸 3 而未删），均**未卷入本 PR**，交还其作者。
