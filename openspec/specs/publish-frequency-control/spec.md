# publish-frequency-control Specification

## Purpose
定义 publish-frequency-control 的行为契约，判据只认下列 Requirement 与其 Scenario：「发布频率守卫必须在生产装配路径上生效」、「间隔维度与策略单一真源」、「账号身份缺席不得绕过频率门禁」等，共 6 条。本规格由归档 change `publish-frequency-control` 产生。
## Requirements
### Requirement: 发布频率守卫必须在生产装配路径上生效

系统 SHALL 在任务队列执行发布前检查发布频率守卫，并在提交前完成记账。守卫实例必须由
DI 容器持有并**经生产装配路径注入** `TaskQueue`；`TaskQueue` 构造函数在生产的
`options.taskQueue` 缺省时 MUST 仍收到 `publishIntervalGuard`。任何"注册了守卫但无人注入"
的装配状态 MUST 使回归测试变红。

理由：本能力此前已有完整实现与 60+ 条单元测试，但生产调用点为 0、
`publish_timeline` 表 0 行——测试在套件内手工 `new` 守卫并注入，从不经过装配路径。

#### Scenario: 生产容器里的队列拿到守卫

- **WHEN** 以生产方式构建 DI 容器（`createContainer()` 不带参数，等价于 `bootstrap.js:77`）
- **THEN** `container.get('taskQueue')` 内部的频率守卫不为 `null`，且就是
  `container.get('publishIntervalGuard')` 同一实例

#### Scenario: 装配回归（把注入摘掉必须变红）

- **WHEN** 从 `taskQueue` 注册工厂中移除 `publishIntervalGuard` 注入
- **THEN** 装配锁用例失败；不得因"守卫仍被注册在容器里"而判为通过

#### Scenario: 死引用不得充当接线证据

- **WHEN** 源码中存在读取 `publishIntervalGuard` 但结果未被使用的语句
- **THEN** 该语句 MUST 被删除；MUST NOT 以"容器里有注册"作为能力已生效的论据

### Requirement: 间隔维度与策略单一真源

发布最小间隔 SHALL 由 `packages/shared-utils` 的频率策略模块单一持有，按平台返回两档：
账号档（`platform:accountId`）与平台档（`platform:*`，同平台跨账号）。除该模块外
MUST NOT 存在第二份间隔常量表；渲染层定时发布表单的校验属于输入期 UX 校验，
MUST NOT 被视为主进程执行期门禁。

策略模块 MUST NOT 置于 `publish-capabilities.json`（该注册表承载内容能力，
与调度节奏是两类关注点）。

#### Scenario: 15 平台全覆盖且未知平台回落最严档

- **WHEN** 分别查询 wechat_mp、zhihu、weibo、douyin、xiaohongshu、tencent_video、kuaishou、
  toutiao、bilibili、baijiahao、youtube、tiktok、twitter、instagram、facebook 的间隔策略
- **THEN** 每平台返回非空的两档间隔；不在表内的平台回落基线最严档，MUST NOT 回落 0

#### Scenario: 环境变量覆盖与非法值出声

- **WHEN** `MP_PUBLISH_MIN_INTERVAL_MS` 或 `MP_PUBLISH_PLATFORM_MIN_INTERVAL_MS`
  被设为合法值、`0`、或非法值（NaN/负数/非数字字符串）
- **THEN** 合法值生效；`0` 表示该档显式关闭；非法值回落默认并输出 warn 日志，
  MUST NOT 静默当作 0 处理

### Requirement: 账号身份缺席不得绕过频率门禁

当发布任务不携带 `accountId`（含 `publish:wechat` 固定传 `null`、
`publish:batch` 字符串形态目标归一化为 `null`）时，系统 SHALL 跳过账号档，
但 MUST 仍然执行平台档间隔检查与记账。"无账号身份" MUST NOT 等价于"无发布行为"。

#### Scenario: 无账号目标仍受平台档约束

- **WHEN** 同一平台先以 `accountId: null` 完成一次发布，随后在平台档窗口内再次提交
  该平台任务（仍为 `accountId: null`）
- **THEN** 第二次提交被阻塞并进入等待，MUST NOT 因账号缺失而被直接放行

#### Scenario: 不同账号仍各自持有账号档窗口

