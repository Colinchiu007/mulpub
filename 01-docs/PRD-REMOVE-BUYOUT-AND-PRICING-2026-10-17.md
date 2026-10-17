# PRD：移除买断授权模型 + 定价统一与支付接入方案（2026-10-17）

> 本文件分两部分：
> **A（本次实施）移除买断类型** —— 产品决策已定（用户 2026-10-17 明确「买断类型现在已经不提供了，应该全部相应的内容都去除」）。
> **B（待决策，不实施）定价统一与支付接入** —— 列出方案对比与决策点，需人工拍板后才可开工。

---

# A 部分：移除买断授权模型

## A1. 一句话

把「一次性付费 ¥99 永久使用（买断）」这一整套形态从代码、定价表、IPC 通道与 UI 文案中彻底移除，只保留**订阅制**（服务端 `plan-matrix.js` 三档 + 兑换码核销）。

## A2. 为什么必须移除（不是清理洁癖）

残留的买断形态有四个实际问题，都是「用户可见」或「安全相关」：

| # | 问题 | 证据 |
| --- | --- | --- |
| 1 | **定价自相矛盾** | 权威源 `plan-matrix.js` 是三档订阅（standard ¥59月/¥499年、pro ¥79月/¥699年），而 `payment-manager.js` 的 `PLANS` 写 `pro: { amount: 99 }` 一次性。同一个产品对「pro 多少钱」有两个互斥答案。 |
| 2 | **下单链路已断，但骨架还在** | `payment-manager.js:138-146` 的 S1 修复（2026-10-09）把 `activate('PAY-PRO-<uuid>')` 判死：`license-manager.activate()` 现在只接受 4-4-4 兑换码格式，订单号 UUID 必不匹配 ⇒ **用户「支付成功」后拿不到任何授权**。链路是死的，代码还在跑。 |
| 3 | **UI 对外宣称一个不存在的套餐** | `UpgradeModal.vue:29` 渲染 `¥99 /永久`、L65 渲染「确认支付 ¥99」。虽正式包该按钮被 `purchaseAvailable` 关掉，但价格文案的权威性已失效。 |
| 4 | **授权模型与订阅制互斥** | `license-manager.activate()` 落库写 `expiresAt = null`（永不过期）；`_daysRemaining()` 只服务 trial，对 `type=pro` 恒返回 0 ⇒ 本地授权**零到期、零续期概念**，与服务端 `durationDays` / `settleExpiry` 的订阅语义直接冲突。 |

## A3. 现状地图（调研证据，实施前已逐条核实）

### A3.1 服务端轨（订阅制，**保留不动**）

| 能力 | 位置 | 状态 |
| --- | --- | --- |
| 三档定价权威源 | `packages/api-publish-engine/src/auth/plan-matrix.js`（`PLAN_MATRIX_VERSION=2026-10-08`） | ✅ 保留 |
| 订阅生命周期 | `subscription-service.js`：`grant({durationDays})` / `settleExpiry` / `getSubscriptionView` / `getUsageView` | ✅ 保留 |
| 兑换码核销 | `POST /api/v1/redeem`（`redeem` / `createRedeemBatch` / `listRedeemCodes`） | ✅ 保留（当前唯一真实开通渠道） |
| 权益下发 | `entitlementPayload` → `identity:state-changed` → `identityStore.entitlement` | ✅ 保留 |

### A3.2 本地买断轨（**本次移除**）

| 层 | 文件 | 买断相关内容 |
| --- | --- | --- |
| 服务 | `electron/services/payment-manager.js`（182 行） | `PLANS = { pro: { amount: 99, licenseType: 'pro' } }`；`createOrder` / `completePayment` / `simulatePayment`；`completePayment` 里的 `lm.activate(...)` 已被 S1 切断 |
| IPC handler | `electron/ipc-handlers/payment.js`（92 行） | 6 通道：`payment:create-order` / `list-orders` / `get-order` / `complete` / `simulate` / `cancel` |
| 通道白名单 | `electron/license-access-control.js` L13、L101 | 上述 6 通道登记 |
| 渲染 API | `src/api/publisher.js`（`paymentCreateOrder` 等，L370 起） | 渲染层调用封装 |
| UI | `src/components/UpgradeModal.vue` | L29 `¥99 /永久`、L65 `确认支付 ¥99`、L82 模拟支付按钮、L292 `paymentCreateOrder`、L307 `simulatePayment` |
| 授权落库 | `electron/services/license-manager.js` | `activate()` 写 `type = 'pro'` + `expiresAt = null`（买断）；`isPro()` L226 与 `activate()` L177 判断 `type === 'lifetime'` |

