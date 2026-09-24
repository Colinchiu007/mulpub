# 会员中心阶段 2 · 真实支付与自动续费设计（Member Center P2 Payment Spec）

> 版本 v1.1 | 日期 2026-09-24 | 状态：🟡 CEO 评审完成（SELECTIVE EXPANSION）· 待最终签字后进入实施计划
> 范围：Multi-Publish 桌面端「会员中心」订阅变现的**真实支付链路**——支付通道选型、通道无关抽象、订阅创建/续费/取消写入、自动续费、续费/退款 webhook。
> 上游真源：`01-docs/DESIGN-MEMBER-CENTER-2026-09-23.md`（阶段 1，已 CEO 签字、PR #2314 已合并落地）、`packages/api-publish-engine/src/auth/postgres-commerce-store.js`、`.../publish-api-commerce.js`、`ops-center/docs/pricing-strategy.md`
> 阶段 1 地基复用：`identity_subscriptions`、`identity_orders`、`identity_redeem_codes`、`identity_entitlement_snapshots`、`identity_entitlement_usage`、`identity_webhook_events`；统一 upsert 的第 ③ 写入通道（支付回调）在阶段 1 置灰，本 spec 将其点亮。

---

## ⭐ CEO 评审结论（v1.1，2026-09-24 · SELECTIVE EXPANSION）

本轮以创始人/CEO 模式评审，结论为 **SELECTIVE EXPANSION**：保持既有范围与安全红线，graft 三项高杠杆扩展，延后一项。

**三条红线（进入编码前必须满足，硬性前置）：**
- **R-A 先 spike 反推抽象**：§2.3 首个生产通道供应商未定，抽象层不得对着空气锁定。实施第一步是对**单一通道**做沙箱 spike（真实结账 + 真实 webhook 载荷），用实际载荷格式（尤其幂等 ID、`custom_data` 回传、退款/proration 能力边界）反推并冻结 `PaymentProvider` 接口，再接第二通道验证可插拔。
- **R-B 定价与通道共同决策**：MoR 约 5% + $0.50/笔的固定费，对低价档（如 ¥6–12）毛利侵蚀显著。plan-matrix 真实定价（P1 §10 待办）必须与选定通道的费率/固定费**一起拍板**，不得先建计费后定价格。
- **R-C P1 会员面板 dogfood 闭环前不叠 P2 编码**：阶段 1 会员中心 UI shell 尚未在运行态完整验证（联调/dogfood 未闭环）。先闭环 P1，再在其上叠加支付，避免未验证面积翻倍、故障难定位。

**graft 的扩展（均优先复用通道原生能力，成本前置评估）：**
- ✅ **免费试用 `trial_days`**（订阅转化第一杠杆，见 §7.6）。
- ✅ **首日促销码 coupon**（通道原生 coupon，续约期正确性进金额校验，见 §7.7）。
- ✅ **自助收据/发票门户**（优先用通道 hosted 客户门户而非自建，见 §7.8）。

**明确延后：** ⏸ **取消时 win-back 挽留优惠** → 记为阶段 2.1（运营复杂度不匹配 MVP 付费体量）。

---

## 0. 背景与现状（承接阶段 1）

阶段 1 已交付并合并（PR #2314）：
- 三级订阅权益矩阵（free / standard ¥29·月 / pro ¥79·月）以服务端 `plan-matrix` 为唯一真源。
- `identity_subscriptions` 补了统一 upsert 写入路径，但只有两条通道可用：**① 兑换码核销 ② ops-center 后台开通**；第 **③ 支付回调**通道置灰。
- `identity_orders` 表已建（含 `channel / status / paid_at / refunded_at / invoice_status`），阶段 1 无真实扣款，订单仅由兑换码/后台开通回填。
- `identity_webhook_events` 表已存在（阶段 1 用于承接幂等事件去重），本 spec 作为支付 webhook 落点复用。
- 桌面端 `UpgradeModal.vue` 的「支付宝/微信」仍是**开发模式模拟支付**；「我的订阅 → 自动续费开关」置灰并标注「阶段 2 可用」。

**阶段 2 要补的缺口**：真实扣款、订阅续费/取消写入、支付回调验签、自动续费、续费失败（dunning）与退款、账单发票，且必须在**不锁定单一支付供应商**的前提下完成。

---

## 1. 范围、目标与非目标

