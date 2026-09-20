# PRD：热门选题分类供给增强（方案 A-E 全量实现）

- 日期：2026-09-20
- 分支 / worktree：`hot-topics-category-supply` / `D:/Data/projects/mp-worktrees/mp-hot-topics-category-supply`
- 范围：apps/desktop（electron 主进程 + renderer + locales）——新增功能 + Bug 修复（M/中风险）
- 关联：热门选题页（`src/views/HotTopics.vue`）、`electron/services/hot-topics-service.js`

## 1. 背景与根因

用户反馈：热门选题页「财经、科技、情感、教育、健康、国际」分类下内容稀少甚至为 0。

根因分析（2026-09-20 四轮端点探测 + 代码审计结论）：

| # | 根因 | 影响 |
|---|------|------|
| 1 | 抓取量结构性不足：`MAX_PER_CHANNEL=20`、`MAX_TOPICS=160`，8 渠道 × 20 条里约 7 成被社会/娱乐/体育类高热词占据 | 长尾分类天然分不到条目 |
| 2 | 分类器「society 黑洞词」：关键词表含裸字「判」等单字词，`文本.includes('判')` 把大量含"判断/审判/预判"的普通选题误判为 society | 污染其他分类，society 虚高 |
| 3 | 单标签互斥：一条选题只允许一个分类，横跨多领域（如"医保谈判"= society+health+finance）被最高优先级独占 | 其他分类计数为 0 |
| 4 | 微博原生分类映射表过窄：hot_band 返回 51 条含原生「情感/财经/健康医疗」分类，但 RAW_CATEGORY_MAP.weibo 未映射 → 全部落 general，emotion=0 | 现成数据被浪费 |
| 5 | 无垂类定向供给：所有分类共享同一批综合榜，稀疏分类没有补充渠道 | 稀疏恒稀疏 |

## 2. 方案总览（A-E 全部落地）

| 方案 | 内容 | 落点文件 |
|------|------|---------|
| A | 放宽抓取量（20→50/渠道、160→400 总量）+ 分类器修复（黑洞词、打分制、多标签 categories[]、微博映射扩容、知乎/腾讯端点提量） | `classifier.js`、`channels.js`、`hot-topics-service.js` |
| B | 稀疏分类定向补拉：主聚合后分类条目数低于阈值、或 UI 显式指定 boostCategories 时，追加抓取该分类垂类榜 | `hot-topics-service.js`（`CATEGORY_BOOSTS`、`_collectBoostChannel`） |
| C | LLM 分类兜底：仍为 general 的条目批量交 LLM 分类，结果落盘缓存；未配置模型/失败静默降级 | `hot-topics/llm-classifier.js`（新）、`hot-topics-service.js`（`_applyLlmLabels`）、`phase1-context.js`（接线） |
| D | 稀疏分类专属渠道：百度财经 tab、新浪财经滚动、IT之家 RSS、微博情感/健康医疗垂类过滤 | `channels.js`（`parseSinaFinance`、`parseIthomeRSS`）、`CATEGORY_BOOSTS.sources` |
| E | UI 增强：分类 chip 显示计数、空分类「补拉该分类」按钮、多标签过滤与双标签展示 | `HotTopics.vue`、`src/api/hot-topics.js`、`ipc-handlers/hot-topics.js`、locales |

### 端点探测结论（2026-09-20 实测）

- ✅ 可用：`top.baidu.com/api/board?tab=finance`、`feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516`、`ithome.com/rss/`、`weibo.com/ajax/statuses/hot_band`（原生 category 过滤）
- ❌ 不可用（放弃）：知乎分域 hot-list 域名参数、头条分类参数、百度 education tab、v2ex、B站 partitions 榜单
- 结论：教育/国际无稳定垂类端点 → `CATEGORY_BOOSTS.education/international.sources = []`，依赖方案 A（映射/关键词修复）+ 方案 C（LLM 兜底）补充。

## 3. 数据契约

