# Proposal: publish-logging-observability（账号内容发布日志可观测性增强）

## Why

对「账号内容发布」操作与流程做只读审计后，发现以下日志盲区与污染风险（均带 `file:line` 锚点）：

### P0（发布链路黑盒，故障不可追溯）

- **P0-1 desktop publisher-router 三条发布轨完全静默**：`apps/desktop/electron/services/publisher-router.js` 中 `RpaVmPublisher.publish`（L452-491）、`ApiPublisher.publish`（L508-552）、`BackendPublisher.publish`（L561-586）以及路由分发 `PublisherRouter`（L591+）**零日志记录**。RPA / API / 后端三条轨的成功、失败、耗时、返回作品 URL 均无落盘，发布失败时只能靠客户端回显反推。（注：`packages/api-publish-engine/src` 引擎层有 `api-router`/`publish-mode`/`scheduled-publish` 等日志，但 desktop 包装层与 RPA/后端轨未触达引擎 logger。）
- **P0-2 发布进度阶段转换未落盘**：`apps/desktop/electron/services/publish-progress-events.js` `emit`（L129-160）仅在 `taskId/platform` 非法（L131）与 `send failed`（L158）时 warn，**正常进度（start/success/failed/cancelled）完全不写文件日志**，文件侧无发布过程轨迹。
- **P0-3 publish:batch 成功日志丢失账号映射**：`apps/desktop/electron/ipc-handlers/publish.js` L311 `ipcLog('info','publish:batch','ok', \`taskIds=[...] 耗时=...ms\`)` 仅记录 taskIds，**丢失 platform→accountId 映射**，事后无法把 task 关联到具体账号。
- **P0-4 api-usage-governor 限流/配额闸口零日志**：`apps/desktop/electron/services/api-usage-governor.js` 中排队超时（`_sweepExpired` L307）、RPM 限流（`_pace` L349-355）、冷却（`_waitCooldown` L362-367）、额度超限（`_assertTokenBudget`/`_quotaExceeded` L426）、429 重试环（`_executeWithRetry` L430-458）全部 `throw new ProviderError(...)` 但**无任何日志记录**。这是引擎与平台之间最高风险的静默闸口，触发限流时用户只看到上游失败、看不到被限流。
- **P0-5 video-clone-engine 发布适配零日志**：`packages/video-clone-engine/src/adapters/publish.js`（28 行）无任何 logger 调用，`createPublish().run` 成功/失败/跳过（no-publisher）全程黑盒。

### P1（日志质量与可靠性）

- **P1-1 IPC 层仍用字符串 concat、未走结构化 notify**：`apps/desktop/electron/ipc-handlers/{publish,account}.js` 的 `ipcLog(level,channel,stage,detail)` 仍拼接字符串，未迁移到 `logger.notify(module,messageKey,{errorCategory,params,level})`（结构化、白名单 params、脱敏）。
- **P1-2 外部可控文本未消毒即入日志（log injection）**：`publish.js` L314 `ipcLog('error','publish:batch','error', \`message=${e.message} 耗时=...ms\`)` 直接拼接 `e.message`；任意第三方/用户可控文本含换行或控制符即可伪造日志行、混淆审计（`logger` 仅脱敏凭证，不脱敏用户文本）。
- **P1-3 监控/风控/统计/复核/影响子域散落字符串日志**：monitor / risk / statistics / audit-requery / impact 等子域仍 `log.warn('x','msg')` 散写，messageKey 不统一，难以聚合检索。
- **P1-4 重试/轮询日志风暴缺乏护栏**：retry / poll 循环在高频失败时可能每轮打日志，形成日志风暴淹没关键事件。

## What Changes

### ADDED Capabilities
- `publisher-logging` — publisher-router 三条轨 + video-clone-engine 发布适配的结构化日志
- `publish-progress-logging` — 发布进度关键阶段落盘
- `ipc-publish-logging` — publish/account IPC 迁移 notify 结构化 + 保账号映射
- `log-injection-sanitization` — 外部可控文本入日志前的消毒 + 回归测试
- `api-usage-governor-logging` — 限流/配额/冷却/重试闸口结构化日志
- `monitor-risk-logging` — 监控/风控/统计/复核/影响子域 notify 统一
- `log-storm-guard` — 重试/轮询日志限速护栏

### 变更明细
逐项见对应 `specs/<capability>/spec.md` 的 `Requirement` / `Scenario`（含 `file:line` 锚点与 QM-3 风格断言）。

## Impact
- 落盘日志量适度增加（关键路径结构化行），不影响渲染层既有的 `publish:progress` 事件流。
- 不改动发布业务流程语义，仅新增/补齐日志。
- 不引入新依赖；`logger.notify` 与 `redact`/白名单 params 为既有契约。
- 需补充/扩展 QM-3 日志门禁（见 `log-injection-sanitization` 与 `ipc-publish-logging` spec）。

## Out of Scope
- 「登录一个账号」的登录态观测项（非本次发布流程审计范围）。
- 日志后端/采集/可视化（ELK 等）建设。
- 既有未覆盖模块的批量补齐（仅限上述 P0/P1 清单）。
