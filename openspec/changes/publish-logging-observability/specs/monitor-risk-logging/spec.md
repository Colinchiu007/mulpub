# monitor-risk-logging (delta)

## ADDED Requirements

### Requirement: 监控/风控/统计/复核/影响子域统一 notify
monitor、risk、statistics、audit-requery、impact 等子域的散落字符串日志（`log.warn('x','msg')`）统一迁移到 `logger.notify(module, messageKey, {params,errorCategory,level})`，messageKey 命名约定 `<subdomain>-<event>`，便于聚合检索。

#### Scenario: 风控事件统一 key
WHEN 风控模块产生 risk 事件（参照 `api-publish-engine/src/index.js` L140 `onRiskEvent` 的 `risk_<type>`）
THEN 落 `notify('RiskService','risk-<type>',{params:{platform?},level:'WARN'})`，messageKey 收敛为 `risk-<type>`

#### Scenario: 监控/统计/复核/影响子域收敛
WHEN monitor/statistics/audit-requery/impact 产生日志
THEN 各自使用 `notify('<Module>','<subdomain>-<event>',{params})`，不再出现裸 tag 字符串散写

QM-3 断言：新增结构锁测试 `apps/desktop/electron/services/observability-messagekey.test.js`，扫描目标子域源码断言 `notify(...)` 调用且 messageKey 含 `-`（禁止裸 tag 字符串）。