### 3.1 条目结构（`topics[]`，IPC `hot-topics:fetch` / `get-cache` 返回）

```
{
  id: string,           // 主榜 "channel:rank"（不变）；补拉 "channel:board:rank"（如 weibo:emotion:3）
  topic: string,        // 选题文本
  channel: string,      // 渠道键：zhihu/toutiao/tencent/bilibili/douyin/baidu/weibo/tophub/sina_finance/ithome_tech
  category: string,     // 主分类（10 枚举之一，兼容旧缓存字段）
  categories: string[], // 【新增】多标签，1-3 个，主分类恒在首位；旧缓存条目可能缺失（渲染端回退 [category]）
  rank: number, hotValue: string|null, url: string|null, fetchedAt: number
}
```

- 分类枚举（10）：`general / society / finance / tech / entertainment / sports / game / emotion / health / education / international`（`CATEGORY_KEYS`）。
- `channelStats` 增加补拉渠道的统计项（key = source.id，如 `baidu-finance`）。

### 3.2 持久化键（SQLite settings）

| key | 内容 | 校验 |
|-----|------|------|
| `hot_topics_cache` | `{topics, fetchedAt, channelStats}` | JSON 解析失败/结构不符 → fail-closed 回退空结构，不崩溃 |
| `hot_topics_llm_labels`（新） | `{ [选题文本]: 分类枚举 }` | 解析失败回退 `{}`；条目上限 500，超限按插入序裁剪最旧 |

### 3.3 IPC 入参校验（`hot-topics:fetch`）

- `force`：布尔化（`!!payload.force`）。
- `boostCategories`（新）：非数组 → `[]`；逐项要求 `typeof === 'string' && length <= 32`，不合法项剥离；总数 `slice(0, 10)`。非法输入不抛错，静默净化。

## 4. 功能逻辑

### 4.1 方案 A：抓取量 + 分类器

1. `MAX_PER_CHANNEL = 50`、`MAX_TOPICS = 400`；知乎端点改 `api.zhihu.com/topstory/hot-list?limit=50`，腾讯 `page_size=50`；所有渠道解析器 slice 上限同步 50。
2. 微博 `hot_band` 解析兼容双形态：`json.data.band_list` 与 `json.data` 数组；topic 取 `word || title`。
3. 分类器 `classifyTopicMulti(rawCategory, channel, topicText)` → `{category, categories}`：
   - 渠道原生分类（映射表命中）优先作为主标签；微博映射表扩容（情感→emotion、财经→finance、健康医疗→health、教育/校园→education、健身/养生→health、汽车→tech、艺人→entertainment、职场/法律→society、育儿→emotion 等），另增 `GENERIC_RAW_MAP` 使任意渠道的 10 类中文原生分类生效（新浪财经 rawCategory='财经' 经此命中）。
   - 关键词打分制：每分类得分 = 命中关键词的长度之和（越长越具体，天然抑制裸字误伤）；`Array.sort` 稳定排序保优先级。
   - 标签合并：原生主标签在前，关键词得分降序补足，去重后 `slice(0, 3)`；全空 → `['general']`。
   - society 黑洞词修复：移除裸字「判」，改强词「审判/判决/判刑/案发」；health 增「卫健委/疾控/新药/门诊/手术/医疗/医保」；sports 增「决赛/世预赛」；emotion 增「情侣/表白/失恋」。
   - 向后兼容：`classifyTopic`（v1 字符串契约）行为保留，既有调用方不受影响。

### 4.2 方案 B/D：定向补拉 `CATEGORY_BOOSTS`

| 分类 | threshold | 补拉源（source.id → 端点 / 解析器 / 直挂分类） |
|------|-----------|-----------------------------------------------|
| finance | 6 | `baidu-finance`（百度 tab=finance，复用 baidu 解析器，board=finance）；`sina-finance`（新浪 roll API，`parseSinaFinance`，channel=sina_finance） |
| tech | 6 | `ithome-tech`（IT之家 RSS，`parseIthomeRSS` 兼容 CDATA/实体，channel=ithome_tech） |
| emotion | 4 | `weibo-emotion`（微博 hot_band + `filterCategory:'情感'` 解析后过滤） |
| health | 4 | `weibo-health`（`filterCategory:'健康医疗'`） |
| education / international | 4 | 无稳定端点，sources=[]（A+C 兜底） |

