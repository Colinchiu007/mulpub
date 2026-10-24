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

`packages/api-publish-engine/docker-compose.yml` 已经逐项透传（2026-10-23 修复）。

**支付凭据放在独立的文件里**，不要写进 `deploy/logto/api.env`（那是业务 API 自身的 Logto / PostgreSQL / entitlement 配置）：

```bash
cp deploy/payment/wechat-pay.env.example deploy/payment/wechat-pay.env   # 已被 .gitignore 忽略
```

```dotenv
# deploy/payment/wechat-pay.env
PAYMENT_PROVIDER=wechat_native
WECHAT_PAY_APPID=<appid>
WECHAT_PAY_MCH_ID=<mchid>
WECHAT_PAY_API_V3_KEY=<32 字符>
WECHAT_PAY_CERT_SERIAL_NO=<40 位十六进制>
# 二选一：文件路径（**容器内**）或 PEM 全文
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

# 两个 --env-file：身份/数据库一份，支付凭据一份（Compose v2.24+ 支持多文件，后者覆盖前者）
docker compose -f packages/api-publish-engine/docker-compose.yml \
  --env-file deploy/logto/api.env \
  --env-file deploy/payment/wechat-pay.env \
  up -d
```

> ⚠️ **漏掉第二个 `--env-file` 会怎样**：`PAYMENT_PROVIDER` 读不到 ⇒ 退回 `none` ⇒ 前端显示「支付通道暂未开放」。
> 好消息是 `payment-preflight` 会把它判成 **FAIL**（"检测到 N 个支付变量但 PAYMENT_PROVIDER=none"），不会静默通过。

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

-- 回调事件已落库（provider='wechat_pay'，id = 'wechat_pay:<订单号>'）
SELECT id, event, auth_subject, status, processed_at, result
  FROM identity_webhook_events
 WHERE provider = 'wechat_pay'
 ORDER BY received_at DESC LIMIT 5;
-- 期望：该订单一条 status='processed'，auth_subject = 订单号，result 里有 plan
```

**前端期望**：不刷新页面，档位与到期时间就地更新（`paid` 事件触发 `identityStore.load()`）。

**失败排查**：

| 现象 | 方向 |
|---|---|
| 弹窗「支付通道暂未开放」 | 预检 4.1 没 PASS；`/me/checkout` 是 503 |
| 弹窗「支付未完成，未扣款，可重试」 | 微信返回错误码。看服务端日志的 `PAYMENT_PROVIDER_UPSTREAM_REJECTED` 后面的 code |
| 手机付了钱，桌面端不动 | 回调没到。查 ① 公网能否 `curl -X POST https://<域名>/api/v1/webhooks/payment`（应 401 而不是超时）② 商户平台回调 URL 是否逐字一致 ③ 网关是否放行该路径 |
| 回调到了但订单没 paid | 先查 `identity_webhook_events WHERE provider='wechat_pay' AND auth_subject='<订单号>'`：<br>· **没有行** ⇒ 回调没到服务端（查公网可达性 / 商户平台回调 URL / 网关放行）<br>· **有行且 `status='processing'`** ⇒ 验签过了但结算中途失败，看日志 `hook="payment-webhook"` 的 `PAYMENT_ORDER_NOT_FOUND` / `ORDER_REFERENCE_CONFLICT`<br>· **完全没日志** ⇒ 验签就失败了，常见 `PAYMENT_WEBHOOK_CERT_NOT_FOUND`（公钥 ID 配错）/ `PAYMENT_WEBHOOK_CERT_MISSING`（平台公钥没配） |

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
- HTTP 200（幂等成功，不报错），响应体带 `duplicate: true`
- `identity_subscriptions` **没有**第二条针对该订单的记录
- `identity_webhook_events` 里该订单**只有一行**（重复投递落同一行，`ON CONFLICT DO NOTHING`）
- 到期时间**没有**再加一次

```sql
-- 判据①：权益只发一次
SELECT count(*) FROM identity_subscriptions WHERE provider_reference = 'wechat:<订单 id>';
-- 期望：1（provider_reference 上有 UNIQUE 约束，重复授权会被数据库拒绝）

-- 判据②：事件只落一行（这是 2026-10-23 新增的留痕，重复投递不会新增行）
SELECT count(*) FROM identity_webhook_events
 WHERE provider = 'wechat_pay' AND auth_subject = '<订单 id>';
-- 期望：1
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

-- webhook 到达与处理情况（近 24h）
SELECT event, status, count(*) AS n
  FROM identity_webhook_events
 WHERE provider='wechat_pay' AND received_at > now() - interval '24 hours'
 GROUP BY event, status;
-- 正常：绝大多数 status='processed'。出现 processing 积压 ⇒ 结算链路在报错

-- 卡在 processing 的事件（超过 10 分钟）—— 这是要人工看的那条线
-- 成因：结算成功但收口 UPDATE 失败（服务端日志会有 PAYMENT_EVENT_NOT_RECORDED）。
-- 权益**已经发了**，这条只是留痕没闭环；不要据此重新发放。
SELECT id, event, auth_subject, received_at
  FROM identity_webhook_events
 WHERE provider='wechat_pay' AND status='processing'
   AND received_at < now() - interval '10 minutes'
 ORDER BY received_at DESC LIMIT 20;

-- 未落账的订单（有支付但没 paid）—— 这是要盯的那条线
SELECT id, user_id, amount, created_at
  FROM identity_orders
 WHERE channel='payment' AND status='pending' AND created_at < now() - interval '30 minutes'
 ORDER BY created_at DESC LIMIT 20;
```

