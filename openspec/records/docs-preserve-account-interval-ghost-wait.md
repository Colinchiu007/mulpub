---

sync_reason: PR 刚开、尚未合并，远程同步状态待回填
sync_backfill_owner: Colinchiu007（本分支作者，合并后同一次提交内删除本两字段）

record: docs-preserve-account-interval-ghost-wait
task: 代为提交共享根遗留的「账号间隔幽灵等待」计划与 pitfall（清干净共享根以解除 worktree 创建阻塞）
date: 2026-10-17
---

# 代为提交共享根遗留工作（docs-preserve-account-interval-ghost-wait）

## 0. 这是什么，以及为什么要由本次会话提交

共享根 `<仓库根>` 里躺着**他人**（另一个会话）于 2026-10-17 02:05 留下的两处未提交产物：

| 状态 | 文件 | 内容 |
| --- | --- | --- |
| `M` | `01-docs/learnings.md` | 11 行 pitfall：`future-timestamp-in-interval-store-becomes-ghost-wait` |
| `??` | `01-docs/PLAN-FIX-ACCOUNT-INTERVAL-GHOST-WAIT-2026-10-16.md` | 222 行实施计划（现象/根因/TDD 顺序/验收/环境异常登记） |

该 PLAN 文件末尾自陈「编写会话 pwsh 执行沙箱故障（`SetNamedSecurityInfoW grantWrite` Win32 5），
无法运行 git/测试/PR」——即**内容完整、但编写会话无法提交**，于是留在共享根。

阻塞是如何被触发的：本次会话要建的运行时代码 worktree 被两个正规入口拒绝：

- `scripts/start-mp-task.ps1` → `mp-worktree-health.ps1` 返回 `ok=false`（`clean=False`）
- `scripts/gwm-task.sh`（经 `scripts/session-init.sh <task>`）→
  「主目录 main 存在未提交文件，拒绝创建任务 worktree」（其判据是 `--untracked-files=no`，
  故**已跟踪**的 `learnings.md` 修改是唯一阻塞项，未跟踪的 PLAN 文件不算）

按 AGENTS.md「隔离失败/冲突防坑纪律 A：隔离创建失败 → 立即停、报告用户」，未擅自 `stash`/`reset`，
而是上报用户；用户选择「代为提交、走 docs-only 通道」。本 PR 即该授权的执行。

## 1. 为什么必须先快进，而不是直接提交（这一步是关键）

上报时共享根本地 `main` 落后 `origin/main` **33 个提交**。查证：

```
git log HEAD..origin/main --oneline -- 01-docs/learnings.md
→ 0a0d3581b (#3775)
  7f4a6cc95 (#3772)
  110c3aabb (#3733)
  c2cda02d6 (#3742)
```

上游 **4 个提交**改过同一个文件。若基于滞后的工作副本直接提交，会把那 4 处已合并的改动
**反向撤销**——这正是 AGENTS.md 明写的失效模式（「滞后的工作副本会让 docs PR 反向撤销已合并的那一行」）。

处置顺序（每步都有产物可验）：

1. 备份工作区完整副本 + 11 行 patch 到 `%TEMP%`；
2. `git checkout -- 01-docs/learnings.md`（恢复到旧 HEAD 版本，改动已在第 1 步留底）；
3. `git merge --ff-only origin/main`（快进 33 个提交 → HEAD `036a98176`）；
4. 按**锚点**重放 11 行 —— 锚点取 `### pitfall:mutation-driver-zero-hits-first-prove-the-probe-can-see-red`
   （原始 diff 的上下文显示这 11 行本就插在它前面）。**不用行号**：快进后行号必然偏移
   （原 19881 行 → 现 19966 行）。重放脚本带幂等保护（已存在即 SKIP）与锚点缺失即 fail-closed。
5. 复核：插入位置 19966，`mutation-driver` 顺延到 19976，标题/空行/正文格式与原始 diff 一致。

## 2. 判定证据（docs-only）

```
node scripts/classify-docs-only.js --base=origin/main --head=HEAD
→ docs-only=true
  files=2
  01-docs/learnings.md
  01-docs/PLAN-FIX-ACCOUNT-INTERVAL-GHOST-WAIT-2026-10-16.md
```

（判定必须在 **commit 之后**取证：未提交时 `HEAD==base` ⇒ 空 diff ⇒ 会误报 `docs-only=false files=0`。）

## 3. 保留门禁

- 变更类型与隔离声明：纯文档，就地编辑 + PR 落地，不进 worktree ✅
- 行尾/编码对账：`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致 ✅
- 品牌残留：`node scripts/check-no-brand-residue.js` ✅
- 文档同步（doc-gate）✅
- 本机绝对路径：`node scripts/check-doc-abs-paths.js --all` ✅
- 远程同步：PENDING

| 远程同步 | PENDING |
| --- | --- |

## 4. 范围声明（本 PR 只做搬砖，内容仅一处合规性改写）

本 PR **不修改**那 11 行 pitfall 与 222 行 PLAN 的实质内容，只把它们从共享根工作区搬到远端。

**唯一例外（如实登记）**：PLAN 第 221 行原文含一处本机绝对路径
（`SetNamedSecurityInfoW grantWrite(<本机绝对路径>)`，描述编写会话那次沙箱故障的参数），
会被 `check-doc-abs-paths.js` 判 `1 处 > 基线 0`（Gate 12c）。
按该判据自己给出的正解之一「改写成占位符形态」，已改为 `<仓库根>`，
**语义不变**（仍指仓库根目录），并在该行下方补了一句改写说明。
除这一处外，本文件其余内容原样未动。

若内容需实质修订，属另行立项（该任务 `fix-account-interval-ghost-wait` 的实施仍未开始：
无 worktree、无代码改动、无 PR）。

顺带说明一处环境侧的处置：上报期间发现 2 个越界 worktree 使 health 检查 `$outside.Count -eq 0` 不过
（`<临时目录>/mp-backfill-3776` 已合并属遗留、`<临时目录>/mp-prd-entry-contracts` 是他人活跃的 PR #3785）。
按「不擅动他人工作区」原则**一个都没删**，改用正规登记制环境变量 `MP_ALLOWED_WORKTREES` 豁免
（`mp-worktree-health.ps1` L143-147 原生支持），`outsideWorktrees` 归零。
