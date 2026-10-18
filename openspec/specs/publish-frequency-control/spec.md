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