- **WHEN** 同平台的账号 A 刚发布，账号 B 从未发布，且平台档已满足
- **THEN** 账号 B 的账号档不阻塞；仅在平台档窗口未满时被阻塞

### Requirement: 记账必须发生在提交之前且失败仍占用窗口

系统 SHALL 在两档间隔均满足后、**调用执行器提交之前**完成记账。
失败、超时或被中止本身 MUST NOT 构成回滚该记账的理由；唯一的例外是**能确证该次尝试
根本没有把内容送出**（从未发起平台写操作，或传输层显式声明 `definitelyNotSent`），
且该例外 MUST NOT 由获益方（抛出错误的那一层）自行声明。

理由：平台侧限流窗口按"请求已发生"计时。仅在成功路径记账会让
"实际已发到平台但应用判定失败"的三类形态（执行器抛错、任务超时、重试环重入）
不占窗口，从而下一次提交不受限，且重试会重复发布。

#### Scenario: 超时输掉竞态时窗口仍被占用

- **WHEN** 一次发布提交后被 `task.timeout` 判超时，而执行器 promise **尚未收敛**
  （请求可能仍在飞）
- **THEN** MUST NOT 回滚窗口与日配额；该任务被标记为"提交状态未知"，
  其后续轮次即使带 `definitelyNotSent` 也 MUST NOT 回滚
  （回滚会还原到"仍在飞那次提交之前"的窗口，比不回滚更糟）

#### Scenario: 确证未送出时仍须照常回滚

- **WHEN** 执行器**已收敛**地失败，且从未发起平台写尝试或显式声明可确证未送出
- **THEN** 窗口 MUST 被回滚、日配额 MUST 回补，重试按有界退避（≥10s）重排；
  把"禁止在飞未知回滚"实现成"永不回滚"属违规

#### Scenario: 重试不得立即连发

- **WHEN** 任务失败进入重试环（`retriesLeft > 0`）并重新入队
- **THEN** 重试提交前仍须通过间隔检查；等待 MUST NOT 消耗 `retriesLeft`

### Requirement: 等待中的任务必须保持可取消、可退出、可跨重启

被间隔阻塞的任务 SHALL 回到等待队列尾部或头部并保持 `status: 'pending'`、
`startedAt: null`、从运行集合移除；重排定时器 MUST 登记以便退出时统一清理，
MUST NOT 让事件循环因等待句柄而无法退出。

#### Scenario: 等待期间取消

- **WHEN** 任务处于间隔等待中且用户请求取消
- **THEN** 重排回调发现取消标记后 MUST NOT 重新入队，MUST NOT 提交

#### Scenario: 应用退出清理等待句柄

- **WHEN** `shutdown()` 在存在等待中任务时被调用
- **THEN** 所有重排定时器被清除，等待中的任务被标记为取消，不留悬挂句柄

### Requirement: 间隔阻塞必须对用户可见

系统 SHALL 通过既有 `publish:progress` 的 `phase: 'blocked'`
（`stageKey: 'waiting'`）向渲染层广播阻塞，并携带 `remainingWait`。
本要求 MUST NOT 新增相位枚举值、MUST NOT 新增引擎阶段串、MUST NOT 在渲染层
维护第二份阶段映射——消费链（`phase4-events.js` 转发、
`PublishProgressTaskRow.vue` 渲染剩余等待）已存在，本次仅补齐生产者侧。

#### Scenario: 阻塞事件携带剩余等待时间

- **WHEN** 任务因账号档或平台档间隔被阻塞
- **THEN** 渲染层收到 `phase:'blocked'` 且 `remainingWait` 为正数毫秒，
  进度行展示等待状态而非静止不动

#### Scenario: 阻塞不是终态

- **WHEN** 任务处于 `blocked`
- **THEN** `blocked` MUST NOT 被归入终态集合；到点后同一任务应继续走到
  `start`/`progress`/`success` 正常收敛

### Requirement: 同账号发布间隔必须逐平台可配置

同账号最小发布间隔（`accountMinMs`）SHALL 由频率策略模块内的**逐平台默认表**
`PLATFORM_ACCOUNT_MIN_INTERVAL_MS` 单一持有，MUST NOT 由内容档位（`TIER_PRESETS`）派生。
档位 SHALL 继续持有 `platformMinMs` 与 `accountDailyMax` 两维。

