---
record: wechat-native-payment
task: 微信 Native 扫码支付接入（最小闭环）—— 设计定稿（PR #4177） + 服务端/桌面端实现（PR #4187）
date: 2026-10-21
---

# 微信 Native 扫码支付接入（wechat-native-payment）

## 0. 本记录覆盖两个 PR

本分支名被两个 PR 复用，记录合并在一处（AGENTS 要求记录载体为 `openspec/records/<分支名>.md`）：

| 阶段 | PR | merge SHA | 内容 |
|---|---|---|---|
| ① 设计定稿（docs-only） | #4177 | `d15c0c614705b0fa857045a4d58fd01acff137ec` | PRD 480 行 + openspec change 603 行 + 5 处虚假「已实现」声明修正 |
| ②③④ 实现 | #4187 | 待合并 | 迁移 006 + PaymentProvider + 微信适配器 + checkout/webhook + 桌面端扫码链路 |

阶段① 的门禁与合并取证见 §1；阶段②-④ 见 §2-§7。

## 1. 阶段①（PR #4177，已合并）

### 1.1 交付物

| # | 文件 | 行数 |
|---|---|---|
| 1 | `01-docs/PRD-WECHAT-PAY-INTEGRATION-2026-10-21.md` | 480 |
| 2 | `openspec/changes/wechat-native-payment/proposal.md` | 144 |
| 3 | `openspec/changes/wechat-native-payment/design.md` | 226 |
| 4 | `openspec/changes/wechat-native-payment/tasks.md` | 105 |
| 5 | `openspec/changes/wechat-native-payment/specs/wechat-native-payment/spec.md` | 128 |

### 1.2 修正的 5 处虚假声明

| 文件 | 原文（假） | 事实 |
|---|---|---|
| `pricing-strategy.md` §4 | 「已实现：支付宝、微信支付」引用 `payment-manager.js:23` | 该文件 2026-10-17 随买断模型删除（PR #3851） |
| `PRD.md`（6 处） | 「✅ 模拟模式」 | 模拟支付入口 2026-10-07 已从正式包移除 |
| `PRODUCT-POSITIONING.md` | 支付集成 ✅ | 本地 mock 链路已被切断 |
| `roadmap-v1.1.0.md` | P2「支付接入 SDK 集成」无状态 | 补设计定稿链接 |
| `PRD-REMOVE-BUYOUT-AND-PRICING` B 部分 | BD-1/2/3「待人工拍板」 | 全部闭合，保留决策过程作来路存档 |

**根因**：删除类改动只删了代码、没反查引用该代码的文档。与 `remove-buyout-license.md` §11 记的 CI 三轮失败同类（那次漏删测试文件，这次漏改文档声明）。可复用做法：删除模块后除 `grep` 代码引用，还要 `grep` 文档里的「已实现 / ✅ / 文件路径」字样。

### 1.3 门禁与合并

- docs-only 判定 `true files=11`；行尾两口径一致；品牌残留 PASS（11447 文件）
- PR 侧 11 条检查全 pass，重型 job 按 docs-only 短路
- `check-branch-merged.js` rc=0，11 文件全部 `IDENTICAL`
- 远端分支 0 行；retire 标签 `retire/wechat-native-payment-2026-10-21`

**合并方式：人工授权（如实登记）**。`check-main-red.js` 从 19:07 到 19:36 连续轮询始终 `INCOMPLETE exit=3`：主干 tip 平均每 20 分钟被其他会话推进，而单次 CI 需 20-30 分钟，「主干已稳定且全绿」的时间窗一次都没出现。**关键区分**：`INCOMPLETE` 语义是「未证实」而非「主干红」——读数行 `mainFail=0 / newRed=0 / prFail=0 / prPending=0`。用户 2026-10-21 19:35 明确授权「你替我手动合并」，合并前后均完成产物取证（`state=MERGED` + `mergeCommit.oid` + `git log` 恰好 1 行 + 远端分支 0 行 + `check-branch-merged.js` rc=0）。

`quality-gate` 在 merge SHA 上**无 push run**——属 `NO_RUN(by design)`（push `paths-ignore` 对纯文档类改动不跑）。转核该判据最近 main 读数：`2a63373d` / `760826d1` / `b1493595` / `4711f4a6` 均 success。

