---
record: wechat-pay-provider-wiring
task: 把 WeChatNativeProvider 接到组装根（让支付真的能发起）
date: 2026-10-22
---

# 让支付真的能发起：provider 接线

## 1. 缺口：111 条支付测试全绿，但生产里 provider 恒为 null

上一轮做配置透传时顺带查到（PRD §16）：

| 位点 | 代码 |
|---|---|
| `src/auth/logto-runtime.js:127` | `new SubscriptionService({ repository, planOverrides })` —— **没传 `paymentProvider`** |
| `src/auth/subscription-service.js:120` | `this.paymentProvider = options.paymentProvider \|\| null` |
| `src/auth/subscription-payment.js:56` | `if (!this.paymentProvider)` ⇒ 恒回 503 |
| 全仓 `src` | `WeChatNativeProvider` **只出现在它自己的定义文件**，生产代码从未 `new` 过它 |

**后果**：迁移应用了、compose 透传了、`.env` 填满了、商户平台配好了 —— `POST /me/checkout` **仍然恒 503**，
用户仍然看到「支付通道暂未开放」。上一轮的配置工作会全部白做。

**为什么测试全绿也发现不了**：每条测试都**注入** provider。

```js
new SubscriptionService({ repository, paymentProvider: new WeChatNativeProvider({...}) })
```

被注入的东西永远不需要有人去构造它。单元覆盖率 100%，**组合根覆盖率 0%**。

## 2. 改法：一次接全，不许半接

| 位点 | 改动 |
|---|---|
| `src/auth/payment-providers/wechat-native-factory.js`（新增） | `readPem` / `buildAuthorizationHeader` / `createWeChatNativeProvider(env, deps)` |
| `src/auth/logto-runtime.js` | 构造 provider 并传入 `SubscriptionService({ paymentProvider })`；用 `!== undefined` 判空以保留测试可控性 |
| `src/auth/production-config.js` | 平台公钥纳入 `wechat_native` 必填 |
| `.env.example` / `docker-compose.yml` | 新增 `WECHAT_PAY_PLATFORM_PUBLIC_KEY(_PATH)` / `_PUBLIC_KEY_ID`；恢复 `WECHAT_PAY_CERT_CONTENT`（现在真有消费方了） |

### 为什么必须一次接全

下单要**商户私钥签名**，回调要**平台公钥验签**。只接下单不接验签 = 用户付了钱、webhook 401、权益不发放
—— 比"根本付不了款"更糟：从「功能缺失」变成「钱收了没给货」，是资金事故。

所以 `createWeChatNativeProvider` 对两者都强制校验，缺一即抛；`production-config` 也同步把平台公钥列为必填。

## 3. 签名实现的两个易错点

### 3.1 原文格式：五行、四换行、末尾还要一个换行

```
HTTP方法\nURL路径\n时间戳\n随机串\n请求报文主体\n
```

少一个换行、或把 `RSA-SHA256` 写成 `SHA256`，线上表现都是 `SIGN_ERROR`、所有下单失败。
所以测试**不是断言字符串前缀**，而是生成真 RSA 2048 密钥对 → 签名 → 用公钥 `verify` 往返验证。

### 3.2 报文主体必须与实际发出的逐字节一致

本仓下单时实际发的是 `JSON.stringify(body)`（`wechat-native.js:243`），
而 `signRequest` 收到的是 **body 对象**（`wechat-native.js:246`）。所以工厂里也必须 `JSON.stringify` 同一个对象。

测试里专门有一条「乱序 key」用例：把 `{z:1,a:2}` 的签名拿去用 `{a:2,z:1}` 验，**必须验不过** ——
若这条能验过，说明实现重排了 key，与真实发出的 body 不一致。

## 4. 验签侧：换公钥必须吵出来

`certificateProvider.getBySerial(serial)` 只持有一把平台公钥：

- 配了 `WECHAT_PAY_PUBLIC_KEY_ID` ⇒ 按 serial 核对，不一致返回 `null`
  ⇒ provider 抛 `PAYMENT_WEBHOOK_CERT_NOT_FOUND`
- 没配 ⇒ 不按 serial 过滤（兼容只配一把公钥的部署）

**刻意 fail-closed**：微信侧换公钥而配置没更新时必须失败，不能拿旧公钥默默验过。

## 5. 判据

新增 **21 例**（`test/payment-provider-factory.test.js`）。

### 变异反证（两条，均双向）

| 变异 | 结果 |
|---|---|
| 撤掉 `logto-runtime.js` 里的 `paymentProvider,` | **19 pass / 2 fail**，组装根用例精确变红 |
| 签名原文去掉末尾换行 | **19 pass / 2 fail**，验签用例精确变红 |

均逐字节还原 True。

### 全量

`packages/api-publish-engine` `node scripts/run-tests.js` **rc=0**（Vitest 47 文件 / **504 例** + node:test）。

### 组装根测试长什么样（关键）

```js
const rt = await createLogtoRuntime({ env: { ...baseEnv, ...wechatEnv }, repository: stubRepository() })
assert.ok(rt.subscriptionService.paymentProvider instanceof WeChatNativeProvider)
```

它**不注入** provider，而是走真实组装路径 —— 这就是当初唯一能抓住本缺口的那条断言。

## 6. 仍未做

| 项 | 阻塞 |
|---|---|
| `tasks.md` `0.3` / `8.8`（沙箱凭据 / E2E-1~7） | 需要真机凭据 |
| 生产注入凭据、商户平台配回调、网关放行、灰度、回滚演练 | 运营 / 运维 |

**本 PR 之后，"代码侧能不能付款"这条已经打通**：装配、签名、验签、配置校验、环境透传都齐了。
剩下的全部是「拿真凭据跑一次」。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）