理由：各平台对连发的容忍度不同，而"为一个平台开新档位"会让分类器连带变形、
"在调用方写平台分支"会造出第二份真源——两者都被本 capability 的「单一真源」条款禁止。
差异化 MUST 落在数据面：任何平台收紧或放宽只改表里一行，不改控制流。

取值 MUST 如实标注取证状态：公开渠道没有任何平台公布过量化间隔，
因此本篇 MUST NOT 在任何面向用户的文案或代码注释里把某个数值称为"平台官方规则"。

#### Scenario: 15 平台全覆盖且只有显式登记的平台偏离档位

- **WHEN** 读取 `PLATFORM_ACCOUNT_MIN_INTERVAL_MS` 并与 `SUPPORTED_PLATFORMS` 对账
- **THEN** 两键集必须完全相等（不得缺平台、不得有多余平台）
- **AND** 与档位代表值不同的平台清单必须逐平台显式登记，多一个偏离即红

#### Scenario: 未登记平台回落基线，且基线不得弱于任何已登记平台

- **WHEN** 以未登记平台（含 `undefined`、非字符串）解析间隔
- **THEN** 账号档回落 `BASELINE_INTERVALS.accountMinMs` 并置 `fallback: true`
- **AND** 该基线值 MUST 引用逐平台表（不得另写一份数字），且 MUST ≥ 表内最大值

### Requirement: 账号间隔覆盖必须按「细粒度赢粗粒度」解析

`accountMinMs` 的取值 SHALL 由唯一实现 `resolveAccountMinIntervalMs(platform, { env, warn, overrides })`
按五级优先级解析，顺序不可调整：

1. 设置页平台专属覆盖 `overrides.accountMinMsByPlatform[platform]`
2. 设置页全局覆盖 `overrides.accountMinMs`
3. 环境变量平台专属 `MP_PUBLISH_ACCOUNT_MIN_INTERVAL_MS_JSON[platform]`
4. 环境变量全局 `MP_PUBLISH_MIN_INTERVAL_MS`
5. 逐平台表默认（未登记平台回落基线）

`resolveIntervals` 的账号档 MUST 经该函数取值（禁止"加了表但没改链"），
且该函数 MUST NOT 反向调用 `resolveIntervals`（互调即无限递归）。
`0` 在每一级都是合法值（显式关闭），判"是否已设置" MUST 用显式存在性检查，MUST NOT 用 `||` 兜底。

#### Scenario: 平台专属覆盖不得被全局值抹掉

- **WHEN** 同时存在设置页全局覆盖、env 平台专属、env 全局，且设置页平台专属覆盖该
- **THEN** 返回设置页平台专属值；仅去掉该覆盖时返回设置页全局值；
  再去掉设置页覆盖时返回 env 平台专属值；最后退到 env 全局值，再到表默认

#### Scenario: 兜底分支不得绕过覆盖链

- **WHEN** 平台未登记且 `MP_PUBLISH_MIN_INTERVAL_MS` 被设为合法值
- **THEN** 返回该 env 值，MUST NOT 因为"走了回落分支"而直接返回基线常量

#### Scenario: 两个解析函数不得互相调用

- **WHEN** 分别以已登记与未登记平台调用 `resolveAccountMinIntervalMs` 与 `resolveIntervals`
- **THEN** 均不得抛错（递归会以 `RangeError` 形式当场暴露）

### Requirement: 逐平台覆盖的非法输入必须分两档严格度且不得打断发布链

设置页覆盖字段 `accountMinMsByPlatform` 与环境变量 `MP_PUBLISH_ACCOUNT_MIN_INTERVAL_MS_JSON`
共用同一条判据，但刻意区分两类非法：

- **值非法**（非有限数 / `<0` / 设置页侧还要求整数且在 `[0, MAX_INTERVAL_MS]`）⇒ **整条覆盖作废**
  并出声，MUST NOT 部分生效（"一半生效"会让"我改了 A 却影响了 B"不可解释）；
- **平台键未知** ⇒ **只忽略该键**并点名，MUST NOT 作废整体（拼错一个平台名不该抹掉用户其余配置）；
  若全部键都未知 ⇒ 视为无效，MUST NOT 留下空 map 被下游读成"覆盖了但值为空"；
- **超上界** ⇒ 钳位并出声（沿用既有间隔语义，与配额类字段的"丢弃"不同）；
- 任何解析失败 MUST NOT 抛错打断发布链，只出声并回落到下一级。