## 2. 阶段②服务端：数据层与通道适配器

### 2.1 数据模型

- `migrations/postgresql/006_payment_orders.sql`：`identity_orders` 补 4 列（`provider_order_id` / `provider_sub_id` / `period` / `discount_cents`，全部可空向后兼容）+ 新建 `identity_payment_customers`（唯一键 `(provider, user_id)`）
- **零约束变更**：`identity_orders.channel` 的 CHECK 在 `004_member_commerce.sql:12` 已含 `'payment'` —— 阶段 1 预留的地基
- `identity_webhook_events` 复用为支付 outbox，`auth_subject` 语义放宽为「事件归属的业务主键」（支付事件填订单号），见 design.md §2.3

### 2.2 PaymentProvider 收缩为三方法

上游 `DESIGN-MEMBER-CENTER-P2-PAYMENT` 的六方法是为 MoR 托管（Paddle/LS）设计的；微信 Native 无订阅 ID、无 API 取消/改套餐语义。`capabilities()` 六项全 false 是诚实数据，UI 据此隐藏入口。

### 2.3 两个真缺陷（TDD 抓出）

| # | 缺陷 | 后果 | 抓到它的判据 |
|---|---|---|---|
| a | `event_type` 读错层级（微信放**外层明文**，实现读加密的 `resource`） | **所有成功回调归一化成 `type=null` → 记 ignored → 订阅永不生效** | webhook 契约锁；变异 33 pass / 8 fail |
| b | `toVerifiableKey` 把 SPKI 公钥包成 CERTIFICATE 头 | `crypto.verify()` 抛 `ASN.1 wrong tag`，所有真签名用例红 | 真签名正例 |

**(a) 的根因值得单列**：测试夹具当初也把 `event_type` 塞进 `resource`，**恰好让错读法通过**——「夹具跟着错实现写」。夹具已改回真实微信结构。

## 3. 阶段②服务端：服务与端点

### 3.1 落库顺序（不可换）

**先落 pending 订单，再调供应商**。反过来的话，供应商下单成功而落库失败会得到「用户手机里有一张可扫的付款码、我们账上什么都没有」——回调到达时无从归属，既不能授权也不能对账。先落单后下单最坏留一条 pending 超时失效。

### 3.2 三个端点

| 端点 | 鉴权 | 要点 |
|---|---|---|
| `POST /api/v1/me/checkout` | `profile:write` | body 白名单只取 `plan`/`period`；`amount` 等一律丢弃 |
| `GET /api/v1/me/orders/{id}` | `profile:read` | 别人的订单返 **404 而非 403**（403 泄露订单号存在）；形状非法不查库 |
| `POST /api/v1/webhooks/payment` | **免登录 · 强验签** | 四头 RSA-SHA256 + 时间戳 ±300s + AEAD_AES_256_GCM |

**顺序即安全前提**：webhook 块排在 Bearer 鉴权之前（与 logto webhook 同层）；`/me/orders/{id}` 排在 `/me/orders` 集合分支之前。

**webhook 三条纪律**：① 先读原始字节再验签；② 验签失败 401 且**不入库**（锁：`settlePaymentWebhook` 一次都没被调）；③ 内部错误仍返回 2xx（防微信重投风暴）。

### 3.3 幂等键 = 我方订单号

订单主键即 `out_trade_no`，重复回调天然撞主键；`providerReference='wechat:<out_trade_no>'` 撞 `identity_subscriptions_provider_reference_key` 走 409 既有收敛。**不用 `transaction_id`**：同一订单可能先 `SUCCESS` 后 `REFUND`，流水号相同但语义相反。

### 3.4 循环依赖坑（已修）

`subscription-payment.js` 顶部 `require('./subscription-service')` 取 `CommerceError` 形成循环：subscription-service 在末尾 require 本文件应用 mixin，加载期拿到未完成 exports。`cli.test.js` 以「`--help` 必须输出空字符串」抓到它（子进程 stderr 多出 `Warning: Accessing non-existent property 'CommerceError'`）。改为惰性 require 后复绿。