判据：`paid / (paid + pending)` 应稳定；`pending` 长期不降说明回调链路有问题。

---

## 灰度期每天跑一次对账

```bash
docker compose -f packages/api-publish-engine/docker-compose.yml \
  exec publish-api node packages/api-publish-engine/scripts/payment-reconcile.js --since-days 1
```

退出码 `0` 才继续放量；`1` 有阻塞差异（见 PRD §15.10.5 的处置表）；`2` 是工具/连接问题，
**不能读成"没问题"**。下面是它覆盖的五项，和上面那几条 SQL 是一回事，但一次算完并给出处置提示：

| 判据 | 等级 | 出现时的第一动作 |
|---|---|---|
| 已支付但没发权益 | **阻塞** | 查该单事件行：没行=回调没到；有行=结算抛错 |
| 发了权益但订单非已支付 | **阻塞** | 先核对微信商户平台是否真收到钱，**不要自动降级** |
| 回调已处理但订单非已支付 | **阻塞** | 代码缺陷信号，先 `PAYMENT_PROVIDER=none` 回滚入口 |
| 已支付但无事件行 | 提示 | 历史单正常；新单查 `PAYMENT_EVENT_NOT_RECORDED` |
| 事件卡 processing >10 分钟 | 提示 | 人工清账，**不要据此重新发放** |

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
| 1 | 未支付订单**永远停在 `pending`** | `identity_orders.status` 的 CHECK 只有 `pending / paid / refunded / canceled`，**没有 `failed`**。前端弹窗里的 `failed` 态只对应「本次轮询失败」，不是库里的状态 | 设计如此（PRD §4.2 非目标） |
| 2 | 没有自助退款 | 退款走商户平台后台人工操作；退款后 `identity_orders.status` 不会自动变 `refunded` | 设计如此（PRD §4.2 非目标） |
| 3 | 没有自动续费 | 到期即失效，续期 = 重新下一单 | 设计如此（未申请委托代扣资质） |

> 2026-10-23 修复：支付回调现在会落 `identity_webhook_events`
> （`provider='wechat_pay'`，幂等键 `wechat_pay:<订单号>`）。原「回调不留痕」那条限制已消除，
> 见 PRD §15.9。E2E-4（重复回调幂等）现在可以**两道判据**同时验：
> 事件表只有一行 + `identity_subscriptions.provider_reference` 只有一条。
>
> 已知边界：同一订单将来若出现第二类事件（退款/撤销通知），会与 `wechat_pay:<订单号>` 撞键，
> 届时改 `paymentEventId()` 扩成 `wechat_pay:<orderId>:<event>`。
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

---

## 9. 桌面端构建与购买流程验收（2026-10-23 实测）

> 这一节回答的是「会员中心 → 选套餐 → 购买」到底能不能用。
> 结论先说：**代码、IPC、弹窗、价目、订单页都已实现并在 main 上**（#4187 / #4219，2026-10-22 落地），
> 16 个前端测试全绿。真正缺的是**本机构建** —— 本机 `%LOCALAPPDATA%\Programs\Multi-Publish`
> 与 `multi-publish` 两个目录都是空的，共享根也没有 `dist-electron`。

### 9.1 先确认"是不是真的没实现"

按这个顺序查，能一步定位问题在哪一层：

| 层 | 查什么 | 本次结果 |
|---|---|---|
| 视图 | `apps/desktop/src/views/member-center/Subscription.vue` 有没有购买按钮 | 有，4 个（standard/pro × 月/年），`data-testid=purchase-<plan>-<period>` |
| 弹窗 | `apps/desktop/src/components/WeChatPayDialog.vue` | 有，8 态状态机 |
| IPC | `electron/ipc-handlers/wechat-pay.js` | 有 3 条：`wechat-pay:create-order` / `order-status` / `list-orders` |
| 桥接 | `electron/preload/wechat-pay.js` | 有，暴露 `wechatPayCreateOrder` 等 |
| 价目 | `electron/services/identity/entitlement-service.js` 请求 `GET /api/v1/plans` | 有（scope `profile:read`） |
| 订单页 | `views/member-center/OrdersBilling.vue` | 有，含「继续支付」复用同一订单号 |
| 测试 | `pnpm exec vitest run src/components/WeChatPayDialog.test.js src/views/member-center/OrdersBilling.test.js` | **16/16 通过** |