### 1.1 目标（阶段 2 必达）
- G1：接入**至少一个**生产可用的订阅支付通道，跑通「下单 → 收银台 → 支付成功 → 订阅生效 → 快照回刷」全链路。
- G2：支付回调（webhook）**验签 + 幂等 + 乱序容忍**，作为订阅状态的唯一可信写入源；客户端展示只读服务端。
- G3：**自动续费**开关可用；续费成功/失败/到期降级由 webhook 驱动，不依赖客户端轮询。
- G4：**退款**与**到期取消**回写订阅与订单状态，权益即时收缩。
- G5：账单/发票入口打通（订单历史以服务端为准，衔接阶段 1 的 `identity_orders`）。

### 1.2 非目标（推后）
- 多币种税务自主申报（选 MoR 通道即由供应商承担，见 §2）。
- 按量计费/钱包充值（credit top-up）——本阶段只做**周期订阅**（月/年）。
- 团队/企业席位、合同采购、对公转账（企业能力另立 spec）。
- 复杂促销引擎（多层叠加、自动定价、A/B 促销）——阶段 2 仅接入**通道原生单品促销码 coupon**（见 §7.7），不自建营销引擎。
- 支付通道自助切换的运营后台 UI（先以配置驱动，见 §2.4）。

---

## 2. 支付通道选型（通道无关优先）

### 2.1 两种模式：MoR vs PSP（核心分野）

| 维度 | MoR（Merchant of Record，记录商户） | PSP（Payment Service Provider，支付网关） |
|---|---|---|
| 法律卖家 | 供应商是卖家，你只是供货方 | **你**是卖家 |
| 税务/发票/合规 | 供应商负责（VAT/GST/销售税自动算） | 你自负 |
| 退款/拒付 | 供应商托管 | 你处理 |
| 费率 | 高（Paddle 约 5% + $0.50/笔） | 低（约 2.9% + $0.30） |
| 集成负担 | 低（订阅生命周期原生） | 高（需自建账单、税务、门户） |
| 代表 | Paddle、Lemon Squeezy、国内托管收单 | Stripe、支付宝/微信直连 |

**决策**：阶段 2 MVP 选 **MoR 模式**——用最低合规负担跑通全球/全国订阅，符合「能不用数据库就不用、能不自建复杂度就不建」的项目原则。PSP 直连（自建支付宝/微信）推后，仅在国内 MoR 覆盖不足时作为补充通道。

### 2.2 候选通道对比

| 通道 | 模式 | 订阅 API | 关键 webhook 事件 | 验签 | 中国区支付宝/微信 | 备注 |
|---|---|---|---|---|---|---|
| **Paddle** | MoR | 原生（trial/升降级/暂停/取消） | `subscription.{created,updated,activated,past_due,canceled,paused,resumed}`、`transaction.{paid,completed,past_due}`、`adjustment.{created,updated}` | `paddle-signature` 头（AES+时间戳） | 支持部分国际卡，国内收单弱 | 结算含税，dunning 内置 |
| **Lemon Squeezy** | MoR（Stripe 背书，2023 收购） | 原生订阅 + 客户门户 | `order_*`、`subscription_{created,active,payment_success,payment_failed,cancelled,scheduled_cancel}` | `Signature` 头（HMAC-SHA256） | 同 Paddle | **不支持经 API 立即取消**，走门户/到期取消 |
| **国内托管收单** | MoR/半托管 | 视供应商 | 自定义 | 各供应商 RSA/签名 | **强**（支付宝/微信Native） | 人民币定价、发票（电子发票）贴合本项目 ¥ 口径 |

### 2.3 推荐落地策略：主通道 + 抽象层可替换
- **默认实现**优先做**与本项目 ¥ 定价/支付宝·微信用户习惯最贴合的国内托管通道**（对齐 §2 现有定价矩阵），把其适配器作为 `PaymentProvider` 的第一个 reference impl。
- **Paddle / Lemon Squeezy** 作为国际通道的第二/第三适配器，验证抽象层可插拔；不强制阶段 2 全接，先接一个国际通道即可。
- 以 `config.yaml` 的 `payment.provider` 选择激活通道（见 §2.4），**代码零改**切换供应商。

### 2.4 配置驱动（运营可配，延续阶段 1「金额以服务端为唯一真源」）
```yaml
# config.yaml（示意）
payment:
  provider: domestic_hosting        # domestic_hosting | paddle | lemon_squeezy
  environment: sandbox              # sandbox | live
  webhook_secret_ref: PAYMENT_WEBHOOK_SECRET   # 仅引用环境变量名，严禁明文入库/入仓
  allowed_currencies: [CNY]         # 国际通道时追加 USD
  dunning:
    retry_days: [1, 3, 5]           # 续费失败重试节奏（供应商侧或本侧调度）
    grace_hours: 48                 # 过期后权益宽限，超时回落 free
  idempotency_window_days: 30       # webhook 事件去重时间窗
```
- 密钥**只走环境变量/密管**，`.env.example` 提供占位；仓库内禁止任何真实 key/secret（安全门禁）。
- `environment` 与 `app.isPackaged` 解耦：打包态不得因 `NODE_ENV`/`ELECTRON_IS_DEV` 落到 sandbox（延续阶段 1 §7 门禁）。

