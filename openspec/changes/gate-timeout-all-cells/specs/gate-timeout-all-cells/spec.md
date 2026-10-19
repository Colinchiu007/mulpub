# Spec: gate-timeout-all-cells

## Requirement 1：每一格作业级 timeout-minutes 都必须在册

- `.github/workflows/*.yml` 中**恰好 4 空格缩进**的 `timeout-minutes` 视为作业级预算，实测 24 格。
- 每一格必须在 `scripts/gate-timeout-registry.json` 有且仅有一条登记（键 = workflow + jobId）。
- 未登记 ⇒ `UNREGISTERED_TIMEOUT_CELL`；登记项在 workflow 里消失 ⇒ `MISSING_TIMEOUT_CELL`。
- 深缩进（步级）的 `timeout-minutes` 不纳入，但**必须被扫描器单列并打印**，不得静默忽略。

#### Scenario: 有人给一个作业加了新的 timeout-minutes
- **WHEN** PR 改了 workflow，新增一格 `timeout-minutes` 而注册表未登记
- **THEN** `QG Changes` 红，规则名 `UNREGISTERED_TIMEOUT_CELL`，并点名 `<workflow>#<jobId>`

#### Scenario: 某作业改名或删除
- **WHEN** 注册表里的某一格在 workflow 里已读不到
- **THEN** 红，规则名 `MISSING_TIMEOUT_CELL`

## Requirement 2：登记值必须带实测分布，且预算按 ×1.5 规则判定

- 每条登记必须给出 `samples / maxMinutes / p90Minutes / censoredAtCeiling / ceilingMinutesSampled / runsListed / collectedAt`。
- `timeoutMinutes ≥ ceil(floor × SAFETY_MULTIPLIER)`，`SAFETY_MULTIPLIER` 取自 `scripts/gate-budget.js`；
  `floor = max(maxMinutes, censoredAtCeiling>0 ? ceilingMinutesSampled : 0)`（成功样本右截尾）。
- `state=measured` 要求 `samples ≥ minSamples(20)`；`state=seeded` 允许暂时不足，但
  `samples ≥ 20` ⇒ `SEEDED_STALE`，超过 `seededGraceDays(30)` 仍不足 ⇒ `SEEDED_EXPIRED`。
- `collectedAt` 距今 > `staleDays(90)` ⇒ `STALE_PROVENANCE`。
- `maxMinutes ≥ 0.9 × timeout` ⇒ `HUGGING`（贴脸必须重定数，哪怕规则①仍站得住）。

#### Scenario: 作业变慢到预算不够
- **WHEN** 复测后 `maxMinutes` 上升使 `ceil(max×1.5) > timeout`
- **THEN** 红，`UNDER_BUDGET` 并打印 floor/required/实测值

## Requirement 3：失明不得被读成合规

- 读不到 `timeout-minutes`、读到非整数、注册表 JSON 损坏、`--timeout` 未指名到格 ⇒ 退出码 **2**。
- `0` 只表示"逐格合规且棘轮通过"；`1` 只表示"确实违规"。

#### Scenario: 注册表 JSON 被写坏
- **WHEN** 字段类型错 / 重复登记 / `p90 > max` / `samples > runsListed`
- **THEN** 加载器当场抛 `GATE-TIMEOUT-REGISTRY`，CLI 以 2 退出（半份注册表比没有更危险）