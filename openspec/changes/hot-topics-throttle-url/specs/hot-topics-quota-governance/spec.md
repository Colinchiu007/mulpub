# hot-topics-quota-governance Specification

## Purpose

定义热门选题采集的**第三方请求配额**契约：哪些请求必须共享配额、手动刷新的节流边界、
以及限流/熔断状态的跨进程持久化语义。锁的是「对一个真实端点，本应用最多以什么频率请求它」。

## Requirements

### Requirement: 配额按端点而非按来源身份

限流与熔断的键 SHALL 为 `quotaKeyOf(config)`：显式 `throttleKey` 优先，否则 `throttleKey(url)`
（host + path，小写、去查询串与尾斜杠）。**MUST NOT** 使用来源 `id` 作为配额键。
`quotaKeyOf` SHALL 是唯一的键推导真源，service 层不得出现第二份键推导逻辑。
同一配置集中 SHALL NOT 存在「URL 相同但配额键不同」的组合。

#### Scenario: 同一 URL 的两个身份共享配额
- **WHEN** 两个身份（`weibo` 与 `weibo-emotion`）的 `url` 相同、`intervalMinutes` 均为 10
- **THEN** 第一个真实抓取，第二个立即 `skipped === true` 且 `reason === 'throttled-by-url'`（不发第二个请求）

#### Scenario: 不同 URL 配额独立
- **WHEN** 两个身份的 `url` 不同（`weibo` 与 `baidu`）
- **THEN** 两者都不被节流跳过

#### Scenario: 显式共享键优先于 URL
- **WHEN** 两个身份声明相同 `throttleKey`
- **THEN** 即使 URL 相同与否，均共享同一配额（第二个被跳过）

#### Scenario: 配置层无「同 URL 不同配额键」
- **WHEN** 扫描 `CHANNEL_CONFIGS` + `CATEGORY_BOOSTS`（含 fallbacks）的全部条目
- **THEN** URL 相同的条目配额键全部相等

#### Scenario: 微博主渠道与两个垂类补拉共享配额
- **WHEN** 比较 `weibo`、`weibo-emotion`、`weibo-health` 三者的 `quotaKeyOf`
- **THEN** 三者相等

### Requirement: 熔断按端点生效

熔断的失败计数与 OPEN 状态 SHALL 使用与限流相同的配额键。
一个身份连续失败达到阈值 SHALL 让该端点的全部身份跳过（`breakerOpen: true`）。
成功 SHALL 清零该配额键的失败计数。

#### Scenario: 一个身份的失败保护整条端点
- **WHEN** `weibo` 身份对某 URL 连续失败 3 次
- **THEN** `weibo-emotion` 对同一 URL 的抓取直接 `skipped: true, breakerOpen: true`

#### Scenario: 空列表失败记到端点配额上
- **WHEN** 某配置全部尝试都解析出 0 条
- **THEN** 熔断失败计数落在 `quotaKeyOf(cfg)` 上（而非 `cfg.id`）

### Requirement: 手动强制刷新有最小间隔

`fetchTopics({ force: true })` SHALL 受 `MANUAL_REFRESH_MIN_INTERVAL_MS`（> 0）约束：
距上一次**真实** force 抓取不足该间隔时，SHALL 返回当前缓存并带 `throttled: true`，
且 SHALL NOT 发起任何渠道请求。
带非空 `boostCategories` 的调用 SHALL 豁免该间隔（用户指名的补拉意图不得被吞）。
`_lastManualRefreshAt` SHALL 仅在真实放行时更新（被节流时不得更新，否则用户永远刷不动）。
非 force 路径 SHALL 不受影响（仍由缓存 TTL 约束）。

#### Scenario: 间隔内的 force 被节流
- **WHEN** 紧接着上一次真实 force 再次 `fetchTopics({ force: true })`
- **THEN** 返回缓存、`throttled === true`、渠道抓取次数不增加

#### Scenario: 越过间隔后可真实刷新
- **WHEN** 把 `_lastManualRefreshAt` 拨回超过最小间隔后再 force
- **THEN** 正常发起渠道抓取且结果不带 `throttled`

#### Scenario: 定向补拉豁免
- **WHEN** 携带 `boostCategories` 在间隔内 force
- **THEN** 补拉照常执行且结果不带 `throttled`

### Requirement: 限流/熔断状态可持久化且恢复 fail-closed

`ChannelThrottle` 与 `ChannelBreaker` SHALL 提供 `serialize()`（可 JSON 序列化快照）与
`restore(snapshot)`。`restore` 对任何非法载荷（非 JSON、结构不符、键非字符串、数值非有限正数）
SHALL 清空自身状态且 SHALL NOT 抛错 —— 失败方向必须是「退化成无记忆」而非「放行一切」。

#### Scenario: 快照往返保持节流
- **WHEN** `tryAcquire('k1', 10)` 后 `serialize()`，新实例 `restore()` 该快照
- **THEN** 新实例 `tryAcquire('k1', 10)` 返回 false（仍在间隔内）

#### Scenario: 熔断计数往返
- **WHEN** 失败 2 次后 `serialize()`，新实例 `restore()` 后再失败 1 次
- **THEN** `isOpen` 为 true（3 次阈值被恢复并触发）

#### Scenario: 非法载荷 fail-closed
- **WHEN** `restore('not-json')` / `restore({ lastFetch: 'nope' })` / `restore(null)`
- **THEN** 均不抛错，且后续 `isOpen` 为 false

### Requirement: 抓取轮次结束后落盘配额状态

服务 SHALL 在每轮真实抓取完成后把限流/熔断状态写入 settings 键 `hot_topics_throttle_state`
（结构含 `version` / `savedAt` / `throttle` / `breaker` / `lastManualRefreshAt`），
并在构造时恢复。落盘失败 SHALL 只记 warn 不影响抓取主流程；恢复失败 SHALL 只清空状态。

#### Scenario: 构造时恢复
- **WHEN** settings 中存在合法快照并新建服务实例
- **THEN** 限流时间戳与熔断计数被恢复（不再「重启后无记忆」）

#### Scenario: 落盘失败不影响抓取
- **WHEN** `setSetting` 抛错
- **THEN** 仅记 warn，抓取结果正常返回