## 4. 阶段③桌面端

| 组件 | 文件 | 要点 |
|---|---|---|
| IPC | `electron/ipc-handlers/wechat-pay.js` | `wechat-pay:` 前缀（**不是** `payment:`），见下 |
| preload | `electron/preload/wechat-pay.js` | 只回 `qrDataUrl`，渲染层拿不到 `weixin://` 串 |
| 二维码 | `electron/services/wechat-pay-qrcode.js` | 主进程用 `qrcode@^1.5.4` 生成 SVG data URL |
| 弹窗 | `src/components/WeChatPayDialog.vue` | 8 态状态机：loading/qrcode/polling/paid/failed/expired/timeout/error |
| 接线 | `src/views/member-center/Subscription.vue` | 登录才渲染购买按钮；`defineAsyncComponent` 懒加载弹窗 |

**命名为什么是 `wechat-pay:`**：`buyout-removal.contract.test.js` 用 `payment:` 前缀与 `/\bpayment[A-Z]\w+/` 锁买断形态不回归。复用旧名会与那把锁正面冲突，且 `payment` 是已移除的买断链路名字。

**契约锁改造**：新增一条**正向锁**——`wechat-pay:` 通道恰好两条、preload 恰好两个桥接、且两条都不得进 `PUBLIC_CHANNELS`（能触发真实扣款必须登录）。只写"零命中"不够，零命中也可以由「支付功能被删光」满足。

**弹窗三条纪律**：① 轮询只读（权威源是 webhook）；② 关闭即停（锁：关窗后再等 12s，IPC 调用数不得增加）；③ 不展示 `code_url` 原文。

## 5. 对 PRD 决策的一处显式推翻

**PRD §7.2 原定手写 QR 编码器（零新依赖），实现时改用 `qrcode@^1.5.4`。**

理由：手写 Byte 模式 + RS 纠错 + 掩码选择 + 格式信息共 350+ 行，而**本机没有任何扫码器或参考向量可以验证它真能扫**。对支付路径来说，「生成一张看起来像码但扫不出的图」等于零收入，且故障形态极隐蔽（界面一切正常）。用确定性换正确性，这个取舍在资金链路上划算。

放 `apps/desktop`（**不是** shared-utils）：避免把 pngjs/yargs 打进渲染层 bundle；主进程生成 SVG data URL 后交给渲染层。

## 6. 债务基线：三次撞线，全部拆文件（未抬基线）

| 撞线文件 | 撞线后 | 处置 | 处理后 |
|---|---|---|---|
| `test/payment-provider-wechat.test.js` | 566 | 拆 A/B + 夹具抽 `test/helpers/wechat-payment-fixtures.js` | 206 / 237 |
| `postgres-identity-repository.js` | 503（base 已 498） | 006 语句组抽 `payment-schema.js`；`PostgresWebhookTransaction` 抽 `postgres-webhook-store.js` | 428 |
| `subscription-service.js` | 637 | 支付方法按 `applyXxxHelpers(Proto)` mixin 抽到 `subscription-payment.js` | 496 |

`--update` 抬基线会把「我引入的债务」变成永久合法，正是 AGENTS 点名的「未抬高基线掩盖」。最终读数：`filesOver500: 95 = baseline 95`、`circularDeps: 0`、其余三项均在基线内。

## 7. 门禁读数

| 项 | 结果 |
|---|---|
| `packages/api-publish-engine` 全量 | **rc=0**（Vitest 47 文件 / 504 测试 + 全部 node:test 直跑） |
| 新增契约锁 | provider 22 + webhook 19 + subscription-payment 17 + payment-api 20 = **78 例** |
| 迁移漂移锁 | 23/23 |
| `apps/desktop` 相关 | WeChatPayDialog 8/8、QR 6/6、buyout 21/21（+1 正向锁）、preload 414/414、MemberCenter 11/11、member-api-service 10/10 |
| `check-locale-sync --keys` | PASS（2210 key 均存在） |
| `check-locale-sync --cjk` | PASS（基线 1330 / 当前 1124） |
| `check-debt-budget` | 全部指标在基线内 |
| eslint | 0 error（595 warning 全为存量，与改动前同数） |
| **QM-1 打包** | `electron-builder --win --dir` **rc=0**（5.2 min）；asar 内含 `wechat-pay`(3) / `payment-providers`(3) / `subscription-payment`(1) / `payment-schema`(1) / `postgres-webhook-store`(1) / `qrcode`(120)；解包后 `require('qrcode')` OK |
| **QM-1 启动** | 存活 8s = **True**；stderr = **0 字节**；层①红线未命中 → **PASS（层③）** |
| QM-6 双模型评审 | 判定 `DUAL`（3374 行 / 35 文件 / 敏感命中 11 路径 + 74 内容）；`deep-review.sh` 结果见 §8 |

