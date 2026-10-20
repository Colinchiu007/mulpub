---
change: publish-frequency-policy-v2
status: in-progress
created: 2026-10-10
branch: publish-frequency-policy-v2
---

# publish-frequency-policy-v2 — 发布频率策略 v2（记账语义 / 日配额 / 抖动）

## 背景

上游调查报告 `01-docs/INVESTIGATE-PUBLISH-FREQUENCY-STRICTNESS-2026-10-10.md`（PR #3253）对现行发布频率门禁（`publish-frequency-control`，PR #2773）给出四条判定：

| # | 问题 | 证据 |
|---|---|---|
| 1 | **失败惩罚过重**：未提交到平台的失败也吃掉整个间隔窗口 | 本机真实历史中 bilibili 连续 3 次失败间隔恰为 120.0 / 30.0 分钟；`task-queue.js:587-597` 自动重试与 `:240-262` 手动重试同走守卫 |
| 2 | **刻度无依据且维度选错**：只有最小间隔、没有日配额 | 公开资料唯一有依据的维度是「条/天」（微信订阅号 1 条/天；微博发博 30 次/小时·100 次/天） |
| 3 | **零抖动**：发布点落在精确的 30.0 / 60.0 分钟整数边界 | 守卫与队列内 `Math.random` 命中数 0；微博官方口径是「非用户主动行为频繁调用（即使未超过频次限制）」也会被封 |
| 4 | **跨账号平台档无依据且实测空转** | `backend-data/accounts.json` 每平台恰好 1 账号 ⇒ 该档恒被更严的账号档支配 |

报告给出的 P0/P1/P2 建议**全部未实施**；本变更把它们落地。

## 目标

1. **G1** 未提交到平台的失败不再惩罚间隔窗口，且该判定**不可被获益方伪造**。
2. **G2** 补上唯一有公开依据的维度：账号级**日配额**。
3. **G3** 发布节奏不再呈现机器级等周期（引入只增不减的抖动）。
4. **G4** 数值下调到「仍远保守于官方速率」的量级，并把跨账号平台档调到有依据且成本可接受的位置。
5. **G5** 渲染层口径与运行期门禁统一，用户可查、可覆盖、可在必要时一次性紧急放行。

## 非目标

- 不做设备/IP 级全局串行（沿用上游 PRD §2 非目标）。
- 不做「成功才记账」（会引入重复发布，调查报告 §6.C 已否决）。
- 不声称符合任何平台官方规定（沿用上游 PRD §2 非目标）。
- 不做跨环境审计溯源（需新增出网通道，爆炸半径大于被保护对象）。
- 不做跨设备配额同步。

## 范围

| ID | 内容 | 承载模块 |
|---|---|---|
| P0-1 | 记账语义细分：未提交失败回滚窗口 | `shared-utils` + 桌面装配 |
| P0-2 | 重试（自动/手动）放行路径 | `shared-utils` |
| P1-1 | 跨账号平台档：默认开 2 分钟，仅显式 0 关闭 | `shared-utils` |
| P1-2 | 账号级日配额（新维度） | `shared-utils` + store + 装配 |
| P1-3 | 间隔抖动（可注入随机源） | `shared-utils` |
| P2-1 | 数值下调 60→20 / 30→10 / 10→3 分钟 | `shared-utils` |
| P2-2 | 渲染层口径统一 + 设置页策略区块 + 一次性紧急放行 | 渲染层 + IPC + locale |
| P2-3 | 未登记平台回落时出声告警 | `shared-utils` |
| P2-4 | 校准基础设施（口径定义 + 可复现取数脚本） | `scripts/` |
| P2-5（部分） | `config/platforms.yaml` 的 `tencent_video` 命名歧义澄清注释 | `config/` |

**P2-5 的另一半（`publish:wechat` 补任务级 `accountId`）移出本变更**：已审计渲染层零生产调用方（`src/api/publisher.js:8` 仅被测试引用），改动面与收益不成比例，另立变更处理。

## 与上游决策的关系（显式偏离声明）

| 上游结论 | 本变更 | 理由 |
|---|---|---|
| P1-1「跨账号平台档**默认关**」 | **改为默认开 2 分钟**（仅显式 `0` 关闭） | 跨家族对抗评审两轮均指出「默认关削弱同平台多账号保护」；成本有界（1 账号/平台时完全惰性），保留唯一一条设备/IP 邻域保护。**这是一处对调查报告的显式偏离**，已在 design §7 与 PRD 写明 |
| 日配额数值「须先由运营确认」 | 落地为 3 / 5 / 20 的**工程保守起点**，env 与设置页双覆盖 | 不让机制停在未实现；默认值随 PRD 与设置页显式标注「待运营确认」 |

## 影响面

- `packages/shared-utils/src/publish-frequency-policy.js`、`publish-interval-guard.js`、`task-queue.js`
- `apps/desktop/electron/services/store-schema.js`、`store/` mixin、`core/container.setup.js`、`ipc-handlers/publish.js`、`bootstrap/phase4-events.js`
- `apps/desktop/src/locales/publish-page/{zh,en}.js`、`settings/{zh,en}.js`、`components/PublishProgress*`、设置页
- `scripts/`（新增校准脚本）、`config/platforms.yaml`（注释）

## 验收

见 `specs/publish-frequency-policy-v2/spec.md` 的 Scenario，以及 `tasks.md` 的 7.1–7.4 全量门禁与变异反证清单。
