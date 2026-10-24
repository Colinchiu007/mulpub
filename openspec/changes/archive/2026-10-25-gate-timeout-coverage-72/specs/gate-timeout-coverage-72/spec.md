# Spec: gate-timeout-coverage-72

## Requirement 1：`QG Coverage` 的作业级 timeout 必须覆盖实测预算

- `.github/workflows/quality-gate.yml` 中 `QG Coverage` 作业的 `timeout-minutes` 必须 **≥ 72**。
- 该下限来自 `scripts/check-coverage-budget.js` 的 `UNDER_BUDGET` 判据：
  `timeout ≥ ceil(floor × 1.5)`，`floor = max(maxMinutes, censoredAtCeiling > 0 ? ceilingMinutesSampled : 0)`。
- 120 趟窗口同口径重采样的实测分布为 `maxMinutes=47.37` / `p90Minutes=45.27` / `samples=51` /
  `ceilingMinutesSampled=72` / `collectedAt=2026-10-24` ⇒ `required = 72`。
- 取值必须**恰等于** `required`（72）：不欠账，也不多给。

#### Scenario: 有人把 coverage 的 timeout 调回 65 或调到 70

- **WHEN** PR 把 `QG Coverage` 的 `timeout-minutes` 改成 65 或 70（均 `< 72`）
- **THEN** `node scripts/check-coverage-budget.js` 红，规则名 `UNDER_BUDGET`，并打印 floor/required/实测值

#### Scenario: 有人把 timeout 抬到远超实测

- **WHEN** PR 把 `timeout-minutes` 抬到明显高于 `required`（如 90）
- **THEN** 允许通过（判据只管下限），但必须在本 change 的依据里说明为何多给

## Requirement 2：登记项的 provenance 字段集必须与采集器产出严格一致

- 每条登记的 provenance **字段集**必须与 `scripts/coverage-budget-sample.js` 的 `buildProvenance` 产出**逐字相等**
  （`scripts/check-coverage-budget.test.js` 锁 7 机械比对）。
- **不得**为登记项的 provenance 增加采集器不产的键（如 `note`）：`scripts/lib/gate-timeout-registry.js` 的
  `coverageProvenance()` 会把条目 provenance 原样透传到 `PROVENANCE` ⇒ 字段集多一个键即红。
- 补充说明性依据只能落在**workflow 注释、PRD 与执行记录**里，不得落在 provenance 里。

#### Scenario: 有人想在 provenance 里加一个 `note` 说明依据

- **WHEN** PR 在 coverage 条目的 provenance 里新增 `note` 键
- **THEN** `node scripts/check-coverage-budget.test.js` 红（25/26），锁 7 的字段集比对失败

## Requirement 3：代码路径上不得存在指向不存在脚本的坏指针

- 注册表、加载器、采样器、判据脚本与相关锁注释里，**凡指向脚本的引用都必须指向真实存在的文件**。
- 本 change 涉及的坏指针一律指向 `scripts/coverage-budget-sample.js` / `scripts/check-coverage-budget.js`。
- `openspec/` 内的历史记录与在途 change 任务清单**不在本判据的代码路径范围内**（改它们会污染历史）。

#### Scenario: 有人按采集器的输出刷新注册表

- **WHEN** 按 `scripts/coverage-budget-sample.js` 的输出刷新注册表
- **THEN** 输出里的采集命令必须指向真实存在的脚本，不得把坏指针原样写回注册表

## Requirement 4：重写「看起来是 JSON 的台账」必须保持排版形状

- `scripts/gate-timeout-registry.json` 是**每个 job 压成一行**的紧凑格式。
- 改它必须用**文本级最小替换**（定位单行后替换），**禁止**用 `json.dumps(indent=2)` 重写整个文件。
- 写回后必须 `git diff --stat` 检查形状：单条改动的噪音 diff 必须在个位数行量级。

#### Scenario: 有人用 json.dumps 重写注册表

- **WHEN** PR 的 diff 出现数百行的注册表重排（每个 job 被展开成多行）
- **THEN** 视为违反本 Requirement，必须改回文本级最小替换
