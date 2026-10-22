# Design — wechat-native-payment

> 实现的详细规格（校验表 / 文案表 / 测试矩阵 / 交互态）见 `01-docs/PRD-WECHAT-PAY-INTEGRATION-2026-10-21.md`。
> 本文只记录**决策与备选**（为什么选 X 而非 Y），以及风险与回退。

## 0. 一句话设计

在既有 `applySubscription` 之上新增**第三条授权写入通道（支付回调）**：服务端算金额 → 落 `pending` 订单 → 调微信 Native 下单拿 `code_url` → 客户端渲染二维码 → 微信 webhook 验签后驱动订单 `paid` 并**复用** `applySubscription` 发放权益。**不新增任何授权写入路径**，只新增一条触发它的入口。

## 1. 为什么复用 applySubscription 而不是新写一条支付授权路径

`postgres-commerce-store.js:88-169` 的 `applySubscription` 已经处理了本期需要的全部难点：

| 难点 | 既有实现 | 新写的代价 |
|---|---|---|
| 并发续叠丢期 | `pg_advisory_xact_lock(hashtextextended($1,0))` 按用户串行化（:100） | 极易漏 —— 并发下单会丢时长 |
| 跨档压制（低档不降高档） | `planRank` 比较 + `downgradeSuppressed`（:112-116） | 重写必漂移 |
| 快照与订阅同源 | `entitlementPayloadFor(effectivePlan)` + fail-closed 守卫（:120-129） | 漏守卫即权限分裂（G3 同型事故） |
| 三连写原子性 | subscription upsert → order → snapshot 同事务（:142-158） | 非事务即永久权限泄漏 |
| `provider_reference` UNIQUE 冲突 | 收敛为 409 `ORDER_REFERENCE_CONFLICT`（:146-152） | 裸 23505 → 500 |
| `durationDays` 溢出 | Invalid Date 守卫（:137-139） | RangeError → 500 |

**结论**：`settlePaymentWebhook()` 只做「验签 → 归一化 → 算 durationDays → 调 applySubscription」，与 `redeem()` 的差异仅在 `channel: 'payment'` 与 `providerReference` 取值。**这也意味着续期语义自动获得续叠与压制保护**，无需为「重新下单」写任何新逻辑。

## 2. 数据模型（最小增量）

### 2.1 `identity_orders` 补列（迁移 006）

```sql
ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS provider_order_id TEXT;
ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS provider_sub_id    TEXT;
ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS period            TEXT;
ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS discount_cents    INTEGER NOT NULL DEFAULT 0;
```

- 全部可空 + 默认值向后兼容（阶段 1 兑换码/后台订单不受影响）。
- `period` 取值 `month | year`，**不设 CHECK 约束**：与上游 §4.1 一致（避免既有行阻塞迁移）；由服务层白名单校验。
- `discount_cents` 本期恒 0（无 coupon），列的存在是为对账schema 稳定，不在服务层读取。
- **不加 `coupon_code`**：上游 §4.1 有，但本期无 coupon 功能，加了就是无人写入的死列。

### 2.2 新建 `identity_payment_customers`

```sql
CREATE TABLE IF NOT EXISTS identity_payment_customers (
  user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_customer_id TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT identity_payment_customers_unique UNIQUE (provider, user_id)
);
```

**为什么建这张表**：微信 webhook 回传的是 `openid`/`transaction_id`，**没有我们的 `user_id`**。必须有「微信 openid ↔ 业务 user_id」的映射才能把回调落到正确用户。

**为什么 `provider_customer_id` 可空**：微信 Native 场景下，我们在 `createCheckout` 时把 `user_id` 编码进 `attach` 字段（微信自定义数据，会原样回传），**不依赖 openid 反查**。但 openid 仍要落库——用于对账与将来「同一微信多次支付」的关联。若将来接 JSAPI（必须 openid），这张表就是现成的入口。

**`UNIQUE (provider, user_id)` 而非 `(provider, provider_customer_id)`**：本期一个用户对微信只有一个映射；反向唯一会让「同一 openid 绑定两个 user」被 DB 拒绝，而那是业务层该判的（且 openid 可空，NULL 在 PG 唯一约束里不互斥，写了也锁不住）。

### 2.3 幂等键的选取（关键决策）

