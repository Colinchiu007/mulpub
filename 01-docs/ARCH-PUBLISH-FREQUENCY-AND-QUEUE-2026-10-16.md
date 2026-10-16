# 发布频率控制与任务队列机制（现行实现，2026-10-16）

> 适用范围：本篇描述**当前代码**的行为（策略 v4 + change `publish-frequency-unwired-surfaces`），
> 面向"要改这块的人"和"要排障的人"。所有数值与判据都标了落点（文件:行），
> 行号会漂，**符号名不会**——按符号名找，找不到就是实现变了，别按本篇办事。
>
> 本篇**不回答**"这些数值合不合平台官方规定"。本工具的数值是工程保守默认，
> 不声称符合任何平台官方规则；取舍依据与自认弱点见
> `01-docs/PRD-PUBLISH-FREQUENCY-V4-2026-10-15.md` §3–§5。

---

## 1. 组件地图：谁持有什么

| 关注点 | 唯一落点 | 职责边界 |
|---|---|---|
| 频率**数值**与合法域 | `packages/shared-utils/src/publish-frequency-policy.js` | 三档预设、平台分组、回落基线、env/覆盖解析、上下界、加载期基线自检。**禁止在任何调用方另抄一份数值** |
| 窗口**判定与记账** | `packages/shared-utils/src/publish-interval-guard.js` | `check()` 出结论、`recordPublish()` 占位、`release()` 回滚、`clearWindow()` 紧急放行、抖动与退避、回滚硬顶 |
| **排队与执行** | `packages/shared-utils/src/task-queue.js` | 通道调度、并发上限、超时/中止 race、重试环、跨重启持久化 |
| 频控相关的队列方法 | `packages/shared-utils/src/task-queue-frequency.js` | 传输层打点、探针计数、未提交失败回滚判定、有界退避重排、紧急放行机制 |
| 生产装配（DI） | `apps/desktop/electron/core/container.setup.js` | `publishIntervalGuard` 注册（接 SQLite 存储 + 设置页覆盖）、`taskQueue` 注册（**守卫排在展开之后，不允许被 options 覆盖成 undefined**） |
| 提交打点 | `apps/desktop/electron/bootstrap.js`（executor 内） | 唯一有权声明"发出去了/发过但没成"的层 |
| 主进程 ↔ 渲染层 | `apps/desktop/electron/ipc-handlers/publish-frequency.js` | 4 个通道：`publishFreq:getPolicy / setPolicy / emergencyRelease / emergencyStatus` |
| 日计数与时间线持久化 | `apps/desktop/electron/services/store/publish-daily-store.js` + store 的 timeline 面 | 表 `publish_daily_count` / `publish_timeline`，owner 作用域 |
| 启动期裁剪 | `apps/desktop/electron/bootstrap/phase3-services.js` | 在 `store.init()` 成功后调用 `prunePublishDailyCountAllOwners(guard.today())` |
| 设置页 | `apps/desktop/src/components/PublishFrequencySettings.vue` | 只渲染下发值，**不持有第二份数字** |

---

## 2. 现行数值（v4）

三个维度。**"更严"的方向在两个维度上相反**，这是回归锁必须分维度取界的原因：

- `accountMinMs`：同平台同账号两次提交的最小间隔 —— 越大越严
- `platformMinMs`：同平台**任意**两次提交的最小间隔 —— 越大越严
- `accountDailyMax`：同平台同账号的当日提交上限 —— **越小越严**

```
档位      代表平台                              账号档   平台档   日配额
long      wechat_mp zhihu baijiahao toutiao      5 分钟   1 分钟    200
clip      douyin kuaishou tencent_video          3 分钟   1 分钟    350
          xiaohongshu bilibili youtube
          tiktok instagram facebook
short     weibo twitter                          1 分钟   1 分钟    500
未登记    任何不在表内（含非字符串）的 platform    5 分钟   1 分钟    200   + fallback:true
```

三条不可破的形状不变量（各由行为锁实测，不是从公式推的）：