### 7.1 QM-1 的一个真实陷阱（值得写下来）

首次启动验证 **FAIL**：进程 8 秒内提前退出、stderr 0 字节。

根因：父环境带着 `ELECTRON_RUN_AS_NODE=1`，任何 Electron 可执行文件会以**纯 Node 模式**启动并静默退出——`rc=0`、stdout 空、stderr 空、不建窗口，与「启动干净」**完全同形**。

这正是 AGENTS `fix-qm1-electron-run-as-node` 记的那条。本机实测还多一层：`Start-Process -Environment <hashtable>` **不能可靠覆盖**继承环境（传了也照样以纯 Node 模式退出）；唯一可靠做法是先在当前进程 `Remove-Item Env:ELECTRON_RUN_AS_NODE` 再普通启动。剔除后立刻变为「存活 True / stderr 0 字节」。

**若只看 stderr**，这一格会被判成「启动干净」的假绿。

## 8. 遗留与未闭合（不假装）

1. **微信沙箱端到端未执行**：`tasks.md` §0.3 要求沙箱凭据（appid/mchid/APIv3 密钥/商户证书）。用户给的是**生产凭据**，沙箱需另行申请。因此 PRD §11.4 的 E2E-1~7（真机扫码、超时、重放、伪造签名、跨档压制）**一条都未执行**。代码侧所有判据都是注入式单元/契约锁，**不构成真机通过的证据**。
2. **生产环境未验证**：同上。上线前必须按 PRD §14 清单在生产复跑 E2E-1（沙箱通过也不构成生产通过）。
3. **`GET /api/v1/me/orders/{id}` 的前缀白名单**：`ME_API_PREFIXES` 以 `paramPattern` 锁形状（`^wp[a-z0-9]{8,64}$`，天然不含 `/`），但**没有专门的单测覆盖路径穿越尝试**（如 `/api/v1/me/orders/../../admin`）。服务端 `_handleMemberOrderDetail` 会再判一次形状，属双层防护，但缺一条显式负例。
4. **`OrdersBilling.vue` 未改造**：spec 里有「订单页展示真实订单」这条 MODIFIED Requirement，本次**未实现**（仍是「订单功能即将上线」占位）。不影响支付主链路，但 spec 与实现有一处差距。
5. **`check-main-red.js` 在主干高频推进下不可满足**（阶段① 已记录）：工具适用边界，非本 PR 缺陷；根治需给判据加降级口径，属「改谁来守门」，必须人工过目。

## 9. 上线检查清单（代码之外，全部待办）

- [ ] 生产商户凭据注入服务端环境（`WECHAT_PAY_APPID` / `MCH_ID` / `API_V3_KEY` / `CERT_SERIAL_NO` / `CERT_PATH` / `NOTIFY_URL`）
- [ ] 微信商户平台配置回调 URL + 开启 APIv3 回调加密（`AEAD_AES_256_GCM`）
- [ ] nginx/网关对 `/api/v1/webhooks/payment` 放行（免登录但需防 CC）
- [ ] 确认 `WECHAT_PAY_*` 未被打进 Electron 产物（按「只走服务端环境变量」实现，仍需实测）
- [ ] 生产环境复跑 E2E-1
- [ ] 灰度：先白名单小流量，观察 webhook 到达率与订单 paid 率
- [ ] 回滚待命：`PAYMENT_PROVIDER=none` 重启即关闭入口（零代码回退）
