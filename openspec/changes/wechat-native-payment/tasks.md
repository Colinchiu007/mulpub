# Tasks — wechat-native-payment

> 依赖分组。每个任务 ≤ 一个会话，TDD 优先（先写测试确认精确变红）。
> ⚠️ 本 change 跨运行时代码（服务端 + 桌面端）⇒ **必须在隔离 worktree 执行**（`scripts/session-init.sh wechat-native-payment`），不得在共享主目录落盘。

---

## 校准说明（2026-10-22）

**本文件此前长期停在工作计划态 —— 大部分 `[ ]` 对应的代码其实早已写入并合并**，任何人读它都会误判进度。
本次按**代码实况**逐条校准，判据是"能在仓里指出文件/测试"，不是"我记得做过"。

| 项 | 读数 |
|---|---|
| 校准方式 | 逐条探测代码/测试是否存在（27 项 + 8 项两轮），支付相关测试 **111/111 通过**；**2026-10-23 复核**：`grep '^- \[x\] NN.N'` 实测 **49 项已勾选 / 3 项未勾选** |
| 结果 | 完成 **49** 项 / 未勾选 **3** 项（`0.3`、`6.6`、`8.8`）/ 实现方式变更 **3** 项（`4.4`、`6.5`、`6.6`） |
| 仍未完成的实质待办 | **只剩 `0.3` / `8.8`（真机凭据与 E2E）**。`6.6` 虽仍 `[ ]`，但那是**主动改方案**（见条目内说明：手写 QR 编码器无扫描器可验证，改用 `qrcode@^1.5.4`），**不是待办** |
| 相关 PR | #4187（主体）、#4219（订单页）、#4225（依赖审计判据，与本 change 无关但同批修复）、#4249（compose 透传）、#4252（provider 接线）、#4256（上线预检）、#4267（E2E runbook）、#4269（回调留痕）、#4274（对账）、#4286（mock 预演） |

> ⚠️ **2026-10-23 更正**：本表原写「完成 35 项 / 未完成 2 项」，是 #4247 校准当时的读数。
> 此后 `9.8` 等条目被勾选，数字漂移而表没跟 —— **记录的读数必须能被 `grep` 复现**，
> 否则读它的人会拿着过期数字做判断。本次改为实测并写清复现方式。

---

## 0. 前置（本 change 开工前必须完成）

- [x] 0.1 隔离 worktree：`scripts/session-init.sh wechat-native-payment`，确认 `git rev-parse --abbrev-ref HEAD` = `wechat-native-payment`
  - 证据：分支 `wechat-native-payment` → PR #4187
- [x] 0.2 新 worktree 依赖就绪：`pnpm install --frozen-lockfile && node scripts/ensure-electron.js && node scripts/verify-worktree-deps.js`
  - 证据：`verify-worktree-deps` OK（11 个消费方全部解析到本 worktree）
- [ ] 0.3 沙箱凭据到手（微信商户沙箱环境 appid/mchid/APIv3 密钥/商户证书），写进 worktree 的 `.env`（**不提交**）
  - ⛔ **未完成**。用户仅提供生产商户凭据，沙箱未申请。**这是 `8.8` 的唯一阻塞点**

## 1. 服务端 · 数据层（P0-1）

- [x] 1.1 先写漂移锁：扩展 `test/member-commerce-migrations.test.js`，断言 `006_payment_orders.sql` 的每条语句都出现在 `SCHEMA` 中（同 004/005 体例）→ **首轮红**
  - 证据：`packages/api-publish-engine/test/member-commerce-migrations.test.js`
- [x] 1.2 写 `migrations/postgresql/006_payment_orders.sql`：`identity_orders` 补 4 列 + 新建 `identity_payment_customers` + 用户维度索引
  - 证据：`migrations/postgresql/006_payment_orders.sql`（4 个 `ADD COLUMN IF NOT EXISTS` + 1 张表）
- [x] 1.3 `postgres-identity-repository.js`：SCHEMA 数组同步 + `REQUIRED_SCHEMA_RELATIONS` 追加 `identity_payment_customers`
  - 证据：`identity_payment_customers` 同时出现在 SCHEMA 与 REQUIRED_SCHEMA_RELATIONS
- [x] 1.4 `postgres-commerce-store.js`：新增 `createPendingOrder` / `markOrderPaid` / `getOrderById` / `upsertPaymentCustomer`（白名单列，禁 `SELECT *` 直出）
  - 证据：四方法均存在（另多出 `listOrders`，供订单页）
- [x] 1.5 跑漂移锁转绿 + `test/postgres-identity-repository.test.js` 全绿
  - 证据：API 全量 `node scripts/run-tests.js` rc=0