流程（`fetchTopics`）：
1. 新鲜缓存命中（TTL 10min，非 force）→ 直接返回（`preservedStaleCache` 检查在前，语义不变）。
2. 主聚合（8 渠道，逻辑同 v1，条目带 categories）。
3. 统计各分类计数（多标签口径：条目在每个关联分类下都计数）。
4. 触发条件：`(counts[cat] || 0) < cfg.threshold` **或** `boostCategories.includes(cat)`（UI 显式指定不受阈值限制）→ 并发抓取该分类全部 sources。
5. 补拉条目：独立限流/熔断键（source.id，与主渠道互不影响）；`filterCategory` 命中才保留；id 含 board 段防撞号；主分类直挂 boostCategory，categories=[boostCategory, 关键词标签…]。
6. `_aggregate` 去重合并：跨渠道同文本合并 mergedFrom；**分类升级**——general 条目先到、补拉明确分类后到时，提升主分类并并入标签（反向不降级）。
7. `slice(0, MAX_TOPICS)` → 方案 C LLM 兜底 → 写缓存。

### 4.3 方案 C：LLM 分类兜底

- 接线：`phase1-context.js` 在 `providerRouter` 创建后 `hotTopicsService.setLlmClassify(createLlmTopicClassifier({ modelProviderManager, log }))`（构造期注入亦可，deps.llmClassify）。
- 应用（`_applyLlmLabels`）：
  1. 收集 `category === 'general'` 且未命中落盘缓存的条目，单轮上限 `LLM_BATCH_LIMIT = 40`（成本控制）。
  2. 先查 `hot_topics_llm_labels` 缓存，命中直接回填（不再请求）。
  3. 未命中文本批量送 `llmClassify` → 返回 `{选题文本: 分类}`；**校验**：值必须 ∈ CATEGORY_KEYS，非法值忽略；主分类升级 + categories 并入。
  4. 有变更才落盘（追加写，超 500 裁剪）。
- **降级合同（fail-open）**：未注入 llmClassify / 未配置默认 llm provider / 调用抛错 / 输出不可解析 → 全部静默返回 `{}`，保持关键词分类结果，抓取主流程绝不因 LLM 失败而报错。
- LLM 适配器 prompt 合同：要求只输出 JSON `{"序号":"分类键"}`；正则 `\{[\s\S]*\}` 提取；序号映射回选题文本；temperature=0，max_tokens=800；单条文本截断 200 字符。

### 4.4 方案 E：UI 交互

| 交互/显示项 | 逻辑 | 提示文字（locale key） |
|-------------|------|------------------------|
| 分类 chip 计数 | 每个分类按钮右侧显示 `categoryCounts[cat]`（多标签口径）；`data-testid="hot-topic-cat-count-<cat>"`；「全部」不显示 | — |
| 多标签展示 | 条目行 category-tag 由单标签改为 `topicCategories(topic).slice(0, 2)`，最多展示 2 个标签，各自带 `cat-<key>` 配色 | `hotTopics.categories.<key>` |
| 多标签过滤 | `filteredTopics` 分类匹配改为 `topicCategories(x).includes(activeCategory)`；兼容旧缓存（无 categories 回退 [category]） | — |
| 空分类补拉 | 全局有数据但当前分类过滤后为空 → EmptyState 切换文案 + 按钮改「补拉该分类」→ `refresh(force=true, boostCategories=[当前分类])` | `hotTopics.emptyCategoryTitle`＝"该分类暂无内容"；`emptyCategoryDesc`＝"当前分类下暂时没有选题，可定向补拉该分类垂类榜单"；`boostAction`＝"补拉该分类" |
| 空态（原有） | 全局无数据时维持原文案与「立即刷新」行为 | `emptyTitle` / `emptyDesc` / `emptyAction` |
| 渠道筛选下拉 | 新增 `sina_finance`＝"新浪财经"、`ithome_tech`＝"IT之家" | `hotTopics.channels.*` |

