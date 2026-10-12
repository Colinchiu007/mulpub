# 变更：热门选题采集配额治理（hot-topics-throttle-url）

## Why

对采集频率与机制做逐行取证后确认四条真实风险（均有代码级证据）：

1. **P0（最严重）**：限流/熔断的键是来源身份 `id`，但同一 URL 常挂多个 id ——
   `weibo` 主渠道 + `weibo-emotion` + `weibo-health` 补拉共用 `https://weibo.com/ajax/statuses/hot_band`，
   `ithome-tech` + `ithome-ai` 补拉共用 `https://www.ithome.com/rss/`。按 id 计数等于没有配额：
   换个 id 就能再来一次。emotion/health 补拉阈值仅 4（多标签口径极易触发），IT之家因 AI 补拉源
   几乎每轮双打 —— 这是常态路径，不是理论值。
2. **P1**：UI 的 `refresh(true)` 直达 service 的 `force:true`，v2 里 force 直接跳过缓存 TTL。
   缓存 TTL（10min）只约束自动刷新；**决定第三方压力的是用户点击频率，而它没有上限**。
3. **P2**：`provider:'feed'` 的快捷采集 `ithome` 源与热门选题的 `ithome-tech/ai` 补拉源打同一 RSS，
   两套限流互不知晓，同一端点两份配额叠加。
4. **P3**：限流/熔断是纯进程内存态，重启即清零 ——「重启后的第一轮」= 全渠道并发外呼，
   且完全不记得 5 分钟前刚打过同一批端点。

**同时更正上一轮分析的一条误判**：快捷采集的中文热榜源（weibo/zhihu/douyin/bilibili/baidu/
toutiao/tencent/tophub/sina_finance/ithome_tech）全部标注 `provider: 'hot-topics'`，
注释明写「复用 hot-topics-service，**零新抓取**」。因此**不存在**「两个模块对同一批平台
各打一份」的问题 —— 本轮不做跨模块限流器抽取，只做同端点配额共享。

## What Changes

- **新增** `apps/desktop/electron/services/hot-topics/throttle.js`：
  `throttleKey(url)`（host+path 归一化，去查询串）、`quotaKeyOf(config)`（**唯一真源**：
  显式 `throttleKey` > URL 归一化，**不用 id**）、可持久化的 `ChannelThrottle` / `ChannelBreaker`
  （`serialize()`/`restore()`，restore 对非法载荷 fail-closed）。
- **service 层**：`_collectChannel` / `_collectBoostChannel` 的限流与熔断键从 `id` 改为
  `quotaKeyOf(config)`；跳过结果带 `reason: 'throttled-by-url'` 便于排查。
- **P1**：新增 `MANUAL_REFRESH_MIN_INTERVAL_MS = 60_000`；`force` 在间隔内返回缓存 +
  `throttled: true`；带 `boostCategories` 的定向补拉豁免。
- **P2**：`CATEGORY_BOOSTS.tech/.ai` 两路补拉源显式 `throttleKey: 'ithome-rss'` 共享配额
  （2 次/15min → 1 次/15min，且一方的失败保护另一方）。
- **P3**：新 settings 键 `hot_topics_throttle_state`；每轮真实抓取后落盘，构造器恢复；
  恢复失败只清空（无记忆），绝不退化成「放行一切」。
- **配置一致性回归锁**：断言全配置中不存在「同 URL 但配额键不同」的组合。

## 不做（明确排除）

- 不改 UI 刷新按钮/定时器（服务层已治理，UI 无需感知，也未新增用户可见文案）。
- 不改快捷采集 feed 源的抓取限流（其自身已有 intervalMinutes 节流）。
- 不抽跨模块公共限流器（中文榜零新抓取，抽取无收益且增加耦合）。
- 不引入分布式/跨进程锁（单用户桌面应用，settings 落盘足够）。
- 不给「教育/国际」等无源分类补配置（与上一轮结论一致）。