## 2. 服务端 · PaymentProvider 抽象与微信适配器（P0-2）

- [x] 2.1 先写契约测试 `test/payment-provider-wechat.test.js`：三方法输入输出 + 归一化映射逐事件断言 → **红**
  - 证据：契约测试 + `test/payment-provider-wechat-webhook.test.js`
- [x] 2.2 写 `src/auth/payment-providers/index.js`（抽象 + 工厂 + `WebhookSignatureError`）
  - 证据：同路径；另有 `OUT_TRADE_NO_PATTERN` 单一真源（3 处共用）
- [x] 2.3 写 `src/auth/payment-providers/wechat-native.js`：`createCheckout` / `parseWebhook` / `capabilities`
  - 证据：同路径。⚠️ **平台证书 → 微信支付公钥**：2024+ 微信已迁移到 bare-Base64 SPKI 公钥（非证书），实现同时支持两者（`toVerifiableKey` 按 PEM 头分支）
- [x] 2.4 **零外发测试**：所有 HTTP 经注入的 `fetcher`/`signer`，测试零真实出网
  - 证据：`fetcher` / `signer` 注入点存在，测试全注入
- [x] 2.5 变异反证：摘掉验签 → 契约测试精确变红并指回根因
  - 证据：见 `openspec/records/wechat-native-payment.md`

## 3. 服务端 · 订阅服务（P0-3）

- [x] 3.1 先写测试 `test/subscription-payment.test.js`（金额真源 / 落 pending / settle / 幂等 / 乱序 / 未知订单号）
  - 证据：`test/subscription-payment.test.js`（25 例）
- [x] 3.2 实现 `createCheckout()` + `settlePaymentWebhook()`（**只调 applySubscription，不复制其逻辑**）
  - 证据：`src/auth/subscription-payment.js`（mixin，注入 `subscription-service.js`；后者压到 496 行以过 500 行门禁）
- [x] 3.3 转绿 + 变异反证（把 `channel:'payment'` 改成 `'redeem'` → 对账断言红）
  - 证据：支付面测试 111/111 通过。⚠️ 该条**专项变异**未逐条留档（本轮只复核了通过状态，不代它背书）

## 4. 服务端 · 路由（P0-4/P0-5）

- [x] 4.1 先写路由测试 `test/payment-api.test.js`：scope 校验、body 白名单、错误码映射、webhook 401/2xx 分支
  - 证据：`test/payment-api.test.js`（22 例）
- [x] 4.2 `POST /api/v1/me/checkout`（scope `profile:write`，body 只取 `{plan, period}`）
  - 证据：`_handleMemberCheckout`。⚠️ 另支持 `orderId`（「继续支付」复用同单，见 #4219）
- [x] 4.3 `GET /api/v1/me/orders/{id}`（scope `profile:read`，仅本人订单）
  - 证据：`_handleMemberOrderDetail`；他人订单返回 404（不泄露存在性）
- [x] 4.4 新 mixin `src/auth/publish-api-payment-webhook.js` + `POST /api/v1/webhooks/payment`
  - 证据：⚠️ **未拆独立文件** —— `_handlePaymentWebhook` 与另两个 handler 同在 `publish-api-payment.js`。
    动因：`publish-api-server.js` 有 1574 行硬上限（`check-max-lines` 的 TARGET_GREW 零增长），拆 mixin 本就是为了压行数，再拆一个会把行数推回去
- [x] 4.5 `publish-api-server.js`：scope 映射 + 端点清单 + OpenAPI 描述同步
  - 证据：4 个端点均出现在 OpenAPI 描述（`/me/checkout`、`/me/orders`、`/me/orders/{id}`、`/webhooks/payment`）
- [x] 4.6 `.env.example` 补微信商户环境变量占位（**只有占位，无真实值**）
  - 证据：`PAYMENT_PROVIDER=none` + 6 个 `WECHAT_PAY_*` 空占位
- [x] 4.7 全量 `cd packages/api-publish-engine && pnpm test` rc=0
  - 证据：`node scripts/run-tests.js` rc=0（Vitest 47 文件）

## 5. 服务端 · 配置与生产校验

- [x] 5.1 `production-config.js` 增加 `PAYMENT_PROVIDER` / `WECHAT_MCH_ID` 等校验（`none` 时跳过微信必填项）
  - 证据：`production-config.js` + `test/production-config.payment.test.js`
