# PRD — 发布频率策略 v3（数值再下调一档 + 日配额 ×10 + 超时竞态不再释放窗口）

- change: `publish-frequency-policy-v3`
- branch: `publish-frequency-policy-v3`（worktree `D:/Data/projects/mp-worktrees/mp-publish-frequency-policy-v3`）
- 日期: 2026-10-15
- 基线: `b7a0b34d1`（开工时 `origin/main`）
- 上一版: `01-docs/PRD-PUBLISH-FREQUENCY-POLICY-V2-2026-10-10.md`（v2，PR #3253 调查报告 → 实施）
- 规格载体: `openspec/specs/publish-frequency-control/spec.md`（主干规格）+
  `openspec/changes/publish-frequency-policy-v3/`（本次变更工件）

---

## 1. 结论摘要

1. 三档**账号档**由 20′/10′/3′ 下调到 **5′/3′/1′**；**平台档**由"统一 2′"改为**按档分级 3′/2′/1′**；
   **日配额**由 3/5/20 条提升到 **30/50/200 条**（用户要求的 10 倍）。
2. 放松必然带来的两处 fail-closed 同批落地：**D1**（超时/中止竞态输掉时禁止回滚频控窗口）
   与**回滚许可封顶**（`MAX_ROLLBACK_PER_DAY = 5`，不随日配额放大）。二者不是可选优化项：
   间隔收到 1–5 分钟后 D1 的触发窗口提前了一个量级；而回滚上限的公式若继续只由 `dailyMax`
   推导，"每日可回滚次数"会跟着 ×10。
3. 数值仍然**只是工程保守默认**，本工具不声称符合任何平台的官方频次规则（§13 自认弱点）。

---

## 2. 现行机制全景（v2，改造前）

```
调用方（Publish.vue / 排期 / 批处理 / 全自动化流水线）
      │ queue.add({platform, article, accountId, retry, timeout})
      ▼
TaskQueue.add → _add                          task-queue.js:169
  · accountId 归一：task.accountId ?? article.accountId ?? null（:183）
  · retry ?? defaultRetry；timeout ?? defaultTimeout(180s)
      ▼
_processNext                                  task-queue.js:483
  · 三道闸：owner 归属 → 日配额被拒集合 _quotaBlocked → **通道占用**（platform:accountId）
  · 同通道串行，跨通道并行吃满 maxConcurrent（默认 3，env 可覆盖 [1,10]）
      ▼
_executeTask                                  task-queue.js:519
  · guard.check(platform, accountId)          publish-interval-guard.js:283
      ├─ ① daily 桶（独立否决项，先判）→ bucket:'daily'，remainingMs 恒 0
      └─ ② account 桶 vs platform 桶 **取更严**，结果过 _jitter（只增不减，ratio 默认 0.4）
  · 不放行 → emit publish:blocked → setTimeout(waitMs) → _delayed 登记 → _saveState
             日配额命中时另加 _quotaBlocked，等待时长 = msUntilNextDay()（次日 00:00:05）
  · 放行   → **提交前**记账 recordPublish()（乐观记账，两档同时占位 + 日计数 +1）
             返回值存进 task._hold，供 release() 精确还原
      ▼
Promise.race([执行器, 超时, 中止])             task-queue.js:610-616
  · 执行器（bootstrap.js:101）在真正发出平台请求处打两点：
      markSubmitAttempted(taskId) / markSubmitted(taskId)   task-queue-frequency.js:27,39
      （都按 this._running.get(taskId) 查任务）
      ▼
失败 → _maybeRollback(task, e)                task-queue-frequency.js
  · rollbackable = (!submitAttempted) || e.definitelyNotSent
  · 佐证位与阶段判据矛盾 → fail-closed（按已提交处理）
  · 接线探针：已证明会打点的平台出现"未打点且未确证未送出"的失败 → 该平台进程内停用回滚
  · 回滚成功 → _delayRequeue(task, releaseGraceMs≥10s)；否则任务直接回队列
```

**为什么记账在提交之前**（不可回退的设计）：平台侧限流窗口按"请求已发生"计时。若只在成功路径
记账，"内容已发到平台但应用判超时/报错"就不占窗口，重试会重复发布且下一次不受限。

