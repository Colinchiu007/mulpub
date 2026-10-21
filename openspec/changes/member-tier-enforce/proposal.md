# Proposal｜会员档位硬门禁（member-tier-enforce）

## 1. 问题

PR #4051 把 `limits` 打通到客户端，发布页能拦「第 6 个平台」。但那是 **UI 分支**：

- `POST /api/v1/publish` 只校验 `cloud_publish` 这个 feature，**不读** `max_platforms`；
- `POST /api/v1/batch-publish` 同理，免费档 `batch_size_per_run = 1` 仍可一次打 10 个平台；
- 定时通道 `_authorizeScheduledEntry` 是独立授权链，只在即时侧加的判据会在这里漏掉。

结论：**服务端目前没有任何数量型上限判据**，「免费档 5 平台」对脚本调用方是空头承诺。

## 2. 方案

1. 新增纯函数判据 `src/auth/plan-capabilities.js`：
   - `resolveLimits(payload)`、`checkPlanCapability(payload, request)`、`capabilityError(violation)`；
   - 三条纪律：缺失即放行、`-1` 不限、`0` 是「本档不提供」。
2. 三条入口接线（即时 / 批量 / 定时），顺序为**先判上限、再扣额度**。
3. 客户端补一处：离线/缓存快照的 `graceUntil` 判活（上游 PRD N10），
   因为服务端只在 `/me` 与 provider 读取端投影，断网路径不经过服务端。

## 3. 不做什么

- 设备数（N1）、云账号配额执行点（N2）、`grant` 幂等（N9）、到期横幅 UI（N4）、
  日发提交前校验（N5）——均留在上游 PRD §12，本批只把**判据**做出来并接在两条主入口上。
- 不改价格、配额、features 集合。
- 不回溯裁剪已超限用户的选择集。

## 4. 影响面

| 文件 | 变更 |
|---|---|
| `packages/api-publish-engine/src/auth/plan-capabilities.js` | 新增（纯函数判据） |
| `packages/api-publish-engine/src/publish-api-server.js` | 新增 `_assertPlanCapabilities(ForContext)` + 三处调用 |
| `apps/desktop/electron/services/identity/entitlement-service.js` | 新增 `applyGraceWindow` + 三处装配点 |
| locales zh/en | 三个新错误码文案（成对） |
| 文档 | 本 proposal、PRD、执行记录 |

## 5. 风险

| 风险 | 缓解 |
|---|---|
| 误拦正常用户 | 「缺失即放行」+ 11 形态单测；402 计数观察 |
| 两入口判据漂移 | 接线锁（读源码断言调用点与顺序） |
| 402 被当成不可恢复 | 文案写明「升级后可继续」，且**不扣额度** |

## 6. 验收

见 PRD §9 A1–A9；核心是 A6（三条入口都接）与 A7（客户端三态判活）。