#### Scenario: 一个坏值连带同条 env 里的好键一起失效

- **WHEN** `MP_PUBLISH_ACCOUNT_MIN_INTERVAL_MS_JSON` 含一个合法平台值与一个负数值
- **THEN** 该 env 整条作废，合法平台也回落表默认，且日志点名「整条作废」

#### Scenario: 未知平台键只忽略该键

- **WHEN** 同一份输入里含一个未知平台键与一个合法平台键
- **THEN** 合法键照常生效，日志点名「未知平台」，覆盖对象不作废

### Requirement: 逐平台间隔的展示面不得持有第二份数字

设置页 MUST 从 `publishFreq:getPolicy` 同时取得**逐平台默认表**（`accountMinDefaults`）
与**逐平台生效值**（`platforms[p].accountMinMs`），并逐行展示「默认 / 生效 / 已覆盖」。

渲染层 MUST NOT 持有任何频率数值字面量；下发载荷缺字段时 MUST 显示占位符，
MUST NOT 回落成一个自造数字。未覆盖的平台输入框 MUST 留空——
MUST NOT 用默认值预填（预填会让下一次"什么都不改直接保存"把每个平台钉成一份默认值覆盖，
此后策略表再改永不生效）。一个平台都没填时 MUST 省略 `accountMinMsByPlatform` 键，
MUST NOT 提交空 map（"清空覆盖"的既有语义是提交 `null`）。

#### Scenario: 载荷缺 accountMinDefaults 时显示占位而不是猜值

- **WHEN** `getPolicy` 返回的载荷不含 `accountMinDefaults`
- **THEN** 每行「默认」显示占位符，界面不出现任何编造的分钟数

#### Scenario: 无覆盖时保存不得压平差异化

- **WHEN** 用户在逐平台区一项都没填就点保存
- **THEN** 提交对象不含 `accountMinMsByPlatform` 键；全部维度均未填时提交 `null`

#### Scenario: 分钟与毫秒的换算只在提交时发生

- **WHEN** 用户在某平台行填 12（分钟）并保存
- **THEN** 提交值为 `12 * 60000` 毫秒，字段名与主进程 `resolvePolicyOverrides` 的键逐一对应

### Requirement: 提交阶段判定（不可被获益方伪造）

守卫 MUST 以**提交阶段**而非**错误类型**作为「未提交失败」的判据。发布传输层（真正发出平台写操作的那一层）MUST 在首次
平台写操作前调用一次 `markSubmitted()`，队列 MUST 将其结果记录为 `task.submittedAt`。回滚间隔窗口 MUST 仅在
`task.submittedAt` 为空时允许；错误对象上的 `notSubmitted` / `definitelyNotSent`（见
`apps/desktop/electron/services/publish-not-submitted.js`）MUST 只作**佐证位**，两者与阶段标记不一致时 MUST 按「已提交」
处理（占窗口）并记录 error 级日志。

#### Scenario: 提交前失败可立即重试
- **WHEN** 一次发布在发出任何平台请求之前失败，且该错误带 `notSubmitted` 或 `definitelyNotSent`
- **THEN** 守卫回滚该次占位，同一 (platform, accountId) 无需等待即可再次提交

#### Scenario: 提交后失败仍占窗口
- **WHEN** 一次发布已发出平台请求（`submittedAt` 已置位）后失败或超时
- **THEN** 该窗口 MUST 保持占用，后续同窗口提交被拦；回滚 MUST NOT 发生

#### Scenario: 佐证位与阶段标记不一致时 fail-closed
- **WHEN** 错误带 `notSubmitted === true` 但 `task.submittedAt` 已置位
- **THEN** 判定为已提交，占窗口，并记录 error 级日志与计数

#### Scenario: 成功发布的接线自证
- **WHEN** 一次发布**成功**但 `task.submittedAt` 为空
- **THEN** 记录 error 级日志并递增「接线缺陷」计数（把传输层漏接线从静默风险变为主动告警）

#### Scenario: 竞态输掉且执行器未收敛时不得回滚（v3 起追加的事实）
- **WHEN** 一次发布因超时/中止判输，但执行器 promise **尚未收敛**（请求可能仍在飞）
- **THEN** MUST 置 `task.submitUncertain` 并拒绝回滚；该标记按任务**终身不复位**（重试轮不得还原窗口）

