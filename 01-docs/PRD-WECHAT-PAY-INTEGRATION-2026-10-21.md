# PRD：微信 Native 扫码支付接入（2026-10-21）

> 关联 change：`openspec/changes/wechat-native-payment/`（proposal / design / tasks / spec）
> 上游真源：`packages/api-publish-engine/src/auth/plan-matrix.js`（定价）、`subscription-service.js`（授权发放）、`01-docs/DESIGN-MEMBER-CENTER-2026-09-23.md`（阶段 1）、`01-docs/DESIGN-MEMBER-CENTER-P2-PAYMENT-2026-09-24.md`（阶段 2 设计，本 PRD 显式偏离其 MoR 假设）
> 状态：**设计定稿，待实施**（本文件与 change 工件同批落地，编码前需 QM-6 双模型评审收敛）

---

## 1. 一句话

让终端用户在会员中心选套餐 → 服务端算价下单 → 桌面端展示微信扫码二维码 → 用户手机支付 → webhook 回调驱动**既有** `applySubscription` 发放订阅权益。**不新增授权写入路径，只新增一条触发它的入口。**

## 2. 商户与通道事实（2026-10-21 用户确认）

| 项 | 值 |
|---|---|
| 商户类型 | **个体工商户** |
| 支付产品 | **微信 Native 支付（扫码）** |
| 应用场景 | 桌面端 → 展示二维码 → 用户手机微信扫码 |
| 回调域名 | **已有 ICP 备案公网域名**，可做 HTTPS 回调 |
| 凭据 | **API v3 密钥 + 商户证书已到手** |
| 费率 | 0.6%（用户已接受对毛利的侵蚀） |

**为什么 Native 是桌面端唯一可行形态**：JSAPI 必须在微信内打开网页；H5 需要在微信外浏览器跳转且个人/个体户受限；小程序是独立应用形态需另立项。Native 的 `code_url` 生成为二维码正是桌面场景的标准解法。

## 3. 为什么必须复用 applySubscription（设计基石）

`postgres-commerce-store.js:88-169` 的 `applySubscription` 已实现本期全部难点，新写一条支付授权路径必然在这些点上出事故：

| 难点 | 既有实现位置 | 新写的典型事故 |
|---|---|---|
| 并发续叠丢期 | `pg_advisory_xact_lock`（:100） | 两笔并发订单只续一份时长 |
| 跨档压制 | `planRank` + `downgradeSuppressed`（:112-116） | pro 用户下一单 standard 被降级 |
| 快照与订阅同源 | `entitlementPayloadFor(effectivePlan)` + fail-closed（:120-129） | `subscription=pro + snapshot=standard` 权限分裂 |
| 三连写原子性 | 同事务（:142-158） | 订阅写了快照没写 = 永久权限泄漏 |
| `provider_reference` UNIQUE | 收敛 409（:146-152） | 裸 23505 → 500 |
| `durationDays` 溢出 | Invalid Date 守卫（:137-139） | RangeError → 500 |

**结论**：`settlePaymentWebhook()` 的职责仅限「验签 → 归一化 → 算 durationDays → 调 applySubscription」。与 `redeem()` 的差异只有 `channel: 'payment'` 和 `providerReference` 前缀。

## 4. 范围与非目标

### 4.1 本期做（P0-1 ~ P0-9）

迁移补列 + 新表、PaymentProvider 抽象、微信 Native 适配器、`createCheckout`、`settlePaymentWebhook`、两个用户态端点、一个 webhook 端点、桌面端 IPC + 二维码渲染 + 扫码弹窗 + 轮询、locale 成对、契约锁改造。

### 4.2 本期不做（显式非目标）

| 不做 | 原因 |
|---|---|
| 自动续费 / 委托代扣 | 需另签「委托代扣」资质（未申请）。续期 = 重新下一单 |
| 升降级 proration | 无订阅对象可改价 |
| 自助退款 | 走商户平台后台人工操作；权益回收由运营执行 |
| 免费试用 | 上游红线：代码无实现，**不得对客户承诺试用** |
| 促销码 coupon | 微信 Native 无原生 coupon；自建营销引擎是上游明确非目标 |
| 客户门户 | 无 hosted portal；订单列表走本仓 `/api/v1/me/orders` |
| 多通道配置切换 | 只有一个通道，配置开关是死代码 |
| 国际卡 / 多币种 | 个体工商户 + Native = 仅 CNH/CNY 境内 |

## 5. 数据模型

### 5.1 迁移 `migrations/postgresql/006_payment_orders.sql`

```sql
BEGIN;

-- 订单：补支付供应商字段（全部可空 + 向后兼容）
ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS provider_order_id TEXT;
ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS provider_sub_id    TEXT;
ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS period            TEXT;   -- 'month' | 'year'
ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS discount_cents    INTEGER NOT NULL DEFAULT 0;

-- 用户 ↔ 供应商客户映射：webhook 回传 openid，需反查业务 user_id
CREATE TABLE IF NOT EXISTS identity_payment_customers (
    user_id   TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
    provider  TEXT NOT NULL,
    provider_customer_id TEXT,
    email     TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT identity_payment_customers_unique UNIQUE (provider, user_id)
);

CREATE INDEX IF NOT EXISTS idx_identity_payment_customers_user
    ON identity_payment_customers(user_id, provider);

COMMIT;
```

**列决策**：
- `period` **不设 CHECK 约束**（与上游 §4.1 一致，避免既有行阻塞迁移）；由服务层白名单校验。
- `discount_cents` 本期恒 0（无 coupon），列存在是为 schema 稳定，服务层不读。
- **不加 `coupon_code`**：本期无 coupon 功能，加了是无人写入的死列。

**为什么建 `identity_payment_customers`**：微信 webhook 回传 `openid` / `transaction_id`，**没有我们的 `user_id`**。必须有映射才能把回调落到正确用户。虽然本期通过 `attach` 字段回传 `user_id`（见 §6.2）不依赖 openid 反查，但 openid 落库仍为对账与将来 JSAPI 接入留入口。

**`UNIQUE (provider, user_id)` 而非 `(provider, provider_customer_id)`**：一个用户对微信只有一个映射；反向唯一会让「同 openid 绑两个 user」被 DB 拒绝（那是业务层该判的），且 `provider_customer_id` 可空时 PG 唯一约束不锁 NULL。

### 5.2 `identity_orders.channel` 无需改约束

`004_member_commerce.sql:12` 的 CHECK 已含 `'payment'`——**阶段 1 预留的地基**。这是本变更能「最小增量」的前提。