微信 webhook 的 `out_trade_no` 是**我们自己生成的订单号**，全局唯一；`transaction_id` 是微信侧流水号。

**幂等键 = `out_trade_no`（我们的订单号）**，理由：
- `identity_orders.id` 就用 `out_trade_no`（而非 `ord-<uuid>`），订单号即主键，重复回调天然撞主键。
- `applySubscription` 的 `providerReference` 用 `wechat:<out_trade_no>`，撞 `identity_subscriptions_provider_reference_key` 唯一约束 → 409 `ORDER_REFERENCE_CONFLICT`（既有收敛路径）。
- **不用 `transaction_id`**：微信对同一笔订单可能先发 `SUCCESS` 再发 `REFUND`，两个事件 `transaction_id` 相同但语义相反；用订单号才能让「同一订单的多事件」按订单聚合，再按事件类型分流。

**乱序容忍**：`REFUND` 早于 `SUCCESS` 到达时，`REFUND` 找不到 `paid` 订单 → 记 `identity_webhook_events.status='ignored'` 并返回 2xx（**不报错**，否则微信会重投风暴）；后续 `SUCCESS` 正常生效。本期无退款功能，故 `REFUND` 分支只落库不处理（为对账与审计留痕）。

### 2.4 `identity_webhook_events` 的复用冲突（必须解决）

阶段 1 该表为 Logto webhook 设计：列是 `(id, provider, event, hook_id, auth_subject, created_at, received_at, status, result, processed_at)`，唯一键 `(provider, id)`。

**冲突点**：`auth_subject TEXT NOT NULL`（:73）—— 微信回调里没有 Logto subject。

**方案 A（采用）**：`auth_subject` 仍 NOT NULL，支付事件填**订单号 `out_trade_no`**（它是我们生成的、非空、有界）。语义上「subject」被放宽为「事件归属的业务主键」，Logto 事件填 Logto subject、支付事件填订单号。
- 优点：零 schema 变更，`claimWebhookEvent` 的 `ON CONFLICT (provider, id) DO NOTHING` 直接复用（既有幂等路径）。
- 代价：列名与内容不完全对齐，需在代码注释与 PRD 明示。

**方案 B（否决）**：新建 `identity_payment_webhook_events` 表。理由：同一张 outbox 表才能让「事件先落库再处理」的审计口径唯一；分表后对账要查两处，且 `provider` 列本就为区分来源而存在（已有 `logto` 值，加 `wechat` 即可）。

**方案 C（否决）**：改 `auth_subject` 为可空。理由：动既有列会影响 Logto 路径的既有断言与生产数据，且 NOT NULL 是刻意的 fail-closed。

## 3. PaymentProvider 抽象（三方法，收缩版）

```js
// packages/api-publish-engine/src/auth/payment-providers/index.js
class PaymentProvider {
  createCheckout({ orderId, plan, period, amountCents, currency, attach })
    → { codeUrl, expiresAt }                       // 微信 Native：code_url
  parseWebhook({ rawBody, headers })
    → NormalizedEvent                              // 验签失败抛 WebhookSignatureError(401)
  capabilities()
    → { immediateCancel:false, refunds:false, proration:false,
        autoRenewToggle:false, trial:false, coupons:false, customerPortal:false }
}
```

**为什么只留三方法**：上游 R-A 红线说「抽象层不得对着空气锁定」。微信 Native 的真实能力边界就是「下单 + 回调」，`cancelSubscription`/`changePlan` 无对应物。**能力声明全部为 false** 是诚实的数据，UI 据此隐藏对应入口（上游 §10.3 的能力驱动文案机制保留但本期全部走 false 分支）。

**归一化事件形状**（与上游 §3 对齐但收缩）：

```js
type NormalizedEvent = {
  provider: 'wechat',
  externalEventId,        // = out_trade_no（幂等键）
  type: 'checkout.completed' | 'payment.failed' | 'refunded' | 'ignored',
  orderId,                // = out_trade_no
  amountCents, currency,  // 仅供对账
  occurredAt,
  raw                     // 仅入库 jsonb，绝不外泄
}
```

## 4. 金额真源铁律（不可放宽）