---

## 3. PaymentProvider 抽象接口（通道无关契约）

所有通道实现同一接口，服务端只依赖抽象，不感知具体供应商字段。

```js
// 概念签名（实施时落 packages/api-publish-engine/src/auth/payment-providers/*）
interface PaymentProvider {
  // 创建一次订阅结账会话，返回收银台跳转/嵌入所需的 checkout 载荷
  createCheckout({ userId, plan, period, currency, trialDays?, couponCode?, successUrl, cancelUrl }): { checkoutToken, checkoutUrl, expiresAt }

  // 主动取消（若通道不支持 API 立即取消，实现内部转标记 cancel-at-period-end）
  cancelSubscription({ providerSubId, atPeriodEnd }): { status, effectiveAt }

  // 切换套餐（升级立即生效/降级下周期生效由通道决定，归一化到内部语义）
  changePlan({ providerSubId, newPlan, proration }): { status, nextBillAt }

  // 解析并验签 webhook 原始请求 → 归一化事件（失败抛 WebhookSignatureError）
  parseWebhook(rawReq): NormalizedEvent

  // 通道能力声明（供上层降级决策）
  capabilities(): { immediateCancel: bool, refunds: bool, proration: bool, autoRenewToggle: bool, trial: bool, coupons: bool, customerPortal: bool }
}

// 归一化事件（屏蔽通道差异，喂给 §6 状态机）
type NormalizedEvent = {
  provider, externalEventId,   // 幂等键
  type: 'checkout.completed' | 'subscription.activated' | 'subscription.renewed'
      | 'subscription.canceled' | 'payment.failed' | 'refunded' | 'subscription.plan_changed'
      | 'subscription.trial_started' | 'subscription.trial_end',
  providerSubId, userId?, plan?, period?, amount?, currency?, discount?, couponCode?,
  occurredAt, currentPeriodEnd?, raw   // raw 仅入库不外泄
}
```
- **能力协商**：上层据 `capabilities()` 决定交互（如 Lemon Squeezy `immediateCancel=false` → UI 取消按钮文案改「将在本周期结束时取消」，见 §10.3）。
- 新增通道 = 新增一个 provider 适配器 + 一个 `parseWebhook` 归一化映射，**不改状态机、不改订单表**。

---

## 4. 数据模型（在阶段 1 表上扩展，最小新增）

### 4.1 `identity_orders`（阶段 1 已建，补字段/取值）
- 复用列：`id / user_id / plan / amount / currency / channel / status / created_at / paid_at / refunded_at / invoice_status`。
- `channel` 取值扩展：`redeem`（兑换码，阶段1）| `ops_admin`（后台开通，阶段1）| `paddle` | `lemon_squeezy` | `domestic_hosting`（阶段2）。
- `status` 语义收敛为状态机产物：`pending → paid → (refunded | failed)`；`pending` 由 `createCheckout` 落库，终态由 webhook 驱动。
- **新增可空列**（迁移见 §11）：`provider_order_id`、`provider_sub_id`、`period`（month|year）、`discount`（券减免额，服务端算）、`coupon_code`（核销的促销码，仅审计用，金额仍以回调结算额为准）。

### 4.2 `identity_subscriptions`（阶段 1 已建，补续费字段）
- 复用：`plan / user_id / period / status / expires_at`。
- 新增可空列：`provider`、`provider_sub_id`、`auto_renew`（bool，默认 false）、`cancel_at_period_end`（bool）、`last_event_id`（幂等水位）、`renewal_state`（`active | past_due | canceled`）、`trial_ends_at`（试用到期时刻，null=非试用）。
- 唯一约束建议 `(user_id)` 主订阅 + 历史归档，续费只更新 `expires_at` 与 `status`。

### 4.3 `identity_payment_customers`（新建，用户↔通道客户映射）
- 列：`user_id / provider / provider_customer_id / email / created_at / updated_at`；唯一 `(provider, provider_customer_id)`、索引 `(user_id, provider)`。
- 用途：webhook 常以供应商 customer id 回传，需反查 `user_id`；结账前写入映射。