### 5.3 `identity_webhook_events` 复用与 `auth_subject` 语义放宽

既有表列（`postgres-identity-repository.js:67-79`）中 `auth_subject TEXT NOT NULL`，而微信回调没有 Logto subject。

**方案（已定）**：支付事件的 `auth_subject` 填**订单号 `out_trade_no`**。语义放宽为「事件归属的业务主键」——Logto 事件填 Logto subject，支付事件填订单号。

| 备选 | 否决理由 |
|---|---|
| 新建 `identity_payment_webhook_events` | 同一张 outbox 才能让「先落库再处理」审计口径唯一；`provider` 列本就为区分来源而存在（已有 `logto`，加 `wechat` 即可） |
| 改 `auth_subject` 为可空 | 动既有列影响 Logto 路径既有断言与生产数据；NOT NULL 是刻意 fail-closed |

**幂等键 = `out_trade_no`（我方订单号）**，理由：
- `identity_orders.id` 即 `out_trade_no`，订单号即主键，重复回调天然撞主键。
- `applySubscription` 的 `providerReference` 用 `wechat:<out_trade_no>`，撞 `identity_subscriptions_provider_reference_key` → 409 `ORDER_REFERENCE_CONFLICT`（既有收敛路径）。
- **不用 `transaction_id`**：微信对同一订单可能先 `SUCCESS` 后 `REFUND`，两者 `transaction_id` 相同但语义相反。用订单号才能让「同一订单多事件」按订单聚合、按类型分流。

## 6. 服务端契约

### 6.1 `POST /api/v1/me/checkout`（scope `profile:write`）

**请求**（body 白名单，只认两字段，其余一律丢弃）：

| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| `plan` | string | 是 | ∈ `{standard, pro}`；`free` → 400 `CHECKOUT_PLAN_INVALID` |
| `period` | string | 是 | ∈ `{month, year}`；否则 400 `CHECKOUT_PERIOD_INVALID` |

**服务端处理序列**：

```
① 校验 plan/period（白名单，非枚举值绝不落到供应商）
② amountCents = period==='month' ? priceMonthlyCents : priceYearlyCents
   durationDays = period==='month' ? 30 : 365
③ out_trade_no = 'wp' + 时间戳(base36) + 随机(8位base36)   // 全局唯一、有界
④ 落 identity_orders { id: out_trade_no, plan, amount: amountCents,
                        currency:'CNY', channel:'payment',
                        status:'pending', period, created_at: now }
⑤ upsert identity_payment_customers { user_id, provider:'wechat', email }
⑥ provider.createCheckout({ orderId, amountCents, currency, attach })
   attach = JSON.stringify({ orderId: out_trade_no, userId })  // 微信原样回传
⑦ 返回 { orderId, codeUrl, expiresAt }
```

**成功响应 200**：

```json
{ "orderId": "wplxxxxxxxxxxxxxxx", "codeUrl": "weixin://wxpay/bizpayurl?pr=...", "expiresAt": "2026-10-21T18:00:00+08:00" }
```

**错误码**：

| HTTP | code | 触发条件 |
|---|---|---|
| 400 | `CHECKOUT_PLAN_INVALID` | `plan` 非枚举或为 `free` |
| 400 | `CHECKOUT_PERIOD_INVALID` | `period` 非枚举 |
| 401 | `AUTH_SCOPE_MISSING` | 非 Logto 身份（复用既有守卫） |
| 503 | `PAYMENT_PROVIDER_UNAVAILABLE` | 未配置商户凭据 / `PAYMENT_PROVIDER=none` |
| 502 | `PAYMENT_PROVIDER_UPSTREAM_FAILED` | 微信下单超时或返回错误（订单留 `pending`） |
| 500 | `COMMERCE_INTERNAL_ERROR` | 其它（经 `_commerceFailure` 统一映射，status 夹紧 [400,599]） |

**`codeUrl` 的两点约束**：
- 它是 `weixin://` 协议 URL，**只在微信内可打开**，桌面端必须转为二维码，**不得**尝试 `shell.openExternal`。
- 有效期由微信侧定（通常 2 小时），服务端同时在 `expiresAt` 回传，客户端据此展示「二维码已过期」。

### 6.2 `GET /api/v1/me/orders/{orderId}`（scope `profile:read`）

- 路径参数 `orderId` 必须匹配 `^wp[a-z0-9]{8,64}$`。
- **仅返回属于当前用户的订单**（`user_id` 不匹配 → 404 `ORDER_NOT_FOUND`，不泄露订单存在性）。
- 响应：`toOrderDto` 白名单字段 + `period` + `provider_order_id`。**绝不返回 `provider_sub_id`**（本期恒 NULL，且属内部字段）。

### 6.3 `POST /api/v1/webhooks/payment`（免登录 · 强验签）

**请求头（微信 APIv3 四头，全部必填）**：

| 头 | 用途 |
|---|---|
| `Wechatpay-Signature` | RSA-SHA256 签名 |
| `Wechatpay-Serial` | 平台证书序列号（用于选公钥） |
| `Wechatpay-Timestamp` | 秒级时间戳（容差 ±300s） |
| `Wechatpay-Nonce` | 随机串（防重放） |

**处理序列**：

```
① 读 rawBody，上限 256 KiB（与 Logto webhook 同口径），超限 413
② 验签（先验签，再解析任何业务字段 —— 同 logto-webhook.js:124 纪律）
   - 时间戳偏离 > 300s → 401 PAYMENT_WEBHOOK_TIMESTAMP_STALE
   - Serial 未缓存 → 调 GET /certificates 拉取（需商户证书签名）→ 仍无 → 401
   - RSA-SHA256 验签失败 → 401 PAYMENT_WEBHOOK_SIGNATURE_INVALID（不入库不处理）
③ AEAD_AES_256_GCM 解密 resource（APIv3 平台证书密钥）
④ 归一化为 NormalizedEvent
⑤ 事务：
   claimWebhookEvent({ id: out_trade_no, provider:'wechat', event: type,
                       hook_id: transaction_id, auth_subject: out_trade_no, ... })
   → 撞唯一键即返回 2xx { duplicate: true }（不重复授权）
   分流：
     checkout.completed → 订单 pending→paid → applySubscription(channel='payment')
     payment.failed      → 仅更新事件状态（不动订阅）
     refunded           → 记 ignored（本期无退款功能，留痕供对账）
⑥ completeWebhookEvent
⑦ 返回 2xx（含重复/忽略）
```

