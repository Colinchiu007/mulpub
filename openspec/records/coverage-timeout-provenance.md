---
record: coverage-timeout-provenance
task: 把 QG Coverage 的 timeout-minutes 从"无人看管的预算常量"变成有实测分布 + 每次 PR 机械对账的对象，并按规则抬 40→60
date: 2026-10-18
---

## 本次执行记录：QG Coverage 预算取证化（coverage-timeout-provenance，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（`.github/workflows/` + `scripts/` 工具脚本 + 文档）：`classify-docs-only --base=origin/main --head=HEAD` = **false** ⇒ 走完整质量节拍，重型 job 不短路。worktree `mp-coverage-timeout-provenance` + 裸分支 `coverage-timeout-provenance`，由 `start-mp-task.ps1` 创建并过 `verify-worktree-deps`（11 项解析通过）|
| 第一性原因（QM-5 ①） | ✅ | 预算常量与"它够不够"之间**没有任何东西在看**：`timeout-minutes: 40` 自 `052599cbd`（#3313，2026-10-11）那次"job 上限 40→55"的治理中被留在原地——那一次治的是 Gate 4 / shard 的**步级预算对**，`coverage` 作业没有步级预算，于是成了漏网的一格。丢失形态：GitHub 掐掉整个作业 ⇒ 末尾汇总与诊断不写完 ⇒ **main 侧证据永久不可回答**（不是跑挂）。|
| 逃逸分析（QM-5 ②） | ✅ | 逃过了：① CI 全量测试（预算不属任何测试面）；② `workflow-contract.test.js` 类结构锁（它看步骤名与 job 形状，不看数值是否被观测支撑）；③ `gate-budget.js` 既有真源（它的作用域写死在 Gate 4 / shard 两个对象上）。**为什么"看得见"却没拦住**：#3836 那次我读到了 `cancelled` 并归因到 40 分钟天花板，但归因只落在文档里，落不到任何判据上——**读到了 ≠ 有人在守**。同族：「装饰性门禁」（有读数、无 enforcement）。|
| 修复 + 回归保护（QM-5 ④） | ✅ | ①`timeout-minutes: 40 → 60`（= `ceil(39.7 × SAFETY_MULTIPLIER)`，系数 require 自 `scripts/gate-budget.js`，不新写第二个 1.5）；②单点取证 `scripts/lib/coverage-budget-provenance.js`；③可重跑采集 `scripts/coverage-budget-sample.js`；④对账 `scripts/check-coverage-budget.js` 五条判据（UNDER_BUDGET / HUGGING / INSUFFICIENT_SAMPLES / STALE_PROVENANCE / PROVENANCE_VALUE_DRIFT），读不到数值走退出码 2。回归锁 `scripts/check-coverage-budget.test.js` **16 条**，含"改哪格读哪格"的双向对照、截尾 floor 的正/反向对偶、字段同源 parity、漏样可见性。|
| 防止再次发生（QM-5 ⑤） | ✅ | ① Gate 2b7 接线（`changes` 作业、`shell: bash` fail-fast、只用内置模块）；② `check-unwired-tests.js` 实跑（提交后再跑一次作数，`git ls-files` 域）；③ `.gitignore` 补两条 negation（`scripts/*.js` 默认吞新脚本，`git add` 会当场报错）；④ PRD `01-docs/PRD-COVERAGE-TIMEOUT-PROVENANCE-2026-10-18.md`（含"为什么不复用 gate-budget"与"任意 cancelled 无锁可区分"两处诚实边界）；⑤ 记忆更新（预算常量的取证化落点）。|
| 行尾与 diff 对账 | ✅ | 改动文件 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐档相等（以当场打印为准，见提交前自测块）|
| 接线棘轮 | ✅ | 新增 `scripts/check-coverage-budget.test.js` **在同一次改动里**登记进 `quality-gate.yml` Gate 2b7；编号取 2b7 而非 2b5（`#3724` 占用 "Gate 2b5 - CCG evidence anchor"，2b6 已被占）——同号会在 squash 后撞成两步同名|
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何渲染面；改动是 CI workflow 与根级门禁脚本|
| QM-6 CCG 双模型外部评审 | ⚠️ 见下方 QM-6 节 | 规定后端 codex / 前端 claude，替代通道另计；逐条实测读数与处置写在下方，未跑成不写 PASS、不以自审替代 |
| 远程同步 | 由门禁推导 | 本 PR 不手写状态词、不为收口另开 PR（`gate-record-sync-derived-status` / #3879）；合并发生即由 `scripts/lib/merge-ledger.js` 推导收口 |

## QM-6（如实登记）

见本节末尾的通道读数；后端轴与前端轴分别记录"跑了什么、回了什么、哪些采纳哪些拒绝"。

## 自测块（提交前当场跑）

```
node --test scripts/check-coverage-budget.test.js   → tests 16 / pass 16 / fail 0
node scripts/check-coverage-budget.js               → timeout=60 需≥60 floor=39.7 samples=24 ⇒ RC 0
node scripts/coverage-budget-sample.js --limit=60 --ceiling=40 → 60 趟窗口，probe_errors=0
变异反证                                            → 10 道逐条实跑，红集互不相同，10/10 CAUGHT
```
