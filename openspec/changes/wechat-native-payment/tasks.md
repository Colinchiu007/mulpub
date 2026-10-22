# Tasks — wechat-native-payment

> 依赖分组。每个任务 ≤ 一个会话，TDD 优先（先写测试确认精确变红）。
> ⚠️ 本 change 跨运行时代码（服务端 + 桌面端）⇒ **必须在隔离 worktree 执行**（`scripts/session-init.sh wechat-native-payment`），不得在共享主目录落盘。

## 0. 前置（本 change 开工前必须完成）

- [x] 0.1 隔离 worktree：`scripts/session-init.sh wechat-native-payment`，确认 `git rev-parse --abbrev-ref HEAD` = `wechat-native-payment`
- [x] 0.2 新 worktree 依赖就绪：`pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js`
- [ ] 0.3 沙箱凭据到手（微信商户沙箱环境 appid/mchid/APIv3 密钥/商户证书），写进 worktree 的 `.env`（**不提交**）

## 1. 服务端 · 数据层（P0-1）

- [x] 1.1 先写漂移锁：扩展 `test/member-commerce-migrations.test.js`，断言 `006_payment_orders.sql` 的每条语句都出现在 `SCHEMA` 中（同 004/005 体例）→ **首轮红**
- [x] 1.2 写 `migrations/postgresql/006_payment_orders.sql`：`identity_orders` 补 4 列 + 新建 `identity_payment_customers` + 用户维度索引
- [x] 1.3 `postgres-identity-repository.js`：SCHEMA 数组同步 + `REQUIRED_SCHEMA_RELATIONS` 追加 `identity_payment_customers`
- [ ] 1.4 `postgres-commerce-store.js`：新增 `createPendingOrder` / `markOrderPaid` / `getOrderById` / `upsertPaymentCustomer`（白名单列，禁 `SELECT *` 直出）
- [ ] 1.5 跑漂移锁转绿 + `test/postgres-identity-repository.test.js` 全绿

## 2. 服务端 · PaymentProvider 抽象与微信适配器（P0-2）

- [x] 2.1 先写契约测试 `test/payment-provider-wechat.test.js`：三方法输入输出 + 归一化映射逐事件断言 → **红**
- [x] 2.2 写 `src/auth/payment-providers/index.js`（抽象 + 工厂 + `WebhookSignatureError`）
- [x] 2.3 写 `src/auth/payment-providers/wechat-native.js`：
  - `createCheckout`：组装 APIv3 下单请求（`amount.total` 单位为分、`attach` 编码 `{orderId, userId}`）
  - `parseWebhook`：四头验签（RSA-SHA256 + 平台证书 + 时间戳容差 5min）→ AEAD_AES_256_GCM 解密 resource → 归一化
  - `capabilities`：六项全 false
  - 平台证书获取/按 Serial 缓存
- [x] 2.4 **零外发测试**：所有 HTTP 经注入的 `fetcher`/`signer`（同 `shipinhao-capabilities.js:16` 纪律），测试零真实出网
- [x] 2.5 变异反证：摘掉验签 → 契约测试精确变红并指回根因

## 3. 服务端 · 订阅服务（P0-3）

- [ ] 3.1 先写测试 `test/subscription-payment.test.js`：
  - `createCheckout` 金额真源（带 `amount:1` 的请求仍按 plan-matrix 落单）
  - `createCheckout` 落 `pending` 订单 + 记 `identity_payment_customers`
  - `settlePaymentWebhook`：pending→paid + `applySubscription(channel='payment')`
  - 幂等：同 `out_trade_no` 二次 settle 不重复授权
  - 乱序：`refunded` 早于 `checkout.completed` → ignored 且不抛错
  - 未知订单号 → `PAYMENT_ORDER_NOT_FOUND` 409（不建订阅）
- [ ] 3.2 实现 `createCheckout()` + `settlePaymentWebhook()`（**只调 applySubscription，不复制其逻辑**）
- [ ] 3.3 转绿 + 变异反证（把 `channel:'payment'` 改成 `'redeem'` → 对账断言红）

## 4. 服务端 · 路由（P0-4/P0-5）

- [ ] 4.1 先写路由测试 `test/payment-api.test.js`：scope 校验、body 白名单、错误码映射、webhook 401/2xx 分支
- [ ] 4.2 `POST /api/v1/me/checkout`（scope `profile:write`，body 只取 `{plan, period}`）
- [ ] 4.3 `GET /api/v1/me/orders/{id}`（scope `profile:read`，仅本人订单）
- [ ] 4.4 新 mixin `src/auth/publish-api-payment-webhook.js` + `POST /api/v1/webhooks/payment`（免登录强验签，256KiB 上限）
- [ ] 4.5 `publish-api-server.js`：scope 映射 + 端点清单 + OpenAPI 描述同步
- [ ] 4.6 `.env.example` 补微信商户环境变量占位（**只有占位，无真实值**）
- [ ] 4.7 全量 `cd packages/api-publish-engine && pnpm test` rc=0

## 5. 服务端 · 配置与生产校验