### A3.3 已确认的两个"死"事实

1. **`lifetime` 类型只被读、从不被写**：全仓仅 `license-manager.js:177` 与 `:226` 两处读取判断，**没有任何代码产生该类型** ⇒ 纯历史遗留。
2. **`payment:simulate` 与 `payment:complete` 的主进程防线**：早前核实过 `app.isPackaged` 拒收 + `ADMIN_ONLY_CHANNELS` 双重硬拦，正式包不可达。

## A4. 决策点（D1–D4，含我的建议与依据）

> 这些是实施前必须定的岔路。我给出建议，但**A4 的 D2/D3 涉及产品口径，需你确认**。

### D1 本地 `payment-manager` 整条链路：整删 vs 留骨架？

| 选项 | 说明 | 我的建议 |
| --- | --- | --- |
| **A. 整删** | 删 `payment-manager.js` + `payment.js` + 白名单条目 + 渲染 API + UI 支付按钮 | ✅ **推荐** |
| B. 留骨架 | 保留通道，只把 `PLANS` 改造成订阅价 | ❌ 不推荐 |

**依据**：这条链路已被 S1 切断（支付成功也不授权），留着只会让下一个人误以为"支付能用了"，重演本次「以为有支付其实没有」的误判。**真要接支付时重写比修复便宜**——因为需要的是支付平台 SDK + 回调 + 对账，与本地的 `orders.json` 无一处可复用。

### D2 本地 `license-manager.activate()`：整删 vs 改为订阅语义？

**决策（已实施）：选 A 整删。** `activate()` 与 `license:activate` IPC handler 一并移除。

| 选项 | 说明 | 结论 |
| --- | --- | --- |
| **A. 整删** `activate()` 与 `license:activate` 通道 | 所有授权只走服务端 redeem | ✅ **已采用** |
| B. 保留但改为写 `expiresAt = 未来日期` | 本地也能"订阅" | ❌ 否决，会引入第二授权源与服务端 `settleExpiry` 打架 |

依据：`MemberCenter.vue:213` 已确认「本地 license:activate 已在正式构建禁用…兑换码走服务端」；正式包内该通道本就不可达。移除后 `license-manager` 的职责收敛为 **trial + 离线 free 兜底 + features 查询 + 存量数据兼容**。

**配套处理（关键，否则会制造新缺陷）**：

1. **存量 `lifetime` 授权不降级**：全仓没有任何代码写 `lifetime` 类型，看着像死代码；但历史版本写过。直接删判断 = 那批已付费用户静默降级为免费。**已实施 `_migrateLegacyLicenseType()`**：加载期把 `lifetime` 规范化为 `pro`（能力不变、仍永不过期）并立即落盘，`load()` 的主文件分支与 `.bak` 恢复分支**都**接入（少一条就会让走备份恢复的用户降级）。
2. **`licenseStore.isPro` 保留读取**：它仍是 `ProfileMenu` / `useBatchPublish` 的判定输入，删掉会让已购用户在那些位置失去能力。**登记为已知债**：长期应统一迁移到 `hasFeatureOf(entitlement, feature)`（#3761 已确立的渲染层单一真源），但那属于「权益判定统一」独立任务，不在本次范围。

> **离线场景的结论**：删 `activate()` 后，离线已购用户靠**存量本地 license 数据**（`type: 'pro'`）继续生效；新订阅用户靠服务端 entitlement 下发。若将来要求「离线也能用新开通的权益」，正确做法是**由服务端下发到期时间并落本地**，而不是恢复本地自行判定。

### D3 `PRO_FEATURES`（本地 8 项）与 `plan-matrix` 的 features：要不要统一？

| 现状 | 风险 |
| --- | --- |
| 本地 `license-manager.js:23` 有硬编码 `PRO_FEATURES`（8 项） | 与服务端 `plan-matrix` 的 `features: string[]` 是**两套清单**，任何一侧改动都会漂移 |

**我的建议**：本次**不动**（属定价统一范畴，放进 B 部分），但**登记为已知债**。理由：动它会牵连 `hasFeature` / `getFeatures` / 渲染层判定，超出"移除买断"的范围。