1. `platformMinMs ≤ accountMinMs` 对每个已登记平台成立 ⇒ **同账号永远由账号档决定，平台档只在跨账号时兜底**。v4 把平台档三档统一成 1′ 是"分级撤掉、机制保留"：这条档是唯一约束"同一台机器、同一出口 IP 下多个号在同一平台并行"的机制，而它失效的后果（平台侧把多号关联成矩阵行为）在本地**没有任何可观测信号**。
2. 账号档严格单调 `long > clip > short`；日配额严格单调 `long < clip < short`（长文日配额最少）。v4 把长文配额从 30 抬到 200（6.7×）之后，**"节奏仍分档"这件事只由 `accountMinMs` 承载**，配额不再参与表达节奏。
3. 回落基线 `BASELINE_INTERVALS` 是**独立常量，故意不从 `TIER_PRESETS` 派生**——改档不应静默改变回落实质。它逐维度不弱于任何已登记平台（间隔取全域最大、配额取全域最小），并由 `checkBaselineStrength()` 在**模块加载时**再自检一次：违规只 `console.warn` 不抛错（属"配置写错"级别，不该让整条发布链起不来）。空表会让"零个违规"读起来像通过，所以自检**必须报告自己没测到东西**。

---

## 3. 合法域与覆盖优先级

优先级恒为：**设置页覆盖 > 环境变量 > 策略表**。

| 量 | env 名 | 默认 | 合法域 | 非法值语义 | 超界语义 |
|---|---|---|---|---|---|
| `accountMinMs` | `MP_PUBLISH_MIN_INTERVAL_MS` | 按档 | `[0, MAX_INTERVAL_MS]` | 回落默认**并出声** | 钳位并出声 |
| `platformMinMs` | `MP_PUBLISH_PLATFORM_MIN_INTERVAL_MS` | 按档 | 同上 | 同上 | 同上 |
| `accountDailyMax`（分档） | `MP_PUBLISH_DAILY_MAX_LONG / _CLIP / _SHORT` | 200/350/500 | `[0, MAX_DAILY_QUOTA]` 整数 | 回落默认并出声 | 钳位并出声 |
| `accountDailyMax`（三档同值） | `MP_PUBLISH_ACCOUNT_DAILY_MAX` | — | 同上 | 同上 | 同上 |
| `jitterRatio` | `MP_PUBLISH_JITTER_RATIO` | `0.4` | `[0, 1)` 有限数 | 回落默认并出声 | — |
| `releaseGraceMs` | `MP_PUBLISH_RELEASE_GRACE_MS` | `60000` | `≥ MIN_RELEASE_GRACE_MS=10000` 整数 | 回落默认并出声 | **低于下界钳位**到 10s |
| `emergencyMaxPerDay` | `MP_PUBLISH_EMERGENCY_MAX_PER_DAY` | `1` | `[0, 10]` 整数 | 回落默认并出声 | 钳位并出声 |
| 队列并发 | `MP_QUEUE_MAX_CONCURRENT` | `3` | `[1, 10]` 整数 | 回落默认并出声 | — |

两个常量是这次专门收敛出来的：

- `MAX_INTERVAL_MS = 7 天`：间隔源的上界。含抖动系数后 `wait × (1 + ratio)` 必须仍小于 `TIMER_MAX_MS = 2^31-1`；守卫另有安全值 `TIMER_SAFE_MS = TIMER_MAX_MS - 2000`，抖动后一律钳在安全值内。
- `MAX_DAILY_QUOTA = 5000`：**日配额合法域的唯一真源**，env、设置页覆盖、`dailyMax[tier]`、设置页输入框的 `:max` 四条路径共用。它必须**严格大于**最大默认值——写成刚好等于时，下一次上调默认值会撞上界并被**静默钳位**（默认值不经过 env 那条有声路径，没人会去读那条 warn）。`0` 是"关掉配额"的显式语义，所以不需要用天文数字表达"不设限"。

`0` 在所有档上都是**合法值**（表示显式关闭该档），所以代码里一律用 `pick(...)` 判"是否已设置"，**禁止用 `||` 兜底**。

### 3.1 设置页覆盖是全有或全无

`resolvePolicyOverrides(raw)` 的语义是**任一字段非法 ⇒ 整个覆盖对象作废**（返回 `null`）并出声。半生效态会让"我改了 A 却影响了 B"变成不可解释的行为。未知字段一律忽略（前向兼容）。间隔类字段进对象前按 `Math.floor` 并钳到 `MAX_INTERVAL_MS`；配额类要求整数且 `[0, MAX_DAILY_QUOTA]`。