```
客户端 POST /api/v1/me/checkout  body: { plan, period }
        ↓  服务端
plan-matrix 校验 plan ∈ {standard, pro}（free 拒 400）
          校验 period ∈ {month, year}
          amountCents = period==='month' ? priceMonthlyCents : priceYearlyCents
          durationDays = period==='month' ? 30 : 365
          ↓  落单
identity_orders { id: out_trade_no, amount: amountCents, channel:'payment',
                  status:'pending', period, plan }
          ↓  下单
provider.createCheckout({ amountCents, ... })   // 微信要求 total 单位为「分」
```

- 客户端**传 `amount` 一律丢弃**（body 白名单只取 `plan`/`period`）。契约测试必须有一条「带 `amount:1` 仍按 ¥5900 落单」。
- 回调金额与订单金额不一致 → 记 WARN `PAYMENT_AMOUNT_MISMATCH`（对账），**不改计费、不阻断授权**（本期无 coupon，不一致只可能是异常）。
- **30 天 vs 自然月**：`durationDays` 用固定 30/365，与兑换码路径一致（`redeem` 的 `duration_days` 也是整数天）。不做自然月顺延——那需要日历运算且与既有语义分叉。

## 5. Webhook 处理流程

```
POST /api/v1/webhooks/payment
  │ ① 读 rawBody（上限 256 KiB，与 Logto webhook 同口径）
  │ ② 验签：四头（Wechatpay-Signature / Serial / Timestamp / Nonce）
  │    - 时间戳偏离 > 5min → 401（防重放）
  │    - 用 Serial 对应的微信平台证书公钥做 RSA-SHA256 验签
  │    - 验签失败 → 401，**不入库不处理**
  │ ③ 解密 resource（AEAD_AES_256_GCM，APIv3 平台证书密钥）
  │ ④ 归一化 → NormalizedEvent
  │ ⑤ 事务：claimWebhookEvent（幂等）→ 分流事件类型
  │    - checkout.completed：订单 pending→paid → applySubscription(channel='payment')
  │    - payment.failed / refunded / ignored：只更新事件状态，不动订阅
  │ ⑥ 完成 → completeWebhookEvent
  │ ⑦ 返回 2xx（含重复/忽略）
```

**为什么验签前不解析 JSON**：与 `logto-webhook.js:124` 同一纪律——先验签再信任任何字节。

**为什么内部错误仍返回 2xx**：上游 §9 已定（防微信重投风暴）。错误已入 `identity_webhook_events.status='failed'` 供重放修复。**但本期不做重放 UI**（那需要 ops-center 新页面，超出最小闭环）。

**微信平台证书的获取与轮换**：`GET /certificates` 需商户证书签名，返回平台证书（每张有 `expire_time`）。**本期实现**：启动时拉取并缓存到内存，`Wechatpay-Serial` 指向未缓存的证书时按需增量拉取。**不做定时轮换**（进程重启即刷新，桌面服务重启频率足够）。

## 6. 桌面端链路

```
MemberCenter/Subscription.vue  「立即购买」按钮
  │ invoke('wechat-pay:create-order', { plan, period })
  ▼
主进程 ipc-handlers/wechat-pay.js
  │ withSenderCheck + license-access-control（authenticated）
  │ → memberApiService.request({ path:'/api/v1/me/checkout', method:'POST',
  │                              body:{plan, period} })   ← 白名单只放 plan/period
  ▼
服务端返回 { orderId, codeUrl, expiresAt }
  │
  ▼
主进程 wechat-pay-qrcode.js：codeUrl → QR 矩阵 → SVG data URI
  │
  ▼
渲染层 WeChatPayDialog.vue：<img :src="qrDataUri"> + 3s 轮询 order-status
  │  - paid → 「支付成功」→ 触发 identity 状态刷新 → 关闭弹窗
  │  - failed → 「支付失败，可重试」
  │  - 30min 超时 → 「支付超时，可重新发起」
```

**IPC 命名为什么用 `wechat-pay:` 而非 `payment:`**：`buyout-removal.contract.test.js` 用 `payment:` 前缀与 `payment[A-Z]` 桥接名锁买断形态不回归。复用旧名会与那把锁正面冲突，且语义上「payment」是已被移除的买断链路名字。**新命名 = 新语义**，同时改造该锁把「payment 前缀零命中」收紧为「白名单里只有 wechat-pay: 两条」。

