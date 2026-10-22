---
record: wechat-pay-orders-page
task: 会员中心「订单与账单」页展示真实订单（spec MODIFIED Requirement 补实现）
date: 2026-10-22
---

# 会员中心订单页（wechat-pay-orders-page）

## 1. 为什么做这件事

PR #4187 落地微信 Native 支付时，spec 里有一条 **MODIFIED Requirement 未实现**：

```
## MODIFIED Requirement: 会员中心订单页展示真实订单
`OrdersBilling.vue` SHALL 从「订单功能即将上线」占位改为读取 `GET /api/v1/me/orders`
展示真实订单列表（时间、套餐、金额、状态徽标）。
#### Scenario: 订单列表展示
- WHEN 已登录用户进入「订单与账单」
- THEN 页面 SHALL 展示该用户的订单列表，含 pending / paid / failed 状态徽标
- AND pending 订单 SHALL 提示「待支付」且不展示金额到账承诺
#### Scenario: 空订单态
- WHEN 用户无任何订单
- THEN 页面 SHALL 展示空态引导（前往购买或使用激活码），而非错误态
```

PR #4187 的交付说明里如实登记为「未实现」。本 PR 补齐它。

## 2. 关键发现：这不是纯前端改动

spec 要求 pending 订单的「继续支付」**用同一 `orderId` 重新取 `codeUrl`**。
而 PR #4187 的 `createCheckout` **每次都新建订单** —— 直接复用它会得到一个更坏的结果：
用户每点一次「继续支付」就多一条 pending 订单，账单与对账都会脏。

所以必须先给服务端加「复用既有 pending 订单」的路径。

## 3. 服务端：`_reusePendingOrder`

六条前置缺一即拒（任何一条放松都是资损或信息泄露入口）：

| # | 条件 | 失败码 |
|---|---|---|
| ① | `orderId` 形状合法（`^wp[a-z0-9]{8,64}$`） | 400 `CHECKOUT_ORDER_ID_INVALID` |
| ② | 订单存在 | 409 `PAYMENT_ORDER_NOT_FOUND` |
| ③ | 属于当前用户 | 409 `PAYMENT_ORDER_NOT_FOUND`（**与②同码**） |
| ④ | `channel = payment` | 409 `CHECKOUT_ORDER_CHANNEL_MISMATCH` |
| ⑤ | 仍是 `pending` | 409 `PAYMENT_ORDER_NOT_REUSABLE` |
| ⑥ | `plan`/`period` 与订单登记值一致 | 400 `CHECKOUT_ORDER_MISMATCH` |

**③ 与 ② 用同一个错误码**：区分开就等于回答「这个订单号存在吗」——攻击者可以拿它枚举。

**金额取订单已落库的值，不重算 plan-matrix**：订单创建后若运营调价，重算会让
「继续支付」收出与订单登记不一致的金额 —— 对账直接错，而订阅仍会照常发放（更难发现）。

**订单号形状提升为单一真源**：原先 `wechat-native.js` 与 `publish-api-payment.js` 各写一份
`/^wp[a-z0-9]{8,64}$/`，本 PR 把它收到 `payment-providers/index.js` 由三处共用 ——
两份真源漂移是本仓已有先例的坑。

## 4. 客户端

| 文件 | 改动 |
|---|---|
| `OrdersBilling.vue` | 20 行占位 → 真实列表（时间/套餐/金额/状态徽标）+ pending「继续支付」+ 空态两入口 + **错误态独立于空态** |
| `WeChatPayDialog.vue` | 新增 `reuseOrderId` prop，有值才带 `orderId` 透传（保持新建调用形状不变） |
| `MemberCenter.vue` | `<component :is>` 接 `@navigate`，空态按钮可切分区 |
| `ipc-handlers/wechat-pay.js` | 新增 `wechat-pay:list-orders`；`pickCheckoutBody` 支持 `orderId` |
| `preload/wechat-pay.js` | 新增 `wechatPayListOrders` |
| `member-api-service.js` | 白名单加 `['/api/v1/me/orders', { methods: ['GET'] }]` |
| locale zh/en | 新增 9 键成对（含把 `ordersEmptyHint` 从「即将上线」改成真实空态文案） |

### 三条 UI 纪律

1. **失败 ≠ 空态**：请求失败渲染错误态 + 重试。把错误显示成「还没有订单」会让用户以为付过的订单丢了。
2. **未登录不发请求**：发一次只会拿 401，并在服务端留无主日志。
3. **不做退款入口**：本期非目标（PRD §7.5），退款走客服/运营。

### 两处刻意的「不美化」

- **未知状态原样显示**：`refunded` / `canceled` 若被塞进「已关闭」，用户读到的是错误的账务状态。
- **金额非整数时显示 `—`**：不猜 0（0 会被读成「免费订单」）。