写入走 `publishFreq:setPolicy`：校验在**写库之前**，非法直接回 `VALIDATION_ERROR`「已整体拒绝（未保存任何字段）」——否则界面显示"已保存"而策略没变。

即时生效的口径分两类，这是刻意设计不是遗漏：

- 间隔与日配额：守卫**每次 check 现取**覆盖对象（构造期不快照）⇒ 改完下一次判定即生效。代价是每次 check 一次 settings 读（任务粒度，可接受）。
- 抖动与回滚退避：是守卫构造期标量，必须显式调 `setJitterRatio()` / `setReleaseGraceMs()` 才生效。这两个 setter 对非法值 **no-op 并出声**，绝不让"设置页写了个非法值"把已生效的保守配置降级成 0（那等于静默关掉抖动）。

---

## 4. 守卫怎么判（`check`）

键形态（`buildKey`）：有账号 ⇒ `platform:encodeURIComponent(accountId)`；无账号 ⇒ `platform:*`
（`PLATFORM_BUCKET_ACCOUNT_ID = '*'`）。非字符串 accountId 一律归一成 `null`，
**"账号身份缺席"不等于"无发布行为"**——缺席时跳过账号档，平台档照判照记。

判定顺序（顺序本身是语义）：

```
① 日配额 —— 独立否决项，先判
   命中 ⇒ { allowed:false, remainingMs:0, bucket:'daily', reason:'daily_quota', daily:{used,max,dayKey} }
   为什么 remainingMs 恒 0：它不是"等一会儿"，是"今天到此为止"。等待时长由
   msUntilNextDay()（次日 00:00:05，与 today() 同一注入时钟）给出，队列据此单独成集 _quotaBlocked。

② 两档间隔取更严
   账号档 remaining = max(0, accountMinMs - (now - store.get(accountKey)))
   平台档 remaining = 同上，键 platform:*
   取较大者决定 bucket:'account' | 'platform'，返回的 remainingMs 已过抖动（只增不减）
```

运营日 `today()` 缺省用 `new Date(now()).toLocaleDateString('sv-SE')`（即 `YYYY-MM-DD`），
且**可注入**——所有跨日判据必须与它同源。队列侧另算一次本地日期就是第二套口径，
差一天的表现是"昨天的行今天被删"或"该删的没删"，且两处都不报错。

---

## 5. 队列怎么排（`TaskQueue`）

### 5.1 通道调度（B 方案）

- 通道键：`task.platform + ':' + (task.accountId ?? '')`。⚠️ 这与守卫的窗口键是**两个命名空间**（守卫用 `encodeURIComponent` 且缺席记 `*`，通道用空串），不要互相套用。
- 同通道 FIFO 串行、跨通道并行吃满 `maxConcurrent`。存在的理由：同一账号并发开两个发布窗会被平台侧风控，且两个窗口会互相竞争同一份登录态。
- `_processNext` 的轮候用 `inspected` 计数保证不无限循环；三种情况把任务推回队尾并继续扫：非当前 owner、`_quotaBlocked` 命中、通道已有任务在跑。

### 5.2 被频控推迟时的四条纪律（少一条就会出事故）

1. 任务回到 `status:'pending'`、`startedAt:null`，并从 `_running` 移除。
2. **必须显式释放通道占用**——该分支在 `try/finally` 之前 `return`，finally 的释放不会执行。漏掉时"等 5 分钟间隔"会把通道占死，频控从保护变成雪崩。
3. 重排定时器句柄登记进 `_pendingTimers` 并 `unref()`（否则事件循环被等待句柄钉住、应用退不出去），同时登记进 `_delayed`（观测承载处）。
4. `_saveState()` 落快照。广播 `publish:blocked`（含 `remainingWait` / `bucket` / `reason` / `daily`），渲染层据此显示等待。

### 5.3 提交前后：记账与打点

```
recordPublish(platform, accountId)   ← 在调用执行器【之前】
  两档同时占位 + 日计数 +1，返回 hold={at, accountKey, platformKey, accountPrev, platformPrev, dailyPrev, dayKey}
  hold 必须存进 task._hold 并回传给 release() —— 它是"精确还原前值"的唯一凭据
task.submitAttempted = false; task.submittedAt = null
```