---

## 3. 为什么现在改（依据与局限）

| 依据 | 内容 |
|---|---|
| 运营诉求 | 用户明确提出：间隔"都可以再缩短"，日配额按 10 倍放开 |
| 真实历史标定 | 2026-10-08 用 `shared-user-data/publish-history.jsonl` 的真实提交终态 87 条（剔除 13 条预检跳过）标定：douyin 71% / xiaohongshu 67% / zhihu 67% / toutiao 62% / kuaishou 43% 会被**当时**的账号档拦下；本机每平台恰 1 账号 ⇒ 逐平台间隔 == 逐账号间隔，拦下比例是精确值 |
| 当时的结论 | 保持 v2 数值（样本全部来自门禁上线之前，反推平台阈值是循环论证） |
| 现在的判断 | 用户是运营方，排队成本由其承担；v3 把"宁慢不险"改为"接近但保留 fail-closed"，并用 §5 的两处闸门把放松的**风险面**收在可接受方向 |

**局限（如实声明）**：上表的"拦下比例"衡量的是**用户被自己工具挡住的比例**，不是平台风控命中率。
本文件与代码都不声称 5′/3′/1′ 对应任何平台官方阈值。

---

## 4. v3 数值表（单一真源：`packages/shared-utils/src/publish-frequency-policy.js`）

| tier | 平台 | 账号档 `accountMinMs` | 平台档 `platformMinMs` | 日配额 `accountDailyMax` |
|---|---|---|---|---|
| `long` 长文 | wechat_mp, zhihu, baijiahao, toutiao | **5′**（v2 20′） | **3′**（v2 2′） | **30**（v2 3） |
| `clip` 短视频 / 图文社区 | douyin, kuaishou, tencent_video, xiaohongshu, bilibili, youtube, tiktok, instagram, facebook | **3′**（v2 10′） | **2′**（v2 2′） | **50**（v2 5） |
| `short` 短内容 | weibo, twitter | **1′**（v2 3′） | **1′**（v2 2′） | **200**（v2 20） |
| 未登记平台（回落基线） | 任何不在表内的 platform | **5′** | **3′** | **30** |

结构性约束（由回归锁钉住，不是注释）：

1. `platformMinMs ≤ accountMinMs` 逐平台成立 —— 这正是"同账号时由账号档决定、跨账号时由平台档兜底"
   得以成立的前提。主干规格把它写成 MUST。
2. **档间单调**：账号档 `long > clip > short`（严格大于）；平台档 `long ≥ clip ≥ short`。
3. 抖动仍为 `ratio = 0.4`（只增不减 ⇒ 上表是**下界**，实际等待 ∈ [值, 值 × 1.4]）。
4. 间隔源上界仍是 7 天（`MAX_INTERVAL_MS`），防含抖动后逼近 `setTimeout` 的 2^31−1。
5. 未登记平台的回落值**故意不从档位预设派生**：`BASELINE_INTERVALS` 是独立常量，
   调 `long` 档不得静默改变回落实质。
6. 数值落点收敛为 `TIER_PRESETS`（一处）+ `PLATFORM_TIER`（分组），平台表由二者派生 ——
   v2 是 15 行手抄同值，改漏一行的表现是"某平台莫名比别人严/松"。

### 关于「没有针对短视频内容吗？」

有。`clip` 档就是短视频档（抖音/快手/视频号/TikTok/YouTube/Instagram/Facebook/Bilibili），
v3 给它的账号档是 3′。需要点名的**不精确之处**：`tier` 复用 v2 的既有分组（当初为日配额引入，
刻意不新增第四套分类器），所以 `clip` 里同时装着**竖屏短视频**（douyin/kuaishou/tencent_video/…）
与**图文社区**（xiaohongshu）与**横站长视频**（youtube/bilibili）。三者的平台节奏并不相同，
但共用 3′/2′/50。把它们拆开需要第四档，会连带改 `resolvePolicyOverrides` 的 `dailyMax` 枚举
（`[long, clip, short]` 是闭合集）与设置页三个日配额输入框 —— 本次**不做**，登记为 §10 的已知不精确。