### D4 `UpgradeModal` 的定位

移除支付 UI 后，该组件只剩：
- 演示三档价格（服务端 `entitlement.plans`）
- 「付费通道筹备中」状态

**我的建议**：保留组件（它是有用的价目展示 + 状态说明），但删除 `¥99 /永久`、`确认支付 ¥99`、模拟支付按钮与三条 payment import。

## A5. 实施方案（分层，TDD）

### A5.1 删除清单

| # | 文件 | 动作 |
| --- | --- | --- |
| 1 | `electron/services/payment-manager.js` | **删除整个文件** |
| 2 | `electron/ipc-handlers/payment.js` | **删除整个文件**（含 6 通道注册） |
| 3 | `electron/license-access-control.js` | 删 L13、L101 的 6 条 payment 通道登记 |
| 4 | `src/api/publisher.js` | 删 `paymentCreateOrder` / `paymentListOrders` / `paymentGetOrder` / `paymentSimulate` / `paymentCancel` |
| 5 | `src/components/UpgradeModal.vue` | 删 `¥99 /永久`、`确认支付 ¥99`、模拟支付按钮、3 条 payment import 与对应函数 |
| 6 | `electron/services/license-manager.js` | 删 `activate()`；删 `lifetime` 两处判断；`activateTrial` 保留 |
| 7 | `electron/ipc-handlers/license.js` | 删 `license:activate` handler（**待 D2 确认**） |
| 8 | preload 暴露 | 删 payment 相关桥接 |
| 9 | 测试 | 删/改对应断言（见 A5.3） |

### A5.2 明确不动

- 服务端订阅与兑换码全链（`plan-matrix` / `subscription-service` / `/api/v1/redeem` / entitlement 下发）
- `license-manager` 的 trial 能力（虽也有问题，但**不是买断**，不扩大范围）
- `PRO_FEATURES` 双清单问题（登记为债，B 部分处理）
- 会员中心（已正确）

### A5.3 TDD 顺序

1. **先写测试**（对每条删除，先写"应不存在"的断言）：
   - `payment-manager` / `payment.js` 文件不存在（或不再被 require）
   - `license-access-control` 白名单不含 `payment:*`
   - `publisher.js` 不再导出 payment 函数
   - `UpgradeModal` 源码不含 `¥99` / `/永久` / `paymentCreateOrder`
   - `license-manager` 不再有 `activate()` 与 `lifetime`
2. 跑测试确认**精确变红**（证明断言真的在测）
3. 实施删除
4. 转绿
5. **变异验证**：把 `¥99` 加回 `UpgradeModal`，确认源码锁变红

## A6. 验收标准

| # | 验收项 | 判据 |
| --- | --- | --- |
| AC-1 | 全仓无「¥99 /永久」买断文案 | `grep '¥99' apps/desktop/src` 零命中（除注释里的历史说明） |
| AC-2 | 全仓无 `payment:*` IPC 通道 | `grep 'payment:' electron/` 仅剩注释 |
| AC-3 | `payment-manager.js` 与 `payment.js` 已删 | 文件不存在 |
| AC-4 | `license-manager` 无 `activate()` 与 `lifetime` | 源码断言 |
| AC-5 | 会员中心兑换码链路不受影响 | `MemberCenter.test.js` 全绿 |
| AC-6 | 三档定价展示正常 | `entitlement.plans` 渲染测试绿 |
| AC-7 | **QM-1 打包验证通过** | 改动了 `electron/`，必须本地 `electron-builder --win --x64` 成功 + 启动验证 |
| AC-8 | 无孤儿 import / 未使用变量 | lint 0 error |

## A7. 风险与回滚

| 风险 | 处置 |
| --- | --- |
| 删 `payment.js` 导致主进程注册失败 | 同步删 `ipc-handlers/index.js`（或等价注册处）的引用；QM-1 打包 + 启动验证兜底 |
| 删 `activate()` 影响离线授权 | **D2 待确认**；若要求离线可用，改为「服务端下发到期时间」而非本地判定 |
| 渲染层残留 payment 调用 | `publisher.test.js` 的导出清单断言会红 |
| 用户已购买断的存量授权数据 | `type: 'pro'` 的本地 license 数据**不做迁移**（仍视为 pro），仅移除"新产生买断"的路径；如需清理另立项 |