平台侧限流窗口按"请求已发生"计时。只在成功路径记账 ⇒ "内容已发到平台但应用判失败/超时"不占窗口 ⇒ 下一次提交不受限，且重试会重复发布。

打点必须由**真正发出平台请求的那一层**做（本仓是 executor），**不是**由抛出错误的那一层声明——否则"免等重试"的获益方可以自行伪造。分层语义：

| 场景 | 打点 | 后果 |
|---|---|---|
| 进入 `publisher.publish()` **之前**失败（风控挂起 / 信号已中止 / 进度注册失败） | 不打点 | 从未发起平台写尝试 ⇒ 守卫可回滚该窗口 |
| `publish()` 内部失败，且未自证未送出 | `markSubmitAttempted` | 按已提交处理（保守：宁可多等一个窗口） |
| 发布器显式声明 `error.definitelyNotSent === true`（连接未建立 / DNS 失败等可确证未送出） | 不打点 | 可回滚 |
| 成功 | `markSubmitted`（同时置 `submittedAt`） | 见下面的不变量 I4 |

**不变量 I4（成功路径自证）**：成功的发布必然发生过平台写操作 ⇒ `submittedAt` 必须非空。
为空即传输层漏接线，而这会把"未提交失败"误判为**可回滚**（危险侧）。所以在这里把它变成
第一次成功就暴露的 `console.error` + 对该平台停用回滚（fail-closed），而不是等某次失败被误放行。

### 5.4 race、超时与 D1

```
Promise.race([ executorPromise, timeoutPromise(task.timeout, 默认 180000ms), abortPromise ])
```

- `executorPromise` 就是被 race 的那一个，且它自己记录是否已收敛（`executorSettled`）。
  声明必须在 `try` 之外（catch 分支要读它）。
- **D1**：被超时/中止判输而执行器**尚未收敛**时，请求可能仍在飞。此时"没有打点"**不构成**"没有发起"的证据——
  `markSubmitAttempted` 按 `_running.get(taskId)` 查任务，而 finally 已删该键 ⇒ 迟到的打点永久落空。
  处置：置 `task.submitUncertain = true`（**按任务终身不复位**），拒绝回滚，探针 `inflightUnknown += 1`，
  输出一条点名平台与任务 ID 的 warn。终身不复位的理由：重试轮的 `recordPublish` 会覆盖 `_hold`，
  此时若允许回滚，还原的是"上一轮仍在飞的那次提交之前"的窗口——比不滚更糟。
- 方向恒为多等。对偶同样不可破：**执行器已收敛**且确证未送出的失败必须照常回滚；
  把"禁止在飞未知回滚"实现成"永不回滚"等于撤销免等重试能力。

### 5.5 回滚资格矩阵（`_maybeRollback`）

| 条件 | 回滚？ | 依据 |
|---|---|---|
| race 输给超时/中止且执行器未收敛 | ❌ 置终身锁 | D1 |
| `task.submitUncertain` 已置位（任何后续轮次，哪怕带 `definitelyNotSent`） | ❌ | 终身锁排在本条**所有旧判据之前** |
| 从未发起写尝试（`!submitAttempted`）且平台无矛盾 | ✅（还要过下面三道闸） | 阶段判据 |
| 传输层确证未送出（`definitelyNotSent`） | ✅（同上） | 阶段判据 |
| 错误同时带 `notSubmitted=true` 与"已发起且未确证" | ❌ + `releaseFailed += 1` + error | 佐证位与阶段判据矛盾时取更保守一侧；**获益方不得自证免等** |
| 该平台已有过一次成功发布，本轮却是"未发起尝试"的失败 | ❌ + 该平台**终身停用回滚** | 接线矛盾探针（`missingWiring` 计数）。⚠️ 必须排除 `definitelyNotSent`——登录态早退处主动打该标是**合法的未提交**，不排除的话"第一次登录失效"就会把该平台回滚能力自毁 |
| 该平台已被停用回滚 | ❌ | `_rollbackDisabledPlatforms` |
| 过闸后：窗口值不等于 `hold.at` | ❌ `window_taken` | 乐观并发：绝不回滚他人窗口 |
| 当日回滚次数已达 `_rollbackCap` | ❌ `rollback_cap` | 见下 |