调用链：`HotTopics.vue refresh(force, {boostCategories})` → `api/hot-topics.js hotTopicsFetch(force, boostCategories)` → preload（payload 整体透传，**preload 与 bundle 无需改动**）→ `ipc-handlers/hot-topics.js`（净化）→ `HotTopicsService.fetchTopics({force, boostCategories})`。

## 5. 显示项汇总（用户可见变化）

1. 10 个分类按钮各带灰色计数角标（实时反映当前数据集内该分类条数，含多标签）。
2. 选题行标签列最多出现 2 个分类标签（主分类 + 次标签），颜色沿用既有 `cat-*` 调色板。
3. 选中空分类时空态文案变为「该分类暂无内容…」，主按钮变为「补拉该分类」，点击后强制刷新并定向补拉该分类垂类榜，成功后该分类计数与列表更新。
4. 渠道筛选多选新增「新浪财经」「IT之家」两项。
5. 全部分类条数预期显著提升（财经/科技/情感/健康最明显；教育/国际经 LLM 兜底提升）；配置过模型时首次抓取后因 LLM 批量分类略有延迟，之后走标签缓存零开销。

## 6. 非功能需求与约束

- 反爬纪律：补拉源与主渠道共用限流（各自独立键）与熔断（3 次失败 OPEN 30min）；单渠道抓取超时 10s 不变。
- 隐私：LLM 兜底仅发送选题文本（截断 200 字符），用户未配置模型时零外发。
- 性能：单次抓取新增最多 6 个补拉请求（全部并发、独立失败），总耗时上界仍受 10s 超时约束。
- 缓存兼容：旧缓存（无 categories 字段）读入后渲染端回退 `[category]`，不要求清缓存升级。

## 7. 验收标准与测试

| 验收项 | 测试 |
|--------|------|
| 常量与导出（50/400/LLM_LABELS_KEY/CATEGORY_BOOSTS） | hot-topics-service.test.js「Plan A」 |
| society 黑洞词不再误判、强词仍命中 | Plan A 分类器用例 |
| 微博映射扩容后 emotion 原生分类直挂 | Plan A |
| classifyTopicMulti 返回 1-3 标签、主分类在首位、general 兜底 | Plan A |
| 各解析器 50 上限、parseWeibo 双形态 | Plan A |
| 阈值触发补拉 + boost id 含 board 段 + 显式 boostCategories 不受阈值限制 | Plan B/D |
| parseSinaFinance / parseIthomeRSS（含 CDATA） | Plan D |
| LLM 标签应用 / 落盘缓存不重复请求 / 抛错静默 / 未注入跳过 / 非法分类忽略 | Plan C（5 用例） |
| IPC 透传与净化 | hot-topics.assembly.test.js |
| UI：计数 chip / 多标签过滤 / 空分类补拉按钮 / fetch 参数 | HotTopics.test.js 35 例 |
| locale zh/en 成对 | CI Gate 7 + check-locale-sync --keys PASS |

真机验证口径：打包后打开热门选题页，确认 6 个稀疏分类计数 > 0；点击教育分类（sources=[]）验证 LLM 兜底路径（配置模型后 general 条目被重新分类）。

## 8. 已知边界

- 教育/国际无垂类端点，供给依赖主榜关键词 + LLM 兜底，稀疏度高于 finance/tech 属预期。
- 补拉受各渠道限流窗口约束（微博 10min、百度 10min、新浪/IT之家 15min），连续点击「补拉该分类」在窗口内静默跳过（不报错，返回既有聚合结果）。
- LLM 分类质量依赖用户所配模型；输出合同校验失败即忽略，宁缺勿错。
