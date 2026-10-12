# PRD：热门选题采集配额治理（P0–P3，2026-10-13）

> 分支 `hot-topics-throttle-url`｜关联上一轮风险分析（同会话 2026-10-12）
> 上游：PR #3381（多源扩展 + AI 分类）、#3397（回填）

## 1. 背景与问题定义

对采集频率与机制做逐行取证后，确认四条真实风险（均有代码级证据，非推测）：

| # | 风险 | 机制级根因 | 实际后果 |
|---|---|---|---|
| **P0** | 限流/熔断的键 = 来源身份 `id`，而同一 URL 挂多个 id | `tryAcquire(config.id)` / `breaker.*(config.id)` | `https://weibo.com/ajax/statuses/hot_band` 被 `weibo` + `weibo-emotion` + `weibo-health` 三个身份共用，理论 **3 次/10min**；`https://www.ithome.com/rss/` 被 `ithome-tech` + `ithome-ai` 共用 **2 次/15min**。且 emotion/health 补拉阈值仅 4 条（多标签口径极易低于阈值），IT之家因 AI 补拉源几乎**每轮双打**——这不是理论值，是常态路径 |
| **P1** | 手动刷新 `force:true` 无上限 | UI `refresh(true)` 直达 service，v2 的 force 直接跳过缓存 TTL | 缓存 TTL（10min）只约束自动刷新；**决定第三方压力的是用户点击频率，而它没有上限** |
| **P2** | 跨模块配额不共享 | 快捷采集中文榜 `provider:'hot-topics'`（零新抓取，复用热门选题限流）；但 feed 类 `ithome` 源与热门选题的 `ithome-tech/ai` 补拉源打**同一个 RSS 端点**，两套限流互不知晓 | 同一端点两份配额叠加 |
| **P3** | 限流/熔断是纯进程内存态 | `ChannelThrottle`/`ChannelBreaker` 只有 `Map`，无落盘 | 重启即清零：「重启后的第一轮」= 全渠道并发外呼，且完全不记得 5 分钟前刚打过 |

**更正一条此前的分析误判**：快捷采集的中文热榜源（weibo/zhihu/douyin/bilibili/baidu/toutiao/tencent/tophub/sina_finance/ithome_tech）全部标注 `provider: 'hot-topics'`，注释明写「复用 hot-topics-service，**零新抓取**」。因此**不存在**「两个模块对同一批平台各打一份」的问题——真实重叠只有 `provider:'feed'` 的 `ithome` 源与热门选题补拉源共用同一 RSS。

## 2. 方案

### 2.1 P0：配额键单一真源（核心）

新增 `apps/desktop/electron/services/hot-topics/throttle.js`，把限流器/熔断器抽出并改键：

```
quotaKeyOf(config)  =  config.throttleKey（显式声明） || throttleKey(config.url)
throttleKey(url)    =  host + path（小写、去查询串、去尾斜杠）
```

- **不用 id 作键**：`id` 只用于 `channelStats` 与 UI 展示，不用于配额。
- **忽略查询串**：百度 `?tab=realtime` / `?tab=finance` 是同一台服务器的同一类压力，共享配额。
- **`_mapNative` 式的单一真源纪律**：`quotaKeyOf` 是唯一的键推导函数，service 层禁止第二份实现（避免判据漂移，与 classifier 的 `CATEGORY_KEYS` 同一族问题）。
- 熔断同键：一个身份连续失败，整条端点进入保护。

### 2.2 P1：手动刷新最小间隔

- 新常量 `MANUAL_REFRESH_MIN_INTERVAL_MS = 60_000`。
- `fetchTopics({ force: true })` 在间隔内返回 `{ ...cache, fromCache: true, throttled: true }`，不发请求。
- **豁免**：带 `boostCategories` 的定向补拉不受限（用户指名的补拉意图不能被吞，与评审 MINOR-3 取向一致）。
- 取 60s：拦截「连点刷新」「无脑轮询」，又不至于让用户以为刷新坏了。

### 2.3 P2：显式声明共享配额

`CATEGORY_BOOSTS.tech` 与 `.ai` 两路补拉源加 `throttleKey: 'ithome-rss'`——它们打同一个 RSS 端点，显式共享后从 2 次/15min 降为 1 次/15min，且一方的失败保护另一方。其它同 URL 组合（weibo 三身份）由 URL 归一化天然覆盖，无需额外声明。

### 2.4 P3：状态跨进程落盘

- 新 settings 键 `hot_topics_throttle_state`，结构 `{ version, savedAt, throttle, breaker, lastManualRefreshAt }`。
- 写入时机：每轮真实抓取完成后（`_persistQuotaState`），失败吞掉不影响主流程。
- 恢复时机：构造器 `_restoreQuotaState`。**fail-closed**：任何非法载荷只清空状态（退化成「无记忆」），绝不退化成「放行一切」。

## 3. 数据校验

| 对象 | 规则 | 失败行为 | 位置 | 测试 |
|---|---|---|---|---|
| 配额键 | `throttleKey` 显式值优先，否则 URL 归一化；非法 URL 退化为整串小写 | 不会互相误伤 | `throttle.js:throttleKey/quotaKeyOf` | `throttleKey(url) 归一化` |
| 限流快照 | `lastFetch` 必须是 `[string, positive number][]` | 清空（无记忆），不抛错 | `ChannelThrottle.restore` | `restore 对非法载荷 fail-closed` |
| 熔断快照 | `failures`/`openedAt` 同上；负数、非有限值丢弃 | 清空 | `ChannelBreaker.restore` | 同上 |
| 同 URL 多身份 | 配置层断言：同一 URL 的全部身份配额键唯一 | 测试红 | `hot-topics-quota.test.js` 配置一致性 | `不存在「同 URL 但 throttleKey 不同」` |
| 手动刷新豁免 | `boostCategories` 非空时不做最小间隔判断 | 豁免 | `fetchTopics` P1 分支 | `带 boostCategories … 不受拦截` |
| 落盘失败 | `setSetting` 抛错 | warn 吞掉，主流程继续 | `_persistQuotaState` | （错误路径，人工） |

