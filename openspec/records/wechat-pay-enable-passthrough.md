---
record: wechat-pay-enable-passthrough
task: 让支付配置真正到达服务进程（compose 透传）+ PRD 启用步骤
date: 2026-10-22
---

# 让前端真的能付款：把支付配置送进容器

## 1. 现场：代码全绿，但用户点「立即购买」永远看到"通道未开放"

前一轮 `tasks.md` 校准后，唯一剩下的实质待办是「真机 E2E」。继续往下查发现**还有两个不报错的坑**，
它们都不会让测试变红，只表现为「前端功能不存在」。

### 坑 1：`docker-compose.yml` 一个支付变量都没透传

实测 `packages/api-publish-engine/docker-compose.yml` 的 `environment` 有 20+ 项，**没有一项是 `PAYMENT_PROVIDER` 或 `WECHAT_PAY_*`**。

后果链条：

```
宿主机 .env 写了 PAYMENT_PROVIDER=wechat_native
  → 容器里读不到（compose 没传）
  → production-config 按默认 'none' 处理
  → POST /api/v1/me/checkout 恒返回 503 PAYMENT_PROVIDER_UNAVAILABLE
  → 弹窗恒落在 error 态：「支付通道暂未开放，可使用激活码开通」
```

**最恶劣的地方是它"看起来配好了"**：运维在 `.env` 里写得完全正确，`validate-production-config` 也过
（因为那个校验跑在容器里、读到的同样是空），唯一的现象是用户点不了。

### 坑 2：迁移不应用，整个服务起不来（不只是支付）

`PostgresIdentityRepository.initialize()` 在 `production` 下直接抛 `PRODUCTION_AUTO_MIGRATE_FORBIDDEN`；
而 `assertReady()` 校验的 `REQUIRED_SCHEMA_RELATIONS` **已含 `identity_payment_customers`**。

所以升级到含支付的版本时，**不先跑 006 迁移 ⇒ `BUSINESS_DATABASE_SCHEMA_NOT_READY` ⇒ 健康检查失败 ⇒ 整站不可用**。
这不是"支付不可用"，是"服务不可用"。PRD 原来的 §14 清单里没有这一步。

## 2. 改法

| 位点 | 改动 |
|---|---|
| `packages/api-publish-engine/docker-compose.yml` | 逐项透传 `PAYMENT_PROVIDER` + 7 个 `WECHAT_PAY_*`，**全部用 `${VAR:-}` 默认** |
| `.env.example` | 补 `WECHAT_PAY_CERT_CONTENT`（与 `CERT_PATH` 二选一）；标注"必须同时出现在 compose" |
| `packages/api-publish-engine/test/payment-env-passthrough.test.js` | **接线锁**（新增） |
| `01-docs/PRD-WECHAT-PAY-INTEGRATION-2026-10-21.md` | 新增 §15「启用步骤」，重写 §14 清单第一条 |

### 为什么用 `:-` 而不是 `:?`

`:?` 会让**没配支付的环境直接起不来**。而支付是**可选能力**：默认 `PAYMENT_PROVIDER=none` 时
入口 fail-closed 隐藏，兑换码/后台开通两条既有通道不受影响。
用 `:?` 等于把一个可选功能变成全站启动的硬依赖 —— 那是把"配置缺失"升级成"服务不可用"。

### 接线锁的判据（集合相等，不是"至少包含"）

| 断言 | 防的是什么 |
|---|---|
| `.env.example` 的每个支付变量都在 compose 里 | 新增变量忘了改 compose ⇒ 又是"配了没用" |
| compose 不得多传 `.env.example` 未声明的支付变量 | 两份清单开始漂移 |
| 支付变量一律 `:-`，不得 `:?` | 可选功能不得变成启动硬依赖 |
| 前提：两文件都真的解析出 ≥7 个变量 | 正则失配导致空集合**恒绿**（锁自己失明的形态） |

## 3. 判据

新增 **5 例**（`payment-env-passthrough.test.js`）。变异反证两条，均双向：

| 变异 | 结果 |
|---|---|
| 删掉 `WECHAT_PAY_NOTIFY_URL` 透传 | **3 pass / 2 fail**，「必须透传每个支付变量」精确变红 |
| 把 `WECHAT_PAY_MCH_ID` 改成 `:?` 必填 | **3 pass / 2 fail**，「不得用 `:?`」精确变红 |

均逐字节还原校验 True。

**锁真的会跑**：`scripts/run-tests.js:82` 用 `readdirSync(test).filter(f => f.endsWith('.test.js'))` 枚举，
本文件不在 `VITEST_FILES` 白名单内 ⇒ 走 `node --test` ⇒ 在册执行。
（不核实这一条，"新增了一个锁"可能只是新增了一个从不运行的文件。）

全量：`packages/api-publish-engine` `node scripts/run-tests.js` **rc=0**（Vitest 47 文件 + node:test）。

## 4. 文档写了什么

