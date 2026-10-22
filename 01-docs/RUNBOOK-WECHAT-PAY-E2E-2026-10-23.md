# Runbook：微信 Native 支付 E2E 验收（E2E-1 ~ E2E-7）

> 对应 PRD §11.4。**这是唯一能把「代码能付款」变成「用户真的付过款」的步骤。**
> 本文件的目标是：拿到凭据的人可以**照着敲**，不需要回来问任何一个问题。
>
> 适用版本：`wechat-native-payment`（2026-10-21 ~ 10-23 三个 PR：#4187 / #4219 / #4252 / #4256）

---

## 0. 前置：先把这 8 样东西凑齐

| # | 名称 | 从哪拿 | 备注 |
|---|---|---|---|
| 1 | `appid` | 微信公众平台 / 开放平台 | 与商户号已绑定的那个 |
| 2 | `mchid`（商户号） | 商户平台首页 | 10 位数字 |
| 3 | APIv3 密钥 | 商户平台 → 账户中心 → API 安全 → 设置 APIv3 密钥 | **必须 32 字符**；只显示一次 |
| 4 | 商户证书序列号 | 商户平台 → API 安全 → 申请商户 API 证书 | 40 位十六进制 |
| 5 | 商户私钥 `apiclient_key.pem` | 申请证书时下载（与 #4 配套） | 文件，不是字符串 |
| 6 | 微信支付公钥 + 公钥 ID | 商户平台 → API 安全 → 微信支付公钥 | 2024+ 用公钥模式；ID 形如 `PUB_KEY_ID_…` |
| 7 | 公网 HTTPS 域名 | 你自己的 | 必须能公网访问到 `/api/v1/webhooks/payment` |
| 8 | 一个可登录的测试账号 | 应用里注册 | 用来走前端流程 |

> ⛔ **凭据一律不入仓、不入包、不进 Electron**。放服务端环境的 `.env` 或密钥管理里。

---

## 1. 应用数据库迁移

```bash
# 1.1 先看还差哪些（只读，不改库）
BUSINESS_DATABASE_URL='postgres://…' \
  node packages/api-publish-engine/scripts/migrate-postgres.js --dry-run
```

期望输出里 `pending` 含 `006_payment_orders.sql`：

```json
{"applied":[],"skipped":["002_logto_identity.sql","003_logto_webhook_events.sql","004_member_commerce.sql","005_cloud_accounts.sql"],"pending":["006_payment_orders.sql"]}
```

```bash
# 1.2 真跑
BUSINESS_DATABASE_URL='postgres://…' \
  node packages/api-publish-engine/scripts/migrate-postgres.js
```

**容器内部署**：

```bash
docker compose -f packages/api-publish-engine/docker-compose.yml \
  exec publish-api node packages/api-publish-engine/scripts/migrate-postgres.js --dry-run
```

### 为什么这一步不能跳

| 事实 | 后果 |
|---|---|
| `initialize()` 在 `production` 下抛 `PRODUCTION_AUTO_MIGRATE_FORBIDDEN` | 不会自动建表 |
| `assertReady()` 校验 `REQUIRED_SCHEMA_RELATIONS`，其中含 `identity_payment_customers` | 不迁移 ⇒ `BUSINESS_DATABASE_SCHEMA_NOT_READY` ⇒ **健康检查失败、整站 503** |
| `identity_schema_migrations` 记 checksum | 改已应用的迁移文件会 `MIGRATION_CHECKSUM_MISMATCH`。**只能新增 007+，不要改 006** |

### 迁移后核对（SQL）

```sql
-- 4 个新列必须都在
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'identity_orders'
   AND column_name IN ('provider_order_id','provider_sub_id','period','discount_cents')
 ORDER BY column_name;
-- 期望 4 行

-- 新表必须存在
SELECT to_regclass('identity_payment_customers');  -- 非 NULL

-- 迁移台账
SELECT name FROM identity_schema_migrations ORDER BY name;
-- 期望含 006_payment_orders.sql
```

---

## 2. 把支付变量送进容器

`packages/api-publish-engine/docker-compose.yml` 已经逐项透传（2026-10-23 修复）。宿主机 `.env` 里填：

