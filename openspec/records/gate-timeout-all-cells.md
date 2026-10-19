---
record: gate-timeout-all-cells
task: 全仓 24 格 CI 作业超时常量纳入取证治理（数据单点 + 清单棘轮 + seeded 宽限期），并把采样器扩成全仓可重跑
date: 2026-10-20
---

## 本次执行记录：全仓超时常量取证治理（gate-timeout-all-cells，2026-10-20）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 改动集：`scripts/lib/gate-timeout-registry.js`（A）、`scripts/gate-timeout-registry.json`（A）、`scripts/check-coverage-budget.js`（M）、`scripts/coverage-budget-sample.js`（M）、`scripts/check-coverage-budget.test.js`（M）、`scripts/lib/coverage-budget-provenance.js`（M→shim）、`.github/workflows/quality-gate.yml`（M）、`01-docs/PRD-GATE-TIMEOUT-GOVERNANCE-2026-10-20.md`（A）、`openspec/changes/gate-timeout-all-cells/**`（A）。含 CI 变更 ⇒ **不走 docs-only 通道**。隔离 worktree `mp-worktrees/mp-gate-timeout-governance`，裸分支 `gate-timeout-governance`，基线 `origin/main@c79527117` |
| 第一性原因（QM-5 ①） | ✅ | 2026-10-18 只治理 `QG Coverage` 一格（因它撞死过两趟 main push、丢的是证据不是绿勾）。但**全仓实测 24 格**分布在 11 个 workflow，其余 23 格是同一失败模式的未爆弹：无对账的预算常量 + 作业随仓库变慢 ⇒ 撞死 ⇒ 静默丢证据。根因不是"数字不对"，而是**没有清单** —— 治理面靠人记，就必然只覆盖"出过事的那一格" |
| 逃逸分析（QM-5 ②） | ✅ | ①**发现层**：无任何机械清单枚举 `.github/workflows/*.yml` 的 `timeout-minutes`，所以"还有没有别的格子"只能靠人想起来（本会话先前也只报了 quality-gate.yml 的 9 格，实际全仓 24 格 —— 当场被自己的扫描器纠正）；②**新增层**：任何人今天新增一个 `timeout-minutes: 7` 都不会红；③**漂移层**：即使登记了，作业变慢到不够用也没有触发点（只有那一格有人看）；④**解析层**：`electron-ci.yml` 的 `electron-tests` 作业级 70、步级 10 —— 用 `^\s+timeout-minutes:` 收会把 70 读成 10，对一格**合规**作业报 `UNDER_BUDGET`（假违规与假绿同害） |
| 修复 + 回归保护（QM-5 ④） | ✅ | 数据单点 `gate-timeout-registry.json`（24 条：12 measured / 12 seeded）+ 加载器严格校验 + 判据扩成"逐格 + 清单棘轮 + seeded 双向" + 采样器扩成全仓可重跑。回归保护：锁 20 → **26**（新增 17 棘轮①/18 棘轮②/19 缩进纪律/20 seeded 双向/21 校验器 8 道负控/22 真实仓全量自证），既有 20 条一条不动；`node --test scripts/check-coverage-budget.test.js` → **26/26 pass** |
| 防止再次发生（QM-5 ⑤） | ✅ | ①**棘轮**把"新增裸常量"和"登记项消失"变成当场红，治理面不再依赖人记；②`seeded` 双向规则禁止把宽限期当永久豁免（攒够了不升级也红）；③缩进纪律上锁（19 号）挡住"步级值冒充作业级"这类假违规；④注册表校验器 8 道负控（21 号）挡住"半份注册表以合法外表继续放行"；⑤PRD §8/§9 写入四步操作手册与全部遗留 |
| 行尾与 diff 对账 | ✅ | 全变更集 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐文件相等（见「行尾两口径」段） |
| 接线棘轮 | ✅ | 未新增 `*.test.js`（沿用已接线的 `scripts/check-coverage-budget.test.js`）；`quality-gate.yml` changes 作业 Gate 2b7 本步扩范围（判据 + 锁两行），`node scripts/check-unwired-tests.js` 读数见下 |
| QM-1 打包 / QM-4 视觉 | N/A | 改动集零 `apps/desktop/electron/**`、零 `packages/rpa-engine/**`、零 UI/样式 ⇒ 打包与像素门禁**不适用**（不是"跑了通过"） |
| QM-6 CCG 深度评审 | 由判定器逐笔判 | 本片按文件边界拆成多笔提交，每笔代码改动 ≤200 行；判定器逐笔给出 `mode`（见 PR 内各 `.ccg/reviews/*.json`）。**不预写结论** |
| 远程同步 | 由门禁推导 | 合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导收口；main push 回读证据写在 PR 评论里 |