**响应语义**：

| 场景 | HTTP | 说明 |
|---|---|---|
| 验签通过并处理 | 200 | `{ success: true, orderId }` |
| 重复回调 | 200 | `{ success: true, duplicate: true }` |
| 事件被忽略（乱序/不支持） | 200 | `{ success: true, ignored: true }` |
| 验签失败 | 401 | **不入库** |
| 时间戳过期 | 401 | 防重放 |
| body 超限 | 413 | |
| 载荷不可解析 | 400 | `PAYMENT_WEBHOOK_PAYLOAD_INVALID` |
| 内部处理错误 | **200** | 上游 §9：防微信重投风暴；错误已入库 `status='failed'` 供重放 |

**归一化事件类型映射**：

| 微信事件 | 归一化 type | 动作 |
|---|---|---|
| `TRANSACTION.SUCCESS` | `checkout.completed` | 订单 paid + 发放权益 |
| `TRANSACTION.FAIL` | `payment.failed` | 仅记录 |
| `REFUND.SUCCESS` / `REFUND.CLOSED` | `refunded` / `ignored` | 仅记录（本期无退款） |

### 6.4 供应商凭据（环境变量，严禁入仓/入包）

| 变量 | 用途 |
|---|---|
| `PAYMENT_PROVIDER` | `wechat_native` \| `none`（默认 `none`，即功能关闭） |
| `WECHAT_PAY_APPID` | 应用 ID |
| `WECHAT_PAY_MCH_ID` | 商户号 |
| `WECHAT_PAY_API_V3_KEY` | APIv3 密钥（32 字节，用于解密回调） |
| `WECHAT_PAY_CERT_SERIAL_NO` | 商户证书序列号 |
| `WECHAT_PAY_CERT_PATH` / `WECHAT_PAY_CERT_CONTENT` | 商户证书（二选一） |
| `WECHAT_PAY_NOTIFY_URL` | 回调完整 URL，如 `https://<域名>/api/v1/webhooks/payment` |

**铁律**：
- 这些变量**只存在于服务端进程环境**，**绝不打包进 Electron**（客户端只拿 `codeUrl`，不接触任何商户凭据）。
- `.env.example` 只放占位空值。
- `production-config.js` 增加校验：`PAYMENT_PROVIDER=wechat_native` 时上表必填项缺失即 `PAYMENT_CONFIG_INVALID`（500），启动 fail-fast；`none` 时跳过全部微信校验。

## 7. 桌面端契约

### 7.1 IPC 通道（`wechat-pay:` 前缀）

| 通道 | 方向 | 载荷 | 权限 |
|---|---|---|---|
| `wechat-pay:create-order` | invoke | `{ plan, period }` | `authenticated`（默认，不在 public 表） |
| `wechat-pay:order-status` | invoke | `{ orderId }` | `authenticated` |

**命名为什么不能用 `payment:`**：`buyout-removal.contract.test.js` 用 `payment:` 前缀与 `payment[A-Z]` 桥接名锁买断形态不回归。复用旧名与那把锁正面冲突，且 `payment` 是已移除的买断链路名字。**新命名 = 新语义**，同时改造该锁：把「`payment:` 零命中」收紧为「白名单里**只允许** `wechat-pay:create-order` 与 `wechat-pay:order-status` 两条」。

**主进程 body 白名单**（`member-api-service.js` 的 `ME_API_PATHS` 加 `/api/v1/me/checkout` methods: POST）：renderer 只能贡献 `plan` / `period` 两个字符串字段，其余键一律丢弃。**路径与方法同时锁死**（同既有白名单纪律：只放开路径不放开方法 = 把端点变成可 PUT）。

### 7.2 二维码渲染（零新依赖）

`apps/desktop/package.json` 无 `qrcode` 依赖；引 npm 包需锁文件变更 + 供应链审计。

**决策：手写 QR 编码器**，落 `packages/shared-utils/src/qr-code.js`：

- Byte 模式（UTF-8），版本自适应（`weixin://` URL 约 60-110 字符 → 版本 3-6）。
- 纠错级 **M**（15% 恢复率；扫码场景容错与密度平衡）。
- 输出 SVG data URI（`data:image/svg+xml,...`），矢量缩放不失真，无位图内存开销。
- 容量校验：超出所选版本容量 → 抛 `QR_CAPACITY_EXCEEDED`（fail-closed，不静默截断——截断会生成「看起来像码但扫不出」的假码）。

**为什么放 shared-utils 而非 apps/desktop**：electron vitest 的 `include` 是白名单（`src/**`、`electron/services/**`、`electron/publishers/**`），放 `electron/` 根目录会「一个测试都不跑而 CI 仍全绿」（`buyout-removal.contract.test.js:17-21` 记过这个坑）。

**备选（已否决）**：

| 备选 | 否决理由 |
|---|---|
| 引 `qrcode` npm 包 | 锁文件变更 + 供应链面 + QM-2 依赖审查；收益仅是省 ~200 行 |
| 跳转外部收银台 URL | 桌面端体验断裂；微信 Native 的 `code_url` 是 `weixin://` 协议，浏览器打不开 |
| 位图 PNG | 需 canvas 依赖或手写 PNG 编码；SVG 更简单且矢量 |

### 7.3 扫码弹窗 `WeChatPayDialog.vue`

**状态机（Page-Level TDD，先枚举状态再写代码）**：

| 状态 | 触发 | 显示 |
|---|---|---|
| `loading` | 弹窗打开，调 `create-order` | 骨架 + 「正在创建订单…」 |
| `qrcode` | 拿到 `codeUrl` | 二维码 `<img>` + 「请使用微信扫一扫」+ 金额 + 倒计时 |
| `expired` | `expiresAt` 到或轮询到订单 `failed` | 「二维码已过期」+「刷新二维码」按钮 |
| `polling` | `qrcode` 态期间每 3s 调 `order-status` | 二维码下方「等待支付结果…」 |
| `paid` | 轮询到 `status=paid` | 「支付成功」+ 触发 identity 刷新 + 1.5s 后自动关闭 |
| `timeout` | 30 分钟未 `paid` | 「支付超时，可重新发起」+「重新发起」按钮 |
| `error` | `create-order` 或轮询报错 | 错误文案 +「重试」 |