### 4.4 `identity_webhook_events`（阶段 1 已建，作支付落点）
- 列复用：事件幂等键（`provider + external_event_id` 唯一）、`event_type`、`occurred_at`、`processed_at`、`status(pending|processed|ignored|failed)`、`payload(jsonb)`、`error`。
- 作用：**先落库再处理**（outbox 式），保证乱序/重复/重放可追溯、可重放修复。

### 4.5 金额与真源铁律
- 客户端**只上报 `plan` + `period`**，金额/币种一律服务端据 `plan-matrix` 计算写入订单，**绝不信任客户端传入金额**（防篡改）。
- 订单 `amount` 与回调 `amount` 不一致时：以回调实际结算额为准记账，但触发 `PAYMENT_AMOUNT_MISMATCH`（WARN）供对账。

---

## 5. 结账与订阅创建流程（happy path）

```
会员中心「升级」选套餐(period)
   │ ① 客户端 POST /api/v1/me/checkout { plan, period }   // profile:write
   ▼
服务端：plan-matrix 校验 plan/period → 计算 amount/currency
   → 落 identity_orders(status=pending, channel=provider)
   → ensure identity_payment_customers 映射
   → provider.createCheckout(...) → 返回 { checkoutUrl, checkoutToken, expiresAt }
   ▼
客户端跳转/内嵌收银台 → 用户在供应商页完成支付
   │
   ▼
供应商异步回调 POST /api/v1/webhooks/payment（验签，见 §7）
   → 归一化 NormalizedEvent(type=checkout.completed / subscription.activated)
   → 幂等入库 identity_webhook_events → 状态机(§6) upsert 订阅
   → 订单 status: pending→paid，回填 provider_order_id/paid_at
   → 重新签发 RSA entitlement 快照
   ▼
客户端 sync()（或收到轮询/推送）拉新快照 → 权益/配额即时刷新
```
- **成功页不等回调**：跳转回 `successUrl` 仅表示「已发起」，最终状态以 webhook 为准；成功页展示「支付处理中，权益稍后到账」占位，避免用户误判。
- 超时保护：`pending` 订单 `expiresAt` 后未完成 → 定时任务置 `failed`（不进订阅）。

---

## 6. Webhook 事件归一化与订阅状态机

### 6.1 通道事件 → 归一化事件 → 内部动作（映射表）

| 归一化事件 | Paddle 源 | Lemon Squeezy 源 | 国内托管源 | 状态机动作 |
|---|---|---|---|---|
| `checkout.completed` | `transaction.paid` | `order_created` | 支付成功通知 | 建/更新订阅 active、订单 paid、签发快照 |
| `subscription.renewed` | `subscription.updated`(周期滚动) | `subscription_payment_success` | 续费通知 | `expires_at` 顺延、renewal_state=active |
| `payment.failed` | `subscription.past_due`/`transaction.past_due` | `subscription_payment_failed` | 扣款失败 | renewal_state=past_due，进 dunning（§7.4） |
| `subscription.canceled` | `subscription.canceled` | `subscription_cancelled`/`scheduled_cancel` | 取消/退订 | cancel_at_period_end→到期回落 free；立即→即刻收缩 |
| `refunded` | `adjustment.created`(refund) | `order_refunded` | 退款通知 | 订单 refunded、订阅回滚、权益收回、通知用户 |
| `subscription.plan_changed` | `subscription.updated`(items变) | `subscription_updated`(plan变) | 套餐变更 | 升级即刻、降级下周期（§7.3） |
| `subscription.trial_started` | `subscription.trial_started`(若启用 trial) | `subscription_created`(trial) | 试用开始通知 | 建订阅 active、写 `trial_ends_at`、试用期内不计费 |
| `subscription.trial_end` | `transaction.paid`(试用转付费) | `subscription_payment_success`(试用后首扣) | 试用转付费通知 | 清 `trial_ends_at`、订单 paid、进入正常续费周期 |

### 6.2 状态机（订阅 renewal_state + 订单 status 联动）
```
subscription: none --checkout.completed--> active
active --payment.failed--> past_due --dunning成功--> active
past_due --grace超时/持续失败--> canceled --(到期)--> none(free)
active --subscription.canceled(at_period_end)--> active(标记) -->到期--> none
active --refunded--> 回滚至退款前有效状态或 none（按通道 policy）
order: pending --> paid --> refunded
pending --> (超时/失败) --> failed
```
- **只允许服务端 + webhook 迁移**；任何客户端直调都不能推进订阅状态。