---

## 5. 两处必须与"放松"同批的 fail-closed

### 5.1 D1：race 被超时/中止判输且执行器尚未收敛 ⇒ 禁止回滚窗口

**缺陷机理**（v2 起存在）：

- `_maybeRollback` 的阶段判据是 `!submitAttempted || e.definitelyNotSent`。
- `markSubmitAttempted` / `markSubmitted` 都按 `this._running.get(taskId)` 查任务，而 `finally`
  在失败处理之后就把任务从 `_running` 删除 ⇒ **超时之后到达的打点永久落空**。
- 于是"请求仍在飞、只是还没打点"被读成"从未发起写尝试" ⇒ `release()` 还原两档窗口与日配额
  ⇒ 同账号下一条任务立刻可发 ⇒ **重复发布**，且这一次提交不受任何限制。
- v2 的缓解是靠接线探针把"已证明会打点的平台"的整平台回滚关掉 —— 那是**有损**的：一次超时
  就让该平台在进程余下生命周期失去"免等重试"能力，且两个 Set 都只在内存里。

**v3 的修法**（判据方向，不是打点管道）：

```
race 结束后 executorSettled 仍为 false  ⇒  inFlightAtFailure = true
  → task.submitUncertain = true（**终身不复位**）
  → 探针计数 inflightUnknown += 1，console.warn 一次点名 platform + taskId
  → return false（窗口与日配额保持占用）
后续任何一轮该任务失败，即使带 definitelyNotSent=true 也不再回滚
```

为什么必须"终身"：重试轮的 `recordPublish()` 会覆盖 `task._hold`。若第二轮允许回滚，还原的是
"第一轮仍在飞的那次提交**之前**"的窗口 —— 比不回滚更糟。

为什么仍然要保留正向回滚：免等重试（登录失效、媒体缺失、风控前置校验）是 v2 P0-1 的全部收益，
把它写成"永不回滚"就是撤销该能力。四条正向对偶（§11）专门守这个方向。

**残留风险（不假装已闭合）**：窗口保持占用只保证"同通道下一条不会早于窗口发出"。若平台侧处理
时间本身超过 `task.timeout`（默认 180s），窗口（1–5′）到点后重试**仍可能重复发布**。彻底的解法
是"迟到成功要把已排定的重试撤下"，那需要任务级状态机与迟到结果归属，登记为 §10 的后续项。

### 5.2 回滚许可封顶：`_rollbackCap = min(max(2, dailyMax), 5)`

日配额回答"今天最多发几条"，回滚许可回答"今天最多允许几次把已占的窗口退回去"。
v2 用 `max(2, dailyMax)` 把两者绑死；日配额 ×10 后若不动，短内容档的每日回滚许可会从 20 涨到 200，
等于把**防重试风暴的闸**写成**配额的函数**。v3 加独立常量 `MAX_ROLLBACK_PER_DAY = 5`
（由 `PublishIntervalGuard.MAX_ROLLBACK_PER_DAY` 导出，禁止在调用方另抄）。

方向核对（**QM-6 前端轴 W4 纠正了我最初写的"long/clip 不变"**——那是算错的）：
v2 许可数 = `max(2, dailyMax)` = 长 3 / 中 5 / 短 20；v3 = `min(max(2, dailyMax), 5)` = **5 / 5 / 5**。
所以净效果是 **clip 持平、short 由 20 收紧到 5、long 由 3 放宽到 5**（不是"都不变"）。
放宽 long 是可接受的：v2 那个 3 不是独立量出来的许可额度，它只是**日配额的影子**；
本次把两者解耦后，统一给一个"与运营量级无关的小常数"，比继续让 long 因配额小而只能纠错两次更一致。
若产品认为长文档也该只有 3 次，改法是给 `_rollbackCap` 按 tier 取值，而不是回到 `max(2, dailyMax)`。

---

## 6. 数据校验（数值进入系统的每一道）