**轮询纪律**：
- 3s 间隔，`onBeforeUnmount` / 弹窗关闭**必须**注销定时器（防泄漏）。
- 轮询**只读**，不推进任何状态（spec 已锁）。
- `paid` 后立即停轮询并触发 `identityStore` 刷新（`/me` 快照重取）——**权益刷新以服务端为准**，客户端不自算到期时间。

### 7.4 交互流程

```
会员中心 → 「订阅与方案」页
  │  档位卡片（数据来自 GET /api/v1/plans，随权益同步下发）
  │  standard ¥59/月 · ¥499/年    pro ¥119/月 · ¥999/年
  │  周期切换（月/年 Tab）
  ▼
点「立即购买」（未登录 → 引导登录；服务端不可用 → 按钮隐藏）
  │  invoke('wechat-pay:create-order', { plan, period })
  ▼
弹窗：二维码 + 金额 + 「请使用微信扫一扫」
  │  ← 用户手机微信扫码 → 输入密码 → 支付成功
  ▼
轮询到 paid → 「支付成功，权益已开通」→ 触发 identity 刷新
  │
  ▼
订阅卡显示新档位 + 到期日（本地化日期）
```

### 7.5 会员中心「订单与账单」页

`OrdersBilling.vue` 从「订单功能即将上线，敬请期待。」占位改为真实列表：

| 列 | 内容 |
|---|---|
| 时间 | `createdAt` 本地化（`formatTimestamp`，复用 `labels.js`） |
| 套餐 | `plan` → `planLabelOf` |
| 金额 | `¥{amount/100}` + `period`（月/年） |
| 状态徽标 | `pending`=待支付 / `paid`=已支付 / `failed`=已关闭 |

- `pending` 订单：提示「待支付」并给「继续支付」按钮（重开扫码弹窗，用同一 `orderId` 重新取 `codeUrl`）。
- 空态：「还没有订单。购买会员或使用激活码即可开通。」+ 两个入口按钮。
- **不提供**自助退款入口（本期非目标）；退款走客服/运营。

## 8. 文案表（zh/en 成对，键名 `memberCenter.*`）

> 全部写入 `apps/desktop/src/locales/member-center/{zh,en}.js`，CI Gate 7 `check-locale-sync.js` 拦截不成对。

| 键 | 中文 | English |
|---|---|---|
| `payNow` | 立即购买 | Buy now |
| `payNowDisabledHint` | 支付通道暂未开放 | Payment channel unavailable |
| `payChannelUnavailable` | 支付通道暂未开放，可使用激活码开通 | Payment is not available yet. You can redeem a code instead. |
| `payDialogTitle` | 微信支付 | WeChat Pay |
| `payCreating` | 正在创建订单… | Creating order… |
| `payScanHint` | 请使用微信「扫一扫」扫描下方二维码 | Scan the QR code with WeChat |
| `payAmountLabel` | 支付金额 | Amount |
| `payWaiting` | 等待支付结果… | Waiting for payment… |
| `paySuccess` | 支付成功，权益已开通 | Payment succeeded. Your plan is active. |
| `payFailed` | 支付未完成，未扣款，可重试 | Payment incomplete. You were not charged. You can retry. |
| `payExpired` | 二维码已过期 | The QR code has expired. |
| `payRefresh` | 刷新二维码 | Refresh QR code |
| `payTimeout` | 支付超时，可重新发起 | Payment timed out. You can start again. |
| `payRestart` | 重新发起 | Start again |
| `payRetry` | 重试 | Retry |
| `payClose` | 关闭 | Close |
| `payCancelConfirm` | 关闭后将取消本次支付，你可以在 30 分钟内重新发起。 | Closing cancels this payment. You can restart within 30 minutes. |
| `payContinue` | 继续支付 | Continue payment |
| `ordersStatusPending` | 待支付 | Pending |
| `ordersStatusPaid` | 已支付 | Paid |
| `ordersStatusFailed` | 已关闭 | Closed |
| `ordersEmptyHint` | 还没有订单。购买会员或使用激活码即可开通。 | No orders yet. Purchase a plan or redeem a code to get started. |
| `ordersGoPay` | 去购买 | Buy a plan |
| `ordersGoRedeem` | 使用激活码 | Redeem a code |
| `subscriptionPayHint` | 在线支付已开通，扫码即可完成购买。 | Online payment is available. Scan to complete your purchase. |
| `periodMonth` | 按月 | Monthly |
| `periodYear` | 按年 | Yearly |
| `periodYearDiscount` | 按年省 {percent}% | Save {percent}% yearly |

**`UpgradeModal.vue` 文案变更**：`paymentChannelUnavailable`（「付费通道筹备中，暂不支持购买」）改为引导至会员中心：
- zh：`在线支付已开通，请前往会员中心购买。`
- en：`Online payment is available. Please visit the Member Center.`
- **不重开购买弹窗**（`fix-upgrade-payment-entry` 结论：升级入口一律指向会员中心，不在弹窗内下单）。

## 9. 数据校验汇总表

| 层 | 字段 | 校验 | 失败行为 |
|---|---|---|---|
| 渲染层 | `plan` / `period` | 仅渲染 `standard`/`pro` 卡 + 月/年 Tab | 不出现非法选项 |
| 渲染层 | 金额 | **不传**（服务端算） | — |
| preload | `plan` / `period` | 透传（无校验，主进程兜底） | — |
| 主进程 IPC | body | 白名单只取 `plan`/`period` 两字符串 | 其余键丢弃 |
| 主进程 IPC | `orderId` | `^wp[a-z0-9]{8,64}$` | `BAD_PARAM` |
| 主进程 IPC | 登录态 | `requireSubject` 短路 | `BUSINESS_USER_REQUIRED` |
| 服务端 | `plan` | ∈ `{standard, pro}` | 400 `CHECKOUT_PLAN_INVALID` |
| 服务端 | `period` | ∈ `{month, year}` | 400 `CHECKOUT_PERIOD_INVALID` |
| 服务端 | `amount`（客户端传入） | **忽略** | 按 plan-matrix 计算 |
| 服务端 | `out_trade_no` 生成 | `wp` + base36 时间戳 + 8 位随机 | 撞主键则重生成（≤10 轮） |
| 服务端 webhook | 四头 | 全部必填，签名 RSA-SHA256 | 401 |
| 服务端 webhook | 时间戳 | ±300s | 401 `PAYMENT_WEBHOOK_TIMESTAMP_STALE` |
| 服务端 webhook | body 大小 | ≤256 KiB | 413 |
| 服务端 webhook | resource 解密 | AEAD_AES_256_GCM | 400 `PAYMENT_WEBHOOK_PAYLOAD_INVALID` |
| 服务端 webhook | 订单存在性 | `out_trade_no` 必须在库 | 409 `PAYMENT_ORDER_NOT_FOUND` |
| 服务端 webhook | 订单归属 | 订单 `user_id` 与 attach 解出的 `userId` 一致 | 不一致 → 409 `PAYMENT_ORDER_USER_MISMATCH` |