#### Scenario: 某平台出现"成功但未打点"后永久停用该平台回滚
- **WHEN** 某平台命中 `_disableRollbackForPlatform`（成功而 `submittedAt` 为空，见 `packages/shared-utils/src/task-queue-frequency.js`）
- **THEN** 该平台后续失败不再回滚窗口，避免用不可靠的打点证据撤销已生效的限流保护

### Requirement: 账号级日配额

守卫 MUST 支持账号级日配额维度，与最小间隔**并存**：间隔管突发，配额管总量。日配额 MUST 按 `platform:accountId` 计数，
键为**本机运营日** `YYYY-MM-DD`（不换算平台时区、不声称与平台日界等价）。三档默认值以 `TIER_PRESETS`
（`packages/shared-utils/src/publish-frequency-policy.js`）为唯一真源：**长文 200 / 短视频 350 / 短内容 500**，
上界 `MAX_DAILY_QUOTA`（=5000，写成严格大于最大默认值，避免上调默认时撞被静默钳位）。回滚许可数由
`MAX_ROLLBACK_PER_DAY` 与档位共同决定（`packages/shared-utils/src/guard-release.js`），MUST NOT 随配额放大而失去"少量回滚"的语义。
配额被拒 MUST 以 `bucket='daily'`、`reason='daily_quota'` 表达，且 MUST NOT 以固定短间隔反复重判。
计数存储读回类型不一致时 MUST 归一（TEXT 亲和）；`dailyStore` 自身抛错 MUST fail-open 并**出声**，不得静默放行。

#### Scenario: 当日配额用尽
- **WHEN** 同一账号当日已提交次数达到该档位上限
- **THEN** `check()` 返回 `allowed=false`、`bucket='daily'`、`reason='daily_quota'`；任务进入 `_quotaBlocked`，
  `_processNext` 跳过它，定时器指向次日（`msUntilNextDay`，`apps/desktop/electron/services/store/publish-daily-store.js` 侧的 `prune*` 保留 7 天）

#### Scenario: 跨日恢复
- **WHEN** 本机运营日跨过 00:00
- **THEN** 该账号计数从 0 起算，被阻任务重新入队并重新判定

#### Scenario: 未提交回滚回补配额且幂等
- **WHEN** 一次未提交失败触发了回滚
- **THEN** 该次占用的配额计数 MUST 被回补（下限 0），且重复回滚 MUST NOT 重复回补

#### Scenario: 回滚计数只增不减
- **WHEN** 任意一次回滚发生
- **THEN** 该账号当日的回滚计数 +1，且不因配额回补而减少

### Requirement: 间隔抖动只增不减

守卫 MUST 支持可注入随机源与抖动比例；实际等待 MUST 为 `remaining × (1 + ratio × rand)`，`rand ∈ [0,1)`。
`ratio` 默认值取 `DEFAULT_JITTER_RATIO`（=0.4），非法值 MUST 回落默认并**出声**。抖动 MUST NOT 使等待短于标称最小间隔，
且抖动后仍 MUST 钳在 `setTimeout` 安全值内；`ratio = 0` 时行为 MUST 严格等于未引入抖动前的值。

#### Scenario: 抖动区间
- **WHEN** 抖动比例为 0.4 且连续采样多次
- **THEN** 每次实际等待均落入 `[base, base × 1.4)`

#### Scenario: 关闭抖动等价旧行为
- **WHEN** 抖动比例为 0
- **THEN** 实际等待严格等于标称剩余时间（与未引入抖动时逐值一致）

#### Scenario: 非法抖动比例回落并出声
- **WHEN** `MP_PUBLISH_JITTER_RATIO` 被配成空白、负数或 `>= 1`
- **THEN** 回落 `DEFAULT_JITTER_RATIO` 并打印一次告警，MUST NOT 静默当成 0（那等于关掉防突发）

### Requirement: 未登记平台出声且回落不得弱于任何已登记平台

平台未登记于策略表时，守卫 MUST 回落最严基线（`BASELINE_INTERVALS`，其账号档**引用逐平台表的最严值**而非另写数字），
MUST NOT 回落 0；并 MUST 对该平台**出声告警一次**（进程内按平台去重）。基线强度 MUST 可被自检：
`checkBaselineStrength()`（`packages/shared-utils/src/publish-frequency-policy.js`）在加载期断言回落值不弱于任一已登记平台。