---

# B 部分：定价统一与支付接入方案（待决策，本次不实施）

## B1. 一句话

让「定价权威源」「下单」「授权落库」三者对齐到**同一套订阅模型**，并给出一条真实可用的在线支付通道。

## B2. 现状：三处口径互不一致

| 环节 | 权威 | 口径 |
| --- | --- | --- |
| 定价展示 | `plan-matrix.js` | free ¥0 / standard ¥59月·¥499年 / pro ¥79月·¥699年（**订阅**） |
| 下单 | `payment-manager.js`（A 部分将删除） | pro ¥99 **一次性** |
| 授权落库 | `license-manager.activate()`（A 部分将删除） | `expiresAt = null`（**买断**） |
| 服务端订阅 | `subscription-service.grant({durationDays})` | **订阅**，有到期结算 |

A 部分移除买断后，口径收敛为「订阅」一套，但**在线支付仍缺**。

## B3. 决策点（需人工拍板，我无法代决）

### BD-1 定价模型最终形态

- **选项 A**：维持三档订阅（free / standard / pro），保留月付+年付双周期 → 与 `plan-matrix` 现状一致，改动最小
- **选项 B**：两档（free / pro），取消 standard → 需改 `plan-matrix` + 所有已下发 entitlement
- **选项 C**：加第四档（如 team）→ 影响定价矩阵、成本核算、兑换码批次

**建议 A**（现状即权威），除非商业上要调整。

### BD-2 支付通道

| 方案 | 说明 | 代价 |
| --- | --- | --- |
| 支付宝当面付 / 网页支付 | 个人/个体可申请，回调简单 | 需商户资质、备案域名、回调服务器 |
| 微信 Native 支付 | 需企业资质 | 同上，门槛更高 |
| 第三方聚合（如 Stripe / 连连 / Ping++） | 接入快，抽成高 | 依赖第三方合规 |
| **维持兑换码（无在线支付）** | 当前状态：运营发码 → 用户核销 | 零开发，但转化路径长 |

**建议**：先 BD-1 定档，再评估 BD-2。若短期不做在线支付，**兑换码 + 会员中心价目展示已是可用闭环**，不必为了"有支付"而仓促上未经审计的资金链路。

### BD-3 授权权威与时序

在线支付接通后必须回答：
- 支付回调 → `SubscriptionService.grant({durationDays, providerReference})` → 服务端落 `expiresAt`
- **幂等**：同一 `providerReference` 重复回调只 grant 一次（`REDEEM_TOPUP_MAX_ROUNDS` 有先例，可复用思路）
- **对账**：订单表与订阅表如何对账、退款如何回收权益
- **离线**：客户端持什么凭据（当前 entitlement 下发 + 本地缓存）

**这三条是资金安全的核心，必须在编码前定稿**。

### BD-4 `PRO_FEATURES` 双清单收敛

本地 `license-manager.js:23` 的 8 项 vs `plan-matrix` 的 `features[]`。建议**单一真源**：渲染端只认服务端 entitlement，本地清单降级为"离线兜底白名单"并加一致性测试。

## B4. 若决定实施在线支付，建议的任务拆分

| 阶段 | 内容 | 产出 |
| --- | --- | --- |
| P0 | 定 BD-1/BD-2/BD-3 | 决策记录（本文件补章） |
| P1 | 服务端：订单表 + 支付回调 + 幂等 grant + 对账 | API + 迁移 + 测试 |
| P2 | 客户端：下单页 + 支付态轮询 + 失败重试 | UI + 状态机 |
| P3 | 安全审计（资金链路）+ 灰度 | 审计报告 + 灰度数据 |
| P4 | 退款与客服流程 | 运营文档 |

**P1-P4 是一个独立项目**，不适合塞进"移除买断"这类清理任务。

---

## 附：本次实施（A 部分）的门禁义务

- 变更类型：运行时代码（`electron/` + `src/`）→ 隔离 worktree `mp-remove-buyout-license`
- **QM-1 强制**：改动 `apps/desktop/electron/` ⇒ 必须 `electron-builder --win --x64` 打包 + 启动验证三层判据
- CCG：跨模块 7+ 文件 ⇒ M+ ⇒ plan review + 双模型审查
- locale 成对：若改用户可见文案，`zh.js` / `en.js` 必须成对