PRD 新增 §15，四小节：

| 节 | 内容 |
|---|---|
| 15.1 | 应用迁移的三条命令（含容器内写法）+ 三条事实（禁止自动迁移 / 就绪检查会验表 / 台账锁不准改旧迁移）+ `--dry-run` 输出示例 |
| 15.2 | 7 个变量的取值约束表（含「必须 32 字符」「必须 HTTPS」）+ 证书放哪（`config/wechat-pay/apiclient_key.pem`，已被 bind）+ 接线锁位置 |
| 15.3 | 三步自检命令（配置自检 / 就绪探针 / 端点存在性，未登录应 401 而非 404） |
| 15.4 | 弹窗**逐态文案表**（8 个状态 × 主提示 × 可用操作，全部引用 locale 实际值）+ 改前/改后对比 |
| 15.5 | 回滚：`PAYMENT_PROVIDER=none` 重启；pending 订单不清理且无副作用 |

15.4 里刻意写清一条容易误判的：**「按钮在、点了报错」是未配置时的预期形态，不是 bug** ——
按钮显示条件是「已登录」而非「已开通支付」，这是 §7.4 的既定设计（预判需额外探测请求）。

## 4.5 ⛔ 本轮还发现一条更大的缺口（未修，已钉进文档）

查「还有没有别的配置不生效」时发现：**`WeChatNativeProvider` 在生产代码里从未被构造过**。

| 位点 | 代码 |
|---|---|
| `src/auth/logto-runtime.js:127` | `new SubscriptionService({ repository, planOverrides })` —— **没传 `paymentProvider`** |
| `src/auth/subscription-service.js:120` | `this.paymentProvider = options.paymentProvider \|\| null` |
| `src/auth/subscription-payment.js:56` | `if (!this.paymentProvider) { … }` ⇒ 恒回 503 |
| 全仓 `src` | `WeChatNativeProvider` **只出现在它自己的定义文件**，生产代码从未 `new` |

**后果**：即使迁移已应用、compose 已透传、`.env` 填好、商户平台配好，`/me/checkout` **仍然恒 503**。
第 15 节的配置工作会全部白做。

**为什么 111 条支付测试全绿也没发现**：每条测试都**注入** provider
（`new SubscriptionService({ repository, paymentProvider: new WeChatNativeProvider({...}) })`）。
被注入的东西永远不需要有人去构造它 —— 单元覆盖率 100%，**组合根覆盖率 0%**。

**为什么本轮不修**：签名 + 平台公钥是安全关键路径，必须**一次接全**。
只接下单不接验签 = 用户付了钱、webhook 401、权益不发放 —— **比现在更糟**（从"付不了"变成"钱收了没给货"）。
已写成 `tasks.md` §9.8（4 个子项，含组装根测试）与 PRD §16。

## 4.6 外部评审的处置（2 High + 2 Medium）

| # | 评审意见 | 处置 |
|---|---|---|
| 1 | High：`CERT_PATH` 与 `CERT_CONTENT` 同时设置时谁优先未定义 | **采纳并更彻底**：`CERT_CONTENT` 在**任何生产代码里都没有消费方**（全仓只在 `production-config` 的 `!== ''` 判断里出现）⇒ 写进 `.env.example` 等于宣传一条不存在的路径。**已从 `.env.example` 与 compose 移除**，并注明"工厂落地时再一并支持" |
| 2 | High：`CERT_CONTENT` 走 env 会被 `docker inspect` 看到，扩大泄露面 | 同上，移除即消除。另核实 `.gitignore:330` 已忽略 `.env` |
| 3 | Medium：锁只验"声明一致"，不验运行时值；且 `.env` 与 `.env.example` 可能各自漂移 | **采纳为作用域说明**：在测试文件头写明"本锁只比对键名，值校验是 `production-config` 的职责"，并写明不得改成"匹配不到就跳过" |
| 4 | Medium：新测试可能没接进 CI（孤儿文件） | **已核实并在文件头留证**：`scripts/run-tests.js:82` 用 `readdirSync(test).filter('.test.js')` 枚举，本文件不在 `VITEST_FILES` ⇒ 由 `node --test` 执行 |

评审的 #1/#2 指向的其实是同一件事，而且顺着它们查出了更严重的问题（见 §4.5）：
`WECHAT_PAY_CERT_CONTENT` **只被校验器承认、没有任何代码读它** —— 这正是"校验器比实现走得远"的形态。
把它写进 `.env.example` 会让人配一个永远不会生效的变量。

## 5. 仍未做

| 项 | 阻塞 |
|---|---|
| `tasks.md` 的 0.3（沙箱凭据）/ 8.8（E2E-1~7） | 需要真机凭据；本次改动**不改变**这个结论 |
| 生产注入凭据、商户平台配回调、网关放行、灰度 | 运营/运维 |

本 PR 的作用是：**把「配了也没用」这条路堵死**，让 0.3/8.8 一旦具备条件就能真正跑通。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）
