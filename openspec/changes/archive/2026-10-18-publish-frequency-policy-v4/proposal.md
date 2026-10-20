---
change: publish-frequency-policy-v4
status: in-progress
created: 2026-10-15
branch: publish-frequency-v4
---

# publish-frequency-policy-v4 — 平台间隔三档统一 1′、日配额 200/350/500

## 背景

v3（PR #3637）把账号档收到 5′/3′/1′、日配额抬到 30/50/200，并把平台档做成"按档分级"3′/2′/1′。
上线后暴露两件事：

1. **平台档分级在单号场景永不生效**（`accountMinMs ≥ platformMinMs` 恒成立），它只在"同平台不同账号"
   时起作用；而用户在设置页要面对三个不同的平台间隔值，却无法用任何本地指标判断该填哪个。
2. **日配额成为真实约束**：长文档 30 条/日在多号矩阵运营下先撞墙，撞墙后系统只是"排队到次日"，
   用户体感是"发不出去且没有明确原因"。

用户口径：间隔可再缩短；日配额"最低 200、最高给到 500"；平台间隔不必分级**但要留着**。

## 变更内容

- `platformMinMs`：3′/2′/1′ → **三档统一 1′**（分级撤掉、机制保留）。
- `accountDailyMax`：30/50/200 → **200/350/500**（档间单调保持；350 为推导的中间值）。
- `BASELINE_INTERVALS`（未登记平台回落）：5′/3′/30 → **5′/1′/200**，仍是独立常量。
- 账号档间隔、抖动比例、退避下界、紧急放行额度、D1 判据、回滚硬顶公式：**一字未动**。
- 用户可见文案：`platformIntervalHint`（zh/en 成对）里"默认各档账号档**更**严"在 v4 起不成立
  （短内容档相等），改为"都不低于本值（短内容档两者相等）"。

## 明确不做

- **不删平台桶**。它是全仓唯一防"同一台机器 / 同一出口 IP 下多号被平台侧关联成矩阵号"的闸，
  而那种后果在本地无任何可观测信号（无回调、无错误码，只表现为数日后掉登录）。这条决定做成锁：
  变异 N6（三档平台间隔归 0）必须变红。
- 不拆 `clip` 档（短视频 vs 图文社区）；不收编 `full-auto-pipeline` 旁路；不实现平台级日配额
  （`PLATFORM_BUCKET_DAILY_KEY_PREFIX` 仍零引用）；不把 `getProbeCounts` / `clearRollbackDisabled`
  接出来；不重标定 `maxConcurrent=3` / `timeout=180s`。以上全部登记为欠账（PRD §8、§12）。

## 影响面

- `packages/shared-utils/src/publish-frequency-policy.js`（数值 + 头注释）——唯一数值落点。
- 测试：`publish-frequency-policy.test.js`（精确表 / 档间单调形状 / 数据表 / env 回落）、
  `publish-interval-guard.test.js`（`_intervals` 形状 + 新增"三档真实配额下回滚许可恒为封顶"行为锁）、
  `container.setup.test.js`（读真实策略的装配锁）、`PublishFrequencySettings.test.js`（夹具同形 + 文案锁）。
- 文案：`apps/desktop/src/locales/settings/{zh,en}.js`（成对，Gate 7）。
- 主干规格 `openspec/specs/publish-frequency-control/spec.md` **不需要改**：它是数值无关的
  （只写"两档间隔 + 回落最严档 + 取更严者"），v4 的两个改动都不与任何 MUST 冲突。
  （v3 曾必须改主干，是因为那句 MUST 与 v2 实现相互矛盾；这次没有这种情况。）