### 6.3 乱序与幂等
- 事件带 `occurredAt`；订阅维护 `last_event_id`/水位，早于当前状态的陈旧事件 **ignored 但仍入库**（审计），不回退更新的状态。
- 幂等键 `(provider, external_event_id)` 唯一：重复回调命中已 processed 记录直接 2xx 返回，不重复签发快照/不重复扣减。
- `checkout.completed` 与后续 `subscription.updated` 可能几乎同到：以 `provider_sub_id` 聚合同一订阅，状态取「单调前进」。

---

## 7. 续费、升降级、退款、自动续费

### 7.1 自动续费开关（解锁阶段 1 置灰项）
- `PATCH /api/v1/me/subscription/auto-renew { enabled }` → 据 provider `capabilities().autoRenewToggle` 调通道或直接维护 `auto_renew` 列 + 到期由通道续费；开关即时回显，最终由 webhook 确认。
- 关闭自动续费：`cancel_at_period_end=true`，**当前周期内权益保留**，到期不续 → 回落 free。

### 7.2 续费扣款
- 由通道在 `expires_at` 前发起，成功→`subscription.renewed` 顺延周期；失败→`payment.failed`。服务端不自行扣款（MoR 托管）。

### 7.3 升级 / 降级
- **升级**（free→standard→pro）：即刻生效，按比例补差价（proration，若 `capabilities().proration`）；权益即时提升，重签快照。
- **降级**：下周期生效（不中断当前已付周期），`cancel_at_period_end` + 计划变更；到期切换到新 plan。

### 7.4 续费失败 dunning
- 按 `config.dunning.retry_days` 节奏（供应商侧重试优先，本侧记录状态）；`grace_hours` 内保留权益并顶部横幅告警「续费失败，请更新支付方式」，超宽限期回落 free（`/api/v1/me` 返回降级）。

### 7.5 退款
- `refunded` 事件驱动：订单 `refunded`、订阅按通道 policy 回滚或置到期、权益即时收缩、`identity_notifications` 推送退款结果。
- 退款入口仅**申请**（`POST /api/v1/me/orders/{id}/refund-request`），是否可退由通道/运营判定，不承诺即时退款成功。

### 7.6 免费试用 trial_days（graft）
- 结账时可带 `trialDays`（若 `capabilities().trial`）。服务端据 plan-matrix + 通道 trial 能力下发，客户端不可自造天数绕过计费。
- 试用期内订阅 `active` 但**无扣款订单**（或 0 额订单），`trial_ends_at` 标记到期。
- 到期由通道发起首扣 → `subscription.trial_end`/`transaction.paid` → 转正常续费周期，签发正式 `paid` 订单。
- 试用期内关闭自动续费：到期不扣款，回落 free，**不产生欠费/dunning**。
- 反滥用：同 `user_id`/同支付指纹仅享一次试用（`capabilities` 决定是否支持，否则服务端记 `trial_ends_at` 历史去重）。

### 7.7 促销码 coupon（graft，通道原生优先）
- 结账可带 `couponCode`（若 `capabilities().coupons`）。**校验与减免一律在通道侧**完成，服务端不自行算折扣价（避免与通道结算额分叉）。
- **续约期正确性铁律（CEO 红线）**：coupon 有「一次性 / 逐期 / 前 N 期」三种生效域。归一化事件的 `amount` 必须区分**首期减免额**与**续约原价**；`subscription.renewed` 事件的金额校验须按 coupon 的 duration 语义判定，**“首月半价”类券不得错误作用于续约**——`PAYMENT_AMOUNT_MISMATCH` 对账须把 coupon duration 纳入期望值计算，避免误报/漏报。
- 促销码有效性以通道回执为准：`checkout` 阶段通道拒绝无效码 → 归一化 `400 COUPON_INVALID`，不落 `pending` 订单。

### 7.8 自助收据 / 发票门户（graft，不自建）
- **优先复用通道 hosted 客户门户**（Paddle/国内托管多提供换卡、发票下载、订阅管理）：新增 `POST /api/v1/me/portal-session` → provider 返回一次性 `portalUrl`（有时效），前端跳转。**不镜像敏感支付因子到本地**。
- 仅当通道无门户（`capabilities().customerPortal=false`）时，退化为**只读**发票列表（读 `identity_orders` 已回填的 `invoice_status`），发票实体下载仍走通道。

---

## 8. 安全（支付是最高危面）

