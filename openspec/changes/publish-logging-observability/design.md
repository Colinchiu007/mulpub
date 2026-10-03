# Design: publish-logging-observability

## 总体策略

仅新增/补齐日志，**不改发布业务流程语义**。所有新增日志统一走既有 `logger.notify(module, messageKey, {errorCategory?, level?, params?, error?})`（`apps/desktop/electron/services/logger.js` L197-227）：

- `params` 白名单 string/number/boolean，自动 `JSON.stringify` 进 meta 段；
- meta 段经 `redact()` 脱敏凭证（Bearer/apiKey/sk-/cookie/JWT），**不脱敏用户草稿文本**；
- 本 change 在 notify 的 meta 预处理中新增**控制字符/换行消毒**，补 log injection 缺口（P1-2）。

## 关键实现点

### 1. 控制字符消毒（P1-2 基石）
新增 `sanitizeLogMetaValue(v)`：
- 对 string：剥离 `< 0x20` 且非 `\t` 的控制字符，将 `\n`/`\r` 替换为空格；
- 对 object（params）：递归仅对 string 值消毒；
- 在 `logger.notify` 组装 `metaObj` 后、`JSON.stringify` 前调用，确保无论 notify 还是未来拼接路径都安全。
- 凭证脱敏 `redact` 不变，二者叠加（先消毒后脱敏）。

### 2. publisher-router 三轨（P0-1）
在 `RpaVmPublisher.publish`/`ApiPublisher.publish`/`BackendPublisher.publish` 入口与出口（成功返回 / catch 抛错 / 取消信号）各插 `logger.notify`：
- 成功：携带 `url: sanitizePublishResultUrl(result.url)`（既有 L485/L551/L583 已用，复用）、`mode`、`durationMs`；
- 失败：携带 `errorCategory` + 消毒后的 `error`；
- 取消：`signal.aborted` 分支（L464/L476/L520/L547）。
- `PublisherRouter` 分发处记 `route-selected`（platform/mode）。
注意：返回 URL 已走 `sanitizePublishResultUrl`，安全；不记录 cookie/凭证。

### 3. publish-progress-logging（P0-2）
在 `publish-progress-events.js emit` 组装 payload 后，对 `start/success/failed/cancelled` 阶段调 `logger.notify('PublishProgress','phase-<phase>',{params:{taskId,platform,stage,percent,batchId}})`；`progress` 心跳（连续 percent）**不落盘**，避免膨胀。既有的非法 taskId/send-failure warn 保留。

### 4. IPC 迁移与保映射（P0-3 + P1-1）
- `publish.js` L311 ok 日志改为 `notify('PublishIPC','batch-ok',{params:{taskCount, platforms: normalizedTargets.map(t=>`${t.platform}:${t.accountId||'any'}`), durationMs}})`（保 platform→accountId）。
- `publish.js` L314 error 改为 `notify('PublishIPC','batch-error',{params:{durationMs},errorCategory:'batch_failed',error: e.message})`（消毒后入 params）。
- `account.js` 既有 `ipcLog` 调用逐步改为 `notify`，messageKey 与 QM-3 gate 现有断言（account:delete/auth:open-login/accounts:list/cover:extract）对齐，避免 gate 回归。

### 5. api-usage-governor 闸口（P0-4）
在 L307/L349-355/L362-367/L426/L442-448/L446/L450-453 各 throw 前插入 `notify`，携带 `providerId`/`attempt`/`cooldownMs`/`errorCategory`，不吞原 throw。

### 6. video-clone-engine（P0-5）
`packages/video-clone-engine/src/adapters/publish.js` 三态（skipped/publish-ok/publish-error）加 `logger.notify`；该包 logger 接口需与 desktop 对齐（注入或复用 shared-utils logger）。

### 7. 子域统一（P1-3）+ 风暴护栏（P1-4）
- monitor/risk/statistics/audit-requery/impact 的散落 `log.warn('x','msg')` 收敛 messageKey 为 `<subdomain>-<event>`。
- `createLogSampler({sampleEvery, maxBurst})` 用于重试/轮询循环：首条 + 末条必记，中间按 sampleEvery 采样。

## 测试策略（QM-3 风格 + 注入回归）

1. **扩展既有 QM-3 gate** `apps/desktop/electron/ipc-handlers/publish-account-logging.test.js`：用 `vi.mock('../services/logger', () => ({ info, warn, error, notify }))`，断言新增 messageKey（batch-ok 含 `platform:accountId`、batch-error 走 notify、`route-selected`、progress phase-* 等）。
2. **新增回归测试文件**（各自 mock logger）：
   - `publisher-router-logging.test.js`（P0-1）
   - `api-usage-governor-logging.test.js`（P0-4）
   - `log-injection-sanitization.test.js`（P1-2 单元：sanitizeControlChars + notify 单行性）
   - `log-storm-guard.test.js`（P1-4 采样上限）
   - `observability-messagekey.test.js`（P1-3 结构锁）
   - `packages/video-clone-engine/src/adapters/__tests__/publish-logging.test.js`（P0-5）
   - `publish-progress-events` 扩展（P0-2）
3. **注入回归**：在 `log-injection-sanitization.test.js` 注入 `e.message="ok\n[NOTIFY] evil fake"`，断言 recorder 中该行为单一字符串、无伪造 `[NOTIFY]` 行。

## 验证

- 文档类/日志类改动经 QM-2 代码必检项；若涉及 `apps/desktop/electron/` 运行时文件改动，须 QM-1 本地打包（`electron-builder --win --x64`）通过。
- 全部新增/扩展测试在 worktree 内 `pnpm test`（vitest）全绿。
