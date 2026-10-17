---
record: visual-gate-full-coverage
task: 把 49 例视觉用例补进 QG Visual——workflows / supplementary-workflows 此前在 PR 侧零覆盖，并统一四套的两轮甄别阻断
date: 2026-10-17
---

## 本次执行记录：补齐 QG Visual 的 49 例覆盖缺口（visual-gate-full-coverage，2026-10-17）【混合 PR · 改守门面】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（`.github/workflows/quality-gate.yml` + `.github/scripts/workflow-contract.test.js`），`classify-docs-only` 必判 false。worktree `<worktreeRoot>\mp-visual-gate-enforce`（D 盘，复用上一轮 worktree 内的新分支 `visual-gate-full-coverage`，基线 = `origin/main`），隔离入口仍被他人会话的历史崩溃残留挡住（`-RequireClean`），按纪律 A 不触碰他人工作、改用 `git worktree add` 建立的既有 worktree，共享根未落盘 |
| 第一性原因（QM-5 ①） | ✅ | **105 例的覆盖面从来没有对齐过**：拆开看 `views 37 + supplementary-views 19 + workflows 31 + supplementary-workflows 18 = 105`；而 `QG Visual`（PR 侧唯一会跑视觉套件的作业）只调 `test:visual` 与 `test:visual:supplement` ⇒ 只覆盖 **56 例**；另外 **49 例**（`workflows` / `supplementary-workflows`）**只**在 `visual-test.yml` 的 `run-all-visual` 里跑，而那个 workflow 自 2026-09-17「CI 提速」起**没有 `pull_request` 触发**（判据：`on:` 下只有 `push: branches:[main]` + `workflow_dispatch`）⇒ 这 49 例在 PR 侧**根本没有执行**。上一轮（#3787）修的是「跑了但失败被吞」，本轮补的是「**根本没跑**」这另一半 |
| 逃逸分析（QM-5 ②） | ✅ | ①**作业层**：`quality-gate.yml` 的 `visual` job 里只有两个 checks 套件的调用，`test:workflow` / `test:workflow:supplement` 一次都没出现（判据：grep 全文件零命中）⇒ 不是判据写错，是**接线漏了一类套件**。②**workflow 触发层**：`visual-test.yml` 只 `push: main` + dispatch，PR 上零执行。③**required 层**：required 集合是 `Gate Result`/`build`/`QG Unit Tests`/`QG Coverage`，不含那个 workflow。④**认知层**：`visual-test.yml` 的注释自称「与 QG Visual 是逐行同构的重复实现」，这句话**只对 56 例成立**；照它推理会得出「PR 侧已全覆盖」的假结论——上一轮我本人就据此写错过一次，本轮用「按套件名逐一对齐」取代「按注释推理」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①`quality-gate.yml` Gate 7 在暗档套件之后新增两套：`test:workflow`（31 例）、`test:workflow:supplement`（18 例），退出码 `$workflowsExit` / `$workflowsSuppExit` 逐条打印进 `[GATE-7] suite exits:` 那一行。②两套同样接入**两轮甄别阻断**：非零当场重跑一次，两次都非零才进 `$checksFailSuites`，最终 `exit 1` 点名「校验型断言两次均失败」——与 #3787 立下的四套口径一致（现在四套全部在列）。③**没有**搬 `run-all-visual` 整只进来：那会把已跑的 56 例再跑一遍并重复付 Playwright 安装 / `build:vue` / 起 Vite 的准备成本。④结构锁从两套扩到四套：`workflow-contract.test.js` 现在逐套断言「非零必重跑 → 两次都非零才入名单」，并断言四套命令**确实出现在 Gate 7 里**（防止守卫分支变成从没执行过的死代码） |
| 防止再次发生（QM-5 ⑤） | ✅ | ①**机械锁**：四套 × 三个结构事实（重跑在分支内、`$checksFailSuites += '<label>'`、命令真的被调用）——少任意一套或写成「一次就红」都当场变红（变异 M1 已实证）。②**把「按注释推理」这个错误换成可机械核对的判据**：锁里逐个列名四套，新增套件必须同步登记，否则「新增了却没人跑」会被这条锁暴露。③**注释写清 49/56 的拆分与理由**，避免下一个人再据「逐行同构」得出全覆盖的假结论 |
| 变异反证 | ✅ **1/1 CAUGHT**（正控 GREEN、还原逐字节 IDENTICAL） | M1：删掉 `workflows` 两套的重跑+阻断块 ⇒ 扩展后的锁**当场红**（`not ok 38 - QG Visual 的校验域套件（views / views-supplement / workflows / workflows-supplement）失败必须阻断`，37 pass / 1 fail）；还原后复跑 38/38，还原字节一致=True |
| 相关域全量 | ✅ | ①`node --test .github/scripts/workflow-contract.test.js` → **38 pass / 0 fail**（该测试用 js-yaml 解析两份 workflow，等于顺带验证新 YAML 合法）。②**新增的两套本地真跑**（起真实 Vite :5174、`PIXEL_THRESHOLD=0.06` 与 CI 同口径）：`test:workflow` → `工作流结果: 31/31 通过，0 失败`、`rc=0`；`test:workflow:supplement` → `rc=0`。⇒ 新步骤不会把 main 弄红 |
| 行尾与 diff 对账 | ✅ | `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` **两口径逐值相等**：`workflow-contract.test.js` **19/2**、`quality-gate.yml` **33/1**、`openspec/records/visual-gate-full-coverage.md` **33/0**。`quality-gate.yml` 删的 1 行是旧 `suite exits` 打印行（被加了两个套件的新版本取代），`workflow-contract.test.js` 删的 2 行是两套版本的 `test(...)` 标题与循环头（被四套版本取代） |
| 接线棘轮 | ✅ | 改的是既有测试文件（非新增），仍在原接线面上；`workflow-contract.test.js` 由 `quality-gate.yml` 显式点名执行 |
| QM-1 打包 | N/A | 未触碰 `apps/desktop/electron/` 与 `packages/rpa-engine/` |
| QM-4 视觉 | N/A（不新增判据/不改基线） | 本 PR 只改「哪些套件在 PR 侧被执行」，不改任何用例、基线或阈值；**未使用 `--update-baseline`** |
| QM-6 CCG 双模型外部评审 | 见判定器 | 以 `.ccg/reviews/<sha>.json` 产物为准 |
| 远程同步 | PASS | PR #3800 已 squash 合并，merge SHA `96ed8171139706364699673cb37c6e3f009cb8f8`（2026-10-17T14:06:16+08:00）；远端分支 `visual-gate-full-coverage` 已删（`git ls-remote --heads` 0 行）；`git log origin/main --grep='(#3800)$'` 恰好 1 行；frontmatter 的 `sync_*` 三字段已在本次提交删除（本记录无 ledger 登记项） |

### 遗留（不假装已闭合）

1. **⛔ 本 PR 属「改谁来守门」**：改的是 `quality-gate.yml` 的 Gate 7 判定面与覆盖集合，按 AGENTS.md 不得由 agent 自动合并，必须人工过目。
2. **长期成本**：合入后**每个 PR** 的 `QG Visual` 会多跑 49 例（本 PR 未预先声称具体秒数，以合入后实跑为准）。这是对**所有 PR 长期生效**的改动，不是只作用于本 PR。
3. **`visual-test.yml` 仍是 main 侧二次信号**：它的 `run-all-visual` 与本 job 现在覆盖同一 105 例，属**有意保留的重复**（它多跑一遍的收益是「代码默认 readiness 超时」这条路径，注释有记载）。**未**把它加回 `pull_request` 触发、**未**改动分支保护 required 集合——那两件事属另一档决策。
4. **端到端阻断仍只能由下一次真实失败证明**：本轮证据是结构锁 + 变异反证 + 本地真跑绿；伪造失败用例去跑真门禁会改用例/基线、反而制造噪声，故未做。
