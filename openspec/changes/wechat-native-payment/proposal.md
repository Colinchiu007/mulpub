---
change: wechat-native-payment
status: in-progress
created: 2026-10-21
branch: wechat-native-payment
---

# wechat-native-payment — 微信 Native 扫码支付接入（最小闭环）

## 背景

2026-10-21 用户确认微信支付资质全部到位：**个体工商户 + 微信 Native（扫码）已申请、ICP 备案公网域名可做 HTTPS 回调、API v3 密钥与商户证书已到手**。这解开了阻塞商业化自助转化的最后一环。

在此之前，本项目的授权开通渠道只有两条，都在 `packages/api-publish-engine/src/auth/subscription-service.js`：

| # | 通道 | `identity_orders.channel` | 用户可达性 |
|---|---|---|---|
| ① | 兑换码核销 `redeem()` | `redeem` | 需运营人工发码，转化路径长 |
| ② | 后台开通 `grant()` | `admin_grant` | 仅 ops-center 管理员，终端用户不可达 |
| ③ | **支付回调** | `payment` | **枚举已预留（`004_member_commerce.sql:12`）但从未写入——本变更点亮它** |

客户端侧，升级入口已从死胡同弹窗改指会员中心（`fix-upgrade-payment-entry`，PR #3798），在线支付长期显示「付费通道筹备中，暂不支持购买」（`locales/member-center/zh.js:78`）。

## 上游设计的显式偏离（必读）

`01-docs/DESIGN-MEMBER-CENTER-P2-PAYMENT-2026-09-24.md`（v1.1）是为 **MoR 托管订阅**（Paddle / Lemon Squeezy / 国内托管收单）写的。微信 Native 是 **PSP 直连**，两者在订阅语义上结构性不同。本变更对上游做如下**显式偏离**：

| 上游设计 | 本变更 | 理由 |
|---|---|---|
| §2.3 主通道＝国内托管 MoR，Paddle/LS 作第二三适配器 | 主通道＝**微信 Native 直连**，抽象层保留但首个实现即微信 | 用户已拿到微信资质；MoR 通道未签约，没有「先接一个」的现实选项 |
| §3 `PaymentProvider` 六方法（含 `cancelSubscription`/`changePlan`/`capabilities`） | **收缩为三方法**：`createCheckout` / `parseWebhook` / `capabilities` | 微信 Native 无订阅 ID（每次下单独立），无 API 取消/改套餐语义。对空气设计六方法正是上游 R-A 红线警告的 |
| §7.1 自动续费开关 | **不做** | 需签约「委托代扣」（另一资质，未申请）。续期＝用户重新下一单 |
| §7.3 升级/降级 proration | **不做** | 无订阅对象可改价。升降级＝下一单时按新档位全价 |
| §7.5 退款 | **不做**（仅 ops-center 人工退款入口） | 退款走商户平台后台操作，不接 API；权益回收由运营在后台执行 |
| §7.6 免费试用 | **不做** | 上游红线已明「代码无实现，不得对客户承诺」；本期保持不承诺 |
| §7.7 促销码 coupon | **不做** | 微信 Native 无原生 coupon；自建营销引擎是上游明确非目标 |
| §7.8 客户门户 | **不做** | 无 hosted portal；订单列表改走本仓 `/api/v1/me/orders`（已存在） |
| §11 双通道并存 + `payment.provider` 配置切换 | **单通道硬编码微信**，保留 provider 目录结构但**不做配置切换** | 只有一个通道时，配置开关是无人执行的死代码 |

**保留**：抽象层目录结构（为将来第二通道留形）、归一化事件模型、`identity_webhook_events` outbox 落点、金额服务端真源铁律、验签强制、幂等键。

## 目标（G1–G6）

- **G1**：会员中心选套餐 → 下单 → 展示微信扫码二维码 → 用户手机支付 → webhook 回调 → 订阅生效 → 客户端权益刷新，全链路可跑通。
- **G2**：金额**一律服务端**按 `plan-matrix` 计算，客户端只上报 `{plan, period}`；客户端传 `amount` 被忽略。
- **G3**：webhook **验签 + 幂等 + 乱序容忍**；伪造/验签失败回调被 401 拒且不改变任何订阅状态。
- **G4**：订单状态机 `pending → paid`（超时 `failed`）由 webhook 驱动，客户端只读。
- **G5**：续期语义 = 重新下一单，复用既有 `applySubscription` 续叠与跨档压制保护，**不新增授权写入路径**。
- **G6**：`payment.provider=none` 或未配置商户凭据时，下单入口 fail-closed 隐藏，不渲染扫码页。