三道闸的副作用（只在真正回滚后发生）：配额计数幂等回补（下限 0）、`rollback_count` **只增不减**。

**回滚硬顶**：`_rollbackCap = min(max(2, accountDailyMax), MAX_ROLLBACK_PER_DAY = 5)`。
`max(2, …)` 让低配额平台至少能纠错两次；`min(…, 5)` 是 v3 加的——日配额从 20 放大到 500 时，
若许可数写成 `max(2, dailyMax)`，"每天可回滚次数"会跟着放大 25 倍，等于把防风闸的额度写成了配额的函数。
`dailyMax = 0`（关闭配额）时结果仍是 2。

被停用回滚的平台如何解除：**只能重启进程**。本进程内不提供撤销入口（历史上那个
`clearRollbackDisabled()` 承诺"设置页确认后解除"但从无 IPC/UI 入口，是假承诺，已随实现删除；
理由见 `01-docs/PRD-PUBLISH-FREQUENCY-UNWIRED-2026-10-16.md` §2）。

### 5.6 重试与退避

```
if (!e.noRetry && task.retriesLeft > 0):
    retriesLeft--; status='pending'; lastAttemptNotSubmitted = rolledBack
    rolledBack ? _delayRequeue(task, releaseGraceMs)   // 有界退避，期间任务仍在 _delayed 且已持久化
               : _queue.push(task)                     // 占着窗口 ⇒ 排队等满，等待不消耗 retriesLeft
else: status='failed'; emit('task:failed')
```

风控即停等结构化信号必须落盘（`errorCode` / `riskBlocked` / `loginExpired` / `noRetry`）——
下游若靠关键词匹配判风控，`status code 601`、`id 6019`、`infrequent` 都会误命中。

`_delayRequeue` 期间任务必须**仍登记在 `_delayed`**：它若只活在 `setTimeout` 闭包里，
`getStatus()` / `getPendingTasks()` / `serialize()` 在整个 grace 期（默认 60s）都看不见它，
重启即静默丢失，UI 上"排队中"凭空少一条。

### 5.7 紧急放行（跨两道实现）

机制在队列（`emergencyRelease`：找等待任务 → 取消定时器 → 清窗 → 重新入队 → 广播），
策略与合规在 IPC 层（调用**之前**判定并落盘）。四道闸按顺序，顺序错了会遮蔽真实原因：

1. **入参校验**：`platform` / `accountId` 必须是合法 path segment。
2. **策略闸**：`emergencyMaxPerDay`（默认 1，`0` = 关闭该入口）+ 冷却 `DEFAULT_COOLDOWN_MS = 10 分钟`。
   未过闸时如实回报 `reason:'disabled' | 'exhausted' | 'cooldown'`（分别对应额度关闭 / 当日已用尽 / 冷却中）
   与 `used/max/retryAfterMs`，**不是错误码**（`code:0`）——用户要知道的是"为什么现在不行"，不是"出错了"。
3. **机制可用性**：到这一步才检查队列能力。提前检查会把"今日额度已用尽"这类真实原因遮蔽成"队列不可用"。
4. **执行 + 记账 + 追加式审计**：审计落 `publish-emergency-audit.jsonl`（state 键 `publishEmergencyRelease`），
   `operator` 由服务内部从 `identityService` 解析，**不接受渲染层自报**（自报可伪造操作者）。

⚠️ 已知副作用（刻意接受）：`clearWindow()` 会连**平台键**一起清，即该平台其他账号的跨账号保护也会失效一次。
只清账号键的话平台键仍会挡住本次放行，功能等于没实现；代价由"每账号每日 1 次 + 冷却 + 审计"共同约束。
三类结果必须都如实回报、不得静默：`no_guard` / `no_waiting_window` / `ok`。

---

## 6. 持久化、跨重启与裁剪

