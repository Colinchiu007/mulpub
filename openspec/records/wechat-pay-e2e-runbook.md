---
record: wechat-pay-e2e-runbook
task: 微信支付 E2E-1~7 可执行 runbook
date: 2026-10-23
---

# E2E 验收 runbook

## 1. 为什么写这个

代码侧已经打通（#4249 配置透传 / #4252 provider 接线 / #4256 上线预检），
但 **E2E-1~7 一次都没跑过** —— 没有一笔真实支付发生过。

PRD §11.4 只有一张七行的表格（场景 + 期望），拿它没法执行：缺凭据从哪拿、缺命令、缺 SQL、缺失败怎么查。
本 runbook 的目标是：**拿到凭据的人可以照着敲，不需要回来问任何一个问题。**

## 2. 内容结构

| 节 | 内容 |
|---|---|
| 0 | 前置：8 样凭据/材料清单（含从商户平台哪个菜单拿） |
| 1 | 迁移：`--dry-run` → 真跑 → 3 条核对 SQL；附「不迁移则整站 503」的三条事实 |
| 2 | 环境变量：`.env` 模板 + 证书放置位置与 `chmod 600` |
| 3 | 商户平台配置：回调 URL 与 APIv3 加密，强调**逐字一致** |
| 4 | 自检：预检 + 就绪探针 + 端点存在性（401 而非 404） |
| E2E-1~7 | 每条含 目的 / 步骤表 / API 观察点 / DB 期望 SQL / 失败排查表 |
| 观测 | 灰度期三条 SQL（成功率、未落账订单） |
| 回滚 | `PAYMENT_PROVIDER=none` 的确切效果 |
| 记录表 | 七行勾选表，跑完填 |

## 3. ⚠️ 写的过程中发现文档与实现不一致（重要）

按 PRD §5.3 的说法，`identity_webhook_events` 被「复用为支付 outbox」。
我照着写了 SQL，然后去核对实现 —— **没有任何代码往里写**：

| 位点 | 事实 |
|---|---|
| `_handlePaymentWebhook`（`publish-api-payment.js:32-84`） | 验签 → `settlePaymentWebhook` → 回 200，全程不 INSERT |
| `settlePaymentWebhook`（`subscription-payment.js:164-220`） | 幂等靠 `markOrderPaid` 条件更新 + `provider_reference` UNIQUE |

也就是说：**回调到达没有持久化记录，只能翻日志。**

这条比「没做」更危险：读文档的人会以为有。已在 PRD 新增 §15.9 记录，并给出建议补法；
runbook 里把所有依赖事件表的 SQL 换成「查日志」，并单列一节「已知限制」。

### 另外两处我一开始写错、核对后改掉的

| 我原先写的 | 实际 | 怎么发现的 |
|---|---|---|
| `provider_reference = '<订单 id>'` | `wechat:<订单 id>`（`subscription-payment.js:180` `providerReference \|\| \`wechat:${orderId}\``） | 读 `settlePaymentWebhook` 源码 |
| `WHERE provider='wechat_pay'` | 该表根本没有支付行；且客户映射用的 provider 值是 `wechat`（`subscription-payment.js:78`） | 同上 |

**教训**：写 runbook 时「凭印象写 SQL」和「照着表结构写」看起来一样，但前者会让执行者得到空结果并误判「链路没通」。

## 4. 判据

docs-only，无代码改动。保留门禁：

- `classify-docs-only` → docs-only=true
- 行尾对账两口径一致
- 品牌残留 PASS
- `check-doc-abs-paths --all` PASS（runbook 里所有路径都是相对或占位形态）
- `check-gate-record-debt` OK

## 5. 仍未做

| 项 | 阻塞 |
|---|---|
| E2E-1~7 真机执行 | 商户凭据 + 商户平台配置 + 公网域名（见 runbook §0） |
| 支付回调事件持久化（PRD §15.9） | 代码改动，建议下一轮做；不阻塞 E2E |

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）