```dotenv
PAYMENT_PROVIDER=wechat_native
WECHAT_PAY_APPID=<appid>
WECHAT_PAY_MCH_ID=<mchid>
WECHAT_PAY_API_V3_KEY=<32 字符>
WECHAT_PAY_CERT_SERIAL_NO=<40 位十六进制>
# 二选一：文件路径（容器内）或 PEM 全文
WECHAT_PAY_CERT_PATH=/app/packages/api-publish-engine/config/wechat-pay/apiclient_key.pem
# WECHAT_PAY_CERT_CONTENT=<PEM 全文>
# 平台公钥（回调验签）：二选一
WECHAT_PAY_PLATFORM_PUBLIC_KEY=<裸 Base64 或 PEM>
# WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH=/app/…/wechatpay_pub_key.pem
WECHAT_PAY_PUBLIC_KEY_ID=PUB_KEY_ID_…
WECHAT_PAY_NOTIFY_URL=https://<你的域名>/api/v1/webhooks/payment
```

**证书文件放哪**：`packages/api-publish-engine/config/wechat-pay/apiclient_key.pem`
—— 该目录已被 compose bind 到容器内 `/app/packages/api-publish-engine/config`。

```bash
chmod 600 packages/api-publish-engine/config/wechat-pay/apiclient_key.pem
docker compose -f packages/api-publish-engine/docker-compose.yml up -d
```

---

## 3. 商户平台配置（网页操作）

| 项 | 位置 | 值 |
|---|---|---|
| 支付回调 URL | 商户平台 → 产品中心 → 开发配置 → Native 支付 → 支付回调 | `https://<域名>/api/v1/webhooks/payment`（**逐字一致**） |
| APIv3 回调加密 | 同上 → 回调加密 | 开启（`AEAD_AES_256_GCM`） |

> 回调 URL 必须与 `WECHAT_PAY_NOTIFY_URL` **逐字相同**（含协议、端口、路径、末尾不许多 `/`）。
> 不一致的典型现象：微信返回「回调地址不合法」，或回调发到旧地址而服务端收不到。

---

## 4. 上线前自检（三条都要过）

```bash
# 4.1 支付预检（配置 / 凭据可解析 / provider 可构造 / 迁移已应用）
docker compose -f packages/api-publish-engine/docker-compose.yml \
  exec publish-api node packages/api-publish-engine/scripts/payment-preflight.js
# 期望：五项全 PASS（provider-kind 显示 PASS 而不是 SKIP）
# 退出码 0 才算过；1 = 有失败项；2 = 用法错误

# 4.2 就绪探针
curl -fsS http://127.0.0.1:3030/api/v1/ready && echo OK

# 4.3 端点存在性：未登录应 401（不是 404）
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3030/api/v1/me/checkout
# 期望 401 / 403；若是 404，说明版本没部署对
```

预检报 `PAYMENT_CONFIG_INVALID(field)` 时，括号里的 `field` 就是缺的那个变量名。

> ⚠️ 预检全绿只证明「我们这边准备好了」，**不证明微信会接受**。下面七条才是真证据。

---

## E2E-1 下单 → 扫码 → 支付成功

**目的**：唯一能证明「用户真的能付钱」的一条。

| 步骤 | 操作 | 观察点 |
|---|---|---|
| 1 | 桌面端登录 → 会员中心 → 订阅 | 看到「立即购买」 |
| 2 | 点「立即购买」 | 先「正在创建订单…」，随后出二维码 + 支付金额 |
| 3 | 手机微信「扫一扫」 | 显示商户名与金额（**金额必须与页面一致**） |
| 4 | 确认支付 | 手机显示支付成功 |
| 5 | 看桌面端 | 弹窗转「支付成功，权益已开通」，关闭按钮禁用 |

**API**：抓一条 `POST /api/v1/me/checkout` 200，响应含 `codeUrl`。

**DB 期望**：

```sql
-- 订单已 paid，且金额与套餐价一致
SELECT id, plan, period, amount, status, paid_at, provider_order_id
  FROM identity_orders
 WHERE channel = 'payment'
 ORDER BY created_at DESC LIMIT 3;
-- 期望：最新一行 status='paid'、paid_at 非空、provider_order_id 非空

-- 权益已发放（provider_reference 形如 wechat:<订单 id>）
SELECT user_id, plan, status, provider_reference, current_period_end
  FROM identity_subscriptions
 ORDER BY current_period_end DESC LIMIT 3;
-- 期望：plan 与购买档位一致、provider_reference = 'wechat:<订单 id>'

-- ⚠️ 支付回调目前**不写** identity_webhook_events（见文末「已知限制」）。
--    确认回调到达请看服务端日志里 hook="payment-webhook" 的行。
```

