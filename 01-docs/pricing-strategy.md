# 定价策略 v2.2

> **权威源：`packages/api-publish-engine/src/auth/plan-matrix.js`**
> （`PLAN_MATRIX_VERSION = '2026-10-20'`，`PLAN_IDS = ['free', 'standard', 'pro']`）
> 2026-10-20 更新（v2.2，会员档位机制落地）：专业版 **¥79 → ¥119 / ¥699 → ¥999**（相邻档 2.0×，
> 对齐行业中位），标准版视频配额 **500 → 300**（3× 余量），新增 `rank` / `maxDevices` /
> `maxCloudAccounts` / `batchSizePerRun` / `modelTier` 五个契约字段。推导见
> `MECHANISM-MEMBER-TIERS-DEEP-2026-10-19.md` §C2.3 / §C4.3，实施见
> `PRD-MEMBER-TIER-MECHANISM-2026-10-20.md`。
> 2026-10-08 更新：标准版改**正价 ¥59**（¥29 为推广期半价价，**不写进本矩阵**）、年付改 ¥499，
> 官方积分改 30/1600/2200。推导见 `DEEP-ANALYSIS-CREDIT-PRICING-2026-10-08.md` §6.1b。
>
> **本文档不定义价格，只解释代码里已经落地的价格。** 改价流程见 §7。
> 2026-10-07 按代码重写：v1.0 长期停留在「10 平台 / Pro ¥39 / 企业版 ¥199」三档旧口径，
> 与实现不符，且列出的多项能力无实现。逐条差异见 §6。

---

## 1. 分层模型

| planId | label | 月付 | 年付 | 平台数 | 日发布 | 并发 |
|---|---|---|---|---|---|---|
| `free` | 免费版 | ¥0 | ¥0 | 5 | 5 | 1 |
| `standard` | 标准版 | ¥59 | ¥499 | 15 | 50 | 3 |
| `pro` | 专业版 | **¥119** | **¥999** | 不限（`-1`） | 1000 | 10 |

**只有三档，没有「企业版」。** v1.0 的企业版（多账号 / API / 团队协作 / SLA）
在 `plan-matrix.js` 中**没有对应 planId**，相关能力也未实现，见 §6。

**相邻档价差**：¥59 → ¥119 = **2.02×**，与 Notion/Slack/Linear 等 5 个产品的二→三档中位
（≈2.0×）一致。改造前 ¥59 → ¥79 只有 1.34×，撑不起功能分界线（两档 `features` 曾逐字节相同）。

## 2. 权益矩阵（代码常量逐项）

| 能力 | `free` | `standard` | `pro` |
|---|---|---|---|
| `maxPlatforms` | 5 | 15 | **-1（不限）** |
| `dailyPublish` | 5 | 50 | 1000 |
| `concurrentTasks` | 1 | 3 | 10 |
| `aiWriteMonthly` | 200 | **-1** | 12000 |
| `videoMonthly` | 0 | **300** | 3000 |
| `scheduleBatch`（定时批量） | ❌ | ✅ | ✅ |
| `dashboard` | `basic` | `full` | `full` |
| `officialCreditMonthly`（官方积分） | 30 | 1600 | 2200 |
| `rank`（档位序，v2.2） | 0 | 1 | 2 |
| `maxDevices`（登录设备，v2.2） | 2 | 3 | -1 |
| `maxCloudAccounts`（云同步账号，v2.2） | 0 | 20 | -1 |
| `batchSizePerRun`（单次批量条数，v2.2） | 1 | 10 | -1 |
| `modelTier`（模型分层，v2.2） | 0 | 1 | 2 |

**派生 features（v2.2 新增三条，消除「standard 与 pro 完全一样」）**：
`cloud_account_sync`（`maxCloudAccounts !== 0`）、`batch_publish`（`batchSizePerRun !== 1`）、
`tier_access_standard` / `tier_access_pro`（`modelTier >= 1 / >= 2`）。

**`maxCloudAccounts: 0` 是「本档不提供」不是「不限」**（与 `-1` 严格区分）；免费档只允许本地绑定账号。

**两处 `-1` 语义不同，别对外混用：**

- `pro.maxPlatforms: -1` —— 真的不限平台。
- `standard.aiWriteMonthly: -1` —— **前提是用户走自有模型 Key**；
  用官方积分仍受 `officialCreditMonthly: 1600` 约束。
  销售话术必须带上这个前提，否则是超卖承诺。
- `pro.dailyPublish` **不是不限**，是 1000。代码注释写明「用有限高值而非 -1，
  避免下游除零 / 无限逻辑」。**别说「专业版无限发布」。**

## 3. 平台口径

平台总数 **15**，来源 `packages/shared-utils/src/publish-capabilities.json`：

```
wechat_mp  zhihu  weibo  douyin  xiaohongshu  tencent_video
kuaishou   toutiao  bilibili  baijiahao
youtube    tiktok  twitter  instagram  facebook
```