- [x] 5.2 `scripts/validate-production-config.js` 与 smoke 同步（不引入新的必填红）
  - 证据：⚠️ **通过委托达成** —— 该脚本只 `require('../src/auth/production-config')` 并调 `validateProductionConfig(env, {phase})`，校验逻辑单一真源，天然同步。
    因此文件里搜不到 `PAYMENT_PROVIDER` 字样**不是缺口**

## 6. 桌面端 · IPC 与二维码（P0-6）

- [x] 6.1 改造 `electron/services/buyout-removal.contract.test.js`（两条正向锁）
  - 证据：正向锁已升级为**三条**通道（`create-order` / `order-status` / `list-orders`），`payment:` 前缀仍零命中
- [x] 6.2 `electron/ipc-handlers/wechat-pay.js`：`withSenderCheck` + `memberApiService.request`
  - 证据：3 条 `ipcMain.handle` 全部包 `withSenderCheck`
- [x] 6.3 `member-api-service.js`：`ME_API_PATHS` 加 `/api/v1/me/checkout`（POST）+ body 白名单
  - 证据：`ME_API_PATHS` 含 `/me/checkout`（POST）与 `/me/orders`（GET）；`pickCheckoutBody` 只取 `plan`/`period`/`orderId`
- [x] 6.4 `electron/preload/wechat-pay.js` + `preload.test.js` 计数断言同步
  - 证据：暴露 3 个方法；`preload.test.js` 375 例通过
- [x] 6.5 `electron/ipc-handlers/index.js` 注册 + `license-access-control.js` 白名单登记（authenticated 级）
  - 证据：⚠️ **默认档即达成** —— `requiredLevelForChannel()` 对不在 `ADMIN_ONLY_CHANNELS` / `PUBLIC_CHANNELS` 的通道一律返回 `'authenticated'`，
    所以 `wechat-pay:*` 不需要显式登记；**显式登记反而会把它写进某个更宽或更窄的表**
- [ ] 6.6 `packages/shared-utils/src/qr-code.js`：Byte 模式 QR 编码器 + 逐位矩阵断言
  - ⚠️ **主动不按原方案做**。改用 `qrcode@^1.5.4`（只加在 `apps/desktop`，不污染 shared-utils 依赖树）。
    理由：手写编码器**没有扫描器/视觉工具可验证**，「测试通过」只能是自证；而错误二维码在用户侧表现为"扫不出来"，属最难归因的故障。
    代价：引入 1 个依赖（含 pngjs/yargs 传递依赖），已限制在桌面端
- [x] 6.7 `electron/services/wechat-pay-qrcode.js`：codeUrl → SVG data URI
  - 证据：`wechat-pay-qrcode.js` + 单测；输出 `data:image/svg+xml;base64,…`

## 7. 桌面端 · UI 与文案（P0-7/P0-8）

- [x] 7.1 先写组件测试（二维码渲染 / 轮询启停 / 三态文案 / 未登录不渲染 / 反失明断言）
  - 证据：`src/components/WeChatPayDialog.test.js`（9 例）
- [x] 7.2 `WeChatPayDialog.vue` + `Subscription.vue` 接线
  - 证据：8 态状态机；`Subscription.vue` 已接
- [x] 7.3 `locales/member-center/{zh,en}.js` 成对新增全部文案
  - 证据：`check-locale-sync --keys` PASS（2212 key）
- [x] 7.4 `UpgradeModal.vue`：「付费通道筹备中」→ 指向会员中心购买的引导文案
  - 证据：文案已改；对应断言同步更新（不是放宽，是替换一条锁定旧行为的断言）
- [x] 7.5 跑 `check-locale-sync.js` + locale 基线扫描
  - 证据：`--keys` PASS（2212）/ `--cjk` PASS（基线 1330，当前 1124）
- [x] 7.6（新增，原计划外）会员中心「订单与账单」展示真实订单
  - 证据：PR #4219；`OrdersBilling.vue` + `OrdersBilling.test.js`（7 例）；含「继续支付」复用同单

## 8. 门禁（提交前全部完成）

- [x] 8.1 `pnpm test` 全量 rc=0
  - 证据：API 全量 rc=0；桌面受影响 6 文件 437/437；支付面 111/111
- [x] 8.2 `eslint` 0 error
  - 证据：0 error
- [x] 8.3 **QM-1**：`electron-builder --win --dir --publish never`
  - 证据：rc=0（electron 43.7.7）；启动 8s **存活 True**、**stderr 空**；父环境带 `ELECTRON_RUN_AS_NODE=1` 已告警并剔除
- [x] 8.4 QM-2 代码必检项：无同步 CPU 密集原语进高频路径、无硬编码密钥、错误处理完备
  - 证据：`payment-providers/*` 无硬编码密钥（凭据全走 env）；webhook 有 256KiB body 上限与 300s 时间戳容差