## 10. 安全清单

| # | 项 | 实现 |
|---|---|---|
| S1 | webhook 伪造 | 微信平台证书 RSA-SHA256 验签 + 时间戳容差 + Serial 选公钥；契约测试含伪造负例 |
| S2 | 金额篡改 | body 白名单 + 服务端算价 + 对账 WARN；契约测试带 `amount:1` 负例 |
| S3 | 重复授权 | 幂等键 = 订单号；`providerReference` UNIQUE + advisory lock 双保险 |
| S4 | 凭据泄漏 | 只走服务端环境变量；`.env.example` 占位；CI 扫硬编码；**不进 Electron 打包** |
| S5 | SSRF | webhook 端点是**入站**，无出站 URL 参数；平台证书拉取走固定微信域名（硬编码，不可配置） |
| S6 | 错误外泄 | 统一 `_commerceFailure`：status 夹紧 + code 形状校验；raw payload 只入 jsonb 不外泄 |
| S7 | 越权读订单 | `GET /me/orders/{id}` 校验 `user_id`，不匹配返回 404（不泄露存在性） |
| S8 | 买断形态回归 | 改造 `buyout-removal.contract.test.js`，新增正向锁 + 变异反证 |
| S9 | 二维码截断 | 容量校验 fail-closed（`QR_CAPACITY_EXCEEDED`），不静默截断 |
| S10 | 轮询滥用 | 3s 间隔 + 单订单轮询 + 弹窗关闭即停；无「批量轮询」入口 |

## 11. 测试矩阵

### 11.1 服务端（`packages/api-publish-engine/test/`）

| 文件 | 覆盖 |
|---|---|
| `payment-provider-wechat.test.js` | 三方法契约 + 归一化逐事件映射 + 验签正负例 + 时间戳过期 + 未知 Serial + 零外发（注入 fetcher/signer） |
| `subscription-payment.test.js` | 金额真源（含 `amount:1` 负例）+ pending 落单 + customers 落库 + settle 三连写 + 幂等 + 乱序 ignored + 未知订单 409 + 用户不匹配 409 |
| `payment-api.test.js` | 路由 scope 校验 + body 白名单 + 错误码映射 + webhook 401/200/413/400 分支 + 重复 2xx |
| `member-commerce-migrations.test.js`（扩展） | 006 与 SCHEMA 漂移锁（同 004/005 体例） |
| `production-config.test.js`（扩展） | `PAYMENT_PROVIDER=none` 跳过微信校验；`wechat_native` 缺必填即红 |

### 11.2 shared-utils

| 文件 | 覆盖 |
|---|---|
| `qr-code.test.js` | **已知向量逐位矩阵断言**（非「生成成功」）+ 版本自适应 + 容量超限抛错 + UTF-8 多字节 + 空串/超长 |

### 11.3 桌面端（`apps/desktop/`）

| 文件 | 覆盖 |
|---|---|
| `buyout-removal.contract.test.js`（改造） | `payment:`/`payment[A-Z]` 零命中 + `wechat-pay:` 两条白名单正向锁 + preload 桥接名锁 |
| `member-api-service.test.js`（扩展） | `/api/v1/me/checkout` 路径+方法白名单 + body 只取 plan/period |
| `WeChatPayDialog.test.js` | 7 态全覆盖 + 二维码渲染 `src^="data:image/svg+xml"` + 轮询启停 + 关闭即停 + **反失盲断言**（先证明推进到扫码页） |
| `Subscription.vue` 测试 | 未登录不渲染购买按钮 + 服务端不可用隐藏按钮 |
| `OrdersBilling.test.js` | 订单列表三态徽标 + 空态引导 + pending「继续支付」 |

### 11.4 人工沙箱验收（PRD 定稿后、编码完成后）

| # | 场景 | 期望 |
|---|---|---|
| E2E-1 | 沙箱下单 → 真机扫码 → 支付成功 | 订阅生效，`/me` 快照刷新，客户端显示新档位 |
| E2E-2 | 扫码后取消支付 | 无 webhook，30 分钟后客户端提示超时；**权益不变** |
| E2E-3 | 二维码过期后刷新 | 新 `codeUrl` 可扫 |
| E2E-4 | 同一订单重复回调（沙箱工具重放） | 权益只发放一次 |
| E2E-5 | 伪造签名回调（curl 手工构造） | 401，权益零变化 |
| E2E-6 | pro 用户下一单 standard | 档位保持 pro，时长顺延（跨档压制） |
| E2E-7 | 打包版（`isPackaged=true`）全流程 | 与开发态一致，无 dev-only 短路 |

## 12. 门禁义务

- **变更类型**：运行时代码（服务端 + 桌面端）⇒ 隔离 worktree `mp-wechat-native-payment`，分支 `wechat-native-payment`，**不得在共享主目录落盘**。
- **QM-1 强制**：改 `apps/desktop/electron/` ⇒ `electron-builder --win --dir --publish never` + 启动存活断言 + 显式剔除 `ELECTRON_RUN_AS_NODE` + stderr 三层判据。
- **QM-2**：无同步 CPU 密集原语进高频路径（二维码编码在点击时一次性执行，非每次渲染）；无硬编码密钥。
- **QM-4 视觉**：新增 `WeChatPayDialog` 无既有基线 ⇒ 登记不进 `QG Visual` 覆盖范围（同 `disable-simulated-payment-in-prod` 处置），不假装做过视觉回归。
- **QM-6 双模型评审**：`ccg-review-decider.js` 判 `mode=dual` ⇒ `plan-review.sh` 收敛后才进编码；编码后对 >200 行提交跑 `ccg-deep-review`。
- **locale 成对**：`check-locale-sync.js` + 渲染层新增中文字符串基线扫描。
- **OpenSpec**：`/opsx:propose` 建 change（本文件即其配套 PRD）；tasks.md 逐项勾选。