## 非目标（本期明确不做）

自动续费、委托代扣、升降级 proration、自助退款、免费试用、促销码、客户门户、多通道配置切换、国际卡、多币种。

## 范围

| ID | 内容 | 承载模块 |
|---|---|---|
| P0-1 | 迁移 `006_payment_orders.sql`：`identity_orders` 补 4 列 + 新建 `identity_payment_customers` + `identity_orders` 索引 | `migrations/postgresql/` + `postgres-identity-repository.js` SCHEMA 同步 |
| P0-2 | `PaymentProvider` 抽象（三方法）+ `WeChatNativeProvider` 实现（下单 / 验签 / 归一化） | `packages/api-publish-engine/src/auth/payment-providers/` |
| P0-3 | `SubscriptionService.createCheckout()` + `settlePaymentWebhook()` | `subscription-service.js` |
| P0-4 | 用户态端点 `POST /api/v1/me/checkout`、`GET /api/v1/me/orders/{id}` | `publish-api-server.js` |
| P0-5 | 服务到服务端点 `POST /api/v1/webhooks/payment`（免登录强验签） | 同上 + 新 mixin 文件 |
| P0-6 | 桌面端 IPC：`wechat-pay:create-order` / `wechat-pay:order-status` | `electron/ipc-handlers/` + `preload/` + `license-access-control.js` 白名单 |
| P0-7 | 二维码渲染（纯本地，零新依赖）+ 扫码页 + 轮询 + 成功/失败态 | `src/views/member-center/` + `src/components/` |
| P0-8 | locale zh/en 成对 + `UpgradeModal` 文案从「筹备中」改为可用 | `src/locales/member-center/{zh,en}.js` |
| P0-9 | 契约锁：改造 `buyout-removal.contract.test.js` 的 payment 命名冲突面 + 新增金额真源/验签/幂等锁 | `electron/services/buyout-removal.contract.test.js` + `packages/api-publish-engine/test/` |

## 影响面

**服务端**（`packages/api-publish-engine/`）：
- `migrations/postgresql/006_payment_orders.sql`（新）
- `src/auth/postgres-identity-repository.js`（SCHEMA + REQUIRED_SCHEMA_RELATIONS）
- `src/auth/postgres-commerce-store.js`（订单读写扩展）
- `src/auth/subscription-service.js`（createCheckout / settlePaymentWebhook）
- `src/auth/payment-providers/{index,wechat-native}.js`（新）
- `src/auth/publish-api-payment-webhook.js`（新，mixin）
- `src/publish-api-server.js`（路由 + scope 映射 + 端点清单 + OpenAPI）
- `.env.example`（微信商户环境变量占位）
- `test/`（新增契约测试）

**桌面端**（`apps/desktop/`）：
- `electron/ipc-handlers/wechat-pay.js`（新）
- `electron/services/wechat-pay-qrcode.js`（新，二维码渲染）
- `electron/ipc-handlers/index.js`、`license-access-control.js`、`preload/identity.js`（或新 `preload/wechat-pay.js`）
- `src/api/publisher.js`（或 member store）
- `src/views/member-center/Subscription.vue` + 新 `WeChatPayDialog.vue`
- `src/locales/member-center/{zh,en}.js`
- `electron/services/buyout-removal.contract.test.js`（改造）

## 关键决策（D1–D6）

### D1 商户形态 → Native 扫码（已定，用户确认）

个体工商户 + Native + 备案域名 + v3 密钥证书到手。**桌面端唯一可用形态**（JSAPI/H5 需在微信内打开，小程序需另立项）。

### D2 一期范围 → 最小闭环（已定，用户授权）

下单→扫码→回调→授权。不做自动续费等六项（见「显式偏离」）。

**续期语义**：用户重新下一单 → `applySubscription` 既有续叠逻辑顺延时长。跨档压制保护（低档码不降高档）已实现于 `postgres-commerce-store.js:108-116`，本变更**复用不重写**。

### D3 费率接受度 → 0.6%（已定，用户确认）