| 入口 | 合法域 | 非法值行为 | 0 的语义 |
|---|---|---|---|
| `MP_PUBLISH_MIN_INTERVAL_MS`（账号档） | `≥0` 的有限数，上界 7 天 | 回落策略表 + **出声** | 该档显式关闭 |
| `MP_PUBLISH_PLATFORM_MIN_INTERVAL_MS`（平台档） | 同上 | 同上 | 同上 |
| `MP_PUBLISH_DAILY_MAX_LONG/CLIP/SHORT` | `≥0` 整数 | 回落本档默认 + 出声 | 该档配额关闭 |
| `MP_PUBLISH_ACCOUNT_DAILY_MAX` | `≥0` 整数 | 回落 + 出声 | 关闭；**优先于三档** |
| `MP_PUBLISH_JITTER_RATIO` | `[0,1)` 有限数 | 回落 0.4 + 出声 | 关闭抖动（严格退化为 v1 行为） |
| `MP_PUBLISH_RELEASE_GRACE_MS` | `≥10000` 整数 | 回落 60s + 出声 | 低于下界钳到 10s（防"回滚即零等待"） |
| `MP_PUBLISH_EMERGENCY_MAX_PER_DAY` | `[0,10]` 整数 | 回落 1 + 出声；超上界**钳位**并出声 | 关闭紧急放行入口 |
| 设置页覆盖 `settings.publishFrequencyPolicy` | 见下 | **全有或全无**：任一字段非法 ⇒ 整个覆盖对象作废（返回 null）并出声 | 各字段同 env |
| `MP_QUEUE_MAX_CONCURRENT` | `[1,10]` 整数 | 回落默认 3 + 出声 | — |

设置页覆盖的额外判据：非对象/数组 ⇒ 丢弃；`dailyMax` 必须是 `{long?,clip?,short?}`；
`releaseGraceMs < 10000` ⇒ 整体作废（与 env 的"钳位"故意不同：env 是运维排障通道，
设置页是用户意图，半生效态会让"我改了 A 却影响了 B"变成不可解释的行为）；未知字段忽略（前向兼容）。
空白值一律回落并出声 —— **静默当 0 等于把配置写错变成关掉门禁**。

本次**未新增任何校验分支**，只改了被校验数值本身的默认值；表中的行为全部有既有回归锁覆盖
（`publish-frequency-policy.test.js` 32 例）。

---

## 7. 流程与功能逻辑（v3 的改动点标注）

1. **入队**：不变。`accountId` 归一、`timeout`、`retry` 同 v2。
2. **通道调度**：不变（`platform:accountId` 串行、跨通道并行）。
3. **频控检查**：三桶顺序与语义不变；只有**数值**换了。`bucket` 与 `daily` 字段继续随
   `publish:blocked` 一起发出（v2 的 QM-6 Warning 修复）。
4. **提交前记账**：不变（乐观记账，两档 + 日计数）。
5. **race**：新增 `executorSettled` 观测（`executorPromise` 必须在 try **之前**构造、
   并就是被 race 的那一个 —— 变异 M9 实测证明：把裸 `this._runTask(...)` 塞回 race 会让执行器
   跑两遍，红的是"第二条任务被执行了"而不是"标志位没设"）。
6. **成功**：不变，含 I4 自证（成功却 `submittedAt` 为空 ⇒ 判接线缺陷并停用该平台回滚）。
7. **失败**：`_maybeRollback(task, e, { inFlightAtFailure })` —— 新判据优先于一切旧判据。
   - 在飞未知 ⇒ 置 `submitUncertain`，占窗口，`lastAttemptNotSubmitted = false`，重试照常排期。
   - 否则按 v2 原判据（未发起 / 确证未送出），并保留矛盾 fail-closed 与接线探针。
8. **退避重排**：`_delayRequeue` 现在把任务**同时登记进 `_delayed`** 并 `_saveState()`。
   修的是实测 D1 时撞出来的另一条：此前任务只活在 `setTimeout` 闭包里，整个 grace 期
   （默认 60s）对 `getStatus()` / `getPendingTasks()` / `serialize()` 全部不可见 ⇒ 重启即静默丢失、
   UI"排队中"凭空少一条。`_delayed` 正是 2026-10-06 为"频控等待中的任务"定的承载处，两种等待同源。