| 存储 | 内容 | 键 |
|---|---|---|
| `publish_timeline` 表 | 两档窗口的上次提交时刻 | `platform:accountId` / `platform:*` |
| `publish_daily_count` 表 | 当日 `count`（可回补）与 `rollback_count`（只增） | `(key, dayKey)`，owner 作用域 |
| `settings.publishFrequencyPolicy` | 设置页覆盖对象（全有或全无后的合法值） | 单键 |
| `shared-user-data/publish-history.jsonl` | 发布历史（标定读这里，**不读 `publish_history` 表**） | — |
| `publish-emergency-audit.jsonl` | 紧急放行审计（追加式） | — |

**启动期裁剪**（`phase3-services.js`，在 `store.init()` 返回成功之后 → `prunePublishDailyCountAllOwners(guard.today())`）
四条口径（第 4 条是 QM-6 自审 C-1 补的：调用点必须在存储就绪之后，否则恒 `not_ready`、一行都不删）：

1. 日键**取守卫的 `today()`**，不在启动侧另算本地日期（理由见 §4）。
2. **按 owner 逐个删**。"逐 owner 删"与"一条不带 owner 的 DELETE"在**最终删了哪些行**上同形，
   所以回归锁拦的是 `db.prepare()`：裁剪期间每条 DELETE 都带 `owner_subject = ?` 谓词、首参是非空 owner、每个 owner 各一条。
3. 失败与接不上都必须出声，返回值带 `basis: 'measured' | 'invalid_input' | 'not_ready' | 'unproven'`
   ——把"没测到"印成 0 是本仓反复登记的构造性零。
4. **调用时机**：调用点排在 `store.init()` 成功之后。未就绪的存储对裁剪恒返
   `basis:'not_ready'` 且一行都不删 ——「有调用点」不等于「接上了」；回归锁必须看到这个顺序
   （`phase3-services.test.js` 的夹具按 `_ready` 决定 basis，`phase1-context.test.js` 另有一条带正向
   对偶的禁令锁）。这是 QM-6 自审 C-1 的落点，第一版正是接在 phase1 而永久 no-op。

日键校验是**形状 + 日历 round-trip 双校验**：只校验形状时，`2026-13-40` 过得了正则却被 `Date.UTC`
归一化滚到 2027-02 ⇒ cutoff 落在所有历史行之后 ⇒ **整表被裁光**。

**跨重启**：队列 `serialize()` 快照三处——`queue` / `running` / `delayed`（第三处是 2026-10-06 补的：
频控等待中的任务既不在 `_queue` 也不在 `_running`，此前完全不在持久化范围内，重启即静默消失，
用户看到"发了一半就没了"）。三者都走 `projectTask` 投影，而投影的第二参**只补 `startedAt`** ⇒
`_hold` / `submitUncertain` / `submittedAt` / `submitAttempted` **进不了快照**，重启恢复的任务
**结构上不可能回滚窗口**（方向安全：宁可多等）。恢复后落在 queue 尾部而不是立刻派发——
窗口本身是持久化的（守卫走 store），该等还是该发由 `_processNext` 重新判定。
`retry()` 同样新建对象，不带走轮次态。
这不是"忘了持久化"，是刻意的取舍——若要改，必须同时改 race 观测与 `release()` 的乐观并发判据。

---

## 7. 用户可见面

设置页（`PublishFrequencySettings.vue`，testid 前缀 `pubfreq-`）：

- 只读区：`pubfreq-current` 显示**当前生效策略**（按档分组，含档位名与"该档 N 个平台"），来自 `getPolicy` 下发的每平台 `_intervals()`。
  ⚠️ `_intervals()` 必须回传 `tier`：缺键时屏幕上每组都是 `undefined（4 个平台…）`（QM-6 前端轴实测的用户可见缺陷）。
- 覆盖区：`pubfreq-override-scope` 提示覆盖是**全局单值**语义（一填就抹平分档，见 §9）；
  `pubfreq-account-min` / `pubfreq-platform-min` / `pubfreq-daily-long|clip|short` / `pubfreq-jitter`。
  五个输入框的 `:max` **绑 `getPolicy` 下发值**（`dailyMaxUpperBound` / `intervalMaxMinutes`），
  渲染层不再持有数字；载荷缺字段时取"不设上界"，**不回落自造数字**。