**判据**：只要上面任一层缺失，才是「没实现」；全都在而用户看不到，就是「没构建」或「跑的是旧包」。

### 9.2 构建：必须用 `build:dir`，不能用 `electron-builder --dir`

```powershell
cd apps/desktop
pnpm run build:dir          # = build:preload + build:paginator + vite build + electron-builder --dir
```

⛔ **不要**只跑 `pnpm exec electron-builder --win --x64 --dir`：

- 它**会成功退出**（exit 0），产物也有 `Multi-Publish.exe`；
- 但 `apps/desktop/dist`（Vite 渲染层产物）如果不存在，asar 里就只有 `node_modules` 里的几个 html，
  **打开是白屏/无 UI**；
- 构建日志里唯一线索是 `• file source doesn't exist  from=...\dist\fonts`。

验证产物真的带界面：

```powershell
pnpm exec asar list dist-electron/win-unpacked/resources/app.asar | Select-String '\\dist\\index.html'
```

必须能列出 `\dist\index.html`。

### 9.3 启动验证：`ELECTRON_RUN_AS_NODE` 会让应用静默退出

2026-10-23 实测踩到：直接 `Start-Process` 启动，12 秒内进程退出、**stderr 与 stdout 全空**、
退出码 0 —— 与「启动干净」完全同形，但应用根本没起来。

根因：父 shell 环境里带着 `ELECTRON_RUN_AS_NODE=1`，Electron 二进制会以**纯 Node 模式**启动并立即退出。

```powershell
$env:ELECTRON_RUN_AS_NODE     # 本次实测为 1
```

判据（缺一不可）：

1. 启动前记录同名进程数，结束后必须相等（只杀自己起的 PID，不按名字批量杀）；
2. **必须断言"窗口期内仍存活"**，提前退出即 FAIL，不得只看 stderr；
3. 子进程 env 必须显式剔除 `ELECTRON_RUN_AS_NODE`（见 `scripts/lib/qm1-child-env.js` 的 `buildChildEnv()`）。

### 9.4 购买流程人工验收（对应用户可见文案）

前置：桌面端已登录（未登录时购买区**不渲染** —— `canPurchase = isAuthenticated`）。

| # | 操作 | 期望显示 | 失败时看哪里 |
|---|---|---|---|
| 1 | 侧边栏进「会员中心」→「订阅」 | 顶部当前套餐卡；下方「选择套餐」四个按钮，显示 real 价格（来自 `/api/v1/plans`） | 价格显示「暂不可用」⇒ 主进程取价失败，查 `entitlement-service` 日志 |
| 2 | 点「标准版 · 月付」 | 弹窗进入 `loading`，随即显示二维码 | 停在 `loading` ⇒ `wechat-pay:create-order` 报错 |
| 3 | 观察二维码 | 是**图片**（SVG data URL），不是一团 `weixin://` 文本 | 出现文本 ⇒ preload 桥接没接上 |
| 4 | 微信扫码 | 微信显示收款方「北京美学家商贸中心（个体工商户）」+ 金额 | 报「商户号异常」⇒ 商户平台配置问题 |
| 5 | 支付成功 | 弹窗转 `polling` → `paid`，提示已开通；会员权益即时刷新 | 一直 `polling` ⇒ 回调没到，查 `identity_webhook_events` 与容器日志 |
| 6 | 关弹窗，看「订单与账单」 | 该订单一行：订单号/套餐/金额/状态=已支付 | 没有行 ⇒ `wechat-pay:list-orders` 失败 |
| 7 | 再点同一套餐购买 | 生成**新**订单号（不复用已支付订单） | 复用 ⇒ 订单号生成逻辑被改坏 |

服务端配套核对（在 ECS 上，发布目录内）：

```bash
docker compose -p multi-publish-shadow -f compose.yml exec -T publish-api node scripts/payment-preflight.js
docker compose -p multi-publish-shadow -f compose.yml exec -T publish-api node scripts/payment-reconcile.js
```

### 9.5 本次已验证到的边界（不要过度解读）

- ✅ 微信**接受**我们的签名：真实调用下单接口返回 `weixin://wxpay/bizpayurl?pr=...`；
- ✅ 回调**能到达**并被验签、解密（日志 `POST /api/v1/webhooks/payment 200`，UA `Mozilla/4.0`）；
- ⚠️ 用**手工下单的测试单**付款会得到 `PAYMENT_ORDER_NOT_FOUND`（数据库里没这单），这是**预期**：
  该路径只用于验证通道，不产生订单/权益；
- ⏳ 「从会员中心下单 → 支付 → 权益到账」三表联动（`identity_orders` / `identity_webhook_events` /
  `identity_subscriptions`）仍需真机走一遍 §9.4。
