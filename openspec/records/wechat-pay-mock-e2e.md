---
record: wechat-pay-mock-e2e
task: 本地 mock 微信服务器预演下单（抓出 SIGN_ERROR 被吞的真 bug）
date: 2026-10-23
---

# mock 微信预演

## 1. 之前所有支付测试都缺的那一环

先前 100+ 条支付测试**全都注入 `fetcher`**。它们证明「provider 拿到某个响应后怎么处理」，
**证明不了**「provider 发出去的请求，微信会不会认」。

线上第一种失败恰恰是后者 —— `SIGN_ERROR`：签名原文 / 报文 / 时间戳任一处不对，**全部下单失败**。
注入式测试永远暴露不出来，因为不存在的网络层不会拒绝你。

## 2. 做法

`test/payment-mock-wechat-e2e.test.js` 起一个本地 HTTP 服务器（`127.0.0.1` 临时端口、不出网），
做和微信一样的事：

| 检查 | 判据 |
|---|---|
| 路径/方法 | `POST /v3/pay/transactions/native` |
| 签名类型 | `WECHATPAY2-SHA256-RSA2048` |
| `mchid` / `serial_no` | 与配置逐字一致 |
| 时间戳 | **10 位秒级**且 ±300s 内（毫秒当场挡下） |
| **签名** | 用商户公钥对 `POST\n路径\n时间戳\n随机串\n原文报文\n` 做 `RSA-SHA256` verify |
| 报文 | `appid` / `mchid` / `out_trade_no` / `notify_url` / `amount.total` / `attach` |

签名不过返回 `{code:'SIGN_ERROR'}` —— 与微信错误体同形。

**关键**：测试里的签名器是**生产签名器** `buildAuthorizationHeader`（与工厂同一份实现）。
自带一套签名逻辑的话，测试就只是在验证自己。

## 3. 它抓到的真 bug

`createCheckout` 原本在 `response.ok !== true` 时**先**抛 `PAYMENT_PROVIDER_UPSTREAM_FAILED`，
**从不解析微信的错误体**。而微信把业务错误放在**非 2xx 的 JSON body 里**（`SIGN_ERROR` 是 401）。

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 签名错（401 `SIGN_ERROR`） | `UPSTREAM_FAILED`「微信下单请求失败」 | `UPSTREAM_REJECTED`「微信下单被拒：SIGN_ERROR 签名错误」 |
| 网关 HTML 401（无 code） | `UPSTREAM_FAILED`「返回异常」 | `UPSTREAM_FAILED`「返回 HTTP 401」 |
| 网络断开 | `UPSTREAM_FAILED` | `UPSTREAM_FAILED`（不变） |

**修复前，运维看到 SIGN_ERROR 会以为是网络问题，实际是密钥/签名不对 —— 排查方向完全相反。**

这类 bug 的逃逸链很清楚：
单元测试只喂"已经解析好的响应对象"，`response.ok` 那个分支从来没被真实错误体走过。

## 4. `apiBase` 只从代码传，不读环境变量

新增 `options.apiBase`（默认生产域名，末尾斜杠规范化）。

**刻意不读 env**：线上某人把它设成 `http://…` 会把签名与报文暴露在明文链路上。
"配置能改安全属性"的口子一旦存在，迟早会被用来"临时绕过"。

## 5. 判据

新增 **5 例**。变异反证两条，均双向：

| 变异 | 结果 |
|---|---|
| 恢复「先判 `ok` 再读报文」 | **3 pass / 2 fail**，SIGN_ERROR 用例精确变红 |
| 忽略 `apiBase` 走生产域名 | **3 pass / 2 fail**，happy path 精确变红 |

均逐字节还原 True。全量 `packages/api-publish-engine` rc=0。

## 5.5 外部评审（1 Critical + 4 High）——4 采纳 / 1 驳回 / 1 部分成立

| # | 意见 | 核验 | 处置 |
|---|---|---|---|
| 1 | Critical：`payload.code` 在非对象载荷上会崩 | **不成立** —— `payload && payload.code` 对字符串/数组只得到 `undefined`，不抛。但「200 里带 truthy 非字符串 code」确实会误判 | 加固为 `对象 && typeof code === 'string' && length > 0` |
| 2 | High：SIGN_ERROR 应返回 401 而非 502 | **驳回** | 401 的语义是「终端用户未认证」，这里是**我们服务端**没向微信认证，用户本人已登录。改 401 会让客户端误判会话过期触发重登，比 502「支付暂不可用」更糟。诊断需求已由 message 里的 SIGN_ERROR 满足 |
| 3 | High：`apiBase` 无 scheme 校验 | 成立 | 只允许 https，http 仅限回环，构造期抛 TypeError |
| 4 | High：mock 里 assert 抛在回调中 → 服务端崩、客户端悬等 | 成立（失败伪装成超时） | 整个 handler 包 try/catch，异常转 500 响应并记 `seen.errors` |
| 5 | High：缺 signature 时 `verify(undefined)` 抛 OpenSSL | 成立 | 验签前先判 `fields.signature` |
| 6 | Medium：`server.close()` 遇 keep-alive 一直等 | 成立 | `closeAllConnections()` 再 close |
| 7 | Low：测试用生产签名器，系统性 bug 两边同错 | 设计取舍，不改 | 集成测试目标是端到端能过 |

### 一条自省：变异反证本身也会假绿

第一版「放松错误体判定」的变异**没红** —— 因为我的测试数据是 `code: 0`（falsy，
`payload.code` 与 `typeof === 'string'` 两种实现都放过）。换成 truthy 的 `code: 42`
才真正区分开。

**变异用例的数据必须选在「两种实现行为不同」的那一侧**，否则测的是"两次都一样的运气"。

## 6. 它证明了什么、没证明什么## 6. 它证明了什么、没证明什么

| 证明了 | 没证明 |
|---|---|
| 我们的签名**可被公钥验证通过**（和微信做的事一致） | 微信真的认（只有 E2E-1 能证明） |
| 时间戳是秒级、在容差内 | 真机扫码、真实扣款 |
| 报文符合 Native 下单契约 | 商户平台配置（回调 URL、加密开关） |
| 签名错时会得到可读的 `SIGN_ERROR` 而不是"请求失败" | 生产网络/证书链 |

**别把它当"支付已验证"** —— 它是"服务端半程的预演"。

## 7. 仍未做

| 项 | 阻塞 |
|---|---|
| E2E-1~7 真机执行 | 商户凭据 + 商户平台配置 + 公网域名 |
| mock 覆盖 webhook 全链路（当前 webhook 验签已有独立真 crypto 测试） | 可做，收益递减 |

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）