9. **紧急放行 / 取消**：机制不变。取消路径本就早退、不回滚（v3 加了一条不变量锁固定这个方向）。

---

## 8. 交互逻辑与显示项

| 位置 | 显示内容 | v3 影响 |
|---|---|---|
| 设置 → 发布频率 → `pubfreq-current` | `currentTierText`：按"生效值签名"分组列出各 tier 及其覆盖的平台数 | 分组数不变，但**平台档现在按档不同**（3′/2′/1′），旧版三组同值 |
| 同上 | `effectiveRangeText`：当前生效区间 | 区间下界随 v3 收窄 |
| 发布进度面板（`PublishProgressTaskRow.vue`） | `publish:blocked` → `stageKey:'waiting'`，文案 `等待 N 分钟后重试`；日配额命中另有专门文案 | 等待量级变小（长文档标称 5′、含抖动最长 7′；v2 是 20′/28′）；**不新增相位**。取整口径本次由 `ceil` 改为 `round`（见 §9 的 W1 条）；注意这是**事件时刻的一次性快照**，不是逐秒递减的倒计时（`stores/publishProgress.js` 只在事件里赋值） |
| 设置 → 覆盖表单 | `accountMinutes` / `platformMinutes`（0..10080 分钟）、三档 `dailyMax*` | 未填 = 继续用各平台默认档；**`platformMinutes` 是全局单值**，一旦填写会把三档平台档抹平成同一个值（既有语义，v3 分级后更需要注意，见 §9 提示文字建议） |
| 设置 → 紧急放行 | 平台选择 + accountId + 确认 | 每日每账号上限仍为 1（`emergencyMaxPerDay` 未动） |
| 探针计数 `getProbeCounts()` | 含 `inflightUnknown`（v3 新增键） | **界面无消费者**（§10），只有 `console.warn` 与内存计数 |

## 9. 提示文字（本次改了 4 条，zh/en 成对）

首稿写的是「本次不改任何用户可见文案」——**那句已被 QM-6 前端轴否证**：有两处文案的内容是**数值陈述**，
数值一动就变成同屏自相矛盾的假话，不改等于交付一条已知的可见假陈述。实际改动：

| locale 键 | 旧文案的问题 | 新文案 |
|---|---|---|
| `settings.publishFrequency.dailyMaxPendingConfirm`（zh:42 / en:40） | 写死「默认值 **3 / 5 / 20**」，而同屏上方 `currentTierText` 显示的是 30/50/200 ⇒ 用户读到两个互相矛盾的数字 | 改为指回动态读数：「三档默认值见本页上方「当前档位」的第三项；它们是工程保守起点、不是平台官方规则，待运营确认。」 |
| `settings.publishFrequency.platformIntervalHint`（zh:36 / en:34） | 承诺「同账号时账号档**恒**更严，该值不改变结果」—— 守卫是两桶取更严，用户把这个值填得比账号档大时该承诺即被自己的输入打破 | 改为条件式：「同账号时取「账号档」与本值的**较严者**：默认各档账号档更严，本值不改变结果；但把它填得比账号档还大时，同账号也会被本值拦住。」 |

另两处显示面修复（不是文案，但同属"用户看到什么"）：

- **`_intervals()` 补 `tier`**：`ipc-handlers/publish-frequency.js` 把 `_intervals(p)` 原样转发给设置页，
  而 `currentTierText` 读 `v.tier` 拼 `tierSummary` ⇒ 修复前生产渲染结果是
  `undefined（4 个平台，如 wechat_mp）：5 min / 3 min / 30`。这是**先于本变更存在**的缺陷
  （v2 引入分组显示时就没回传 tier），之所以从未暴露：`PublishFrequencySettings.test.js` 的
  夹具**自行注入了生产不存在的 `tier`**（「契约夹具不得替对方补字段」的又一落点）。
  现在：实现补键 + 守卫侧 `_intervals` 形状锁 + 夹具退回该字段必红（变异 M16）。