## 13. 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| 二维码编码器位图错误但形似真码 | 高 | 已知向量逐位断言 + 人工真机扫码 smoke（E2E-1） |
| webhook 被伪造白嫖权益 | 高 | 平台证书验签 + 时间戳 + Serial 选钥；负例契约测试 |
| 并发下单丢时长 | 中 | 复用 `applySubscription` 的 advisory lock，不重写 |
| `auth_subject` 语义放宽被后续误用 | 中 | 迁移注释 + PRD 明示「支付事件填订单号」；消费方按 `provider` 分流 |
| 迁移漂移（SCHEMA vs 006） | 中 | 漂移锁同体例 |
| 轮询定时器泄漏 | 中 | 关闭即停 + 反失盲断言 + `onBeforeUnmount` 注销 |
| 沙箱与生产凭据混淆 | 中 | 环境变量分离 + `production-config` 校验；**沙箱验收用沙箱密钥，上线前换生产密钥并复跑 E2E** |
| 30 分钟超时后用户重复下单 | 低 | 旧订单留 `pending`，新订单独立；无副作用（旧订单永不 `paid`） |

## 14. 上线检查清单

- [ ] **先应用 `006_payment_orders.sql` 迁移**（`assertReady()` 会检查 `identity_payment_customers`；不先迁移，新版本**整个服务起不来**，不只是支付不可用）
- [ ] 沙箱全链路 E2E-1 ~ E2E-7 通过
- [ ] 生产商户凭据注入服务端环境（**不入仓、不入包**）
- [ ] **确认 `docker-compose.yml` 已透传全部支付变量**（见 §15.2；漏传的表现是「配了也没用，前端恒显示通道未开放」）
- [ ] `WECHAT_PAY_NOTIFY_URL` 指向生产域名，且该路径在 nginx/网关放行（免登录，但需防 CC）
- [ ] 微信商户平台配置回调 URL + 开启 APIv3 回调加密（`AEAD_AES_256_GCM`）
- [ ] `production-config` 校验通过（`PAYMENT_PROVIDER=wechat_native`）
- [ ] 生产环境复跑 E2E-1（**沙箱通过不构成生产通过**）
- [ ] 灰度：先白名单小流量，观察 webhook 到达率与订单 paid 率
- [ ] 回滚待命：`PAYMENT_PROVIDER=none` 重启即关闭入口（零代码回退）

## 15. 启用步骤（从「代码已合并」到「用户真的能付款」）

> 本节为 2026-10-22 实测补写。此前的 PRD 只有「清单」，没有可执行步骤；
> 而实测发现两个**不照做就永远付不了款**的坑，且它们都不报错，只表现为「前端功能不存在」。

### 15.1 第一步：应用迁移（不做的后果是整站不可用）

```bash
# 在仓库根，DB 连接串与生产同源
BUSINESS_DATABASE_URL='postgres://...' \
  node packages/api-publish-engine/scripts/migrate-postgres.js --dry-run   # 先看 pending

BUSINESS_DATABASE_URL='postgres://...' \
  node packages/api-publish-engine/scripts/migrate-postgres.js            # 再真跑
```

容器内部署时：

```bash
docker compose -f packages/api-publish-engine/docker-compose.yml \
  exec publish-api node packages/api-publish-engine/scripts/migrate-postgres.js --dry-run
```

| 事实 | 说明 |
|---|---|
| **生产禁止自动迁移** | `PostgresIdentityRepository.initialize()` 在 `production` 下直接抛 `PRODUCTION_AUTO_MIGRATE_FORBIDDEN` |
| **就绪检查会验表** | `assertReady()` 校验 `REQUIRED_SCHEMA_RELATIONS`，其中已含 `identity_payment_customers` ⇒ 不迁移则 `BUSINESS_DATABASE_SCHEMA_NOT_READY` ⇒ **健康检查失败、整站不可用** |
| **迁移有台账锁** | `identity_schema_migrations` 记 checksum；改已应用的迁移文件会 `MIGRATION_CHECKSUM_MISMATCH` 硬失败。**不要改 006，只能新增 007+** |

`--dry-run` 输出示例：

```json
{"applied":[],"skipped":["002_logto_identity.sql","003_logto_webhook_events.sql","004_member_commerce.sql","005_cloud_accounts.sql"],"pending":["006_payment_orders.sql"]}
```

### 15.2 第二步：把支付变量真正送进容器

`docker-compose.yml` 的 `environment` 必须逐项透传（**2026-10-22 之前一个都没传**）：

| 变量 | 取值约束 | 缺失时 |
|---|---|---|
| `PAYMENT_PROVIDER` | `none`（默认）/ `wechat_native` | 视为 `none`：入口隐藏 |
| `WECHAT_PAY_APPID` | 公众号/移动应用 AppID | 启动期 `PAYMENT_CONFIG_INVALID` |
| `WECHAT_PAY_MCH_ID` | 商户号 | 同上 |
| `WECHAT_PAY_API_V3_KEY` | **必须 32 字符** | `PAYMENT_API_V3_KEY_INVALID` |
| `WECHAT_PAY_CERT_SERIAL_NO` | 商户证书序列号 | `PAYMENT_CONFIG_INVALID` |
| `WECHAT_PAY_CERT_PATH` **或** `WECHAT_PAY_CERT_CONTENT` | 二选一：商户私钥 `apiclient_key.pem` 的**容器内路径** / PEM 全文 | `PAYMENT_CONFIG_INVALID` |
| `WECHAT_PAY_PLATFORM_PUBLIC_KEY` **或** `WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH` | 二选一：微信支付公钥（裸 Base64 SPKI 或 PEM）/ 其文件路径。**回调验签用，与商户私钥同等必需** | `PAYMENT_CONFIG_INVALID` |
| `WECHAT_PAY_PUBLIC_KEY_ID` | 形如 `PUB_KEY_ID_…`；**可选**，配了就按它核对回调头里的 serial，对不上即 `PAYMENT_WEBHOOK_CERT_NOT_FOUND` | 不按 serial 过滤 |
| `WECHAT_PAY_NOTIFY_URL` | **必须 HTTPS**，且与商户平台配置逐字一致 | `PAYMENT_NOTIFY_URL_HTTPS_REQUIRED` |

证书文件放置（走 `CERT_PATH` 时）：`packages/api-publish-engine/config/wechat-pay/apiclient_key.pem`
—— 该目录已被 compose 以 `./config → /app/packages/api-publish-engine/config` bind 进容器。

**接线锁**：`packages/api-publish-engine/test/payment-env-passthrough.test.js` 断言
「`.env.example` 声明的每个支付变量都在 compose 里透传」「compose 不得多传未声明的」「一律用 `:-` 默认而非 `:?` 必填」。
新增支付变量而忘了改 compose，这条锁当场红。