**前端期望**：不刷新页面，档位与到期时间就地更新（`paid` 事件触发 `identityStore.load()`）。

**失败排查**：

| 现象 | 方向 |
|---|---|
| 弹窗「支付通道暂未开放」 | 预检 4.1 没 PASS；`/me/checkout` 是 503 |
| 弹窗「支付未完成，未扣款，可重试」 | 微信返回错误码。看服务端日志的 `PAYMENT_PROVIDER_UPSTREAM_REJECTED` 后面的 code |
| 手机付了钱，桌面端不动 | 回调没到。查 ① 公网能否 `curl -X POST https://<域名>/api/v1/webhooks/payment`（应 401 而不是超时）② 商户平台回调 URL 是否逐字一致 ③ 网关是否放行该路径 |
| 回调到了但订单没 paid | 看服务端日志 `hook="payment-webhook"` 那几行：验签失败常见 `PAYMENT_WEBHOOK_CERT_NOT_FOUND`（公钥 ID 配错）、`PAYMENT_WEBHOOK_CERT_MISSING`（平台公钥没配）；结算失败看 `PAYMENT_ORDER_NOT_FOUND` / `ORDER_REFERENCE_CONFLICT` |

---

## E2E-2 扫码后取消支付

**目的**：证明「没付钱就不会发权益」。

| 步骤 | 操作 |
|---|---|
| 1 | 下单出码 → 扫码 → 在手机上**取消** |
| 2 | 桌面端等 30 分钟（或临时把 `POLL_TIMEOUT_MS` 调小做一次快速验证） |
| 3 | 观察弹窗与权益 |

**期望**：
- 弹窗 30 分钟后转「支付超时，可重新发起」
- **权益不变**（`identity_subscriptions` 无新行/无变更）
- 订单**仍是 `pending`**（⚠️ 不是 `failed` —— `identity_orders.status` 的 CHECK 里没有 `failed`，未付订单永远停在 pending）

```sql
SELECT id, status, paid_at FROM identity_orders WHERE id = '<刚下的单>';
-- 期望：status='pending'，paid_at IS NULL
```

---

## E2E-3 二维码过期后刷新

| 步骤 | 操作 |
|---|---|
| 1 | 下单出码，等二维码过期（或直接点「刷新二维码」） |
| 2 | 点「刷新二维码」 |

**期望**：拿到**新** `codeUrl`，可正常扫描；旧码不可复用。

**注意**：刷新走的是**同一个订单**（不新建订单行）—— 这是 #4219 加的「继续支付」复用逻辑。

```sql
SELECT count(*) FROM identity_orders WHERE channel='payment' AND user_id='<你的 user_id>';
-- 刷新前后数量不变
```

---

## E2E-4 同一订单重复回调（幂等）

**目的**：证明「重放不会发两次权益」。这是资金安全的核心断言。

| 步骤 | 操作 |
|---|---|
| 1 | 完成一次 E2E-1 |
| 2 | 用商户平台的「回调重试」或用抓到的原始请求体**重放同一回调**（同 `Wechatpay-Signature` 同 body） |
| 3 | 观察响应与 DB |

**期望**：
- HTTP 200（幂等成功，不报错）
- `identity_subscriptions` **没有**第二条针对该订单的记录
- 到期时间**没有**再加一次

```sql
SELECT count(*) FROM identity_subscriptions WHERE provider_reference = 'wechat:<订单 id>';
-- 期望：1（provider_reference 上有 UNIQUE 约束，重复授权会被数据库拒绝）
```

> 实现口径：幂等键是**我们自己的 `out_trade_no`**（即订单 id），不是微信的 `transaction_id`。

---

## E2E-5 伪造签名回调

**目的**：证明「伪造回调拿不到权益」。

```bash
# 拿一条真实回调的 body，把 signature 改掉一个字符后重放
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST 'https://<域名>/api/v1/webhooks/payment' \
  -H 'Content-Type: application/json' \
  -H 'Wechatpay-Signature: <把最后一个字符改掉>' \
  -H 'Wechatpay-Serial: <真实 serial>' \
  -H 'Wechatpay-Timestamp: <真实时间戳>' \
  -H 'Wechatpay-Nonce: <真实 nonce>' \
  --data-binary @payload.json
```

**期望**：**401**，且权益零变化。

```sql
SELECT count(*) FROM identity_subscriptions WHERE provider_reference = 'wechat:<该订单 id>';
-- 期望与伪造前一致
```

---

## E2E-6 pro 用户买 standard（跨档压制）

