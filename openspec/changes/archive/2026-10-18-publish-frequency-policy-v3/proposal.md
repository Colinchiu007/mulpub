---
change: publish-frequency-policy-v3
status: in-progress
created: 2026-10-15
branch: publish-frequency-policy-v3
---

# publish-frequency-policy-v3 — 间隔再下调一档、日配额 ×10、超时竞态不再释放窗口

## 背景

v2（PR #3253 调查 → 实施）把发布频率做成三维度模型（账号档 / 平台档 / 日配额）并引入
"未提交失败免等重试"。运行一轮后暴露两类问题：

| # | 问题 | 证据 |
|---|---|---|
| 1 | **排队成本由用户承担**：长文 20′、短视频 10′ 的账号档把同一账号的连续运营压成每小时 ≤3 条，日配额 3/5/20 条进一步封顶 | 2026-10-08 真实历史标定：douyin 71% / xiaohongshu 67% / zhihu 67% / toutiao 62% 的提交会被账号档拦下（`openspec/records/publish-frequency-control.md`）；用户明确要求"间隔都可以再缩短、日配额增大 10 倍" |
| 2 | **D1：超时竞态会释放窗口** | `task-queue.js` 的 `Promise.race` 被超时判输时执行器仍在飞，而 `markSubmitAttempted` 按 `_running.get(taskId)` 查任务、`finally` 已删该键 ⇒ 迟到的打点永久落空，"仍在飞"被读成"从未发起" ⇒ `release()` 还原窗口 ⇒ 重复发布且下一次不受限。变异 M1 实测：摘掉新判据后"同窗口的第二条任务"用例里第二条**真的被执行了** |
| 3 | **回滚许可与日配额绑死** | `_rollbackCap = max(2, dailyMax)`；日配额 ×10 会让短内容档的"每日可回滚次数"从 20 涨到 200，防重试风暴的闸变成配额的函数 |
| 4 | **退避等待中的任务对观测面不可见** | `_delayRequeue` 只登记 `setTimeout`，不登记 `_delayed` ⇒ 整个 grace 期（默认 60s）内 `getStatus()/getPendingTasks()/serialize()` 都看不到它，重启即静默丢失（实测 D1 时撞出） |
| 5 | **平台档"统一 2′"与档间差异脱钩** | v2 把平台档压成单值，导致长文平台的跨账号节奏与短内容相同；且 15 行手抄同值，改漏一行无人可见 |

## 目标

1. **G1** 账号档下调到 5′/3′/1′，平台档按档分级 3′/2′/1′，日配额 30/50/200；数值落点收敛为
   `TIER_PRESETS` + `PLATFORM_TIER` 两处，平台表派生，消除 15 份手抄。
2. **G2** D1：race 被超时/中止判输而执行器尚未收敛时，MUST NOT 回滚频控窗口，且该任务
   **终身**不再回滚（`submitUncertain`），并有可归因探针计数。
3. **G3** 回滚许可取 `min(max(2, dailyMax), MAX_ROLLBACK_PER_DAY=5)`，与日配额解耦。
4. **G4** 退避等待中的任务必须仍可观测、可持久化、可取消（登记进 `_delayed` 并 `_saveState()`）。
5. **G5** 放松的**反向能力**不得被顺手锁死：免等重试（确证未送出 / 从未发起）必须照常生效，
   由四条正向对偶 + 两条不变量锁钉住。

## 非目标（并说明为什么不做）

- 跨平台全局串行 —— 会废掉"一键发多平台"。
- 平台级日配额（`platform-daily`）、`clearRollbackDisabled` 的 UI 入口、`getProbeCounts` 的消费面、
  `prunePublishDailyCount` 接线、`full-auto-pipeline` 绕过队列与守卫的旁路收敛、
  `maxConcurrent` / `task.timeout` 重新标定、`submitUncertain` 跨重启持久化 ——
  全部登记在 PRD §10，逐条给了理由与判据来源。
- 第四档（把短视频与图文社区拆开）—— 会连带 `resolvePolicyOverrides` 的 `dailyMax` 闭集与设置页三个
  输入框；本次按 PRD §4 如实写明"clip 档不精确"而不下探。

## 风险

更短间隔 = 更高平台风控命中概率，而本工具**没有**平台风控命率的观测面（`riskSuspender` 只事后即停、
不回写频率侧）。日配额 ×10 后"今天到此为止"在数值上几乎不再是约束。重测/收紧触发条件写死在
PRD §13。