### 15.3 第三步：重启并自检

**先跑支付预检**（一条命令查完四件事）：

```bash
docker compose -f packages/api-publish-engine/docker-compose.yml \
  exec publish-api node packages/api-publish-engine/scripts/payment-preflight.js
```

| 检查项 | 查什么 | 失败时的典型原因 |
|---|---|---|
| `provider-kind` | `PAYMENT_PROVIDER` 取值合法；`none` 时直接 SKIP 并结束 | 拼错成 `wechat-natvie` |
| `env` | 7 个支付变量的**存在性与形状**（复用 `validateProductionConfig`） | 少变量 / APIv3 密钥不是 32 字符 / notify_url 不是 https |
| `credentials` | 私钥与平台公钥能否被 `crypto` **解析**（不是只看非空） | PEM 粘错、路径指错、只填了半边 |
| `provider` | **provider 真的能被构造出来** | 这一项 FAIL 就意味着 `/me/checkout` 会恒 503 |
| `database` | `identity_payment_customers` 等必需关系是否存在 | 没跑 006 迁移（见 §15.1） |

退出码：`0` 全通过 / `1` 有失败项 / `2` 用法错误。`--json` 给机器读，`--skip-db` 只查配置时用。

**再跑三条常规自检**：

```bash
# 1) 就绪探针
curl -fsS http://127.0.0.1:3030/api/v1/ready

# 2) 端点存在性（未登录应 401，而不是 404）
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3030/api/v1/me/checkout

# 3) 更全的配置校验（含 Logto / entitlement 等非支付项）
docker compose -f packages/api-publish-engine/docker-compose.yml \
  exec publish-api node packages/api-publish-engine/scripts/validate-production-config.js --phase required
```

**预检只能证明「我们这边准备好了」，不能证明「微信会接受」** —— 后者只有真机 E2E 能证明（§11.4）。

### 15.4 前端用户会看到什么

按钮显示条件是**「已登录」**，不是「已开通支付」—— 这是刻意设计（见 §7.4）：预判需要额外一次探测请求，
而 503 的文案已能把「通道未开放」讲清楚。因此**「按钮在、点了报错」正是未配置时的预期形态**，不是 bug。

弹窗状态机与逐态文案（`memberCenter.*`，zh/en 成对）：

| 状态 | 触发 | 主提示文字（zh） | 可用操作 |
|---|---|---|---|
| `loading` | 打开后立即 | `payCreating`「正在创建订单…」 | 关闭 |
| `qrcode` | 拿到 `codeUrl` | `payScanHint`「请使用微信「扫一扫」扫描下方二维码」+ `payAmountLabel`「支付金额」 | 关闭 |
| `polling` | 轮询开始（与 qrcode 叠加） | `payWaiting`「等待支付结果…」 | 关闭 |
| `paid` | 轮询到 `paid` | `paySuccess`「支付成功，权益已开通」 | **关闭按钮禁用**（让用户看到成功反馈） |
| `failed` | `failed` | `payFailed`「支付未完成，未扣款，可重试」 | `payRetry`「重试」 |
| `expired` | 二维码过期 | `payExpired`「二维码已过期」 | `payRefresh`「刷新二维码」 |
| `timeout` | 30 分钟硬上限 | `payTimeout`「支付超时，可重新发起」 | `payRestart`「重新发起」 |
| `error` | 其它失败 | `payChannelUnavailable`「支付通道暂未开放，可使用激活码开通」 | `payClose`「关闭」/ `payRetry`「重试」 |

改前 / 改后对比：

| 场景 | 改前（compose 未透传） | 改后（配置齐全） |
|---|---|---|
| 会员中心「订阅」页 | 有 `payNow`「立即购买」按钮 | 同左 |
| 点「立即购买」 | 弹窗转 `error` 态：**「支付通道暂未开放，可使用激活码开通」** | 先「正在创建订单…」，随后出二维码与金额 |
| 扫码支付成功 | 不可能发生 | 「支付成功，权益已开通」，关闭禁用；`paid` 事件触发 `identityStore.load()`，**档位与到期时间就地刷新** |
| 取消 / 超时 | — | 30 分钟后「支付超时，可重新发起」；**权益不变** |

### 15.5 回滚

```bash
# 只关入口：不动数据、不改代码
PAYMENT_PROVIDER=none   # 然后重启服务
```

效果：`/me/checkout` 恢复 503 `PAYMENT_PROVIDER_UNAVAILABLE`，前端回到「支付通道暂未开放」；
已产生的 `pending` 订单不会被清理（它们永远不会 `paid`，无副作用）；已生效的订阅不受影响。

## 15.9 ⚠️ 已知限制：支付回调不落 `identity_webhook_events`（2026-10-23 核对）

§5.3 写的是「`identity_webhook_events` 复用为支付 outbox」，但实现里**没有写这张表**：

| 位点 | 事实 |
|---|---|
| `_handlePaymentWebhook` | 验签 → `settlePaymentWebhook` → 回 200，全程**不 INSERT** 任何事件行 |
| `settlePaymentWebhook` | 幂等靠 `markOrderPaid` 的条件更新 + `identity_subscriptions.provider_reference` UNIQUE，不靠事件表 |

**影响**：回调到达/处理**没有持久化记录**，事后追查只能翻服务端日志（`hook="payment-webhook"`）。

**不影响**：幂等（E2E-4）与验签拒绝（E2E-5）仍然成立 —— 前者靠 UNIQUE、后者靠 401，都不依赖事件表。

**建议的补法**（下一轮，非本次）：在 `_handlePaymentWebhook` 里验签通过后、结算之前，
按 `identity_webhook_events` 既有形状插一行（`provider='wechat_pay'`、`auth_subject=<orderId>`、
`event=<归一化类型>`、`status='processing'`），结算后置 `processed` + 写 `result`。
唯一键 `(provider, id)` 已能承接 `Wechatpay-Nonce` 或 `transaction_id` 作为幂等 id。

> 记这一条的理由：PRD 说了「复用」，代码没做 —— **文档与实现各说一套**。
> 这类不一致比"没做"更危险，因为读文档的人会以为有。
## 16. ✅ 已修复：provider 从未被构造（2026-10-22 发现并当日修复）

> 本节记录的是一条**会让第 15 节全部白做**的缺口。它不属于"配置没做好"，是**代码没接上**。
> **修复见 §16.6**；16.1~16.3 保留为问题现场，供后人理解为什么 111 条测试全绿也发现不了。