- [x] 8.5 QM-4 视觉：新增弹窗若无基线 → 登记不进 QG Visual 覆盖范围
  - 证据：同 `disable-simulated-payment-in-prod` 处置
- [x] 8.6 **QM-6 双模型评审**
  - 证据：PR #4187 / #4219 / #4225 均执行跨家族外部评审并把原文贴进 PR 评论。
    ⚠️ 如实记录：#4187 的 opencode 侧 critique 未产出（实际是一个跨家族模型 + 引擎自判），已在 PR 评论里披露
- [x] 8.7 `check-pr-exec-record.js --base=origin/main --mode=enforce` OK
  - 证据：三个 PR 均 rc=0
- [ ] 8.8 沙箱端到端人工验收（PRD §11.4 清单 E2E-1~E2E-7）
  - ⛔ **未完成，零执行**。目前全部判据都是**注入式**的，不构成真机扣款证据
  - 现实路径：微信沙箱对多数商户已不开放 ⇒ 常见做法是**生产环境 1 分钱真实支付**跑 E2E-1

## 9. 交付

- [x] 9.1 commit（Conventional Commits，中文正文）+ push
- [x] 9.2 开 PR，正文写门禁证据与隔离声明
  - 证据：#4177（docs-only 阶段）、#4187、#4219
- [x] 9.3 CI 全绿（含 `check-main-red.js --pr <n>`）
  - 证据：#4187 11/11；#4219 23/23。#4219 合并时主干侧为 in-flight（rc=3），经用户明确授权并如实记录在 PR 评论
- [x] 9.4 自动合并 + 收尾取证
  - 证据：#4187 merge `a22da4430`；#4219 merge `1d425c07`；远端分支均 0 行
- [x] 9.5 回读 main push 的 `quality-gate` run
  - 证据：两个 merge SHA 上 `quality-gate` 均 `completed/success`，0 个非绿作业
- [x] 9.6 worktree 清理：`safe-worktree-remove.ps1 -WhatIf` 干跑后实跑
  - 证据：2026-10-22 清理 `mp-wechat-pay-orders-page` / `mp-dep-audit-envelope` / `mp-main-red-required-scope`，R7 每次核对主工作区与基线一致
- [x] 9.7 执行记录落 `openspec/records/`
  - 证据：`wechat-native-payment.md`、`wechat-pay-orders-page.md`

---

## 9.8 ✅ provider 接线（2026-10-22 发现并当日修复）

- [x] 9.8.1 `src/auth/payment-providers/wechat-native-factory.js`：私钥加载 + `buildAuthorizationHeader` + `createWeChatNativeProvider(env, deps)`
- [x] 9.8.2 平台公钥环境变量（`WECHAT_PAY_PLATFORM_PUBLIC_KEY` / `_PATH` / `WECHAT_PAY_PUBLIC_KEY_ID`）+ 纳入 `production-config` 必填
- [x] 9.8.3 `logto-runtime.js` 接线：构造后传给 `SubscriptionService({ paymentProvider })`
- [x] 9.8.4 **组装根测试**：`createLogtoRuntime` 走真实组装路径，断言 `wechat_native` ⇒ provider 非 null、`none` ⇒ null

> 证据：`logto-runtime.js:127` 构造 `SubscriptionService` 时**没传** `paymentProvider`；
> `subscription-service.js:120` 默认 `null`；`subscription-payment.js:56` 因此恒回 503。
> 全仓 `src` 里 `WeChatNativeProvider` **只出现在它自己的定义文件**，生产代码从未 `new` 过它。
> 详见 PRD §16。**这一条不解决，第 15 节（配置透传）全部白做。**
## 10. 仍未做（汇总，供后续会话直接接手）

| 项 | 阻塞点 | 谁来做 |
|---|---|---|
| `0.3` 沙箱凭据 | 未申请（用户只有生产凭据） | 用户 / 运营 |
| `8.8` E2E-1~E2E-7 | 依赖 `0.3`；或改用生产 1 分钱真实支付 | 需用户配合真机 |
| 生产凭据注入 + 商户平台配置回调 URL / 开启 APIv3 加密 | 商户平台后台 + 运维 | 运营 / 运维 |
| `WECHAT_PAY_NOTIFY_URL` 指向生产域名并在网关放行 | 运维 | 运维 |
| 灰度 + 回滚演练（`PAYMENT_PROVIDER=none`） | 依赖上线 | 运维 |

**一句话**：代码侧无已知缺口；缺的是**真机证据**与**生产配置**。
