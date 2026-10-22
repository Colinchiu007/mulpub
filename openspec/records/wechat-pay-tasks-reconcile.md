---
record: wechat-pay-tasks-reconcile
task: 按代码实况校准 wechat-native-payment/tasks.md 勾选
date: 2026-10-22
---

## 本次执行记录：wechat-native-payment/tasks.md 按代码实况校准（wechat-pay-tasks-reconcile，2026-10-22）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **docs-only=true**（files=2：`.ccg/reviews/07bd5f74….json`、`openspec/changes/wechat-native-payment/tasks.md`）
- 保留门禁：行尾对账 ✅（`--numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐行一致：61/0、133/62）| 品牌残留 ✅（`check-no-brand-residue` PASS，扫描 11859 个 tracked 文件）| 文档同步 ✅（本次即文档本身）| 远程同步 PR #4244
- 备注：跳过 QM-1 / QM-2 / QM-4 / TDD / QM-6（与运行时无关）

## 为什么改

`tasks.md` 长期停在**工作计划态**：大部分 `[ ]` 对应的代码早已写入并合并。任何人（含下一个会话）读它都会误判进度，甚至重复实现已存在的东西。

## 校准方法（判据是"能指出文件/测试"，不是"我记得做过"）

逐条探测代码/测试是否存在：第一轮 27 项、第二轮 8 项；支付相关测试实跑 **111/111 通过**。

| 结果 | 数量 |
|---|---|
| 完成 | **35** |
| 未完成 | **2**（`0.3` 沙箱凭据、`8.8` 真机 E2E） |
| 实现方式变更 | **3**（`4.4`、`6.5`、`6.6`） |

## 三处实现方式变更（如实标注，不硬套原任务文本）

| 项 | 原计划 | 实际 | 为什么 |
|---|---|---|---|
| 4.4 | webhook 拆独立 mixin `publish-api-payment-webhook.js` | 与另两个 handler 同在 `publish-api-payment.js` | `publish-api-server.js` 有 1574 行硬上限（TARGET_GREW 零增长），拆 mixin 本为压行数，再拆一个会把行数推回去 |
| 6.5 | `license-access-control.js` 白名单显式登记 authenticated 级 | 无需登记 | `requiredLevelForChannel()` 对不在 `ADMIN_ONLY_CHANNELS`/`PUBLIC_CHANNELS` 的通道**默认返回 `authenticated`**；显式登记反而会写进更宽或更窄的表 |
| 6.6 | `packages/shared-utils/src/qr-code.js` 手写 Byte 模式编码器 | `qrcode@^1.5.4`（仅 `apps/desktop`） | 手写编码器**没有扫描器/视觉工具可验证**，"测试通过"只能是自证；错误二维码在用户侧只表现为"扫不出来"，属最难归因的故障 |

## 另发现

- 新增 `7.6`：会员中心订单页（原计划外，已随 #4219 交付）
- `5.2` 是**通过委托达成**：`validate-production-config.js` 只 `require('../src/auth/production-config')`，校验逻辑单一真源，所以文件里搜不到 `PAYMENT_PROVIDER` 字样**不是缺口**（这一条如果不写清楚，下个会话会误判成漏做）
- 新增第 10 节「仍未做汇总」，把真待办（凭据/配置/灰度）与"决定不做"的非目标分开列

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PR #4244