注册表同时记录每个平台的 `titleMode`（`title` / `caption`）与内容长度限制，
是内容改写的权威依据（无标题平台须把标题并入描述首行）。

## 4. 支付

`apps/desktop/electron/services/payment-manager.js:23`

```js
const PAYMENT_METHODS = ['alipay', 'wechat']
```

**已实现：支付宝、微信支付。**
**未实现：Stripe / 海外支付。** v1.0 写的「Stripe（海外，后续）」至今没有代码，
海外用户目前**无法自助付费**——这是商业化上比定价更靠前的阻塞项。

## 5. 转化路径（设计意图，非已实现）

```
免费体验 → 触达平台数/日发布上限 → 升级弹窗 → 付费订阅
```

**触发点应挂在这些常量上**（与代码对齐）：

| 触发条件 | 对应常量 |
|---|---|
| 第 6 个平台被选中 | `free.maxPlatforms: 5` |
| 当日第 6 篇 | `free.dailyPublish: 5` |
| 点击「定时批量」 | `free.scheduleBatch: false` |

> ⚠️ **7 天 Pro 试用：代码中无实现。** v1.0 写的「首次使用后 72h 弹窗 7 天免费试用」
> 在 `packages/api-publish-engine/` 下检索不到 `trial` 相关实现。
> 属未落地设计，**不得对客户承诺试用**。

## 6. 与 v1.0 的差异

| 项 | v1.0 | v2.0（代码事实） |
|---|---|---|
| 平台数 | 10 | **15** |
| 档位命名 | 免费 / Pro / 企业 | **免费 / 标准 / 专业** |
| 第二档价格 | Pro ¥39 月 / ¥299 年 | **标准版 ¥59 月 / ¥499 年**（2026-10-08 再改） |
| 第三档 | 企业版 ¥199 月 | **专业版 ¥119 月 / ¥999 年**（2026-10-20 起；此前 ¥79/¥699）；企业版不存在 |
| 免费版平台 | 3 | **5** |
| Stripe | 写「后续」 | 确认**无实现** |
| 7 天试用 | 写「72h 弹窗」 | 确认**无实现** |
| 冷启动 ¥99 终身锁定 | 前 200 名 | **已取消**（2026-10-07 决策，不再采用） |
| 兑换码 | 写「早期用户赠送」 | 随冷启动政策一并取消 |

> v1.0 的年付折扣测算（¥299 vs ¥468 月付 = 37%）已随价格变更失效。
> **2026-10-20 现行**：标准版 ¥499/年 vs ¥59×12 = ¥708，折扣 **29.5%**；
> 专业版 ¥999/年 vs ¥119×12 = ¥1428，折扣 **30.0%**（与标准版对齐）。
> **年付积分恒为月付 × 12**（标准版 19200 / 专业版 26400）——
> `officialCreditMonthly` 是唯一额度字段，不设年付专用字段，年付按月等额发放即自动满足。
> 成本占比（按积分成本 ¥16 / ¥22）：标准版月付 **27.1%**；专业版月付 **18.5%**
> （涨价部分是功能价，积分成本不变，毛利为正）。

## 7. 改价流程

**顺序不能反：先改代码，再回写本文档与 marketing 组。**

1. 改 `plan-matrix.js` 的 `BASE_MATRIX`（含 `PLAN_MATRIX_VERSION`）
2. 跑 `packages/api-publish-engine` 相关测试，确认 `NUMERIC_KEYS` 覆盖完整
3. 回写本文档
4. 回写 `01-docs/marketing/` 全组（`README.md` / `01` / `02` / `03` / `04`）
5. 核对 `apps/desktop/` 侧栏等 UI 文案里的价格字面量

> 2026-10-07 之前定价口径漂移了至少两个版本，根因是**文档引 `pricing-strategy.md`
> 而代码才是真源**。本文档 §0 与 marketing `README.md` 第 3 条纪律都点名了这一点。

## 8. 关键指标（目标值）

| 指标 | 目标 | 当前可度量性 |
|---|---|---|
| 免费 → 标准版转化率 | > 8% | ❌ **不可度量** |
| 月流失率 | < 5% | ❌ **不可度量** |
| 标准版用户 LTV | > ¥600 | ❌ **不可度量** |
| CAC | < ¥50 | ❌ **不可度量** |
| 付费用户数（3 个月） | > 200 | ❌ **不可度量** |

> 🚨 **本页所有指标目前都无法度量。** `PRD-PUBLISH-METRICS` 记录**本机 0 行数据**，
> `ops-center` 的 `ModelUsageDaily` 表成本数据同样全零。
> **上面五个数字是目标，不是现状。** 不要拿去做对外承诺或内部决策依据，
> 直到发布链路埋点真正跑通。

## 9. 竞品对比（⚠️ 未复核）

v1.0 记的「参考产品 ¥49/月、Newrank ¥299/月」**未在本次修订中复核**，
且这些数字没有出处记录。**按 marketing `README.md` 第 3 条纪律
（「数字必须有出处」），在找到可引用来源前不得对外使用。**