- [ ] 5.1 `production-config.js` 增加 `PAYMENT_PROVIDER` / `WECHAT_MCH_ID` 等校验（`none` 时跳过微信必填项）
- [ ] 5.2 `scripts/validate-production-config.js` 与 smoke 同步（不引入新的必填红）

## 6. 桌面端 · IPC 与二维码（P0-6）

- [ ] 6.1 先写契约锁：改造 `electron/services/buyout-removal.contract.test.js`
  - 新增正向锁：`license-access-control.js` 白名单中 `payment:` 前缀仍零命中，且**新增**「只允许 `wechat-pay:create-order` / `wechat-pay:order-status` 两条」
  - 新增正向锁：preload 只暴露 `wechatPayCreateOrder` / `wechatPayOrderStatus`（`payment[A-Z]` 仍零命中）
  - **首轮红**（实现尚未写）
- [ ] 6.2 `electron/ipc-handlers/wechat-pay.js`：`withSenderCheck` + `memberApiService.request`（`ME_API_PATHS` 白名单加 `/api/v1/me/checkout` POST）
- [ ] 6.3 `member-api-service.js`：`ME_API_PATHS` 加 `/api/v1/me/checkout`（methods: POST）+ 对应 body 白名单（只 `plan`/`period`）
- [ ] 6.4 `electron/preload/wechat-pay.js` + `preload.test.js` 计数断言同步
- [ ] 6.5 `electron/ipc-handlers/index.js` 注册 + `license-access-control.js` 白名单登记（authenticated 级）
- [ ] 6.6 `packages/shared-utils/src/qr-code.js`：Byte 模式 QR 编码器 + `__tests__/qr-code.test.js`（**已知向量逐位矩阵断言**，非「生成成功」）
- [ ] 6.7 `electron/services/wechat-pay-qrcode.js`：codeUrl → SVG data URI（含版本/纠错级选择与容量校验）

## 7. 桌面端 · UI 与文案（P0-7/P0-8）

- [ ] 7.1 先写组件测试 `src/views/member-center/WeChatPayDialog.test.js`：
  - 二维码渲染（`<img src^="data:image/svg+xml">`）
  - 轮询启动/停止（关闭即停）
  - paid / failed / 超时三态文案
  - 未登录不渲染购买按钮
  - **反失明断言**：先断言「真的推进到了扫码页」，再断言轮询行为
- [ ] 7.2 `src/components/WeChatPayDialog.vue` + `src/views/member-center/Subscription.vue` 接线
- [ ] 7.3 `locales/member-center/{zh,en}.js` 成对新增全部文案（键清单见 PRD §7）
- [ ] 7.4 `UpgradeModal.vue`：「付费通道筹备中」→ 指向会员中心购买的引导文案（**不重开购买弹窗**，`fix-upgrade-payment-entry` 的结论不变）
- [ ] 7.5 跑 `node .github/scripts/check-locale-sync.js` + locale 基线扫描

## 8. 门禁（提交前全部完成）

- [ ] 8.1 `pnpm test` 全量（apps/desktop + packages/api-publish-engine + packages/shared-utils）rc=0
- [ ] 8.2 `eslint` 0 error（新增 warning 需逐条说明）
- [ ] 8.3 **QM-1**：`cd apps/desktop && pnpm exec electron-builder --win --dir --publish never`
  - 启动存活断言（8s 窗口期）+ 显式剔除 `ELECTRON_RUN_AS_NODE` + stderr 三层判据
- [ ] 8.4 QM-2 代码必检项：无同步 CPU 密集原语进高频路径、无硬编码密钥、错误处理完备
- [ ] 8.5 QM-4 视觉：新增弹窗若无基线 → 登记不进 QG Visual 覆盖范围（同 `disable-simulated-payment-in-prod` 处置）
- [ ] 8.6 **QM-6 双模型评审**：`node scripts/ccg-review-decider.js --input openspec/changes/wechat-native-payment/design.md` → `mode=dual` ⇒ `sh scripts/plan-review.sh` 收敛后才进编码；编码后对 >200 行提交跑 `ccg-deep-review`
- [ ] 8.7 `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` OK
- [ ] 8.8 沙箱端到端人工验收（PRD §9 清单）：真机扫码支付成功/失败/超时三条

## 9. 交付

- [ ] 9.1 commit（ Conventional Commits，中文正文）+ push
- [ ] 9.2 开 PR，正文写门禁证据与隔离声明
- [ ] 9.3 CI 全绿（含 `check-main-red.js --pr <n>` 读 `MAIN-RED verdict=`）
- [ ] 9.4 自动合并（判据见 AGENTS.md「PR 自动合并」5 条）+ 收尾取证（merge SHA / 远端分支 0 行 / `check-branch-merged.js` rc=0）
- [ ] 9.5 回读 main push 的 `quality-gate` run 结论；红了按口径开 follow-up
- [ ] 9.6 worktree 清理：`scripts/safe-worktree-remove.ps1 -WhatIf` 干跑通过后实跑（R1-R5/R7）
- [ ] 9.7 执行记录落 `openspec/records/wechat-native-payment.md`（**新 PR 不回填 `.quality-gates.md`**）
