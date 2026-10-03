# log-storm-guard (delta)

## ADDED Requirements

### Requirement: 重试/轮询日志限速护栏
任何重试/轮询循环在高频失败时，日志发射必须受限：记录首条 + 末条 + 每隔 N 次采样一条（N 可经 env 覆盖），禁止每轮无条件打日志，避免日志风暴淹没关键事件。

- 适用：`api-usage-governor._executeWithRetry` 重试、任何 publish poll/retry 循环。
- 护栏实现：`createLogSampler({sampleEvery, maxBurst})` 返回 `shouldLog(attempt)`，首条(1)与末条(达上限)必记，中间按 sampleEvery 采样。

#### Scenario: 高频重试仅采样打日志
WHEN 重试循环执行 100 次失败、`sampleEvery=10`
THEN 实际落盘日志 ≤ 首条1 + 末条1 + (100/10) ≈ 12 条，而非 100 条

#### Scenario: 末次失败必记
WHEN 重试在第 N 次耗尽抛错
THEN 第 N 条（耗尽）必落 `retry-exhausted`（与 api-usage-governor-logging 协同），不受采样跳过

QM-3 断言：新增 `apps/desktop/electron/services/log-storm-guard.test.js`，mock logger，断言 100 次重试下 notify 调用次数 ≤ 上限。