- **等待分钟取整 `ceil → round`**：抖动让实际等待 ∈ [标称, ×1.4]，短档标称 1′ ⇒ 60–84s 一律被
  `ceil` 显示成「等待 2 分钟」，而 8 秒后任务就发出 —— 相对误差接近 100%（v2 下同样的绝对误差
  ≤59s 摊在 3–20 分钟上看不见）。主进程 `phase4-events.js` 与渲染层 `PublishProgressTaskRow.vue`
  两处同口径（跨主/渲染共用一份 helper 的代价大于收益，改为**两处各一条锁**：
  `phase4-events.test.js` + `PublishProgressPanel.test.js`，改一处必须同改另一处）。

引用现场（已核实的键名）：`settings.publishFrequency.{title, subtitle, currentTier, effectiveRange,
accountInterval, platformInterval, platformIntervalHint, unset, overrideScopeHint, dailyMaxLong,
dailyMaxClip, dailyMaxShort, dailyMaxPendingConfirm, jitterOn, jitterHint, tierSummary, tierSeparator,
save, reset, saveOk, emergencyPlatform, emergencyAccountPlaceholder}`；
进度侧 `publishPage.publishProgressPanel.{blockedWaitMinutes, blockedDailyQuota, releasedNotSubmitted,
emergencyDisabled, stageWaiting, statusBlocked}`。

一条**登记给用户判断的建议**（不在本次动）：设置页「平台档」是**全局单值**，v3 起平台档按档分级，
用户一旦填它就三档抹平。正解是改成三档输入（与 `dailyMax*` 同形），而不是再加一句长解释。

---

## 10. 明确不做 / 已知未接线（不假装已闭合）

1. **跨平台全局串行**：不做。它会废掉"一键发多平台"这个核心能力。
2. **平台级日配额**（`platform-daily`）：守卫里有键前缀常量 `PLATFORM_BUCKET_DAILY_KEY_PREFIX`，
   **全仓零引用**，属"计划了但没接"。本次不做（做它要先决定"每平台每天"归谁）。
3. **`clearRollbackDisabled()`**：`task-queue-frequency.js` 的日志文案写着"重启或**用户在设置页
   确认后**解除"，但**没有 IPC handler、没有 UI 入口** —— 声明与接线不符，属诚实性问题。
   本次不改文案也不建入口，登记在此；下一步要么建入口、要么把文案改成"重启后解除"。
4. **`getProbeCounts()`**：零消费者（设置页/诊断都没读）。v3 的 `inflightUnknown` 同样只进内存。
5. **`prunePublishDailyCount()`**：零生产调用 —— 日计数表只增不删。
6. **`full-auto-pipeline` 旁路**：`createPublisher(...).publish()` 直接发布，自带硬编码
   `PUBLISH_INTERVAL_MS = 5000`，**完全绕过队列与守卫**（违反策略模块头部"禁止在调用方另抄一份"）。
   该链路是活的（`container.setup.js` 注册、`phase1-context.js` 与 `ipc-handlers/auto-pipeline.js` 使用）。
   收敛它要改的是流水线与队列的归属关系，属另一个 PR 的体量，登记不做。
7. **迟到成功撤下重试**（§5.1 残留风险）：需要任务级状态机。
8. **`maxConcurrent` 与 `timeout` 的取值再标定**：v3 后节奏变快，3 并发 / 180s 是否仍合适需要
   真实运营数据重测；本次未做，属"并发按测不按猜"的欠账。
9. **restart 后 `_hold` 丢失**（D4）：`task._hold` 不在持久化投影里，恢复的任务无法回滚窗口
   （方向是"多等"，可接受）。`submitUncertain` 同样不持久化 —— 重启后它不再是"终身"锁，
   恢复路径也不会带 `_hold`，因此实际后果只是"该任务永不回滚"，与预期方向一致。

---

## 11. 回归锁与反证

测试（先红后绿，红当场留证）：