**目的**：证明「高档不会被低档覆盖」。

| 步骤 | 操作 |
|---|---|
| 1 | 用已生效 pro 的账号下单 **standard** 并支付 |
| 2 | 观察档位与到期时间 |

**期望**：`plan` **仍是 `pro`**，`current_period_end` **顺延**（不是被改回 standard）。

```sql
SELECT plan, current_period_end FROM identity_subscriptions WHERE user_id='<该用户>';
-- 期望：plan='pro'，到期时间比支付前更晚
```

---

## E2E-7 打包版全流程

**目的**：证明没有 dev-only 短路。

```bash
cd apps/desktop
pnpm exec electron-builder --win --dir --publish never
dist-electron/win-unpacked/Multi-Publish.exe
```

用**打包产物**重跑 E2E-1。期望与开发态一致。

> 启动时若 8 秒内静默退出且 stderr 为空，先查环境变量 `ELECTRON_RUN_AS_NODE`（它会让 Electron 以纯 Node 模式启动）。

---

## 观测（灰度期每天看一次）

```sql
-- 支付成功率（近 24h）
SELECT status, count(*) AS n
  FROM identity_orders
 WHERE channel='payment' AND created_at > now() - interval '24 hours'
 GROUP BY status;

-- ⚠️ 支付回调不落 identity_webhook_events（见「已知限制」），
--    回调到达率只能从服务端日志统计：grep 'payment-webhook' 并按小时聚合。

-- 未落账的订单（有支付但没 paid）—— 这是要盯的那条线
SELECT id, user_id, amount, created_at
  FROM identity_orders
 WHERE channel='payment' AND status='pending' AND created_at < now() - interval '30 minutes'
 ORDER BY created_at DESC LIMIT 20;
```

判据：`paid / (paid + pending)` 应稳定；`pending` 长期不降说明回调链路有问题。

---

## 回滚

```bash
# 只关入口，不动数据、不改代码
PAYMENT_PROVIDER=none   # 然后重启服务
```

效果：
- `/me/checkout` 恢复 503 `PAYMENT_PROVIDER_UNAVAILABLE`，前端回到「支付通道暂未开放」
- 已产生的 `pending` 订单不会被清理（永不 `paid`，无副作用）
- 已生效的订阅**不受影响**

---

## 已知限制（会让排查变难，先知道）

| # | 限制 | 后果 | 现状 |
|---|---|---|---|
| 1 | **支付回调不落 `identity_webhook_events`** | 回调到达/处理没有持久化记录，只能翻服务端日志。PRD §5.3 写的是「复用为支付 outbox」，实现里 `_handlePaymentWebhook` 与 `settlePaymentWebhook` **都没有写这张表** | 已知缺口，待补 |
| 2 | 未支付订单**永远停在 `pending`** | `identity_orders.status` 的 CHECK 只有 `pending / paid / refunded / canceled`，**没有 `failed`**。前端弹窗里的 `failed` 态只对应「本次轮询失败」，不是库里的状态 | 设计如此（PRD §4.2 非目标） |
| 3 | 没有自助退款 | 退款走商户平台后台人工操作；退款后 `identity_orders.status` 不会自动变 `refunded` | 设计如此（PRD §4.2 非目标） |
| 4 | 没有自动续费 | 到期即失效，续期 = 重新下一单 | 设计如此（未申请委托代扣资质） |

> 限制 #1 的实际影响：E2E-4（重复回调幂等）与 E2E-5（伪造签名 401）**仍然可验**，
> 因为幂等靠 `provider_reference` UNIQUE、验签失败靠 HTTP 401 —— 都不依赖事件表。
> 受影响的是「事后追查某条回调到底有没有来过」。
## 验收记录表（跑完填这张）

| # | 场景 | 结果 | 时间 | 执行人 | 备注（失败时的错误码/截图路径） |
|---|---|---|---|---|---|
| E2E-1 | 下单→扫码→支付成功 | ⬜ | | | |
| E2E-2 | 取消支付，权益不变 | ⬜ | | | |
| E2E-3 | 二维码过期刷新 | ⬜ | | | |
| E2E-4 | 重复回调只发一次 | ⬜ | | | |
| E2E-5 | 伪造签名 401 | ⬜ | | | |
| E2E-6 | pro 买 standard 跨档压制 | ⬜ | | | |
| E2E-7 | 打包版全流程 | ⬜ | | | |

**七条全绿 = 支付功能可以对外。** 有一条红就不算交付完成。