### 16.1 事实（可在当前主干逐行核对）

| 位点 | 代码 | 含义 |
|---|---|---|
| `src/auth/logto-runtime.js:127` | `new SubscriptionService({ repository, planOverrides })` | **没有传 `paymentProvider`** |
| `src/auth/subscription-service.js:120` | `this.paymentProvider = options.paymentProvider \|\| null` | 于是生产里恒为 `null` |
| `src/auth/subscription-payment.js:56` | `if (!this.paymentProvider) { … }` | `POST /me/checkout` 直接回 503 `PAYMENT_PROVIDER_UNAVAILABLE` |
| 全仓 `src` | `WeChatNativeProvider` **只出现在它自己的定义文件里** | 生产代码从未 `new` 过它；只有测试构造 |

### 16.2 后果

**即使**：迁移已应用 + `docker-compose.yml` 已透传 + `.env` 填好 + 商户平台配置完成
—— `POST /api/v1/me/checkout` **仍然恒返回 503**，用户仍然看到「支付通道暂未开放」。

第 15 节解决的是"配置送不到进程"，第 16 节这条是"送到了也没人用"。

### 16.3 为什么测试全绿也发现不了

每条测试都是**注入** provider 的：

```js
return new SubscriptionService({ repository, paymentProvider: new WeChatNativeProvider({ ... }) })
```

`subscription-payment.test.js`（25 例）、`payment-api.test.js`（22 例）全部如此。
**被注入的东西永远不需要有人去构造它** —— 这是"依赖注入 + 无组装根测试"的经典盲区：
单元级覆盖率 100%，组合根覆盖率 0%。

### 16.4 修它需要什么（下一个任务的验收面）

1. `src/auth/payment-providers/wechat-native-factory.js`：
   - `loadMerchantPrivateKey(env)`：`WECHAT_PAY_CERT_CONTENT`（PEM 全文）或 `WECHAT_PAY_CERT_PATH`（文件），二选一，缺失即抛错
   - `buildAuthorizationHeader({ mchId, serialNo, privateKey, method, path, body, nonce, timestamp })`
     → `WECHATPAY2-SHA256-RSA2048 mchid="…",nonce_str="…",signature="…",timestamp="…",serial_no="…"`
     （签名原文 `METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY\n`，RSA-SHA256）
   - `createWeChatNativeProvider(env, deps)`：`PAYMENT_PROVIDER !== 'wechat_native'` 时返回 `null`
2. 平台公钥（webhook 验签用）：需要新环境变量
   - `WECHAT_PAY_PLATFORM_PUBLIC_KEY`（裸 Base64 SPKI 或 PEM）/ `WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH`
   - `WECHAT_PAY_PUBLIC_KEY_ID`（微信 2024+ 公钥模式的 `PUB_KEY_ID_…`）
   - **同时要在 `production-config` 里纳入必填**（没有它，checkout 能出码但 webhook 全部 401 ⇒ 用户付了钱拿不到权益）
3. `logto-runtime.js` 接线：构造后传给 `SubscriptionService`
4. **组装根测试**（关键）：`createLogtoRuntime({ PAYMENT_PROVIDER: 'wechat_native', …完整 env })`
   ⇒ 断言 `subscriptionService.paymentProvider !== null`；`none` ⇒ `null`。
   这条测试是唯一能防住本节的形态 —— 它不注入 provider，而是走真实组装路径。

### 16.6 修复（同日，PR `wechat-pay-provider-wiring`）

| 位点 | 改动 |
|---|---|
| `src/auth/payment-providers/wechat-native-factory.js`（新增） | `readPem`（内容/路径二选一）、`buildAuthorizationHeader`（微信 APIv3 签名）、`createWeChatNativeProvider(env, deps)` |
| `src/auth/logto-runtime.js` | 构造 provider 并传给 `SubscriptionService({ paymentProvider })`；`options.paymentProvider !== undefined` 保留测试可控性 |
| `src/auth/production-config.js` | 平台公钥纳入 `wechat_native` 必填（此前只校验商户私钥） |
| `.env.example` / `docker-compose.yml` | 新增 `WECHAT_PAY_PLATFORM_PUBLIC_KEY(_PATH)` / `WECHAT_PAY_PUBLIC_KEY_ID`；恢复 `WECHAT_PAY_CERT_CONTENT`（现在真的有消费方了） |
| `test/payment-provider-factory.test.js`（新增） | 工厂单测 + **真密钥对验签** + **组装根测试** |

**签名原文**（微信固定格式，五行四换行 + 末尾换行）：

```
HTTP方法\nURL路径\n时间戳\n随机串\n请求报文主体\n
```

报文主体必须与实际发出的**逐字节一致**（本仓发的是 `JSON.stringify(body)`，签名原文也用它），
否则线上表现是 `SIGN_ERROR`、所有下单失败。

**验签侧**：`certificateProvider.getBySerial(serial)` 只持有一把平台公钥；配了
`WECHAT_PAY_PUBLIC_KEY_ID` 就按 serial 核对，对不上返回 `null` ⇒ `PAYMENT_WEBHOOK_CERT_NOT_FOUND`。
这是刻意 fail-closed：**换公钥却没更新配置必须吵出来**，不能拿旧公钥默默验过。

**为什么保留 §16.5 的"不修"判断**：那条判断说的是"不能**半接**"。本次是**一次接全**
（下单签名 + 回调验签 + 组装根测试同时落地），因此不违背它。

### 16.7 判据

新增 **21 例**（`payment-provider-factory.test.js`）。变异反证两条，均双向：

| 变异 | 结果 |
|---|---|
| 撤掉 `logto-runtime` 里的 `paymentProvider,` | **19 pass / 2 fail**，组装根用例精确变红 |
| 签名原文去掉末尾换行 | **19 pass / 2 fail**，验签用例精确变红 |

均逐字节还原 True。全量 `packages/api-publish-engine` rc=0（Vitest 47 文件 / 504 例 + node:test）。
### 16.5 为什么本轮不修

签名与平台公钥是**安全关键路径**，且必须**一次接全**：
只接下单不接验签 = 用户付了钱、webhook 401、权益不发放 —— **比现在（根本付不了款）更糟**。
半接的失败形态是"钱收了但没给货"，那是资金事故，不是功能缺陷。

因此本轮只做**可验证的那一半**（配置透传），并把这条缺口钉进文档与 `tasks.md`。

