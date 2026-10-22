---
record: main-red-liveness
task: 提案——让「主干红就别合」这条判据在主干高频变动下仍可用
date: 2026-10-22
---

## CHANGELOG 条目

# docs(openspec): 新增 main-red-liveness 提案，诊断合并门禁 8 小时卡死的结构性根因

- **背景**：PR #4186（账号资料兜底修复）被合并门禁卡约 8 小时，而它本身 24 项检查全程全绿、`mergeable=MERGEABLE`、`mergeStateStatus=CLEAN`。
- **根因（三条，均有现场取证）**：① TOCTOU——`check-main-red.js` 取 `origin/main` 当前 tip，与真正合并之间有时间差；② 把「主干有检查在跑」误当「主干有红」，主干越活跃越合不进去；③ 缺「基础设施类红」整个类别——本次主干红是 `[electron-ci-timeout-budget] elapsed=2101s budget=2100s rc=124`（超时预算差 1 秒，非断言失败），而唯一豁免出口 `--allow-main-red` 的语义是「本 PR 正是去修那条红」，这类红没有任何 PR 能修 ⇒ 全仓 PR 一起冻住。
- **关键事实**：实测分支保护两套机制（classic 4 条 + ruleset `main-ci-gate` 7 条），`strict_required_status_checks_policy=false` ⇒ **GitHub 本身并不要求「主干绿」**。这条是本仓自加的更严策略，目标正确但实现方式不可满足。
- **方案**：四阶段——主干基线化（约 0.5 天）／基础设施类红登记（约 1 天）／Merge Queue（约 3–5 天）／缩短 `electron-tests`（已由 `electron-ci-budget-rescale` 认领）。
- **本文只提案**：阶段 1/2/3 均属「改谁来守门」，`tasks.md` 0.1–0.4 列为前置裁决，未获人工批准不实施。

---

## 本次执行记录：main-red-liveness 提案（docs-only，2026-10-22）

| 门禁 | 状态 | 证据 |
|------|------|------|
| 变更类型与隔离 | ✅ | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **docs-only=true**, files=3（`.ccg/reviews/1b9efc3b…json`、`openspec/changes/main-red-liveness/proposal.md`、`tasks.md`）。**纯文档，无运行时代码**，故不进 worktree 做打包验证。实际落地方式：共享根 main 已被另一活跃会话（pid 44992）声明，按 `session-guard.ps1` 的「共享工作区只允许一个会话持有声明，请改在独立 worktree 中工作」改用 worktree `mp-main-red-liveness`（**未用 `-Force` 抢声明**） |
| 行尾/编码对账 | ✅ | `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 逐字一致（359/0 + 76/0）。注：首次用 PowerShell `-eq` 比对得到假 MISMATCH（数组逐元素比较不是布尔），改用 bash 字符串比较后 MATCH |
| 品牌残留 | ✅ | 文档未出现竞品真名；内部标识（`main-ci-gate`、`electron-ci-budget-rescale`）均为本仓自有的门禁/任务名 |
| 文档同步 | 随 CI | `doc-gate` |
| 执行记录 | ✅ | 本文件（唯一强制载体） |
| 远程同步 | 由门禁推导 | 不手写状态词（`gate-record-sync-derived-status`） |

- 保留门禁：判定 docs-only=true | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 随 CI | 执行记录 ✅ 本文件 | 远程同步 由门禁推导

### 跳过项（docs-only 通道按设计豁免）

| 门禁 | 理由 |
|---|---|
| QM-1 打包 | 无运行时代码改动 |
| QM-2 代码必检项 | 同上 |
| QM-4 视觉 | 无 UI / 样式 / locale 改动 |
| TDD | 无代码 |
| QM-6 双模型评审 | 无代码；且本提案**本身**就是在申请对门禁判据做外部评审（`tasks.md` 1.3.4 / 2.3.3） |

### 备注

本提案的核心主张是：本次 8 小时不是操作者手慢，而是**判据缺了一整个类别**（基础设施类红）
＋ **判据观测的时刻与被合并的时刻不是同一个**。若阶段 1+2 获批并实施，同类场景可从 8 小时压到 5 分钟量级。