- **验签强制**：`parseWebhook` 校验通道签名头（Paddle `paddle-signature`、LS `Signature` HMAC、国内 RSA）；验签失败 → `WebhookSignatureError` → 401，**不入库不处理**（防伪造回调白嫖权益）。
- **时间戳防重放**：签名带时间戳，偏离当前 > 容差（建议 5 min）拒绝。
- **幂等 + outbox**：见 §4.4/§6.3，事件先落库再处理，可安全重放。
- **金额夹紧**：订单金额服务端算，回调金额仅供对账，绝不据客户端参数计费（§4.5）。
- **最小暴露**：webhook 处理内部错误统一 `500 PAYMENT_WEBHOOK_INTERNAL`，绝不回显 SQL/供应商原文；`raw` payload 仅入 `jsonb` 不外泄给客户端。
- **鉴权分离**：`/api/v1/me/checkout` 等用户态接口走 Logto scope（`profile:write`）；`/api/v1/webhooks/payment` 为**免登录但强验签**的服务到服务端点，必须单独 allowlist，绝不套用用户鉴权也不裸开放。
- **密钥治理**：secret 仅环境变量/密管，`.env.example` 占位；pre-commit/CI 扫硬编码密钥。
- **审计**：订阅状态每次迁移记 `user_id/provider/event_type/old→new/occurred_at`，可追溯。
- **二次确认**：退款申请、关闭自动续费在 UI 侧二次确认（延续阶段 1 §7 敏感操作）。

---

## 9. 端点契约与数据校验（延续阶段 1 §3.8 风格）

> 全部命中既有 `_commerceFailure` 统一映射：status 夹紧 `[400,599]` 否则 500；code 必须匹配 `^[A-Z][A-Z0-9_]{2,63}$` 否则兜底 `COMMERCE_INTERNAL_ERROR`；`>=500` 记 error 日志回「服务暂时不可用」。

**新增用户态端点（`/api/v1/me*`，scope 见括注）：**

| 端点 | 方法 | scope | 校验 | 成功 | 主要错误码 |
|---|---|---|---|---|---|
| `/api/v1/me/checkout` | POST | `profile:write` | `plan∈{free,standard,pro}`；`period∈{month,year}`（free 拒绝 400 PLAN_INVALID）；可选 `trialDays`（须 ≤ plan-matrix 上限且通道支持）、`couponCode`（格式校验后交通道验证） | 200 `{checkoutUrl,checkoutToken,expiresAt,orderId}` | 400 CHECKOUT_PLAN_INVALID / 400 CHECKOUT_PERIOD_INVALID / 400 COUPON_INVALID / 400 TRIAL_UNSUPPORTED / 503 PAYMENT_PROVIDER_UNAVAILABLE |
| `/api/v1/me/subscription` | GET | `profile:read` | — | 200 `{plan,period,expiresAt,autoRenew,cancelAtPeriodEnd,renewalState}` | 503 MEMBERSHIP_UNAVAILABLE(fail-soft 200 不含段) |
| `/api/v1/me/subscription/auto-renew` | PATCH | `profile:write` | `enabled` 必须布尔 | 200 `{autoRenew,cancelAtPeriodEnd}` | 400 AUTO_RENEW_PARAM_INVALID / 405 METHOD_NOT_ALLOWED |
| `/api/v1/me/subscription/cancel` | POST | `profile:write` | 可选 `atPeriodEnd`(默 true) | 200 `{status,effectiveAt}` | 400 CANCEL_AT_PERIOD_END_UNSUPPORTED（通道不支持立即取消时） |
| `/api/v1/me/orders` | GET | `profile:read` | 分页 `limit≤100` | 200 订单列表 | — |
| `/api/v1/me/orders/{id}/refund-request` | POST | `profile:write` | 订单须属本用户且 `paid` | 202 `{requestId,status:pending}` | 404 ORDER_NOT_FOUND / 409 ORDER_NOT_REFUNDABLE |
| `/api/v1/me/portal-session` | POST | `profile:read` | 用户须有 `identity_payment_customers` 映射 | 200 `{portalUrl,expiresAt}` | 503 PORTAL_UNAVAILABLE / 404 CUSTOMER_NOT_FOUND |

**服务到服务端点：**

| 端点 | 方法 | 鉴权 | 契约 |
|---|---|---|---|
| `/api/v1/webhooks/payment` | POST | 免登录·强验签（§8） | 2xx=已接收（含重复/忽略）；401 验签失败；400 载荷不可解析；处理内部错误 500 但**仍返回 2xx 给通道以免风暴重投**（错误已入库供重放） |