## 5. 契约锁：2 → 3 条通道

`buyout-removal.contract.test.js` 的正向锁把 `wechat-pay:` 通道**写死枚举**。
新增 `wechat-pay:list-orders` 必须回来改这张表 —— 这正是那把锁的设计意图：
每新增一条能触达资金/账号数据的通道，都要重新想一遍「是否需登录、是否只读、有无写副作用」。

`list-orders` 的答案是：需登录、只读、无写副作用；且 IPC 层**投影八个字段**，
不透传 `SELECT *` 的 `provider_order_id` / `provider_sub_id` / `discount_cents`。

## 6. 判据

| 面 | 数量 | 关键断言 |
|---|---|---|
| 服务端复用 | 7 | 不新建订单行 / 不存在 / **别人的订单同码拒绝** / 已 paid 拒绝 / plan-period 不一致拒绝 / channel 串道拒绝 / 形状非法拒绝 |
| 路由白名单 | 2 | `orderId` 透传且 `amount` 仍被丢弃；非字符串时**不出现该键**（不是传 undefined） |
| 订单页组件 | 7 | 四列取值 / pending 给按钮 paid 不给 / 继续支付带上该 orderId / 未知状态原样 / 空态两入口 / **失败不得显示成空态** / 未登录不请求 |
| 合计新增 | **16** | |

### 变异反证（两条，均双向）

1. 去掉 `_reusePendingOrder` 的**属主校验** → `23 pass / 2 fail`，第 ③ 条精确变红；逐字节还原 True。
2. （设计层面）金额改取 plan-matrix 而非订单值 —— 由测试 ⑤/⑥ 的档位一致性间接约束，
   未单独做变异（如实说明：这一条只有代码走读，没有变异证据）。

## 7. 门禁读数

| 项 | 结果 |
|---|---|
| `packages/api-publish-engine` 全量 | rc=0（Vitest 47 文件 + 全部 node:test 直跑） |
| `apps/desktop` 受影响 6 文件 | 437/437 通过 |
| `check-locale-sync --keys` | PASS（2212 key，较基线 +2） |
| `check-locale-sync --cjk` | PASS（基线 1330 / 当前 1124） |
| `check-font-size-scale` | PASS（当前 31 / 基线 790） |
| `check-max-lines` | 无新增超大文件（95 = 挂账 95） |
| `check-debt-budget` | 全部指标在基线内，`circularDeps: 0` |
| eslint | 0 error |

## 7.5 QM-1 打包与启动验证（本 PR 改了 `apps/desktop/electron/`，必跑）

| 步骤 | 命令 | 读数 |
|---|---|---|
| 依赖解析 | `node scripts/verify-worktree-deps.js` | OK，11 个消费方全部解析到本 worktree |
| 打包 | `pnpm exec electron-builder --win --dir --publish never` | **rc=0**，electron 43.7.7，产物 `dist-electron/win-unpacked` |
| 启动 | 直接 spawn `Multi-Publish.exe`，观察 8s | **存活 True**（未提前退出） |
| stderr | 同一进程捕获 | **长度 0** ⇒ 三层判据的第 ③ 层（stderr 为空）才判通过 |

**存活这一条必须单独断言，不能只看 stderr**：`ELECTRON_RUN_AS_NODE=1` 会让 Electron 以纯 Node 模式启动并静默退出
（rc=0、stdout/stderr 全空），与「启动干净」完全同形。本机**父环境恰好带着该变量**（已按规程出声告警），
子进程 spawn 时显式剔除；进程能存活 8s 本身就是「它真的作为 Electron 起来了」的证据。

打包期两条 `file source doesn't exist`（`dist/fonts`、`.playwright-browsers`）属**既有状态**：
渲染层未构建、Playwright 浏览器未安装，与本次改动无关，不作为本 PR 的判据。
## 8. 仍未做

- **微信沙箱/生产端到端 E2E 零执行**（沙箱凭据未申请）——本 PR 的判据全部是注入式的，
  不构成真机扣款证据
- `payment.failed` 状态机：PRD §4.2 明确非目标
- 订单列表分页：服务端固定 `limit 50`，本期不做翻页

## 9. CHANGELOG 条目

# 会员中心「订单与账单」展示真实订单

订单页从占位改为真实列表：时间、套餐、金额、状态徽标（待支付/已支付/已关闭）；
未支付订单可直接「继续支付」——复用同一订单号重取二维码，不新建订单；
空态给出「去购买」「使用激活码」两个入口。
配套新增 `wechat-pay:list-orders` 通道（需登录、只读），IPC 层只投影八个字段，
不透传供应商侧标识。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）