- 待确认态：`pubfreq-pending-confirm` / `pubfreq-save` / `pubfreq-reset`。
- 紧急放行区：`pubfreq-emergency-quota`（当日额度读数）/ `-platform` / `-account` / `-reason` / `-submit` / `-result`。
  结果区必须区分四种：成功清窗、`no_waiting_window`（正常结果不是错误）、`no_guard`、策略闸拒绝（含 `retryAfterMs`）。

文案纪律（都是实测踩过的）：

- **不得写死默认值**（历史上 alert 里写死「默认值 3 / 5 / 20」，与同屏动态读数自相矛盾）。
- **不得给绝对承诺**（平台档提示不能写成"一定会/不会被拦"）。
- 等待分钟用 `round` 不是 `ceil`：短档 60–84s 显示成"2 分钟"是错的。
- 被移除的能力不得留在文案里承诺（`clearRollbackDisabled` 那句"设置页确认后解除"就是这类假承诺）。

---

## 8. 观测面现状（别把它当仪表盘）

`taskQueue.getProbeCounts()` 返回 `{ successWithoutSubmittedAt, releaseFailed, rollbackDisabled, inflightUnknown, missingWiring, rollbackDisabledPlatforms }`。

三条限制必须一起说：① **仅进程内**，重启归零；② 截至本篇**没有任何生产消费者**（无 IPC、无 UI），
当前消费者是测试；③ 它不参与任何判定，只用于诊断。想要设置页看到，那是一个功能开发片
（v2 tasks 3.4 未完成的半片），不是"接线漏了一半"。

---

## 9. 本篇覆盖不到的（活例外，不假装已闭合）

1. **`full-auto-pipeline.js` 绕过队列与守卫**：它直接 `createPublisher().publish()`，自带 `PUBLISH_INTERVAL_MS = 5000`，
   不经 `TaskQueue` 也不经 `guard.check()/recordPublish()`。这违反策略头注释"禁止在调用方另抄一份"，
   是全仓唯一的快速通道。收编方式只有两种：接进队列，或在发布循环内显式过守卫。未做，属独立一片。
2. **设置页覆盖是全局单值**：账号档/平台档一填就把分档语义抹平（所有平台同值）。正解是把输入改成分档输入。
3. **平台级日配额不存在**：日计数只在 `if (accountKey)` 分支里写，`platform:*` 没有配额维度。
   曾经那个常量 `PLATFORM_BUCKET_DAILY_KEY_PREFIX` 从未被任何代码路径产出，已随实现删除。
4. **裁剪只在启动跑一次**：长驻进程跨月不会自动裁。行数量级是"账号数 × 天数"，据此不加定时器；
   这是取舍，不是完备。
5. **三个"看着像防线其实无关"的东西**：LLM 供应商 governor、`publish-contract.js` 的表单期校验、
   `riskSuspender` 的事后即停。改频控前别把它们当成已经守住了什么。

---

## 10. 改这里必须跑的锁

| 改动面 | 必跑 |
|---|---|
| 策略数值 / 合法域 | `packages/shared-utils/tests/publish-frequency-policy.test.js`（含逐平台数据表、档间单调、回落逐维度不弱于、`MAX_DAILY_QUOTA` 单点三路径） |
| 守卫判据 | `packages/shared-utils/tests/publish-interval-guard.test.js`（含日键形态锁、导出面无死常量、抖动确定性扫描） |
| 队列 race / 记账 / 回滚 | `task-queue.test.js` + `task-queue-guard-integration.test.js` + `task-queue-timeout-keeps-window.test.js` + `task-queue-delayed-observability.test.js` **全量** |
| 打点管道（executor / publisher-router / rpa-view-manager） | 上述四个 + bootstrap 侧行为锁 |
| 启动期裁剪 | `apps/desktop/electron/services/store-owner-isolation.test.js` + `electron/bootstrap/phase3-services.test.js`（顺序锁 + 夹具按 `_ready` 决定 basis）+ `electron/bootstrap/phase1-context.test.js`（禁令锁 + notify meta 顶层键结构锁，扫描域含两个接线文件） |
| 设置页 | `src/components/PublishFrequencySettings.test.js`（夹具界值故意与真源不同） |
| 声明面漂移 | `packages/shared-utils/src/__tests__/frequency-declaration-contract.test.js`（**双向**：实现→d.ts 与 d.ts→实现） |
| DI 装配 | 装配锁：`createContainer()` 不带参数 ⇒ `container.get('taskQueue')` 内部守卫必须就是 `container.get('publishIntervalGuard')` 同一实例 |