#### Scenario: 未登记平台回落并告警
- **WHEN** 对未登记平台发起发布
- **THEN** 使用最严基线档位，且日志出现且仅出现一次该平台的回落告警

#### Scenario: 有人把基线改松时当场变红
- **WHEN** 回落基线的任一维度弱于某个已登记平台的现行值
- **THEN** `checkBaselineStrength()` 自检失败并出声（"新增平台忘记登记 ⇒ 更松"这条路 MUST NOT 静默成立）

### Requirement: 一次性紧急放行

系统 MUST 提供显式的一次性紧急放行入口，跳过某一 (platform, accountId) 的当前等待。每账号每日次数默认 1、上界 10；
跨账号冷却 `DEFAULT_COOLDOWN_MS`（=10 分钟）与"每日 1 次"**正交**（见 `apps/desktop/electron/services/publish-emergency-release.js`）。
放行 MUST 经二次确认、MUST 受每日次数上限与冷却约束、MUST 写入追加式审计 `publish-emergency-audit.jsonl`（UI 无编辑入口），
并 MUST 对结果给出明确回显。IPC 通道名是 `publishFreq:emergencyRelease`（`apps/desktop/electron/ipc-handlers/publish-frequency.js`）。

#### Scenario: 放行成功并留痕
- **WHEN** 用户在设置页确认紧急放行且当日次数未用尽
- **THEN** 该账号的等待被解除、任务立即进入队列，审计追加一行，设置页与进度面板同步刷新

#### Scenario: 超过每日上限
- **WHEN** 当日紧急放行次数已达上限
- **THEN** 拒绝放行，队列状态不变，界面给出上限文案

#### Scenario: 无等待中的窗口
- **WHEN** 该账号当前没有等待中的窗口
- **THEN** 明确回显「当前没有等待中的窗口」，MUST NOT 静默

#### Scenario: 功能被关闭时回显 disabled
- **WHEN** 紧急放行被整体禁用（配置/开关关闭）
- **THEN** 返回第 4 种结果态 `disabled` 并给出文案，MUST NOT 把它伪装成"无等待中的窗口"

### Requirement: 回滚资格由竞态收敛性决定，不得只由打点状态决定

系统 MUST 在 `Promise.race([执行器, 超时, 中止])` 结束后判定执行器**是否已收敛**，并把该结论
作为「未提交失败回滚」的前置判据。执行器尚未收敛（请求可能仍在飞）时，MUST NOT 回滚间隔窗口
与日配额，MUST NOT 声称该次尝试"未提交"。被 race 的那个 promise MUST 就是被观测收敛性的
那个 promise（不得另起一次执行器调用）。

理由：传输层的提交打点按运行中任务表查任务，任务离开该表后迟到的打点永久落空；
"没有打点"在竞态输掉那一刻**不构成**"没有发起"的证据。

#### Scenario: 超时输掉且执行器仍在飞时窗口保持占用
- **WHEN** 一次发布提交后被 `task.timeout` 判超时，而执行器 promise 尚未收敛
- **THEN** 守卫不得回滚该次占位；该平台/账号的间隔窗口仍被占用，窗口内的后续提交被阻塞

#### Scenario: 同通道第二条任务不得因上一条超时而提前发出
- **WHEN** 上一条任务在同 (platform, accountId) 通道上因超时失败，随后提交同通道的新任务
- **THEN** 新任务 MUST 被频控拦下并报 `bucket:'account'`，MUST NOT 被执行

#### Scenario: 在飞未知必须可归因且不得伪装成"未提交"
- **WHEN** 一次失败发生在执行器未收敛时
- **THEN** 该任务被置 `submitUncertain`，探针计数 `inflightUnknown` 增加一次（按任务而非按轮），
  并输出一条点名平台与任务 ID 的告警；`lastAttemptNotSubmitted` MUST 为 false

#### Scenario: 终身锁——一旦在飞未知，本任务后续轮次不得回滚
- **WHEN** 一条已置 `submitUncertain` 的任务在后续轮次失败，且该轮错误带 `definitelyNotSent=true`
- **THEN** 仍 MUST NOT 回滚窗口（回滚会还原到"第一轮仍在飞那次提交之前"的窗口，比不回滚更糟）

