# Tasks: publish-logging-observability

> TDD-first：每个任务先写测试再实现。运行时代码改动必须在 worktree 内（`scripts/start-mp-task.ps1 -TaskName publish-logging-observability`）进行，提交前过 QM-1 + QM-2。

## P0-1 publisher-router 三轨 + video-clone（高风险，先落地）
- [x] T1.1 新增 `apps/desktop/electron/services/publisher-router-logging.test.js`：mock logger，断言 RpaVmPublisher/ApiPublisher/BackendPublisher publish 成功/失败/取消/路由选择各 messageKey + params（platform/accountId/mode/durationMs/url 经消毒）。
- [x] T1.2 在 publisher-router.js 各插 notify（成功/失败/取消/route-selected，8 处）。
- [x] T1.3 新增 `packages/video-clone-engine/src/adapters/__tests__/publish-logging.test.js`：断言 skipped/publish-ok/publish-error 三态。
- [x] T1.4 在 video-clone-engine adapters/publish.js 接入 logger 并补三态 notify；生产调用点（ipc-handlers/video-clone.js service.run 与 partialRegeneratePipeline）注入 `logger`，package.json test 脚本注册新测试。

## P0-2 发布进度关键阶段落盘
- [x] T2.1 扩展 `publish-progress-events.test.js`：断言 start/success/failed/cancelled 各 phase-* notify 出现、progress 心跳不出现。
- [x] T2.2 在 emit（L129-160）后插关键阶段 notify（`emitPhaseNotify`，只在 start/success/failed/cancelled 终态相位落 notify，心跳/重试/阻塞相位不落）。

## P0-3 + P1-1 IPC 迁移 notify + 保账号映射
- [x] T3.1 扩展 `publish-account-logging.test.js`：batch-ok 含 `platform:accountId`、batch-error 走 notify 且 error 消毒；account:delete/auth:open-login 既有 gate 不回归。
- [x] T3.2 改 publish.js L311（保映射 notify）、L314（error notify）。
- [x] T3.3 account.js ipcLog 调用逐步迁移 notify，messageKey 与 gate 对齐（accounts-list-ok/error、auth-open-login-ok、account-delete-ok 已落 notify）。

## P0-4 api-usage-governor 闸口日志
- [x] T4.1 新增 `api-usage-governor-logging.test.js`：构造限流/超时/额度/重试/重试耗尽场景，断言对应 messageKey + params（providerId/attempt/cooldownMs/errorCategory）且原 throw 不被吞。
- [x] T4.2 在 `_executeWithRetry` 各 throw 前插 `_notify`（queue-timeout/pace-over-limit/cooldown-over-limit/quota-exceeded/retry429-exhausted/transient-retry-exhausted/provider-error，不吞 throw）。

## P1-2 log-injection 消毒 + 回归（门禁）
- [x] T5.1 在 logger.js 新增 `sanitizeLogMetaValue`（控制字符/换行消毒），在 notify meta 预处理调用；保留 redact 脱敏。
- [x] T5.2 新增 `apps/desktop/electron/services/log-injection-sanitization.test.js`：断言含 `\n`/`\x00`/`\x1b` 文本被消毒为单行；凭证仍脱敏；注入载荷 `ok\n[NOTIFY] evil fake` 不分裂日志行。
- [x] T5.3 将 publish.js L314 等字符串 concat 路径改走消毒后 notify（与 T3.2 合并，error 经 sanitizeLogMetaValue 入 params）。

## P1-3 子域统一 notify
- [x] T6.1 新增 `observability-messagekey.test.js` 结构锁：扫描 phase4-events.js / publish-impact-tracker.js / publish-monitor.js / risk-suspender-store.js，断言所有 `log.notify('Module','subdomain-event')` 的 messageKey 含 `-`、命中允许清单、无遗留 `log.warn/info/error/debug('Module','tag')` 裸标签调用；允许清单规模下界 + 四文件 notify 总数一致断言防假绿。
- [x] T6.2 迁移散落日志到 notify，messageKey 收敛 `<subdomain>-<event>`：publish-monitor.js（4 处 check-url-missing/monitor-timeout/poll-progress/poll-error）、risk-suspender-store.js（2 处 persist-failed/hydrate-read-failed 改走 `log.notify` 守卫）、phase4-events.js（14 处，含 RiskSuspender suspend-failed）；配套 risk-suspender-store.test.js mock 改 `log:{notify}` 且断言 `warns.length===1` 不回归。

## P1-4 日志风暴护栏
- [x] T7.1 新增 `log-storm-guard.test.js`：断言 100 次重试下 notify 调用数 ≤ 上限（首+末+采样）。
- [x] T7.2 实现 `createLogSampler`，接入 api-usage-governor._executeWithRetry（per-attempt retry-attempt 经采样器门控）。

## 收口
- [x] T8.1 全量 `pnpm test`（vitest）绿：定向 11 文件 263 测全过；video-clone-engine `node --test` 163 过/0 败/1 skip；桌面全量仅 feedback.test.js 因沙箱 symlink EPERM 环境性失败（非回归，main 同样挂）。
- [x] T8.2 QM-1：完整 `electron-builder --win --x64` 因沙箱出网被 GitHub releases 的 nsis-resources 下载超时阻断（环境性，非代码缺陷）；改走 AGENTS.md QM-1 补充路径 `electron-builder --win --dir --publish never`（exit 0）验证 asar 含全部新增/迁移文件（api-usage-governor.js / log-sampler.js / publish-progress-events.js / risk-suspender-store.js），并 extract asar 实跑 log-sampler require 链（createLogSampler 导出、抽样行为正确）。启动测试因无 renderer 产物/出网受限未跑，主进程代码门禁以 require 链验证为准。
- [x] T8.3 QM-2 代码必检项：require 路径均指向真实文件（api-usage-governor 引 provider-error/token-budget-windows/async_hooks/log-sampler 全部存在）；模块导出 `module.exports = { createLogSampler }` 干净；注释语法 `/* */` 成对；preload 未改动；IPC 序列化未引入新 JSON 不安全路径；唯一 logger mock 破坏性缺口（bootstrap.test.js 缺 notify）已补 `notify: vi.fn()` 且全量回归通过。
- [ ] T8.4 经 PR 落地（worktree + PR，禁止 --no-verify）。