**数据校验细则：**
- `plan`/`period` 枚举白名单，非枚举值一律 `400 CHECKOUT_PLAN_INVALID`/`CHECKOUT_PERIOD_INVALID`，绝不落到供应商。
- `checkoutToken`/`provider_sub_id`/`provider_customer_id`/`external_event_id`：格式 `[A-Za-z0-9_.:-]{8,128}`，越界拒绝，防注入。
- webhook `occurredAt` 必须合法 RFC3339；缺失/非法 → 记 `ignored` 不推进状态机。
- `amount` 若出现必须为非负且小数位合法；异常仅对账不改计费（§4.5）。
- 未注册路径 `404 ROUTE_NOT_FOUND`；集合家族错动词 `405 METHOD_NOT_ALLOWED`。

---

## 10. 前端交互、显示项与提示文字（会员中心）

### 10.1 「我的订阅」页（解锁自动续费）
- 显示：当前套餐、计费周期、`expires_at`（本地化日期）、下次扣款日、自动续费状态。
- **自动续费开关**：从置灰改为可用；关→二次确认弹层文案「关闭后将在本计费周期结束时（{date}）停止续费，到期后回落免费版」。
- 若 `cancel_at_period_end=true`：顶部黄条「订阅将于 {date} 到期，暂不续费」+「重新开启」按钮。
- `renewal_state=past_due`：红条「扣款失败，请在 {grace} 前更新支付方式，否则权益暂停」+「更新支付方式」跳通道客户门户。

### 10.2 升级/结账流
- 套餐对比卡 → 选套餐/周期 → 「前往支付」→ 内嵌或跳转收银台；返回后订阅卡显示「支付处理中」占位骨架（非错误态），轮询 `/me/subscription` 或收快照回刷后更新为生效态。
- 失败/取消返回：提示「支付未完成，未扣款，可重试」，不产生 `paid` 订单。
- 支持试用的套餐：升级卡展示「免费 N 天试用，随时取消」CTA（据 `capabilities().trial`），结账页确认「试用到期前不会扣款」。
- 促销码输入框：结账页可填 coupon，失焦即调 checkout 预校验通道回执；无效提示「优惠码不可用或已过期」（续约期减免语义由服务端保证，前端不承诺“永久折扣”文案）。

### 10.3 文案随通道能力动态化
- 不支持立即取消的通道：取消按钮「将在本周期结束时取消」（据 `capabilities().immediateCancel`）。
- 金额/币种一律来自服务端，前端不硬编码（延续阶段 1 铁律）。

### 10.4 订单与账单
- 订单历史列表：时间、套餐、金额+币种、状态徽标（待支付/已支付/已退款/失败）、发票状态。
- 发票/收据：优先「管理订阅/账单」按钮跳通道客户门户（`/me/portal-session`）；通道无门户时提供只读发票列表（实体下载仍走通道）。退款入口仅 `paid` 订单可用。

### 10.5 i18n
- 所有新增用户可见文案写入 `locales/zh.js` + `en.js` **成对**（CI Gate 7 `check-locale-sync.js` 拦截）；产品名词入 `01-docs/i18n-glossary.md`。

---

## 11. 迁移、灰度与回滚

- **schema 迁移**：新增列全部 `NULL` 可空 + 默认值向后兼容（`auto_renew default false`），阶段 1 数据不受影响；迁移脚本置于 `migrations/`，幂等可重跑。
- **阶段 1 mock 退役**：`UpgradeModal` 开发模式模拟支付在 `payment.environment=live` 时禁用；sandbox 仍可用于测试。`payment-orders.json` 本地 mock 只读缓存化，不再作为真源（阶段 1 §3.2 已定）。
- **双通道并存**：兑换码/后台开通（阶段 1）与支付（阶段 2）共用统一 upsert，互不覆盖；同用户多来源以「最高有效 plan + 最晚 expires_at」聚合。
- **灰度**：先 `sandbox`（通道测试密钥）跑全链路验收 → 白名单小流量 `live` → 全量。
- **回滚**：`payment.provider=none` 关闭支付入口，订阅退回阶段 1 三通道（兑换码/后台）；webhook 端点保留但只落库不推进（kill-switch）。

---

## 12. 验收标准（阶段 2）

