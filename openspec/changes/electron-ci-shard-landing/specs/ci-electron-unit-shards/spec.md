# ci-electron-unit-shards Specification

## ADDED Requirements

### Requirement: 桌面单测整轮按分片执行

Electron CI 作业 SHALL 把 main push 上的**整轮**桌面单测（单 worker 串行、确定性）按 `--shard`
切成**恰好 4 片**并行执行，作业 id 为 `electron-tests-shards`，matrix 为 `shard: [1,2,3,4]`。

分片 SHALL 保留原整轮的确定性参数（`--maxWorkers=1`、`--no-file-parallelism`、`--reporter=verbose`、
三个 timeout 参数），SHALL 附加 `--shard=<i>/<total>`。`fail-fast` SHALL 为 `false`（任一片失败不取消其余片，
否则拿不到"哪几片红"）。

分片作业 SHALL 只在**非 PR 事件**运行（PR 上同一批桌面测试由 `quality-gate.yml` 的 `desktop-shards`
承担，重复执行即浪费，且是 N 份 setup），该条件 SHALL 以**字面量**写出。

#### Scenario: 整轮被切成 4 片并行跑

- **WHEN** 读 `.github/workflows/electron-ci.yml` 的分片作业
- **THEN** 作业 id 为 `electron-tests-shards`，`strategy.matrix.shard` 恰为 `[1,2,3,4]`
- **AND** `strategy.fail-fast` 为 `false`
- **AND** 单测步的命令含 `--shard=${{ matrix.shard }}/${{ strategy.job-total }}`
- **AND** 单测步仍含 `--maxWorkers=1`、`--no-file-parallelism`、`--reporter=verbose`
  （确定性语义与「main 侧第二次独立运行」的 flake 检出原意都不丢）

#### Scenario: 分片只在非 PR 事件跑

- **WHEN** 读分片作业的 job 级 `if`
- **THEN** 它同时含 docs-only 短路条件与字面量 `github.event_name != 'pull_request'`
- **AND** PR 上该作业整片跳过（不白付 N 份 setup），PR 的桌面测试仍由 `desktop-shards` 承担

### Requirement: 单片预算挂单片实测且不高于旧整轮墙

单片步骤的 `timeout` 预算 SHALL 挂在**单片实测**上：整轮步骤级实测 ÷ 片数，再留负载余量。
单片预算 SHALL **低于**它取代的现行整轮预算 2100s，且 SHALL 低于原始 `timeout(1)` 魔数 1200s
（否则是"抬预算的包装"而不是分片），且 SHALL 不高于整轮当前实测 1759s。

分片作业的 job 级 `timeout-minutes` SHALL 容得下「单片预算 + 其余显式 `timeout-minutes` 之和」，
否则"不可归因的超时"只是从 `timeout(1)` 换成 Actions 的 job killer。

自证块 SHALL 在 `bash -e -o pipefail` 下**真能执行**（`set +e` / `RC=${PIPESTATUS[0]}` / `set -e`），
超时 SHALL 打印 `elapsed=` / `budget=` / `rc=` 与 `TIMEOUT_BUDGET_EXCEEDED` 诊断。

#### Scenario: 单片预算按片摊薄且低于被取代的整轮预算

- **WHEN** 读单片步的 `BUDGET_SECONDS`
- **THEN** 它 ≥ 整轮实测（1678–1759s，取 1759）÷ 片数（4）× 2
- **AND** 它 > 现行整轮预算 2100s ÷ 片数（4）＝ 同样负载下的单片最坏
- **AND** 它 < 现行整轮预算 2100s（它取代的就是这个数）
- **AND** 它 < 原始魔数 1200s
- **AND** 它 ≤ 1100（钉住现值，防止将来被一路抬高）

#### Scenario: 分片作业的 job 级预算不倒挂

- **WHEN** 比较分片作业的 `timeout-minutes` 与它各步的显式 `timeout-minutes` 之和
- **THEN** job 级上限 > 显式上限之和 + 单片预算（分钟）
- **AND** 否则"不可归因的超时"只会从 `timeout(1)` 换成 Actions 的 job killer

#### Scenario: 超时能自证

- **WHEN** 单片步被步骤级 timeout 掐断
- **THEN** 日志里出现 `[electron-ci-timeout-budget] elapsed=… budget=… rc=124`
- **AND** 出现 `TIMEOUT_BUDGET_EXCEEDED` 与"已完成测试行数 / 摘要行数"两行自证
- **AND** 该自证块在 `bash -e -o pipefail` 下**真能执行**（不是只在 YAML 里存在）

### Requirement: required context `electron-tests` 不得消失

ruleset `main-ci-gate` 的 required contexts 含 `electron-tests`。matrix 作业的 check 名恒带后缀，
因此 SHALL 存在一个**非 matrix** 的汇入作业，其 id 与 `name` 都是 `electron-tests`，
SHALL `needs` 分片作业、SHALL 带 `always()`，且 SHALL 在分片失败或被跳过时**仍然出现**。

汇入作业 SHALL 有一步按 `needs.electron-tests-shards.result` 判定：结果为 `failure` 或 `cancelled`
时该作业 SHALL 失败（否则"分片红了"会被报成绿，required context 成一句空话）。

matrix 作业 SHALL NOT 使用 `electron-tests` 这个 id/name（否则两条同名检查、聚合语义失效）；
汇入作业 SHALL NOT 再跑一遍整轮桌面单测。

#### Scenario: 汇入作业按 required 名报出分片结论

- **WHEN** 读 `electron-ci.yml` 的汇入作业
- **THEN** 它的 id 与 `name` 都是 `electron-tests`
- **AND** 它 `needs` 含 `electron-tests-shards`，且 job 级 `if` 含 `always()`
- **AND** 它有一步按 `needs.electron-tests-shards.result` 判定，`failure` / `cancelled` 时 `exit 1`

#### Scenario: matrix 作业不得与汇入作业同名、不得再跑整轮

- **WHEN** 读分片作业
- **THEN** 它的 `name` 不等于 `electron-tests`（否则两条同名检查、聚合语义失效）
- **AND** 汇入作业的步骤里不再出现整轮桌面单测步

### Requirement: 接线锁与本规格同口径

结构性锁 SHALL 覆盖：片数恰为 4、`fail-fast: false`、分片参数存在、确定性参数保留、
汇入作业的 id/name/needs/always()、汇入作业的失败判定步骤、单片预算与片数的关系。
锁 SHALL 指向**分片作业**（消费者换了作业），SHALL NOT 指向汇入作业。

判据域 SHALL 覆盖**运行时行为**（自证块真执行一次并断言其输出），SHALL NOT 只断言 YAML 文本存在。

#### Scenario: 锁指向分片作业且覆盖新增形状

- **WHEN** 跑 `apps/desktop/tests/gui-ci-exit-contract.test.js` 与 `.github/scripts/workflow-contract.test.js`
- **THEN** 单测相关的锁指向 `electron-tests-shards`
- **AND** 有锁钉住：片数恰 4、`fail-fast: false`、`--shard` 参数存在、汇入作业的 id/name/needs/always()、
  汇入作业的失败判定步骤、单片预算与片数的关系

#### Scenario: 锁对变异有牙

- **WHEN** 把 `--shard` 参数去掉 / 把片数改成 2 / 把单片预算抬到 2000 / 删掉汇入作业的失败判定步骤 /
  摘掉 `set +e` / 把分片作业改名成 `electron-tests`
- **THEN** 每次都至少有一条锁**指名红**
- **AND** 还原后全部锁重新变绿
