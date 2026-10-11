# 设计：快捷采集·中文素材源扩展

## 1. 为什么需要两套语义（kind 与 timeKind），而不是「再多加几个源 id」

若把中文榜单直接塞进现有 `sources: ['reddit','hackernews','github']` 这条链：

- 该链的语义是「**用关键词去查**」（`searchFn(keyword, { sources, relevanceOn })`），榜单**没有查询词**，
  硬塞进去等于把「查什么得什么」的相关性门禁语义搅浑（AGENTS.md 明令该门禁挂在共用出口且策略进缓存键）；
- 榜单条目**没有发布时间**，而现有 `normalizeMaterial` 在 `windowHours>0` 时对缺时间戳一刀切丢弃（`missing_time`）——
  接了也**永远是空**。

因此本设计引入两个正交维度：`kind`（怎么取）与 `timeKind`（时间从哪来）。二者都是**声明式**的，落在源注册表里。

## 2. 源注册表（唯一真源）

```js
// quick-collect-sources.js（节选，示意）
{ id: 'weibo', label: '微博热搜', kind: 'trend', sourceType: 'hottest', timeKind: 'observed',
  homeUrl: 'https://s.weibo.com/top/summary', expectedDomains: ['weibo.com', 's.weibo.com'],
  intervalMinutes: 10, riskLevel: 'medium', group: 'cn-hot', provider: 'hot-topics' }
{ id: 'arxiv_cs_ai', label: 'arXiv cs.AI', kind: 'trend', sourceType: 'realtime', timeKind: 'published',
  feedUrl: 'https://export.arxiv.org/rss/cs.AI', expectedDomains: ['arxiv.org', 'export.arxiv.org'],
  intervalMinutes: 60, riskLevel: 'low', group: 'tech', provider: 'feed' }
```

- 指令层闭集 = `ALL_SOURCE_IDS`（派生，不手写第二份）；
- `splitSources(ids)` ⇒ `{ search: [...], trend: [...] }`，未知 id 在校验层即拒绝（`QC_SOURCES_INVALID`）；
- 渲染端持有一份**镜像清单**仅用于 UI 分组提示，跨平面 parity 测试断言两侧逐项一致。

## 3. 统一素材模型与时间语义

素材（`normalizeMaterial` 输出）字段见 PRD §5。窗口判定：

```js
const effective = timeKind === 'observed' ? observedAt : createdUtc
if (windowHours > 0) {
  if (effective == null) return { ok: false, reason: 'missing_time' }      // 不变：无法证明"最近"
  if (effective < cutoff) return { ok: false, reason: 'out_of_window' }
  if (effective > nowSec + 86400) return { ok: false, reason: 'future_time' }
}
```

**关键取舍（诚实性）**：`observed` 素材在窗口内**必然通过**（observedAt 就是抓取时刻）。这不是漏洞，而是把
「我看到的是一份当前榜单」如实表达出来——所以：

1. 素材与提示词**必须同时带上** `timeKind` 与 `rank`，让模型知道这是「榜单第 N 位（抓取于 X）」；
2. system 提示词加一条硬约束：**不得**把榜单素材写成「最近 48 小时发布」；
3. UI 结果卡按 `timeKinds` 分两类标签（抓取时刻 / 发布时间）；
4. 跨会话的「名次跃迁/在榜时长」本期不做（需落盘历史，见 PRD §15）。

## 4. 执行链（分流与合并）

```
run(command)
 ├─ validate/normalize（闭集：源 id、kind 归属、窗口、关键词）
 ├─ splitSources(command.sources) ⇒ { search, trend }
 ├─ search 分支（逐关键词，最多 3 个，行为与现网逐字一致）
 ├─ trend 分支（一次调用，注入的 trendFn(sourceIds, { windowHours, limit, now })）
 ├─ mergeMaterials([...searchItems, ...trendItems], { windowHours, now })
 ├─ summarizeRetrieval({ searchQueryCount, trendSourceCount, materialCount, failedQueries })
 └─ buildMessages → llmFn → normalizeCollectedItem
```

三态口径：`attempted = searchQueryCount + trendSourceCount`；`attempted<=0 ⇒ skipped`；有素材但有失败 ⇒ `partial`；
无素材 ⇒ `empty`；否则 `ok`。（既有纯英文指令行为不变：trendSourceCount=0。）

## 5. 抓取层（S2）与限流/缓存/降级

