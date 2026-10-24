---
record: wechat-pay-event-outbox
task: 支付回调留痕 identity_webhook_events（补 PRD §15.9 缺口）
date: 2026-10-23
---

# 支付回调留痕

## 1. 背景：文档说有，代码没做

上一轮写 E2E runbook 时按 PRD §5.3「`identity_webhook_events` 复用为支付 outbox」写了排查 SQL，
核对实现后发现 **`_handlePaymentWebhook` 与 `settlePaymentWebhook` 一行都没写过**：

| 位点 | 当时的事实 |
|---|---|
| `_handlePaymentWebhook` | 验签 → `settlePaymentWebhook` → 回 200，全程不 INSERT |
| `settlePaymentWebhook` | 幂等靠 `markOrderPaid` 条件更新 + `provider_reference` UNIQUE |

后果：**回调到达没有持久化记录，事后追查只能翻日志**。

这类「文档说复用、实现没做」比「压根没做」更危险 —— 读文档的人会以为有。

## 2. 实现

新增 `src/auth/payment-event-outbox.js`（84 行）：

| 函数 | 作用 |
|---|---|
| `paymentEventId(orderId)` | 事件行 id = `wechat_pay:<orderId>`，一单一值 |
| `claimPaymentEvent(client, record)` | `INSERT … ON CONFLICT (provider, id) DO NOTHING RETURNING id` → `{id, claimed}` |
| `completePaymentEvent(client, eventId, result)` | 置 `status='processed'` + `result` + `processed_at=NOW()` |

接入点：`settlePaymentWebhook` 的**同一事务内**（`commerceTransaction`）。

```
claim → markOrderPaid → applySubscription → createNotification → complete
```

三者同事务 ⇒ 抢占成功但结算失败会连事件行一起回滚，重投可以重新来。

## 3. 三条纪律

| # | 纪律 | 理由 |
|---|---|---|
| 1 | `claimed=false` 时**短路**（连 markOrderPaid/applySubscription 都不执行） | 比"靠 UNIQUE 冲突收敛成 409"更早拦住；重复投递不该产生任何副作用 |
| 2 | **事件表写失败不阻断结算**，结果带 `eventRecorded=false` | 用户已经付了钱，权益优先于可观测性 |
| 3 | 收口失败同样不回滚，`eventRecorded` 降级为 false | 权益已经发了，不能因为写日志失败而回滚 |

第 2、3 条都**不静默**：`_handlePaymentWebhook` 见到 `eventRecorded === false` 会落
`PAYMENT_EVENT_NOT_RECORDED` 日志。响应仍是 200（钱已到账，微信不该重投）。

## 4. 幂等键为什么是订单号

微信重投同一笔支付时 `Wechatpay-Nonce` **每次都变**，`transaction_id` 才稳定。
但本模块拿到的是 `orderId`（= 我们自己的 `out_trade_no`）—— 天然一单一值，比 `transaction_id`
更适合：**一单只会有一条支付事件**。

**已知边界**：将来同一订单出现第二类事件（退款/撤销通知）会撞键。届时改 `paymentEventId()`
扩成 `wechat_pay:<orderId>:<event>` —— 这是唯一改动点，已写进代码注释与 PRD。

## 5. 判据

新增 **12 例**（`test/payment-event-outbox.test.js`）：

| 用例 | 断言 |
|---|---|
| 事件 id 一单一值 | `wechat_pay:abc` |
| claim SQL 形状 | 含 `ON CONFLICT (provider, id) DO NOTHING`、`'processing'`、参数映射 |
| 已存在 | `claimed=false` 且不抛错 |
| complete | `SET status='processed'` + `result` 为 JSON |
| eventId 为空 | no-op（不误伤全表） |
| 正常结算 | 先 INSERT 再 UPDATE，`eventRecorded=true`，权益发放 |
| **重复投递** | 短路，`applySubscription` **零次** |
| 事件表不可用 | 结算照常，`eventRecorded=false` |
| 收口失败 | 不回滚，`eventRecorded=false` |
| 非 checkout.completed | 不落库也不结算 |

### 变异反证（三条，均双向）

| 变异 | 结果 |
|---|---|
| 去掉重复短路（`if (!claim.claimed)` → `if (false)`） | **10 pass / 2 fail** |
| 失败也报"已留痕"（`eventRecorded = false` → `true`） | **9 pass / 3 fail** |
| 结果不带 `eventRecorded` | **8 pass / 4 fail** |

均逐字节还原 True。全量 `packages/api-publish-engine` rc=0（Vitest 47 文件 / **504 例**）。

