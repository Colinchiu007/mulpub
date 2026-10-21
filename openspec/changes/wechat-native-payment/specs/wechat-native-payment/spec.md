# wechat-native-payment — 支付接入规格

> 规格条目以 openspec change `wechat-native-payment` 的 proposal/design 为准。
> 本文是**实现级详细规格**：数据校验表、端点契约、交互态、文案表、测试矩阵。

## ADDED Requirement: 服务端按 plan-matrix 计算下单金额

服务端 SHALL 以 `plan-matrix.js` 为金额唯一真源，接收 `{plan, period}` 后自行计算 `amountCents` 与 `durationDays`，**不得信任客户端传入的任何金额字段**。

#### Scenario: 客户端伪造金额被忽略
- **WHEN** 客户端 `POST /api/v1/me/checkout` body 为 `{ plan: 'standard', period: 'month', amount: 1 }`
- **THEN** 服务端落库订单的 `amount` SHALL 等于 `priceMonthlyCents`（5900），而非 1
- **AND** 请求体中的 `amount` 键 SHALL 被 body 白名单丢弃，不透传至供应商

#### Scenario: 免费档拒绝下单
- **WHEN** `plan` 为 `free`
- **THEN** 服务端 SHALL 返回 400 `CHECKOUT_PLAN_INVALID`
- **AND** 不得创建任何订单记录

#### Scenario: 计费周期非法被拒
- **WHEN** `period` 不在 `{month, year}` 内
- **THEN** 服务端 SHALL 返回 400 `CHECKOUT_PERIOD_INVALID`
- **AND** 不得调用支付供应商

#### Scenario: 时长按周期派生
- **WHEN** `period=month`
- **THEN** `durationDays` SHALL 为 30
- **WHEN** `period=year`
- **THEN** `durationDays` SHALL 为 365

## ADDED Requirement: 订单状态机由 webhook 驱动

订单状态 SHALL 只能由服务端 webhook 处理推进：`pending → paid`、`pending → failed`（超时）。任何客户端直调 SHALL NOT 推进订单状态。

#### Scenario: 支付成功回调推进订单与订阅
- **WHEN** 收到验签通过的 `checkout.completed` 事件且订单当前为 `pending`
- **THEN** 订单 SHALL 转为 `paid` 并回填 `provider_order_id` 与 `paid_at`
- **AND** 服务端 SHALL 以 `channel='payment'`、`providerReference='wechat:<out_trade_no>'` 调用 `applySubscription` 发放权益
- **AND** 权益快照 SHALL 与订阅在同一事务内重签

#### Scenario: 重复回调幂等
- **WHEN** 同一 `out_trade_no` 的 `checkout.completed` 事件被投递两次
- **THEN** 第二次 SHALL 返回 2xx 且不重复发放权益
- **AND** `identity_orders` SHALL 仍只有一行该订单
- **AND** `identity_subscriptions` SHALL 只被写入一次

#### Scenario: 乱序事件不回退状态
- **WHEN** `refunded` 事件早于 `checkout.completed` 到达
- **THEN** `refunded` SHALL 被记为 `ignored`（入库）并返回 2xx，不得抛错
- **AND** 后续 `checkout.completed` SHALL 正常生效

#### Scenario: 未知订单号被拒
- **WHEN** 回调的 `out_trade_no` 在 `identity_orders` 中不存在
- **THEN** 服务端 SHALL 返回 409 `PAYMENT_ORDER_NOT_FOUND`
- **AND** 不得创建任何订阅

## ADDED Requirement: Webhook 验签强制

支付 webhook SHALL 先验签再解析任何业务字段。验签失败 SHALL 返回 401 且**不得入库、不得改变任何订阅状态**。

#### Scenario: 伪造签名被拒
- **WHEN** 请求头 `Wechatpay-Signature` 与 body 不匹配
- **THEN** 服务端 SHALL 返回 401 `PAYMENT_WEBHOOK_SIGNATURE_INVALID`
- **AND** `identity_webhook_events` SHALL 无新增记录
- **AND** 相应用户的订阅与权益快照 SHALL 零变化

