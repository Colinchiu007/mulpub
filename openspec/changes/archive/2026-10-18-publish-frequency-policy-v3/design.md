# Design: publish-frequency-policy-v3

## 决策清单

| # | 决策 | 理由 | 被否决的替代方案 |
|---|---|---|---|
| D1 | **数值改一处、平台表派生**（`TIER_PRESETS` + `PLATFORM_TIER` → `PLATFORM_FREQUENCY_POLICY`） | v2 是 15 行手抄同值；改漏一行的表现是"某平台莫名比别人严/松"，而表读起来每行都对。派生后"改一档=改三行"不可能发生 | 继续逐平台字面量（保持 diff 最小）——被否：那正是缺陷 5 的成因 |
| D2 | **`BASELINE_INTERVALS` 保持独立常量，不从预设派生** | 回落必须是"人为想清楚过的最严值"；派生会让"调 long 档"静默改变未登记平台的实质 | 派生自 long 档（少一处手写）——被否：v2 已为此写过专门注释 |
| D3 | **D1 修在判据方向，不修打点管道** | 决策发生在 race 结束那一刻；即使把 `markSubmitAttempted` 改成不依赖 `_running`，"仍在飞、还没打点"这一状态在读判据时**依然成立**，改管道救不了它。真正的信息是"执行器是否已收敛"，队列本来就知道 | 把打点存进 `Map` 让迟到打点落空前生效——被否：那是在赌"迟到打点总在读判据之前到"，且引入一个需要清理策略的进程级状态 |
| D4 | **`submitUncertain` 终身不复位（按任务而非按轮）** | 重试轮会覆盖 `task._hold`；若第二轮允许回滚，还原的是"第一轮仍在飞那次提交之前"的窗口，比不回滚更糟 | 每轮复位——被否：制造"回滚到错误前值"的新故障 |
| D5 | **在飞未知的计数与告警只发生一次/任务** | 与 `_disableRollbackForPlatform` 不同，这不是平台级降级，无需进程级停闸；反复 warn 会淹掉日志 | 沿用 `_rollbackDisabledPlatforms`——被否：会把 P0-1 的免等重试能力整平台关掉（v2 的有损缓解正是本次要替换的东西） |
| D6 | **回滚许可封顶取独立常量 5，不随 tier 变** | 该闸防的是"接线错误导致每轮都回滚"，与运营量级无关；`min` 的方向恒为收紧（long/clip 档数值不变，short 档 20→5） | 保持 `max(2, dailyMax)`——被否：与日配额 ×10 直接冲突 |
| D7 | **退避等待登记进既有 `_delayed`，不新造承载结构** | `_delayed` 是 2026-10-06 为"频控等待中的任务"定的唯一承载处（`serialize` / `getStatus` / `cancel` / `emergencyRelease` 都已按它实现）；新造一份会让四个消费点各改一遍并必然漂移 | 只在 `_pendingTimers` 里留句柄（现状）——被否：即缺陷 4 |
| D8 | **平台档按档分级，但保留 `platformMinMs ≤ accountMinMs` 不变量** | 分级后才谈得上"长文平台跨账号也要更稳"；不变量是"同账号由账号档决定"这一语义成立的前提，破坏它会让平台档反过来支配账号档 | 平台档继续统一 2′（改动更小）——被否：与用户"这些都可以再缩短"的意图不对齐，短内容档会被平台档卡回 2′ |

## 时序（v3 改动点加粗）

```
add → _processNext(三道闸) → _executeTask
  ├ guard.check ── 不放行 → publish:blocked → _delayed + timer（同 v2）
  ├ guard.recordPublish → task._hold（提交前，同 v2）
  ├ **executorPromise = _runTask(...) 包一层 settled 标记（构造于 try 之前，且就是被 race 的那个）**
  ├ race([executorPromise, timeout, abort])
  ├ 成功 → I4 自证（同 v2）
  └ 失败 → _maybeRollback(task, e, **{inFlightAtFailure: !executorSettled}**)
             ├ **在飞未知 → submitUncertain=true → inflightUnknown++ → warn 一次 → return false**
             ├ **submitUncertain 已置位 → return false**
             ├ 佐证位矛盾 → fail-closed（同 v2）
             ├ 接线探针（同 v2）
             └ 回滚成功 → _delayRequeue(graceMs) → **登记 _delayed + _saveState()**
```

## 兼容与迁移

- 无存储迁移：`publish_timeline` / `publish_daily_count` 的键与形状不变，只有**数值**变小/变大。
  旧窗口记录在升级后仍按旧时间戳生效一次（最多比新策略多等 20′/10′/3′），方向是"多等"，可接受。
- 无 API 迁移：`_maybeRollback` 的第三参数可选，缺省即"不告知在飞" ⇒ 现有调用点行为不变。
- 回退：设置页或环境变量把两档与三档配额填回 v2 值即可，无需回滚代码（唯一表达不出的是
  "按档分级的平台档"，因为覆盖通道是全局单值）。