## 4. 流程（改后）

```
fetchTopics(options)
  ├─ 非 force 且缓存新鲜 → 返回缓存（不变）
  ├─ force 且无 boostCategories
  │    └─ 距上次真实 force < 60s → 返回缓存 + { throttled: true }   ← P1 新增
  ├─ Promise.all(CHANNEL_CONFIGS.map(_collectChannel))
  │     └─ _collectChannel(cfg)
  │          ├─ quotaKey = quotaKeyOf(cfg)                          ← P0 新增
  │          ├─ throttle.tryAcquire(quotaKey, intervalMinutes)      ← 键从 id 改为配额键
  │          ├─ breaker.isOpen(quotaKey)
  │          └─ 主端点 → fallback（顺序）→ 解析 → 空列表判失败
  ├─ 补拉 _collectBoostChannel(source)：同样走 quotaKeyOf            ← P0
  ├─ 评分 → 截断 → LLM 兜底 → 写缓存
  └─ _persistQuotaState()                                           ← P3 新增
```

## 5. 交互逻辑与显示项

| 场景 | 改前 | 改后 |
|---|---|---|
| 用户 10 秒内连点刷新 | 每次都全渠道真实外呼 | 第 2 次起返回缓存；UI 无感知（数据不变），且不再打第三方 |
| 同 URL 的垂类补拉与主渠道同轮触发 | 各自限流，端点被打多次 | 第 2 个身份被跳过（`skipped: true, reason: 'throttled-by-url'`），条目由先到的身份提供 |
| IT之家 tech/ai 两路补拉同轮触发 | 2 次 RSS 请求 | 1 次（tech 先到，ai 复用其结果语义；条目按各自 `board` 归类） |
| 应用重启后立即抓取 | 无记忆，全量并发 | 恢复上次的限流时间戳：仍在间隔内的端点被跳过 |

**说明**：`channelStats` 的 `skipped` 语义不变（跳过不算失败，`ok` 保持 true），UI 的「渠道不可用」标记不受影响。

## 6. 提示文字

本轮**未新增用户可见文案**：P1 的节流返回既有缓存（数据不变，无需提示）；P0 的跳过沿用既有「跳过不算失败」语义；P3 纯主进程状态管理。所有排查信息走主进程日志（`[hot-topics] quota state restored/persist failed`），不进 UI。

## 7. 验收标准

| # | 验收项 | 判据 |
|---|---|---|
| A1 | 同 URL 多身份共享配额 | `weibo` 抓取后，`weibo-emotion` 立即 `skipped:true, reason:'throttled-by-url'` |
| A2 | 不同 URL 互不影响 | `weibo` 与 `baidu` 先后抓取均不跳过 |
| A3 | 熔断按端点生效 | `weibo` 连续 3 败后，`weibo-emotion` 直接 `breakerOpen:true` |
| A4 | 手动刷新节流 | 连续两次 force，第二次 `throttled:true` 且不发请求 |
| A5 | 显式补拉豁免 | 带 `boostCategories` 的 force 不被最小间隔拦截 |
| A6 | 跨端配置一致 | 全配置中不存在「同 URL 但配额键不同」 |
| A7 | 状态跨重启 | `serialize/restore` 往返后仍在间隔内 / 失败计数保留 |
| A8 | 落盘恢复 fail-closed | 非法载荷不抛错、清空 |
| A9 | 无既有行为回归 | 全量回归 0 失败 |

## 8. 测试

- 新增 `electron/services/hot-topics-quota.test.js`（**14 例**）：P0 ×5、P1 ×4、P0/P3 单元 ×3、P2 配置一致性 ×2
- 更新 `hot-topics-new-sources.test.js` 1 例（熔断键从 id 改为配额键，属预期行为变更，断言改用 `quotaKeyOf`）
- **变异反证**：把 `quotaKeyOf` 改回「id 作键」→ **5 例当场变红**（A1/A3/补拉/配置一致性/共享键），变异后按内容还原

## 9. 风险与回滚

| 风险 | 缓解 | 回滚 |
|---|---|---|
| URL 归一化把「同 host 不同端点」误合并 | 归一化保留 path；仅去掉 query | 给相关配置加显式 `throttleKey` |
| 60s 手动刷新间隔让用户觉得「刷新没反应」 | 返回缓存 + `throttled` 标记，数据可见；60s 后可真实刷新 | 常量改小或 UI 提示 |
| 状态落盘体积增长 | 仅存配额键 → 时间戳，条目数 = 端点数（≤16） | 删除 `hot_topics_throttle_state` |
| 补拉被主渠道「抢占」配额导致垂类供不上 | 补拉源可用 `throttleKey` 与主渠道隔离（保留逃生门）；本轮 weibo 三身份刻意共享（这正是要修的） | 移除 `throttleKey` 或恢复 id 键 |

## 10. 明确不做

- 不改 UI 的刷新按钮/定时器（服务层已治理，UI 无需感知）
- 不改快捷采集的 feed 抓取限流（其自身已有 intervalMinutes 节流，且中文榜零新抓取）
- 不引入分布式/跨进程锁（单用户桌面应用，settings 落盘已足够）
- 不给「教育/国际」等无源分类补配置（与上一轮结论一致）