#### Scenario: 过期时间戳防重放
- **WHEN** `Wechatpay-Timestamp` 与服务器时间偏差超过 300 秒
- **THEN** 服务端 SHALL 返回 401 `PAYMENT_WEBHOOK_TIMESTAMP_STALE`

#### Scenario: 序列号无对应平台证书
- **WHEN** `Wechatpay-Serial` 指向服务端未缓存的平台证书
- **THEN** 服务端 SHALL 先按需拉取该证书再验签
- **AND** 拉取失败 SHALL 返回 401，不得跳过验签放行

## ADDED Requirement: 客户端只读订单状态

桌面端 SHALL 通过轮询反映服务端已写入的订单事实，**不得**由客户端推进订单或订阅状态。

#### Scenario: 轮询只读
- **WHEN** 客户端轮询 `wechat-pay:order-status`
- **THEN** 返回值 SHALL 仅为服务端订单表当前状态的投影
- **AND** 该调用 SHALL NOT 产生任何写副作用

#### Scenario: 超时未支付
- **WHEN** 订单保持 `pending` 超过 30 分钟
- **THEN** 客户端 SHALL 停止轮询并提示「支付超时，可重新发起」
- **AND** 服务端 SHALL NOT 自动将该订单置为 `paid`

## ADDED Requirement: 支付通道未配置时入口 fail-closed

当服务端未配置微信商户凭据或 `PAYMENT_PROVIDER=none` 时，购买入口 SHALL 隐藏，不渲染扫码弹窗。

#### Scenario: 服务端不可用
- **WHEN** `POST /api/v1/me/checkout` 因缺少商户配置失败
- **THEN** 服务端 SHALL 返回 503 `PAYMENT_PROVIDER_UNAVAILABLE`
- **AND** 客户端 SHALL 提示「支付通道暂未开放」并保留兑换码入口

#### Scenario: 未登录不可下单
- **WHEN** 用户未登录
- **THEN** 主进程 SHALL 在 IPC 层短路返回 `BUSINESS_USER_REQUIRED`（复用既有 `requireSubject` 面）
- **AND** 不得向服务端发出请求

## MODIFIED Requirement: IPC 通道白名单登记支付通道

`license-access-control.js` 的 `PUBLIC_CHANNELS` SHALL NOT 包含任何 `payment:` 前缀通道；新增的微信支付通道 SHALL 以 `wechat-pay:` 前缀登记为 `authenticated` 级（不在 public 表内即默认 authenticated）。

#### Scenario: 买断通道不回归
- **WHEN** 扫描 `license-access-control.js` 与 preload
- **THEN** `payment:` 前缀通道名与 `payment[A-Z]` 桥接方法 SHALL 均为零命中
- **AND** `wechat-pay:create-order` 与 `wechat-pay:order-status` SHALL 各出现一次

#### Scenario: 通道需登录
- **WHEN** 未登录用户调用 `wechat-pay:create-order`
- **THEN** 该调用 SHALL 被 `AUTH_REQUIRED` 拒绝

## MODIFIED Requirement: 会员中心订单页展示真实订单

`OrdersBilling.vue` SHALL 从「订单功能即将上线」占位改为读取 `GET /api/v1/me/orders` 展示真实订单列表（时间、套餐、金额、状态徽标）。

#### Scenario: 订单列表展示
- **WHEN** 已登录用户进入「订单与账单」
- **THEN** 页面 SHALL 展示该用户的订单列表，含 `pending / paid / failed` 状态徽标
- **AND** `pending` 订单 SHALL 提示「待支付」且不展示金额到账承诺

#### Scenario: 空订单态
- **WHEN** 用户无任何订单
- **THEN** 页面 SHALL 展示空态引导（前往购买或使用激活码），而非错误态