#### Scenario: 对偶——确证未送出的快速失败仍须照常回滚
- **WHEN** 执行器**已收敛**地失败，且从未发起写尝试或显式声明 `definitelyNotSent`
- **THEN** 窗口 MUST 被回滚、配额 MUST 回补，重试按 `releaseGraceMs` 有界退避
  （把禁止回滚写成永不回滚即撤销 v2 的免等重试能力）

### Requirement: 频率数值的单一落点与「档位 + 逐平台偏离」派生

长文 / 短视频·图文社区 / 短内容三档的**平台档与日配额** MUST 各自只在一处定义（`TIER_PRESETS`，
`packages/shared-utils/src/publish-frequency-policy.js`）；**账号档 MUST 由逐平台表
`PLATFORM_ACCOUNT_MIN_INTERVAL_MS`（`packages/shared-utils/src/publish-frequency-account-interval.js`）持有**，
档位不得再直接给出账号档数字（v5 起）。未登记平台的回落基线 MUST 是独立常量，其账号档 MUST **引用逐平台表的最严值**
而不是另写一个数字（两个数字必然有一天漂移）。

`long > clip > short` 的档间单调 MUST 只对「未对该平台做偏离」的平台成立；一旦某平台（现仅视频号）偏离到比其档位更严的值，
跨档比较即不成立 ⇒ 偏离集合 MUST 被显式钉住，新增偏离 MUST 让锁变红而不是静默通过。

#### Scenario: 逐平台与档位各自取到生效值
- **WHEN** 分别查询 tencent_video、wechat_mp、weibo 的生效策略
- **THEN** 账号档取自逐平台表（视频号 60′ 为**唯一偏离**、长文档 5′、short 档 1′），
  平台档三档统一 1′（v4 撤分级、机制保留），日配额按档位取 200 / 350 / 500

#### Scenario: 偏离集合扩大必须出声
- **WHEN** 有人把某个平台的账号档改成偏离其档位默认的值
- **THEN** 除该平台外的表必须仍等于其档位默认；偏离集合大小/成员变化必须让既有锁变红，不得静默混入

#### Scenario: 未登记平台回落最严档并出声
- **WHEN** 查询不在策略表内的平台
- **THEN** 回落 `BASELINE_INTERVALS` 并置 `fallback: true`，由守卫按平台去重输出一条告警

### Requirement: 未提交回滚的每日许可数不得随日配额放大

守卫 MUST 以 `min(max(2, accountDailyMax), MAX_ROLLBACK_PER_DAY)` 决定每账号每日的回滚许可，
`MAX_ROLLBACK_PER_DAY` MUST 是守卫导出的独立常量。日配额被调大 MUST NOT 使回滚许可同比例放大。

#### Scenario: 高日配额下仍受硬顶约束
- **WHEN** 某账号当日已回滚 5 次而其档位日配额为 200
- **THEN** 第 6 次回滚被拒绝并回报 `reason:'rollback_cap'`，窗口保持占用

#### Scenario: 封顶必须真的在管
- **WHEN** 断言当前策略表的任一档日配额
- **THEN** 其值 MUST 大于 `MAX_ROLLBACK_PER_DAY`（否则本锁测的是从不生效的死支路）

### Requirement: 有界退避等待中的任务必须仍可观测与持久化

任务因回滚成功而进入 `releaseGraceMs` 退避时，系统 MUST 把它登记进频控等待承载处
（与 `publish:blocked` 同一处）并持久化队列快照；`getStatus()` / `getPendingTasks()` /
`serialize()` MUST 在该期间仍能看到它，`cancel()` MUST 能取消它。

#### Scenario: 退避期间仍可查、可序列化
- **WHEN** 一次未提交失败刚完成回滚并进入退避
- **THEN** 该任务出现在待办列表与队列快照中；重启后可恢复，MUST NOT 只活在定时器闭包里

### Requirement: 平台间隔档必须统一存在且不得整条移除

系统 SHALL 为每个已登记平台提供非零的平台间隔档（键 `platform:*`），且 v4 起三档取**同一值 1 分钟**。
平台间隔档的作用是"同一平台、不同账号两次发布之间的最小错开"；同一账号的场景由账号间隔档
（`platform:accountId`）与"取更严者"规则覆盖。该档 MUST NOT 被整条移除或归零，因为它是唯一约束
"同一台机器、同一出口 IP 下多号在同一平台并行"的机制，而其失效后果（平台侧把多号关联为矩阵行为）
在本地没有任何可观测信号。

