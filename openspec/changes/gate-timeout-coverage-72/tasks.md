# Tasks: gate-timeout-coverage-72

> 说明：本 change 的任务全部已完成并落盘；`- [x]` 复选框保持勾选态（`scripts/openspec-sync-check.js` 的
> `ACTIVE_CHANGE_TASKS_INCOMPLETE` 判据对**在途** change 要求无未完成项）。

## 1 取数与定数

- [x] 用 `scripts/coverage-budget-sample.js` 对 `QG Coverage` 做 **120 趟窗口同口径重采样**，产出 `max=47.37` / `p90=45.27` / `samples=51` / `ceilingMinutesSampled=72`
- [x] 依 `UNDER_BUDGET` 判据复算 `required = ceil(floor × 1.5) = 72`，确认旧值 65 处于欠账状态
- [x] 确认 `HARD_RATIO=0.9` 仅用于 `HUGGING`，不作为「余量为 0」的依据；确认 72 不构成贴脸（`47.37 < 64.8`）
- [x] 确认 timeout 取 **72**（恰等于 required；70 不满足 `timeout ≥ 72`）

## 2 改数据与工作流

- [x] `scripts/gate-timeout-registry.json` 的 coverage 条目：`timeoutMinutes` 改 72，provenance 换真实重采样值
- [x] 该文件用**文本级最小替换**改写（定位单行后替换），diff 保持 3 行而非 `json.dumps` 重写的 430 行噪音
- [x] `.github/workflows/quality-gate.yml`：`QG Coverage` 的 `timeout-minutes` 65 → 72
- [x] 同步 `01-docs/PRD-GATE-TIMEOUT-GOVERNANCE-2026-10-20.md` 的数值表

## 3 修坏指针（代码路径 10 处）

- [x] 注册表顶层 note 1 处、注册表 schedule-heartbeat 条目 note 1 处
- [x] 加载器 `scripts/lib/gate-timeout-registry.js` 的 `remeasureCommand` 1 处
- [x] 采样器 `scripts/coverage-budget-sample.js` 注释 3 处 + **实际输出** 1 处
- [x] 判据 `scripts/check-coverage-budget.js` 提示文案 2 处、锁注释 1 处
- [x] 逐处指向真实存在的 `scripts/coverage-budget-sample.js` / `scripts/check-coverage-budget.js`
- [x] 残留 3 处（`openspec/` 内，在途 change 的任务清单与历史记录）**不改**，登记为待该 change 收口时订正

## 4 门禁与验证

- [x] `node scripts/check-coverage-budget.js` 25 格全绿
- [x] `node scripts/check-coverage-budget.test.js` **26/26**（含 provenance 字段集 parity 锁）
- [x] `node scripts/check-text-encoding-integrity.test.js` 5/5、`node scripts/check-doc-abs-paths.test.js` 52/52
- [x] `node scripts/check-unwired-tests.test.js` 39/39、`node scripts/check-schedule-heartbeat.test.js` 16/16
- [x] `node scripts/check-gate-record-debt.test.js` 122/122、`node scripts/check-max-lines.js` 绿、`node scripts/check-debt-budget.js` 绿
- [x] `node scripts/qm1-child-env.test.js` 7/7、`node scripts/qm1-paths.test.js` 10/10（QM-1 佐证）
- [x] `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ `docs-only=false`（混合 PR，跑完整节拍）
- [x] 落盘后查 U+FFFD 与 CRLF 零污染
- [x] 提交用**明确文件清单**（禁 `git add -A`，编码门禁会留 `01-docs/__encoding-gate-mutation-probe.md` 残渣）
- [x] 执行记录写 `openspec/records/gate-timeout-coverage-72.md`（状态列写「由门禁推导」）

## 5 收口

- [x] 建 openspec change（四件套：proposal / design / tasks / specs）
- [x] 多轨独立审查（量化 / 门禁 / 契约安全 / 流程 CI / 对抗性红队），结论逐条回源码与实跑复验
- [x] 合并后归档至 `openspec/changes/archive/2026-10-24-gate-timeout-coverage-72/`