- **解析分档**：JSON（V2EX hot / HF daily_papers）、RSS/Atom（Solidot/少数派/OSCHINA/IT之家/V2EX index/量子位/InfoQ/arXiv/hnrss）。
  RSS 解析走**轻量正则提取**（与仓库既有 `parseIthomeRSS` 同族），不引入新依赖。
- **字节上限**：`MAX_BYTES = 512 * 1024`（实测雷锋网 1.3MB / OpenAI News 1.2MB / HF blog 258KB）；超限截断后按完整条目边界解析。
- **条数截断**：每源 `MAX_PER_SOURCE = 20`；进提示词总量仍受 `MATERIAL_LIMIT = 12` 约束。
- **时间解析**：RFC2822（`<pubDate>`）与 ISO8601（Atom `<published>`）；**HF `publishedAt` 为 `MM/DD/YYYY HH:mm:ss`**，
  单独走美国格式解析并在测试里锁死（错解析会把 2026-10-07 读成 2026-07-10）。
- **节日/周末空榜**：arXiv `skipDays` 含 Sat/Sun ⇒ 空结果标记 `emptyBySchedule`，UI 文案为「该源周末不更新」，不是故障。
- **限流**：每源 `intervalMinutes`，内存节流（只有放行去抓的请求消耗一个 interval）+ 熔断（连续失败冷却）。
- **缓存**：trend 结果内存缓存，键 = `namespace + 排序后的源 id + windowHours`，TTL 10 分钟。
- **域名校验**：条目 url 的 host 必须在源的 `expectedDomains` 内（含子域），否则丢弃并计 `domain_mismatch`；
  抖音这类 `url=null` 的条目使用 `homeUrl` 并标 `urlKind: 'board'`。
- **失败降级**：单源失败只影响该源（`sourceStats[src] = 'failed'`），不逐条污染其他源；全失败 ⇒ 素材空 ⇒ 引擎声明行。

## 6. 提示词变更

- 素材清单每行形如：`[微博热搜#3 · 抓取时刻 2026-10-11 15:20 UTC+8] 标题 — https://…`
  （`published` 类则写 `[Solidot · 发布 2026-10-11 09:12 UTC+8]`）；
- system 增两条：① 素材时间语义只能按标签描述，**不得**把抓取时刻写成发布时间；② 来源标签必须原样引用，
  未知来源如实回显 id，禁止编造来源。
- `builtin-ai-trends` 的**用户提示词逐字不动**（需求原文），只增补源。

## 7. 兼容性与回滚

- 旧指令（只有 `reddit/hackernews/github`）行为逐字不变：`trend` 分支为空 ⇒ 不调用 `trendFn`。
- 回滚 = 还原 registry 的 trend 段 + 引擎分流（若本轮只上 S1，回滚面仅 4 个文件 + 1 个新模块）。
- 落盘设置键不变（`quick_collect_commands`），无数据迁移。

## 8. 开源调研与借鉴（证据分级；许可证边界见 PRD §12）

| 借鉴点 | 出处 | 许可证 | 证据级别 |
| --- | --- | --- | --- |
| 可空 `hot`/`timestamp` schema、`fromCache`/`updateTime` 新鲜度 | DailyHotApi `src/types.d.ts`、`registry.ts` | MIT | 逐字读到源码 |
| `interval` vs `TTL` 两级新鲜度、`status: success\|cache`、`SourceOption.hiddenDate` | NewsNow `shared/consts.ts` / `types.ts` / `server/utils/source.ts` | MIT | 逐字读到源码 |
| 缓存键 + 单飞锁 + 按 host 限流（只有放行请求消耗 interval） | RSSHub `lib/middleware/cache.ts` / `lib/utils/host-rate-limit.ts` | AGPL-3.0 | 逐字读到源码，**仅借鉴设计** |
| 榜单模型 `rank` + `rank_history` + `first_crawl_time`/`crawl_count`、`platforms(id 不变,name 可变)` | TrendRadar `trendradar/storage/schema.sql` | GPL-3.0 | 逐字读到源码，**仅借鉴结论** |
| `expected_domain` 整源丢弃 + 告警 | TrendRadar `config/config.yaml` | GPL-3.0 | 逐字读到原文 |
| 声明式源注册表（`type: hottest\|realtime`、`sub`、`disable`、`redirect`） | NewsNow `shared/pre-sources.ts` | MIT | 逐字读到源码 |

**不可用**：wechat2rss（无 LICENSE ⇒ 代码不可复用；公众号直采亦需登录态）；内嵌 RSSHub/TrendRadar 代码（GPL/AGPL 传染）；
实测失效源（机器之心 0 条目 / PingWest 空 feed / 虎嗅超时）。