**二维码渲染位置为什么在 shared-utils**：将来 ops-center 后台若要展示支付码可复用；且放 `apps/desktop` 下会被 electron vitest include 白名单之外的路径漏测（`buyout-removal.contract.test.js:17-21` 记过这个坑）。

## 7. 失败与降级矩阵

| 场景 | 服务端 | 客户端 |
|---|---|---|
| 未配置微信商户凭据 | `/me/checkout` → 503 `PAYMENT_PROVIDER_UNAVAILABLE` | 购买按钮隐藏（不渲染），仅展示价目与兑换码 |
| `plan=free` 或非法 | 400 `CHECKOUT_PLAN_INVALID` | 不出现（UI 只对付费档渲染按钮） |
| `period` 非法 | 400 `CHECKOUT_PERIOD_INVALID` | UI 只提供月/年两个选项 |
| 未登录 | IPC 层 `BUSINESS_USER_REQUIRED`（既有 `requireSubject` 短路面） | 引导登录 |
| 微信下单超时/失败 | 502 `PAYMENT_PROVIDER_UPSTREAM_FAILED`，订单留 `pending` | 「发起支付失败，请重试」 |
| 二维码过期（`expiresAt` 到） | 订单仍 `pending`（微信侧 code_url 失效） | 「二维码已过期」+「刷新」按钮重新下单 |
| webhook 验签失败 | 401，不入库 | 无感知（订单保持 pending，最终超时提示） |
| webhook 重复 | 2xx + `duplicate:true` | 无感知 |
| 用户扫码后取消支付 | 微信不发 webhook（或发 `payment.failed`，视版本） | 轮询超时提示 |

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| **二维码渲染器实现错误**（位图错乱但看起来像码） | 对已知向量做**逐位矩阵断言**（非「能生成 SVG」）；附一个真机扫码 smoke（人工，记入 PRD 验收） |
| **webhook 被伪造** → 白嫖权益 | 微信平台证书 RSA 验签 + 时间戳容差 + 平台证书按 `Serial` 匹配；契约测试含伪造签名负例 |
| **金额被篡改** | body 白名单 + 服务端算金额 + 对账 WARN；契约测试带 `amount:1` 负例 |
| **重复授权** | 幂等键 = 订单号；`applySubscription` 的 `providerReference` UNIQUE + advisory lock 双保险 |
| **`auth_subject` 语义放宽被误用** | PRD 与迁移注释明示「支付事件填订单号」；`identity_webhook_events` 消费方按 `provider` 分流，不混读 |
| **迁移漂移**（SCHEMA 数组 vs 006 SQL） | 复用 `member-commerce-migrations.test.js` 同体例漂移锁 |
| **买断形态借尸还魂** | 改造 `buyout-removal.contract.test.js`：新增「白名单只允许 wechat-pay: 两条」正向锁 + 变异反证 |
| **30 分钟轮询占用 IPC** | 3s 间隔 + 窗口关闭即停（`onBeforeUnmount` 注销）；弹窗关闭取消轮询定时器 |
| **商户凭据泄漏进仓库/打包** | 只走环境变量；`.env.example` 占位；CI 扫硬编码密钥；**凭据不进 Electron 打包**（下单在服务端，客户端只拿 codeUrl） |

## 9. 回退

- **功能级**：服务端 `PAYMENT_PROVIDER=none` 或未配商户凭据 → `/me/checkout` 503，客户端隐藏入口。**零代码回退**。
- **数据级**：迁移 006 全部 `ADD COLUMN IF NOT EXISTS` + 新表 `CREATE TABLE IF NOT EXISTS`，无破坏性变更；回退代码不影响既有兑换码/后台通道数据。
- **进程级**：桌面端卸载 IPC 注册即回到「付费通道筹备中」文案。

## 10. 兼容与存量

- 既有 `channel='redeem'` / `'admin_grant'` 订单：`provider_order_id` 等新列恒 NULL，`toOrderDto` 白名单构造不受影响。
- `identity_orders.channel` 的 CHECK 已含 `'payment'`（`004_member_commerce.sql:12`）→ **无需改约束**，这是阶段 1 预留的地基。
- `identity_subscriptions.provider_reference` UNIQUE：既有 redeem/grant 用 `redeem:<code>` / `grant:<op>:<id>` 前缀，支付用 `wechat:<out_trade_no>`，前缀隔离不撞车。