1. 选套餐→结账→沙箱支付成功→webhook 到订阅 active→`/api/v1/me` 快照刷新→客户端权益/配额一致生效（含离线重启仍读快照）。
2. 伪造/验签失败的回调被拒（401）且不改变任何订阅状态；重复回调幂等（不重复签发/不重复计费）。
3. 续费成功自动顺延 `expires_at`；续费失败进 past_due + dunning，超宽限期回落 free。
4. 自动续费开/关即时回显并经 webhook 确认；关闭后到期不续。
5. 升级即刻生效（含 proration，如支持）、降级下周期生效，权益正确收缩/扩张。
6. 退款回写订单 refunded + 订阅/权益回滚 + 通知送达。
7. 金额一律服务端计算；客户端传金额被忽略。
8. 至少一个国内通道 + 一个国际通道（Paddle 或 LS）经同一抽象层跑通，配置零代码切换验证。
9. zh/en 成对；QM-1 打包验证通过；阶段 1 全部场景（兑换码/后台/权益矩阵/门禁）不回归。
10. 免费试用：试用期内不产生扣款、`trial_ends_at` 正确；到期首扣转正常周期；试用内关自动续费到期直接回落 free 不产生欠费；同用户二次试用被拒。
11. 促销码：无效码在 checkout 被通道拒 → 400 COUPON_INVALID 不落单；“首月半价”类券续约按原价扣款且**不触发误报对账**（duration 语义正确）。
12. 客户门户：`/me/portal-session` 返回有时效 `portalUrl` 可跳转；通道无门户时降级只读发票列表，本地不镜像敏感支付因子。

---

## 13. 测试策略（TDD 要点）

- **Provider 契约测试**：每个适配器对 `createCheckout/cancel/changePlan/parseWebhook/capabilities` 的输入输出契约 + 归一化映射表逐事件断言。
- **Webhook 验签**：正/负签名、过期时间戳（防重放）、乱序事件、重复事件幂等、`raw` 不外泄。
- **状态机**：§6.2 全转移覆盖（含 past_due→active、refunded 回滚、cancel_at_period_end 到期降级）；陈旧事件不回退。
- **金额真源**：客户端传 amount 被忽略、服务端据 plan-matrix 计算、对账 mismatch 记 WARN 不改计费。
- **快照联动**：每次订阅迁移触发重签 RSA 快照；离线宽限内权益可用。
- **门禁/回归**：`requireFeature` 三档正负例在支付路径下仍成立；Story2Video 等既有场景不回归。
- **前端**：自动续费开关解锁、past_due 横幅、支付处理中占位、通道能力文案（立即取消 vs 到期取消）、IPC 纯 JSON 序列化。
- **打包**：改 `apps/desktop/electron/` 后 QM-1 完整打包 + require 链 + 8s 启动不崩。
- **沙箱端到端**：用通道 test 密钥跑支付成功/续费/失败/退款/取消五条链路后再切 live。
- **试用**：`trial_started`→`trial_end`→首扣转付费；试用期无扣款；到期未续回落 free；二次试用去重拒绝。
- **促销码续约正确性**：once/forever/`repeated`(N 期) 三种 duration 下，首期减免额 vs 续约原价的金额校验；续约不得误套首期折扣；mismatch 对账纳入 coupon duration 期望。
- **客户门户**：portal-session 签发时效 URL、无门户通道降级只读列表、敏感字段不外泄。

---

## 14. 待办登记（进入实施计划前）

**CEO 红线前置（必须先满足，见 §⭐）：**
- [ ] R-A：单通道沙箱 spike 完成，用真实载荷反推并冻结 `PaymentProvider` 接口（含 trial/coupon/portal 能力边界）。
- [ ] R-B：plan-matrix 真实定价与选定通道费率/固定费共同拍板。
- [ ] R-C：阶段 1 会员中心 UI shell 完成运行态联调 + dogfood 闭环。

**常规待办：**
- [ ] 通道尽调落地：确定首个生产通道国内托管供应商与合同/费率、验签方式、沙箱开通。
- [ ] `PaymentProvider` 接口与目录冻结（`payment-providers/{domestic_hosting,paddle,lemon_squeezy}.js`）。
- [ ] 迁移脚本评审：§4 新增列、`identity_payment_customers` 建表。
- [ ] webhook 端点与用户态端点鉴权 allowlist 评审（§8/§9）。
- [ ] dunning 定时任务归属（供应商侧 vs 本侧调度）与 `grace_hours` 数值确认。
- [ ] 发票/退款申请是否与 ops-center 后台联动的边界确认。
- [ ] trial/coupon/portal 三项 graft 的通道原生能力确认（选定通道后据 `capabilities()` 落地，缺失项降级方案见 §7.6–7.8）。
- ⏸ win-back 挽留优惠（阶段 2.1，CEO 评审明确延后，不入本 spec 实施范围）。
