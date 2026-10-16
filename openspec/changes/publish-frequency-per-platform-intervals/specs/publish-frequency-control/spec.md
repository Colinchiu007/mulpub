## ADDED Requirements

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