硬规矩三条（都是实测换来的）：

- **改任何"限额型"数值前，先找"同一个数值被推导成第二道闸"的落点**（grep 字段名的**使用点**，不是赋值点）。
- **给某条 MUST 开例外时，必须同 PR 改掉主干那句**。主干规格 `openspec/specs/publish-frequency-control/spec.md`
  曾写着"失败、超时或被中止 MUST NOT 回滚该记账"，而合法例外早已存在且从未同步 ⇒ 下一个会话会得出"代码违反规格"
  或照规格删掉合法回滚。
- **测试夹具不得替生产补字段**。v3 那次「契约夹具自行注入了生产不存在的 `tier`」是四层测试全绿的唯一原因。

---

## 11. 排障手册

| 症状 | 先查 | 现场来源 |
|---|---|---|
| "为什么这条没发出去 / 卡在排队" | 守卫判到哪一档、还剩多久 | `publish:blocked` 的 `bucket`（`account`/`platform`/`daily`）+ `remainingWait`；SQLite `publish_timeline` |
| "明明失败了还要等一个窗口" | 该次是否已进入发布器 | `task.submitAttempted`；错误上是否有 `definitelyNotSent`；`inflightUnknown` 计数与那条 warn |
| "同账号第二条比预期早发出去了" | 是否发生过一次回滚、以及被谁触发 | `publish:released` 事件 + `rollback_count`；`releaseFailed`/`rollbackDisabled` 计数 |
| "该平台再也没有免等重试" | 是否被 fail-closed 停用了回滚 | 启动日志里 `_disableRollbackForPlatform` 那条 warn（点名平台与原因）；解除只能重启 |
| "配额明明没发满却说明日限额" | 计数是否被失败尝试占住 | `publish_daily_count` 当日行 `count`（失败也占）；次日 `00:00:05` 起新日 |
| "重启后排队中的任务少了" | 是否处在 grace 退避期 | 该期任务应在 `_delayed` 且已进快照；不在就是回归 |
| "改了设置没生效" | 覆盖是否被整体作废 | `publishFreq:setPolicy` 的 `VALIDATION_ERROR`；`[PublishFrequency] 设置页策略覆盖…已整体丢弃` |
| "新登记的平台没节奏" | 是否忘了登记进策略表 | `resolveIntervals` 回 `fallback:true` + 守卫那条去重告警 |

---

## 12. 沿革（谁改了什么、为什么连带）

| 版本 | 变更 | 连带项（不是可选优化） |
|---|---|---|
| v1 | 只有账号间隔 | 未登记平台静默回落 |
| v2（`publish-frequency-policy-v2`） | 账号档 60/30/10′ → 20/10/3′；平台档统一 2′；新增 `tier` 与 `accountDailyMax`；间隔上界 7 天；未登记平台回落 + `fallback` 标记 | 日配额独立否决（`_quotaBlocked`，否则紧循环）；`releaseGraceMs` 下界 10s 防风闸 |
| v3（`publish-frequency-policy-v3`） | 账号档 → 5/3/1′；平台档分级 3/2/1′；日配额 ×10 → 30/50/200 | **D1**：间隔收到分钟级后触发窗口提前一个量级；**回滚许可硬顶**：许可数不再随日配额放大。数值落点从 15 行手抄收敛为 `TIER_PRESETS + PLATFORM_TIER` 派生，但基线**故意仍独立** |
| v4（`publish-frequency-policy-v4`） | 平台档三档**统一 1′**（分级撤、机制留）；日配额 200/350/500 | 节奏此后只由 `accountMinMs` 表达；`platformMinMs` 归零即视为门禁缺失（回归锁 + 运行期判据） |
| 本片（`publish-frequency-unwired-surfaces`） | 四个"声明了没人接"的面逐条定夺；`MAX_DAILY_QUOTA` 单点化；启动期裁剪接上；日键双校验 | 幽灵声明删除 + **反向**声明锁；notify 诊断值必须进 `meta.params`（否则被 logger 静默丢弃） |
