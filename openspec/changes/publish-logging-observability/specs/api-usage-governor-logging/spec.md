# api-usage-governor-logging (delta)

## ADDED Requirements

### Requirement: 限流/配额/冷却/重试闸口记录结构化日志
`apps/desktop/electron/services/api-usage-governor.js` 的静默闸口必须落 `logger.notify('ApiUsageGovernor', messageKey, {params:{providerId,attempt?,cooldownMs?},errorCategory,level})`：

- 排队超时：`_sweepExpired` L307 `RATE_LIMITED` reject → `notify('ApiUsageGovernor','queue-timeout',{params:{providerId},errorCategory:'rate_limited',level:'WARN'})`
- RPM 限流：`_pace` L349-355 throw → `notify('ApiUsageGovernor','rpm-limited',{params:{providerId,cooldownMs},errorCategory:'rate_limited',level:'WARN'})`
- 冷却：`_waitCooldown` L362-367 throw → `notify('ApiUsageGovernor','cooldown',{params:{providerId,cooldownMs},errorCategory:'rate_limited',level:'WARN'})`
- 额度超限：`_assertTokenBudget`/`_quotaExceeded` L426 → `notify('ApiUsageGovernor','quota-exceeded',{params:{providerId},errorCategory:'quota_exceeded',level:'ERROR'})`
- 429 重试：`_executeWithRetry` L442-448（rate 类）→ `notify('ApiUsageGovernor','retry-rate',{params:{providerId,attempt},level:'WARN'})`；耗尽 L446 throw → `notify('ApiUsageGovernor','retry-exhausted',{params:{providerId,attempt},errorCategory:'rate_limited',level:'ERROR'})`
- transient 重试 L450-453 → `notify('ApiUsageGovernor','retry-transient',{params:{providerId,attempt},level:'WARN'})`

#### Scenario: 触发 RPM 限流被记录
WHEN `waitMs > _maxPaceWaitMs` 抛 `RATE_LIMITED`（L349）
THEN 落 `notify('ApiUsageGovernor','rpm-limited',{params:{providerId,cooldownMs},errorCategory:'rate_limited',level:'WARN'})` 且不吞掉原 throw

#### Scenario: 429 重试耗尽被记录为错误
WHEN `cls==='rate'` 且 `attempt >= limits.retry429` 抛错（L446）
THEN 落 `notify('ApiUsageGovernor','retry-exhausted',{params:{providerId,attempt},errorCategory:'rate_limited',level:'ERROR'})`

#### Scenario: 额度超限被记录为错误
WHEN `win.used > win.limit` 抛 `_quotaExceeded`（L426）
THEN 落 `notify('ApiUsageGovernor','quota-exceeded',{params:{providerId},errorCategory:'quota_exceeded',level:'ERROR'})`

QM-3 断言：新增 `apps/desktop/electron/services/api-usage-governor-logging.test.js`，mock logger，构造限流/超时/额度/重试场景，断言对应 messageKey + params 出现且原 throw 不被吞。