| 文件 | 条数 | 本次新增/修改 |
|---|---|---|
| `packages/shared-utils/tests/publish-frequency-policy.test.js` | 34 | 改 5 条数值断言 + 新增 6 条：逐 tier 精确表、平台档分级集合、档间单调、"恰为 v2 的 10 倍"数据表、**平台→档位归属逐平台钉住**（QM-6 B14：派生表的新风险面是"挪错档"，而它不改任何档位值 ⇒ 前四条全照绿）、**回落基线逐维度不弱于任何已登记平台**（QM-6 B7：独立常量不会被编译器提醒） |
| `packages/shared-utils/tests/publish-interval-guard.test.js` | 51 | 新增 3 条：回滚许可硬顶（含"真表读数必须大于封顶"的活性前置，QM-6 B9 后扩成**逐平台**而非只测 weibo）、`_intervals()` 必须回传 `tier`、minInterval 兼容分支同样要带 `tier` |
| `packages/shared-utils/tests/task-queue-timeout-keeps-window.test.js` | 13 | **新文件**：4 条 D1 行为锁 + 4 条正向对偶 + cancel 不变量 + 退避可观测性 + QM-6 三条（**真实两轮且判据取"release 有没有被调用"**、退避期内可取消、重启恢复不得回滚） |
| `apps/desktop/electron/core/container.setup.test.js` | — | 装配锁按 v3 精确值改断言（经真实容器取守卫，不是 mock）；回落判据由 `>= weibo(1′)` 改成与**最严那档**比 |
| `packages/shared-utils/src/__tests__/frequency-declaration-contract.test.js` | 6 | **新文件**：枚举 `publish-frequency-policy` 与 `PublishIntervalGuard` 的**全部公开面**，逐个要求在 `index.d.ts` 里声明（QM-6 W3：该子路径 require 在类型检查里恒为 `any`，漂移永远不会红） |
| desktop 显示面 3 文件 | +4 | 设置页三条（tier 不再渲染成 undefined / 旧默认值文案不得残留 / 平台档提示不得做绝对承诺）+ 进度面板与主进程各一条 round 取整锁 |
| 其余（`task-queue.test.js` 等） | 141 基线 | 未改，全绿 |

`packages/shared-utils` 全量：**1034 passed / 10 skipped**（50 个文件）；desktop 侧受影响面（`container.setup` / `bootstrap.test` / `publish.test` / `publish-progress-events` / `publisher-router` / `store-owner-isolation` / 设置页 / 进度面板 / `SettingsDialog` / `phase4-events`）**全部通过**。
（消费者并集按 `git grep` 对 4 个被改模块名求并集取得。）

**净新增 27 条用例**（阶段 A/B 14 条 + QM-6 处置 13 条：`_intervals` 的 tier 两格、d.ts 枚举锁六格、真两轮 / 退避期内可取消 / 恢复不回滚三格、显示面四格）。

变异反证 **20 条**（第一批 M1–M11 打本次实现，第二批 M12–M20 打 QM-6 修复本身），全部实跑，且**还原后与原文逐字节相同**（还原判据由外部 `md5sum -c` 对账，不由驱动自证）；另有一条驱动自身的假失败被当场抓到：
第一版驱动按未剥 ANSI 的 `FAIL` 行取用例名 ⇒ `rc=1 而 red=0`，报成 9 条"MISSED"。
真实原因是探针失明，不是锁失效 —— 驱动已改为剥 ANSI 并新增 `PROBE_BLIND` 独立档位
（"有测试失败但叫不出名字"必须与"没测出问题"分开），并在跑变异前先做**未变异必须全绿**的正控。

| # | 变异 | 结果 |
|---|---|---|
| M1 | 退回 v2 判据（无在飞档、无终身锁） | CAUGHT，红 4 条且指名 D1 四条 |
| M2 | 把"禁止回滚"写成"永不回滚" | CAUGHT，红 4 条（对偶①②③ + 终身锁） |
| M3 | 摘掉终身锁（只挡当轮） | CAUGHT，红 1 条（终身锁） |
| M4 | 退避等待不登记 `_delayed` | CAUGHT，红 1 条（退避可观测性） |
| M5 | 回滚上限退回 `max(2, dailyMax)` | CAUGHT，红 1 条（硬顶） |
| M6/M7/M8 | 三个 tier 的数值分别退回 v2 | CAUGHT，红 4 / 9 / 6 条 |
| M9 | race 里另起一次执行器调用 | CAUGHT，红 3 条（重复执行类） |
| M10 | 算了 `executorSettled` 却没传给判据 | CAUGHT，红 3 条（D1 三条本体） |
| M11 | 把封顶数值抬到不再生效（5→500） | CAUGHT，红 1 条（证明常量在**管**而非仅在位） |

