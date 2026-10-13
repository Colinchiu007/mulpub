# fix-risk-hold-false-positive：风控挂起误判修复（结构化优先 + 强弱分档 + 粒度收敛）

## Why

用户报障：账号管理页出现「检测到风控，「微信公众号」等 1 个发布目标已自动暂停后续发布…」，但在平台侧并没有任何验证弹层，且该平台后续发布被真的挡住，必须逐条手动恢复。

根因两条，互为放大镜：

1. **结构化风控信号被丢在半路**。各链其实已经算出结构化结论（抖音 `risk_blocked` 标志、B站 `code:601`、百家号 `code:10000015`、快手 `risk_blocked`、小红书 `XHS_RISK_BLOCKED`），但传输层一律 `throw new Error(result.error)`（`api-publish-engine/src/index.js` 的 `publishViaApi`、桌面 `publisher-router.js` 的三个发布器），`Error` 上只剩 `message`。上层因此**只能**用错误文本猜关键词。

2. **词表无边界且不分强弱**。`/风控|risk|滑块|601|10000015|frequent|频繁|verify|验证|…/i` 是裸子串匹配，实测把 7 类普通失败判成风控（`status code 601`、`id 6019`、`ts=1601846521`、`errno 100000159`、`infrequent login`、`low-risk content`、`身份验证失败`）。

**放大器**：`accountId` 缺失时自动降级为平台级挂起（覆盖该平台**所有**账号），而 `phase4-events` 只从 `task.article?.accountId` 取账号 —— 「一次误判 + 没带账号」= 整平台停摆。

**为什么必须修（代价不对称）**：误判把用户引向「去创作者中心手动发一篇完成验证」——那里根本不会弹验证；挂起态持久化、重启存活、无自动过期；期间该平台所有发布零请求被拦（`RiskSuspendedError` + `noRetry`）。这与仓内既有纪律一致（小红书 DOM 轨早已删掉裸「滑块/验证码」并留下「误判比漏判更有害」注释）。

## What Changes

- **新增单一真源** `packages/api-publish-engine/src/publish/core/risk-signals.js`：
  - `classifyRisk({error, code, riskBlocked, risk_blocked})` → `{hit, strength, signal, suspends}`；
  - 判定顺序 **结构化标志 → 平台风控码族 → 文本兜底**；
  - 文本词表**分强弱**：强档（风控/滑块/安全验证/验证弹层/操作频繁/captcha/canvas illegal/账号存在风险/risk control/BILI_RISK/`验证失败(110)`/`10000015`）允许挂起；弱档（裸 验证/频繁/risk/frequent/verify/601）只提示不挂起；
  - **加边界**：数字用 `(?<!\d)…(?!\d)`，英文词用标识符边界（`_` 算边界）；
  - 排除自身守卫标记 `risk_suspended`；
  - `suspends ⇔ (hit && strength==='strong')` 作为不变量由本模块给出，调用方不得自行推导。
- **收敛两处已漂移的 `RISK_RE`**：`publish-mode-runner.js` 与桌面 `publish-risk.js` 改为 require 同一模块（桌面保留兼容签名 `isRiskBlocked`）。
- **打通结构化信号搬运**：`api-publish-engine/src/index.js`、桌面 `publisher-router.js`（新增 `attachRiskSignals`）在抛错时保留 `code`/`riskBlocked`/`loginExpired`；`shared-utils/task-queue.js` 失败时把它们落到 `task.errorCode` / `task.riskBlocked`。
- **挂起决策加三原则**（`phase4-events.js`）：结构化优先、弱信号不挂起也不提示（只留结构化日志）、`accountId` 改为 `article.accountId || task.accountId || null` 以免误升平台级。引擎 `publish-mode-runner.js` 的挂起点同样加强弱闸门。
- **挂起记录携带判定依据**：`risk-suspender.js` 的 rec 增加 `signal`（封闭词表记号，≤64 字符）与 `strength`（白名单校验）；桌面 store 水合与渲染层 `normalize` 一并透传。
- **横幅新增三个显示项**：粒度标签（全平台账号 / 单账号）、检测时间（`HH:mm`）、判定依据（strong/weak，无值时不渲染）；标题在全平台级时分流到 `suspendedAllAccounts`。
- **i18n 新增 5 个 key**（zh/en 成对）：`suspendedAllAccounts`、`scopeAllAccounts`、`detectedAt`、`evidenceStrong`、`evidenceWeak`、`guidanceAllAccounts`。
- **测试**：新增 `risk-signals.test.js`（45 例）、桌面 `publish-risk.test.js` 扩展（15 例）、`phase4-events.test.js` 新增 11 例、`task-queue.test.js` 新增 3 例（含变异反证）。

## Impact

- **Affected specs**：新增能力 `risk-hold-guard`（见 `specs/risk-hold-guard/spec.md`）
- **Affected code**：
  - `packages/api-publish-engine/src/publish/core/risk-signals.js`（新）
  - `packages/api-publish-engine/src/publish/core/publish-mode-runner.js`
  - `packages/api-publish-engine/src/publish/core/risk-suspender.js`
  - `packages/api-publish-engine/src/index.js`
  - `packages/shared-utils/src/task-queue.js`
  - `apps/desktop/electron/services/publish-risk.js`
  - `apps/desktop/electron/services/publisher-router.js`
  - `apps/desktop/electron/services/risk-suspender-store.js`
  - `apps/desktop/electron/bootstrap/phase4-events.js`
  - `apps/desktop/src/services/risk-suspended-tracker.js`
  - `apps/desktop/src/features/accounts/components/RiskSuspendedBanner.vue`
  - `apps/desktop/src/locales/publish/{zh,en}.js`
- **不涉及**：`platforms.yaml`、IPC 通道契约、preload 键数、数据库 schema、任何自动恢复/自动换号逻辑（合规红线不变）
- **QM-1**：改 `apps/desktop/electron/**` ⇒ 需本地打包验证
- **风险与回退**：见 design.md「风险与回退」