## 5.5 外部评审处置（VERDICT: PASS，0 Critical / 0 High）

跨家族评审（claude，非本实现家族）给出 **PASS**，并逐条确认了三件我最担心的事：

| 复核项 | 结论 |
|---|---|
| 事务语义 | 提前 `return` 走的是 **COMMIT** 而非 ROLLBACK；结算失败则连 claim 一起回滚 ⇒ **不会留下"已抢占但没结算"的毒行** |
| 并发双投 | 第二个事务在 `ON CONFLICT` 上阻塞；第一个提交则它拿到 `[]` 跳过结算，第一个回滚则它接手 ⇒ **只有一个会结算** |
| SQL | 占位符 7 个 / 2 个均正确；`$2::jsonb` 正确；`NOT NULL` 列（`hook_id`/`created_at`/`received_at`）全部供给；`ON CONFLICT (provider,id)` 对得上 `003` 的唯一约束 |

两条 Medium：

| # | 意见 | 处置 |
|---|---|---|
| 4 | `tx.client` 缺失时 `eventRecorded` 键被省略，契约不一致（缺键会被读成成功） | **采纳**：键永远存在，`null` 表示"不适用"。新增 1 例锁住；变异（改回省略）→ 12 pass / 2 fail |
| 5 | 上一投递若"结算成功但收口失败"，事件行会永久停在 `processing`，后续重投只跳过、不修复 | **不修代码**（自动改 `processed` 会在"其实没结算"时谎报），改为**可查判据**：RUNBOOK 观测段加「卡在 processing 超过 10 分钟」的 SQL，并注明「权益已发，不要据此重新发放」。PRD §15.9.2 记录该边界 |

> 这轮评审的价值在于把"我以为对"的三条（事务、并发、SQL）逐条验证了一遍，
> 而不是提新意见。对资金路径来说，**"确认无误"和"发现错误"同样有价值**。
## 5.6 顺带清掉一条陈旧的漏洞基线（与本 PR 逻辑无关，但挡住所有人）

CI `依赖漏洞审计` 红在：

```
❌ RESOLVED_STILL_BASELINED: npm/GHSA-hp3w-g68c-fv3c 已不再命中（多半已升级），请 --update 清账
```

`npm view sprintf-js version` 仍是 `1.1.3`、锁文件仍是 `1.0.3`，都**不含**修复版 ——
所以不是"已升级"，而是**这条公告早已不在判据面内**：它来自 dev/构建依赖链
（`js-yaml@3.x` / `mammoth` → `argparse@1.x` → `sprintf-js`），
而门禁口径是 `--omit=dev / --prod`，dev 依赖不扫。

处置：只删这一条（28 → 27），**没有跑 `--update` 重生成**。原因是 `--update` 会把 `"."` 塞进
一堆条目的 `roots`（本机 worktree 布局的产物），产生 25 增 19 删的环境相关噪声。
删除后 `命中 27 = 挂账 27`，门禁转绿。

> 这条属于"基线只能缩小"的合法动作：清掉一个已经不在判据面内的条目，不是放宽判据。
## 6. 文档同步（关键：不让文档再次落后于实现）

| 文件 | 改动 |
|---|---|
| PRD §15.9 | 标题从「⚠️ 已知限制」改为「✅ 已修复」，新增 15.9.1 实现 / 15.9.2 幂等键理由 / 15.9.3 判据 |
| RUNBOOK E2E-1 | 恢复 `identity_webhook_events` 的核对 SQL（`provider='wechat_pay'`） |
| RUNBOOK E2E-1 排查表 | 改成三段式：没行=回调没到 / 有行 processing=结算失败 / 没日志=验签失败 |
| RUNBOOK E2E-4 | 幂等判据从一条变两条：权益只一条 + **事件只一行** |
| RUNBOOK 观测 | 恢复 webhook 到达与处理的 SQL |
| RUNBOOK 已知限制 | 删掉「回调不留痕」，补「同一订单第二类事件会撞键」的边界 |

> 这一节是本次的重点：上一轮我刚批评过「文档说一套、代码做一套」，
> 如果这次只改代码不改文档，就是在同一个坑里再摔一次。

## 7. 仍未做

| 项 | 阻塞 |
|---|---|
| E2E-1~7 真机执行 | 商户凭据 + 商户平台配置 + 公网域名（见 runbook §0） |
| 同一订单多类事件（退款/撤销） | 未申请退款自动化；届时扩 `paymentEventId()` |

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）