第二批 M12–M20 覆盖的是 QM-6 修复本身（`_intervals` 回传 tier、round 取整、两条提示文案、**夹具退回"替生产补字段"**、d.ts 枚举锁三格、真两轮链路）。
M18 跑了**三轮**才对上，前两轮都是我自己的错：首版变异删的是 `dailyPrev/dayKey`（不是锁声称的 `at`，属**空操作**）；第二版把变异打在一条 `toContain(「at」)` 形状的断言上 —— 它同时被「pl**at**form」这个子串**和**相邻成员 `release(hold: { at: number; … })` 的参数形状满足，是条恒真断言。判据改成「按花括号配对只切出 recordPublish 自己的返回块，再逐字段按 `名: 类型` 的形状判」之后，M18 才真的指名红。**教训**：新写的锁必须当场被一次变异打过 ——「断言存在」很容易被当成「锁有效」，而这两件事在 M18 的第二轮之间就是零差距。`M13/M14/M15/M16` 各只红一条、红在指名的用例上（M16 打的正是 C2 的逃逸原因：夹具替生产补 `tier`）。

两条**如实记录、不改成恰好能红**的覆盖面事实：

- M7（clip 档退回 v2）**不会**让"平台档不再统一 2′"变红 —— clip 的 2′ 仍在 `{1′,2′,3′}` 集合里，
  该锁测的是集合大小而不是每档取值；clip 的平台档取值由"逐 tier 精确表"那条负责。
- M10 不影响"终身锁"那条 —— 它不经 ctx、只读 `submitUncertain`，而 sticky 分支未被该变异触及
  （那条由 M3 负责）。驱动首轮把它列进 M10 的期望，是期望写错，不是锁没牙。

---

## 12. 验收与回退

**验收（可按本机重跑）**

1. `cd packages/shared-utils && pnpm test` ⇒ 数值表与 D1 全绿。
2. QM-1：`cd apps/desktop && pnpm run build:vue && pnpm exec electron-builder --win --dir --publish never`
   ⇒ 两个 rc=0；产物内容判据经 `@electron/asar` 的 `extractFile` 直读（**查找键须去前导分隔符、
   保留反斜杠**，换成 `/` 会全部 MISS 而读成"文件没进包"）：12 条 v3 特征在包内全部命中，
   且 v2 残留（`accountMinMs: 20 * MIN`、`accountDailyMax: 20`）在包内命中 0；
   启动 8s 进程存活、stderr 0 字节（三层判据的第③层）。
3. 现场观察：连续两条同平台同账号任务，等待提示应约 1.4–7 分钟量级（按档），不再是 4.2–28 分钟。

**回退**（无需回滚代码）：设置页把三档 `dailyMax` 与两档间隔填回 v2 值即可，或
`MP_PUBLISH_MIN_INTERVAL_MS=1200000` 等环境变量；两者都优先于策略表。
若要精确回到"每档不同"的 v2 表，只有回退代码一途（v2 的平台档是统一 2′，无法用全局覆盖表达分级）。

---

## 13. 风险与重测触发条件

风险：更短的间隔意味着更高的平台侧风控命中概率，而本工具**没有**平台风控命率的观测面
（`riskSuspender` 只在命中后事后即停，命中次数不回写频率侧）。日配额 ×10 意味着
"今天到此为止"的保护在数值上几乎不再是约束（长文 30 条/天/账号）。

**重测/收紧触发条件（任一即触发，写死在此以便下一个会话照做）**

1. 任一平台出现明确规则（官方文档或可复核的稳定实测）。
2. 运营反馈"重复发布"或"发布被平台拒绝"的现场 —— 优先怀疑 §10 第 6 条的旁路链路，其次 D1 残留风险。
3. 真实提交样本 ≥ 100 条/平台，可用 `scripts/calibrate-publish-frequency.js` 重新标定。
4. 出现"同账号日配额被耗尽"的抱怨 —— 说明配额不是当前瓶颈，应回看间隔而不是继续放大配额。
