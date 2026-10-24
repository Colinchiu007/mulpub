# Change: gate-timeout-coverage-72

## Why

`QG Coverage` 的作业级 `timeout-minutes` 停在 **65**，而实测**同口径 120 趟窗口重采样**给出的 `required` 是 **72**
（`floor = 47.37` 分、`ceil(47.37 × 1.5) = 72`）。也就是说：

- 按 `scripts/check-coverage-budget.js` 的 `UNDER_BUDGET` 判据（`timeout < ceil(floor × 1.5)`），
  **timeout=65 本身就已经不满足预算** ⇒ 这一格处于**欠账**状态；
- `timeout-minutes` 是 GitHub 侧**硬上限**：一旦作业跑满 65 分钟被 kill，**该次运行的证据永久丢失**。
  仓内已发生过同类事故（`gate-timeout-all-cells` 记的两趟 main push 恰好停在 40.0 分钟）。

同时实测发现注册表与代码路径上有 **10 处指向不存在的脚本的坏指针**
（`gate-timeout-sample.js` / `check-gate-timeouts.js`）—— 其中 `scripts/coverage-budget-sample.js:309`
是**采集器实际输出**里的一处 ⇒ 任何按它刷新注册表的流程都会把坏指针原样写回去。

## What Changes

- `.github/workflows/quality-gate.yml`：`QG Coverage` 的 `timeout-minutes` **65 → 72**。
  取 72 而非 70：仓内惯例是 timeout 恰好等于 `ceil(max × 1.5)`，且 72 **恰等于** required，不多给也不欠账。
- `scripts/gate-timeout-registry.json`：coverage 条目的 `timeoutMinutes` 改 72，provenance 换成
  **120 趟窗口同口径重采样**的真实分布（`maxMinutes=47.37` / `p90Minutes=45.27` / `samples=51` /
  `ceilingMinutesSampled=72` / `collectedAt=2026-10-24`）。
- **修掉代码路径上的 10 处坏指针**（注册表顶层 note、schedule-heartbeat 条目 note、加载器 `remeasureCommand`、
  采样器注释 3 处 + 采样器实际输出 1 处、判据提示文案 2 处、锁注释 1 处），全部指向真实存在的
  `scripts/coverage-budget-sample.js` / `scripts/check-coverage-budget.js`。
- 同步 `01-docs/PRD-GATE-TIMEOUT-GOVERNANCE-2026-10-20.md` 的数值表。

## Impact

- **治理面**：仅 `QG Coverage` 一格的作业级 `timeout-minutes`，无产品代码改动、无运行时行为改动。
- **CI 时长**：8 个重型作业同层并行、全部只 `needs: [changes]`、互不依赖 ⇒ 抬 coverage 的 timeout
  **不改变任何其他作业的排队**；`timeout-minutes` 是**天花板不是延时**（该作业实测约 47 分钟）。
  最坏情况只有 coverage 一个作业在跑，只把 gate-result 的等待从 65 分推到最多 72 分（**+7 分**），
  runner 槽位占用上限 +10.8%。
- **残留**：`openspec/` 里有 3 处坏指针（`records/schedule-heartbeat-lock.md:61,70` +
  `changes/schedule-heartbeat-lock/tasks.md:100`）—— 那是**在途 change 的任务清单与历史执行记录**，
  不构成代码路径坏指针，**本 change 不改**（改它会污染在途 change 的历史），已登记，等该 change 自己收口时订正。
- **归档**：本 change 合并后归档至 `openspec/changes/archive/2026-10-25-gate-timeout-coverage-72/`
  （specs 侧不落同名目录，与近期几笔先例一致）。