¥59 × 0.6% = ¥0.354/笔；¥119 × 0.6% = ¥0.714/笔；¥999 × 0.6% = ¥5.99/笔。对比 `plan-matrix` 成本占比（standard 27.1% / pro 18.5%），毛利仍为正。

### D4 二维码渲染 → 纯本地零依赖

`apps/desktop/package.json` 无 `qrcode` 依赖。引入 npm 依赖需过安全审计与锁文件变更（且本仓 QM-2 有依赖审查要求）。**决策：手写 QR 编码器**（~200 行，Byte 模式 + RS 纠错 + 矩阵绘制为 SVG data URI），放 `packages/shared-utils/src/qr-code.js`，带完整契约测试（对已知向量做矩阵断言）。

**备选**（已否决）：引 `qrcode` npm 包（锁文件变更 + 供应链面）；跳转外部收银台 URL（桌面端体验断裂，且微信 Native 的 code_url 需扫码而非跳转）。

### D5 订单轮询 → 客户端轮询 + webhook 双轨

微信 Native 的 `code_url` 扫码后，服务端**只能**靠 webhook 得知支付结果（微信不提供「服务端主动查单」以外的推送，虽有查询 API 但轮询服务端会放大故障面）。

**决策**：
- 主路径：webhook → 订阅生效 → 客户端 `/me` 快照刷新（既有 `identity:state-changed` 推送）。
- 兜底：客户端每 3s 轮询 `wechat-pay:order-status`（读服务端订单表），**轮询不推进任何状态**，只反映 webhook 已写入的事实。
- 超时：`pending` 订单 30 分钟未 `paid` → 客户端停轮询并提示「支付超时，可重新发起」。

**为什么不做服务端主动轮询微信查单 API**：多一条出网链路 + 多一套凭据使用面 + 故障时无法区分「微信没响应」与「我们没收到」。webhook 是微信官方推荐的唯一权威源。

### D6 端点鉴权 → 用户态走 Logto scope，webhook 免登录强验签

- `POST /api/v1/me/checkout`：scope `profile:write`（与 `/api/v1/redeem` 同级），body 只收 `{plan, period}` 两字段。
- `POST /api/v1/webhooks/payment`：**免登录**，验签用微信平台证书（RSA-SHA256，`Wechatpay-Signature` + `Wechatpay-Serial` + `Wechatpay-Timestamp` + `Wechatpay-Nonce` 四头），时间戳容差 5 分钟。与既有 `/api/v1/auth/logto/webhook` 同为「服务到服务端点」，但**验签机制完全不同**（Logto 用 HMAC 共享密钥，微信用平台证书公钥），不共用代码路径。

## 验收标准

| # | 验收项 | 判据 |
|---|---|---|
| AC-1 | 沙箱全链路：下单→扫码→回调→订阅 active→`/me` 快照刷新 | 沙箱密钥端到端测试 |
| AC-2 | 客户端传 `amount` 被忽略，金额由服务端按 plan-matrix 计算 | 契约测试：请求体带 `amount:1` 仍按 ¥5900/¥11900 落单 |
| AC-3 | 伪造签名回调 401 且订阅状态零变化 | 契约测试 |
| AC-4 | 重复回调幂等（同 `out_trade_no` 二次回调不重复授权/不重复落单） | 契约测试 |
| AC-5 | 乱序容忍：`REFUND` 早于 `SUCCESS` 到达 → `SUCCESS` 仍能正确生效 | 契约测试 |
| AC-6 | 未配置商户凭据 → 下单入口 fail-closed 隐藏 | 组件测试 + 服务端 503 |
| AC-7 | 续期（重新下单）顺延时长，低档下单不降高档 | 复用既有 `applySubscription` 测试 |
| AC-8 | `identity_orders` 新增列与迁移一致（漂移锁） | `member-commerce-migrations.test.js` 同体例新增 |
| AC-9 | zh/en 成对，Gate 7 locale sync 通过 | CI |
| AC-10 | QM-1 打包 + 启动三层判据通过 | 改 `electron/`，强制 |
| AC-11 | `buyout-removal.contract.test.js` 改造后仍锁住买断形态不回归 | 契约测试全绿 |
| AC-12 | 二维码渲染对已知向量输出正确矩阵 | 单元测试 |