### 本轮实测（改数依据，可重跑）

```
# 逐 workflow 采集（30 趟/工作流；两处补采 60 趟），probe_errors=0
# 全仓 24 格：无一 UNDER_BUDGET
node scripts/check-coverage-budget.js
→ [GATE-TIMEOUT] OK 全部 24 格与注册表同源、都满足规则①，且清单棘轮通过（无未登记、无消失）   rc=0
```

| 最紧的几格 | 天花板 | 需 ≥ | 余量 |
|---|---|---|---|
| `quality-gate.yml#coverage` | 65 | 65 | **0** |
| `autonomous-loop.yml#loop` | 30 | 27 | **3** |
| `quality-gate.yml#changes` | 5 | 2 | 3 |
| `debt-guard.yml#debt-guard` | 5 | 2 | 3 |
| `quality-gate.yml#static-gates` | 15 | 12 | 3 |
| `quality-gate.yml#autonomous` | 15 | 11 | 4 |

**本片不改任何 timeout 数值**：24 格当前全部满足 ×1.5 规则，缺的是机制而不是数字。

### 采集口径（三个必须分开的类别）

- **在飞**（`status != completed`）：不是漏样、不是样本，单列 `in_flight=`。
- **真漏样**（已完成却无时长）：`rc=2` 拒绝出数。
- **零样本**（窗口内无成功样本）：明确打印"没采到"，`rc≠0`，不得返回空表让人读成"没有长尾"。
- 矩阵作业（`QG Desktop Shards (1/2)`）去后缀归并；模板名（`Autonomous Loop (迭代 3 轮)`）按注册表 `samplerPattern` 前缀归并。
  这两类不归并就会被读成"没有样本"。

### 遗留（不假装已闭合）

- **12 格仍 `seeded`**（样本 <20）：`build`、`clock-shift-oracle`、`electron-tests`、`gui-gate-result`、`gui-test`、`QG Static`、
  `QG Unit Tests`、`QG Visual`、`QG Browser E2E`、`QG Autonomous`、`QG Business API Postgres`、`Gate Result`。
  规则①已被强制，规则②靠 30 天宽限期收敛；到期不足 ⇒ `SEEDED_EXPIRED` 红。宽限期是"允许现在不够"，不是"永远不用够"。
- **步级 `timeout-minutes`（2 格）不在治理面**：显式列出但未纳入；纳入需要另一套规则（步内预算 + 前置开销）。
- **`censoredAtCeiling` 全 0**：24 格在当前天花板下都没有贴脸被杀的本窗口证据 ⇒ "够不够"仍只有 ×1.5 公式一个依据。
- **执行体文件名沿用 `coverage-budget-*`**：就地扩成 24 格；重命名会让单笔改动超 CCG 200 行阈值（实测改后 382 行 vs 原 191 行，
  git 判成 D+A 共 573 行）。新东西已用准确名字（`lib/gate-timeout-registry.js` + `gate-timeout-registry.json`），
  重命名留作一次独立的纯 `git mv` 小提交（0 逻辑改动）。
- **`MIN_SAMPLES` 与另外三个"=20"** 同值不同事，显式不许统一。
