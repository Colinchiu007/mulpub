---
record: fix-visual-test-red
task: 修复 main 上长期常红的视觉门禁——用例 collection-confirm-dialog 自 2026-10-12 页签重构起漂移，补契约锁防再犯
date: 2026-10-17
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由本会话开回填 PR，把表格行的「远程同步」改成 PASS + merge SHA，并在同一次提交删除本段三个 sync_* 字段
sync_backfill_owner: fix-visual-test-red 会话（本节作者）
---

## 本次执行记录：视觉门禁常红修复 —— 用例漂移一个月 + 契约锁（fix-visual-test-red，2026-10-17）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（测试脚本 + 新增测试文件，`classify-docs-only` 判 false）。worktree `<worktreeRoot>\mp-fix-visual-test-red`（**D 盘**），裸分支 `fix-visual-test-red`。**隔离入口的两个脚本都被共享根脏挡住**（`start-mp-task.ps1` 的 `-RequireClean`、`session-init.sh` 的「主目录存在未提交文件」），脏清单是**他人会话 8 小时前的崩溃残留**（`M 01-docs/learnings.md` + `?? 01-docs/PLAN-FIX-ACCOUNT-INTERVAL-GHOST-WAIT-2026-10-16.md`，该 PLAN 文件自述「在 pwsh 沙箱故障的会话中编写」）。按纪律 A「不手动补救、不触碰他人工作」，改用 `git worktree add` 直接创建（PowerShell 原生 `D:\` 路径，符合规则 B），全程未在共享根落盘、未动那两个文件 |
| 第一性原因（QM-5 ①） | ✅ | **视觉用例相对产品重构漂移，而非产品回归**。用例 `collection-confirm-dialog` 的 `checks` 最后改动于 **2026-09-10**（`d74115388`），断言 `/collection` **默认页签**上有 `.cohere-section-title:has-text("草稿箱")`；而 **2026-10-12** 的 `#3395`（`e39dc0a03`）把「草稿箱」改成**独立页签**，`Collection.vue:516` 明写 `const activeTab = ref('collect')` ⇒ 默认视图里根本没有那个区块标题，用例从那次重构起**恒定失败**。**产品功能本身没坏**：`Collection.test.js` L229/L231 已覆盖「切草稿箱页签 → 点删除」并全绿（110 例） |
| 逃逸分析（QM-5 ②） | ✅ | ①**单元层**：功能有测试且绿，但它测的是「行为」，测不到「视觉用例里的选择器还成不成立」⇒ 漂移对单测不可见。②**视觉层**：整套 `run-all-visual`（4 套 105 例）**只在独立 workflow `visual-test.yml` 里执行**；`quality-gate` 的 `QG Visual` 只跑 `run-pixel-tests.js` 的 **pixelTests 20 例** + 视觉覆盖/选型静态判据（`visual-test.yml` 自己的注释即写明「QG Visual 只跑 pixelTests」）。③**required 层**：分支保护的 required 只有 `Gate Result` / `build` / `QG Unit Tests` / `QG Coverage` —— **`Visual Tests` 不在其中** ⇒ 它红不阻塞任何合并。④**后果实测**：`gh run list --workflow=visual-test.yml --branch main --limit 60` 得 **59 失败 / 0 成功**（最早可查到 2026-10-15 11:15），长期常红 ⇒ 告警疲劳，无人发现「其实只差 1 例」。95 例（105−20 中的非 pixel 部分）长期处于**无 required 面覆盖**状态 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①**修用例**：改用 `trigger: '[data-testid="collection-tab-drafts"]'` + `afterTrigger: '[data-testid="collection-drafts-panel"]'` 先切页签，断言改用稳定的 `data-testid`（`collection-drafts-panel .cohere-section-title`、`collection-drafts-list [data-testid="draft-delete"]` 或 `collection-drafts-empty`），不再依赖随文案变化的 `:has-text("草稿箱")` 与 `.cohere-card-grid`。②**实测**：`run-all-visual` 本地 **105/105 通过**（修前 104/105）；单例 `--single collection-confirm-dialog` rc=0；整套 19/19。③**新增契约锁** `apps/desktop/src/views/collection-visual-case-contract.test.js`（3 例）：锁页签 `data-testid`、锁面板/列表/空态/删除 `data-testid`、锁「用例必须走先切页签形态」且**禁止**再出现旧断言形态 |
| 防止再次发生（QM-5 ⑤） | ✅ | 锁的**发现成本**从「20 分钟视觉作业 × 非 required workflow」降到「秒级单测 × required 桌面分片」——漂移当天就红。变异反证见下行。**未闭合的系统性缺口如实登记**：让 `Visual Tests` 的 checks 型用例进入 required 面属「改谁来守门」，按 AGENTS.md 必须人工过目，本会话**不擅自改**（见「遗留」） |
| 变异反证 | ✅ **1/1 CAUGHT**（正控 GREEN、还原逐字节 IDENTICAL） | M1：删掉用例里的 `trigger:` 行（回到「不切页签直接断言」形态）⇒ 契约锁 ③ **当场红**（`Tests 1 failed \| 2 passed`），指名失败即该条；还原后复跑 `Tests 3 passed`，还原字节一致=True。证实锁不是装饰 |
| 行尾与 diff 对账 | ✅ | `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` **两侧逐值相等**：新增 `collection-visual-case-contract.test.js` **74/0**、修改 `supplementary-views.visual.test.js` **16/2**。删除的 2 行是旧的两条 `check(...)` 断言（被新的 data-testid 断言替换），归因明确 |
| 接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` → **rc=0**「检查域内测试文件 91 个 / OK: 全部测试均已接线或按欠账登记」（新文件在 `src/**/*.test.js` 域内，由 vitest include 覆盖、随 required 的桌面分片执行，无需改 workflow） |
| 相关域全量 | ✅ | `vitest run src/views/Collection.test.js src/views/collection-visual-case-contract.test.js` → **110 passed（2 文件）**；`eslint` 对两个改动/新增文件 **0 error** |
| QM-1 打包 | N/A | 未触碰 `apps/desktop/electron/` 与 `packages/rpa-engine/`，无主进程/打包面变化 |
| QM-4 视觉 | ✅ | 本轮**就是**视觉门禁本体：`run-all-visual` 四套 105/105 通过（`suites=4 total=105 passed=105 failed=0 aborted=0`，rc=0），逐套 `views 37/37`、`supplementary-views 19/19`、`workflows 31/31`、`supplementary-workflows 18/18`。本地口径 `PIXEL_THRESHOLD=0.06` 与 CI 一致 |
| QM-6 CCG 双模型外部评审 | 见判定器 | 提交时由 `scripts/ccg-review-decider.js` 按改动量与敏感面判定 single/dual；结果以 `.ccg/reviews/<sha>.json` 产物为准（不在本文手写结论） |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin fix-visual-test-red` 返回 0 行证远端分支已删；回填后删除上方三个 sync_* 字段 |

### 遗留（不假装已闭合）

1. **系统性缺口未修，只登记**：105 例视觉用例中约 85 例的 `checks`/聚合套件只跑在**非 required** 的 `Visual Tests` workflow 上；`quality-gate` 的 `QG Visual` 只覆盖 pixelTests 20 例 + 静态判据。**让这些用例进入 required 面属于「改谁来守门」**（改 `.github/workflows/` 的分支保护/required 集合），按 AGENTS.md「禁止自动合并的情形」必须人工过目，本会话不擅自实施。**需要用户决策：是否把 `Visual Tests` 提为 required check，或把 `run-all-visual` 接进 `quality-gate`。**
2. **本条修复的实际效力有前提**：只有在 `Visual Tests` workflow 本体重跑并绿之后，main 的这条红才会消失。PR 合并后须回读该 merge SHA 上 `visual-test.yml` 的 push run 结论（不得只看 PR 侧）。
3. **未做的事**：没有用 `--update-baseline` 刷新任何基线（禁止掩盖）；105 例里其余 104 例本轮一次通过，说明基线本身没坏，坏的只有这一条用例的选择器。