#### Scenario: 三档平台间隔相等且等于 1 分钟

- **WHEN** 分别解析 `long` / `clip` / `short` 任一档的代表平台
- **THEN** 三者的 `platformMinMs` MUST 相等，且 MUST 等于 `1 * 60 * 1000`
- **AND** 把其中任一档改回更大的值 MUST 使回归锁变红（等号是收紧，不是放宽）

#### Scenario: 平台间隔归零即视为门禁缺失

- **WHEN** 任一已登记平台的 `platformMinMs` 解析结果为 `0`（且并非用户显式覆盖）
- **THEN** 回归锁 MUST 变红，包括"每个维度均为正数"这条既有锁
- **AND** 运行期 `guard.check()` MUST NOT 因平台档归零而把跨账号并行判为可直接提交

#### Scenario: 跨账号并行仍被错开

- **WHEN** 同平台账号 A 刚完成一次发布（在 1 分钟窗口内），账号 B 从未发布
- **THEN** 账号 B 的账号档不阻塞，但因平台档窗口未满而被阻塞，`bucket` MUST 报 `platform`

### Requirement: 日配额必须保持与内容形态同向的单调性

系统 SHALL 按档位提供 `accountDailyMax`，v4 取 `long 200 / clip 350 / short 500`，并 MUST 满足
`long < clip < short`（长文日配额最少）。日配额数值 MUST 由策略表单一持有；任何"抬高某档配额"的
改动 MUST 同时被逐平台数据表断言与档间单调断言观察到。

#### Scenario: 逐平台配额等于档位数据表

- **WHEN** 遍历全部已登记平台并解析其 `accountDailyMax`
- **THEN** 每个平台的读数 MUST 等于其所属档在数据表中的值（200 / 350 / 500）
- **AND** 把任一档改回历史值（如 clip 退回 50）MUST 变红

#### Scenario: 配额单调不得反向或被抹平

- **WHEN** 解析 `long` / `clip` / `short` 三档代表平台
- **THEN** MUST 满足 `long.accountDailyMax < clip.accountDailyMax < short.accountDailyMax`
- **AND** 把 `short` 压到与 `long` 相等 MUST 变红

#### Scenario: 日配额抬高不得放大回滚许可

- **WHEN** 使用真实策略表构造守卫并逐档读取"每日可回滚次数"上限
- **THEN** 三档 MUST 全部等于硬顶 `MAX_ROLLBACK_PER_DAY = 5`
- **AND** 该上限 MUST NOT 表达为 `max(2, accountDailyMax)`（配额 ×N 不得把防风闸额度也 ×N）

### Requirement: 回落基线的两维「不弱于」判据（间隔取上界、配额取下界）

系统 MUST 在未登记平台（含非字符串平台标识）回落 `BASELINE_INTERVALS` 并带 `fallback: true` 供守卫出声。
「不弱于」在两个维度上**方向相反**，MUST 分别取界：间隔维度 MUST 不小于所有已登记平台中的最大值；
日配额维度 MUST 不大于所有已登记平台中的最小值。该回落值 MUST 保持为**独立常量**，不得由档位表派生
（否则改档会静默改变回落实质）。当前取值以 `BASELINE_INTERVALS` 为准（账号档引用逐平台表最严值、
平台档 1′、日配额取最严档），本文**不复制数字**。

#### Scenario: 回落三个维度各自满足不弱于
- **WHEN** 比较 `BASELINE_INTERVALS` 与已登记平台策略表
- **THEN** `accountMinMs` 与 `platformMinMs` MUST 分别 ≥ 全域最大值
- **AND** `accountDailyMax` MUST ≤ 全域最小值
- **AND** 把基线日配额写成比任何平台都宽 MUST 变红（由 `checkBaselineStrength()` 的既有锁承担）

#### Scenario: 回落不得为 0 且必须出声一次
- **WHEN** 以未登记平台标识调用 `resolveIntervals`
- **THEN** 返回 MUST 等于 `BASELINE_INTERVALS` 且 `fallback` 为 `true`
- **AND** 三个维度 MUST 均为正数，守卫 MUST 在进程内去重后告警一次，MUST NOT 静默按 0 放行

