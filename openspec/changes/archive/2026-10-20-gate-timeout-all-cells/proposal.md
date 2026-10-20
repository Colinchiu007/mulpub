# Change: gate-timeout-all-cells

## Why

`timeout-minutes` 是无对账的预算常量。实测它撞死过两趟 main push（`39037127191`、`39084091986`，都恰好停在 40.0 分钟），
后果是 **main 侧证据永久丢失**。2026-10-18 起只治理了 `QG Coverage` 一格；全仓实测共 **24 格**分布在 11 个 workflow，
其余 23 格仍无人看管 —— 同型隐患只是还没发生。

## What Changes

- 新增数据单点 `scripts/gate-timeout-registry.json`：24 格全部登记，逐格带可重跑的实测分布（samples/max/p90/截尾/窗口/采集日）。
- 新增加载器与严格校验 `scripts/lib/gate-timeout-registry.js`（只用 node 内置模块；坏数据 fail closed）。
- `scripts/check-coverage-budget.js` 从"守一格"扩成"守全部"：逐格规则 + **清单棘轮**
  （`UNREGISTERED_TIMEOUT_CELL` / `MISSING_TIMEOUT_CELL`）+ `seeded` 双向规则（`SEEDED_STALE` / `SEEDED_EXPIRED`）。
- `scripts/coverage-budget-sample.js` 从"量一格"扩成"量任意格/全仓"：矩阵后缀归并、模板名前缀归并、在飞与漏样分离、零样本出声。
- `scripts/lib/coverage-budget-provenance.js` 降为**转发 shim**（不持有数值），保证既有消费者（`gate-budget.test.js`）零改动继续工作。

## Impact

- 治理面：24 格作业级 `timeout-minutes`；步级（2 格）显式列出但不纳入。
- 本片**不改任何 timeout 数值**：24 格当前全部满足 `timeout ≥ ceil(max × 1.5)`。
- 落点：`quality-gate.yml` 的 `changes` 作业（Gate 2b7），判据只用 node 内置模块。
- 新增 6 条回归锁（17–22），既有 20 条一条不动。
