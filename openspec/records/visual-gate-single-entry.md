---
record: visual-gate-single-entry
task: 视觉覆盖面平价锁——run-all-visual 的注册表与 QG Visual 的接法表绑成一对，新增套件漏接当场红
date: 2026-10-17
---

## 本次执行记录：视觉覆盖面平价锁（visual-gate-single-entry，2026-10-17）【混合 PR · 只加锁】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（只改 `.github/scripts/workflow-contract.test.js`，**不改任何 workflow 行为**）。worktree `<worktreeRoot>\mp-visual-gate-enforce`（D 盘）内新分支 `visual-gate-single-entry`，基线 `origin/main`。隔离入口仍被他人会话的历史崩溃残留挡住（`-RequireClean`），按纪律 A 不触碰他人工作、复用既有 worktree，共享根未落盘 |
| 第一性原因（QM-5 ①） | ✅ | **同一个覆盖面存在两条真源，且没有平价约束**。真源 A：`tests/visual-testing/scripts/run-all-visual.js` 的注册表（4 个 `require`，即四套 105 例）。真源 B：`quality-gate.yml` Gate 7 里的**逐套命令调用**（因为要保每个套件的退出码语义与重跑粒度，见下行）。两者靠人工同步 ⇒ 2026-10-17 之前漏了 `workflows` + `supplementary-workflows` 共 **49 例**（PR 侧零覆盖），且没有任何判据会因此变红 |
| 逃逸分析（QM-5 ②） | ✅ | ①**无锁**：改 `run-all-visual.js` 注册表不会红任何测试；改 `quality-gate.yml` 接法表也不会红。两侧各自都"看起来完整"。②**注释误导**：`visual-test.yml` 注释称「与 QG Visual 是逐行同构的重复实现」，据此会推断 PR 侧已全覆盖——那句话只对 56 例成立（本轮我本人踩过，已在 #3800 记录里更正）。③**作业层**：`quality-gate.yml` 里 `test:workflow` 系列零命中，属"接线漏了一类套件"，不是判据写错 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增锁 `QG Visual 的套件接法表必须与 run-all-visual 的注册表平价`：①从 `run-all-visual.js` **解析**出注册的套件集合（解析式判据先断言命中数 ≥4，防"0 条 ⇒ 全通过"的假绿）；②按显式映射表 `模块 → package 脚本` 逐套要求 Gate 7 里出现对应命令；③**词边界匹配**（`test:visual` 是 `test:visual:supplement` 的前缀，裸 `includes` 会假绿）。注册表多一套而接法表没跟上 ⇒ 当场红并给出可执行提示 |
| **明确未做（并说明理由）** | ✅ 决策留档 | 用户要求「把 `run-all-visual` 接进 QG Visual」。核对后**不做字面版本**，因为它会同时丢掉三样东西：①**退出码语义**——`run-all-visual.js` 只输出 0/1（`process.exitCode = failed>0||aborted>0 ? 1 : 0`），而 Gate 7 必须保住「3=视图从未渲染出来 ⇒ 当场 `exit 3`」这个区分；②**重跑粒度**——失败时只能整套重跑（四套约 86 秒本地实测），而不是只重跑失败那一套（约 20–30 秒）；③**不省成本**——它仍要跑完四套，`run-all-visual` 唯一能带来的额外收益是"新增套件自动被纳入"，而这一条**由本锁精确替代**（变异 M2 已证）。⇒ 用锁拿收益、不付上述三项代价 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①上述平价锁（新增套件必须同时接进 Gate 7 并登记映射，否则红且提示原因）。②失败信息直接写出"该套件在 PR 侧会静默零覆盖"，把后果写在报错里而不是只写在文档里。③"别按注释推理、按注册表逐项对齐"写进本条记录与 `#3800` 记录，作为同一类错误的两次留档 |
| 变异反证 | ✅ **2/2 CAUGHT**（正控 GREEN、每次还原逐字节 IDENTICAL） | **M1**：删掉 QG Visual 对 `test:workflow` 的调用 ⇒ `not ok 39 - QG Visual 的套件接法表必须与 run-all-visual 的注册表平价`（38 pass / 1 fail），还原 qg 字节一致=True。**M2**：给 `run-all-visual.js` 注册第 5 套（`views/fake-new`）⇒ 同一锁红，报错原文「run-all-visual 注册了套件「views/fake-new」，但 QG Visual 的接法表没有它 —— 该套件在 PR 侧会静默零覆盖。请同时在 quality-gate.yml 接上、并在此登记映射。」；还原 rn 字节一致=True。还原后复跑 39/39 绿 |
| 相关域全量 | ✅ | `node --test .github/scripts/workflow-contract.test.js` → **39 pass / 0 fail**（含新锁；该测试用 js-yaml 解析两份 workflow，等于顺带验证 YAML 合法） |
| 行尾与 diff 对账 | ✅ | `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` **两口径逐值相等**：`workflow-contract.test.js` **49/0**、`openspec/records/visual-gate-single-entry.md` **33/0**（两文件均纯追加，零删除） |
| 接线棘轮 | ✅ | 改的是既有测试文件（非新增），仍在原接线面上；`workflow-contract.test.js` 由 `quality-gate.yml` 显式点名执行 |
| QM-1 打包 | N/A | 未触碰 `apps/desktop/electron/` 与 `packages/rpa-engine/` |
| QM-4 视觉 | N/A（不改判据/不改基线） | 本 PR 只加一条结构锁，**不改任何 workflow 行为、不新增执行步骤**；未使用 `--update-baseline` |
| QM-6 CCG 双模型外部评审 | 见判定器 | 以 `.ccg/reviews/<sha>.json` 产物为准 |
| 远程同步 | PASS | PR #3804 已 squash 合并，merge SHA `ce3f25cdf8d0deb166d9ec445902c386f1d1a3d4`（2026-10-17T15:16:27+08:00）；远端分支 `visual-gate-single-entry` 已删（`git ls-remote --heads` 0 行）；`git log origin/main --grep='(#3804)$'` 恰好 1 行；frontmatter 的 `sync_*` 三字段已在本次提交删除（本记录无 ledger 登记项） |

### 遗留（不假装已闭合）

1. **用户要求的字面版本未实施**：见「明确未做」一行，三项代价都是实测口径（`run-all-visual.js:152` 的源码、本地四套耗时）。若用户在看过代价后仍要字面版本，可另开一轮：需同时改 `run-all-visual.js` 把每个套件的退出码（尤其 3）传导出来，否则会丢掉就绪超时的当场拦截。
2. **本 PR 不改变任何 PR 的 CI 行为**（只加锁），因此不存在新增耗时。
3. **平价锁的边界**：它保证「注册表里的每一套都被 Gate 7 调用」，**不**保证「Gate 7 里没有多余调用」（多调一套不会红）。这条边界是本轮的有意取舍——多调不会造成零覆盖，属性能问题而非覆盖缺口。
