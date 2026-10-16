# publish-frequency-v4 Delta Specification

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: 未登记平台的回落值必须逐维度不弱于任何已登记平台

系统 SHALL 在未登记平台（含非字符串平台标识）回落 `BASELINE_INTERVALS`，其 v4 取值为
账号间隔 5 分钟、平台间隔 1 分钟、日配额 200 条，并带 `fallback: true` 标记供守卫出声。
"不弱于"在两个维度上方向相反，MUST 分别取界：间隔维度 MUST 不小于所有已登记平台中的最大值；
日配额维度 MUST 不大于所有已登记平台中的最小值。该回落值 MUST 保持为**独立常量**，
不得由档位表派生（否则改档会静默改变回落实质）。

#### Scenario: 回落三个维度各自满足不弱于

- **WHEN** 比较 `BASELINE_INTERVALS` 与已登记平台策略表
- **THEN** `accountMinMs` 与 `platformMinMs` MUST 分别 ≥ 全域最大值
- **AND** `accountDailyMax` MUST ≤ 全域最小值
- **AND** 把基线日配额写成比任何平台都宽（如 600）MUST 变红

#### Scenario: 回落不得为 0 且必须出声一次

- **WHEN** 以未登记平台标识调用 `resolveIntervals`
- **THEN** 返回 MUST 等于 `BASELINE_INTERVALS` 且 `fallback` 为 `true`
- **AND** 三个维度 MUST 均为正数，守卫 MUST 在进程内去重后告警一次，MUST NOT 静默按 0 放行
