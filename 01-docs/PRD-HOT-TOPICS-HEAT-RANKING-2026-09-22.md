# PRD：热门选题统一热度排序（P0-P3 全量实现）

> **文档类型**: 产品需求文档（PRD）｜ 配套功能设计文档：`DESIGN-HOT-TOPICS-HEAT-RANKING-2026-09-22.md`
> **日期**: 2026-09-22 ｜ **分支**: `hot-topics-heat-ranking` ｜ **PR**: 见 GitHub `Colinchiu007/Multi-Publish`
> **前置**: PRD-HOT-TOPICS-CATEGORY-SUPPLY-2026-09-20（v2 聚合管线，本 PRD 在其之上叠加"排序科学性"层）

---

## 1. 背景与问题

热门选题页自 v2 聚合管线后，**内容供给**问题（垂类分类稀疏）已解决，但**排序**仍是"聚合偶然性"而非"热度"：

- 列表顺序 = 渠道数组固定顺序（知乎→头条→腾讯→B站→抖音→百度→微博→tophub）依次追加，先抓的渠道霸占前排；
- 「百度/微博榜首」排在「知乎榜尾」之后，用户看到的"排名"实为数组位置；
- 切到任意分类后仍是渠道块状分布，不是该分类内由热到冷；
- 「补拉该分类」补回的垂类头条永远垫底，400 条配额被排前渠道抢占；
- 同时上多个榜的全民事件与单渠道榜尾事件位置无差异；多源信号（mergedFrom）完全浪费；
- 上一轮旧闻与新上榜条目平权，无时间衰减。

**用户价值**：打开页面第一眼看到的就是当下真正最热的事；能理解"为什么它排前面"（名次、多榜、来源热度、升降趋势）。

## 2. 需求范围（P0-P3 全部落地）

| 优先级 | 需求 | 交付 |
|--------|------|------|
| P0 | 统一热度评分 + 先排后截 + 分类内重排 | `scorer.js` 评分器；service 聚合尾部接线；UI filteredTopics 按 score 重排 |
| P1 | 排名可解释性 UI | 统一名次徽标（viewRank）、多榜徽标、trend 箭头、热度 tooltip |
| P2 | 时间衰减 + 渠道权重配置化 | \(2^{-age/6h}\) 衰减 + 跨轮 carry-over；settings 键 `hot_topics_rank_config` |
| P3 | 工程健壮性 | 确定性决胜、score/sourceCount 落盘字段与旧缓存兼容回退、来源名次+热度文案 |

**非目标**：个性化推荐、点击反馈闭环、UI 配置面板（配置到 settings 键为止）、去重算法变更。

## 3. 功能逻辑

### 3.1 评分（详见设计文档 §2）

`score = clamp01(base·w_c·decay·0.9 + 0.12·log₂(sourceCount))`

- **base** = max(渠道内热度百分位 heatNorm, 名次归一 rankNorm)——RSS 渠道无 hotValue 时名次兜底，不因字段缺失得 0 分；渠道内单条/全同值视为无分布信息（heatNorm=−1 交名次兜底，不给假满分）；
- **w_c** 渠道权重：微博/百度/抖音/头条/知乎 1.0，腾讯 0.95，tophub 0.9（微博镜像降权），B站 0.85，垂类源（新浪财经/IT之家）0.8，未登记 0.9；
- **decay**：半衰期 6h，本轮新条目 age=0 不衰减；本轮被限流/熔断/失败跳过的渠道，沿用上轮缓存条目参与评分并随 age 自然下沉（carry-over，评审 M-1）；
- **多榜加成**：同时上榜渠道数越多加分越高（2 榜 +0.12，4 榜 +0.24），是三套独立算法共同验证的最强信号。

### 3.2 排序与截断

- 全量条目先统一评分排序（同分按 来源名次→渠道名→id 确定性决胜，刷新不抖动），再截断 400 条落盘——配额按热度分配，boost 补拉条目按真实热度插位不再机械沉底；
- `viewRank`（1..N）是统一名次唯一真源，落盘；
- **例外（保持既有合同）**：全渠道零结果时 preserve 原样返回上轮缓存，不评分不重排（防清空语义）。

### 3.3 trend（跨轮对比）

与上一轮缓存按**选题文本**匹配（id=渠道:名次 跨轮不稳定）：名次升 ≥3 → `up`；降 ≥3 → `down`；上轮无此条 → `new`；其余 `flat`；首轮（无上轮）→ 空（不显示）。

### 3.4 配置化

settings 键 `hot_topics_rank_config`（JSON，可选）：`{ "channelWeights": { "weibo": 1.0, ... }, "halfLifeMs": 21600000 }`

- **合并语义**：只覆盖列出的渠道，未列渠道保持内置权重；非法项（非有限正数）逐键丢弃；
- fail-closed：缺省/JSON 解析失败/非对象 → 全用内置默认，仅 warn 不抛错；
- 非法 `halfLifeMs ≤ 0` → 回退默认 6h。

## 4. 显示项与提示文字（UI 规格）

### 4.1 显示项

| 位置 | 显示内容 | 出现条件 | 提示文字（tooltip，zh/en 成对） |
|------|---------|---------|--------------------------------|
| 条目行首徽标 | **统一名次**（viewRank，全列表唯一序） | 恒显示；旧缓存无 viewRank 回退视图序号 | 「来源第 {rank} 名 · 综合热度 {heat}」（heat=score×100 取整）；旧数据无 score 回退原文案「来源第 N 名」 |
| 渠道标签后 | **「多榜」chip**（橙色徽标） | sourceCount ≥ 2（旧缓存按 mergedFrom 去重且排除主渠道自身回退计算） | 「同时上榜：{渠道中文名顿号连接}」 |
| 条目行内 | **↑**（红）/ **↓**（绿）/ **「新上榜」**（蓝 chip） | trend = up / down / new；flat 与首轮空不渲染 | 「较上轮上升」/「较上轮下降」/「新上榜」 |

### 4.2 交互逻辑

| 交互 | 行为 |
|------|------|
| 切换分类 chip / 渠道过滤 | 先过滤、后按 score 降序**分类内重排**（该分类内由热到冷）；无 score 的旧条目沉底且保持原相对序 |
| 「补拉该分类」 | 返回后 boost 条目参与统一评分自然插位（可能出现在列表任意位置，含前排） |
| 手动刷新 / 自动刷新 | 重评分 + 与上一轮对比产生 trend；同分条目顺序确定不抖动 |
| 收藏 tab / 勾选 / 批量创作 | 不受名次语义变化影响（选中仍按 id） |
| 悬停名次徽标 / 多榜 chip | 显示对应 tooltip（见 4.1） |

### 4.3 locale 增量（hotTopics 命名空间，zh/en 成对，共 6 键）

`multiBadge` 多榜/Multi-board ｜ `multiBadgeTip` 同时上榜：{sources}/Also trending on: {sources} ｜ `heatScoreTip` 来源第 {rank} 名 · 综合热度 {heat}/Source rank #{rank} · heat {heat} ｜ `trendUp` 较上轮上升/Rising since last refresh ｜ `trendDown` 较上轮下降/Falling since last refresh ｜ `trendNew` 新上榜/New

## 5. 数据校验与兼容性

### 5.1 条目字段增量（IPC `hot-topics:fetch` / `get-cache` 返回的 `topics[]`）

| 字段 | 类型/域 | 校验 |
|------|---------|------|
| `score` | number ∈ (0, 1] | clamp01；非数值 hotValue → 0 处理走名次兜底 |
| `sourceCount` | int ≥ 1 | `Set([channel, ...mergedFrom去重]).size` |
| `viewRank` | int ≥ 1 | 排序后连续序号 |
| `trend` | 'up'\|'down'\|'flat'\|'new'\|null | 首轮 null |

### 5.2 防御与边界

1. `scoreTopics` 非数组/空数组 → 返回 `[]`；rank 非法 → 视同 1；
2. **旧缓存完全兼容**：缺 score/viewRank/sourceCount/trend 任一字段均自然回退（详见设计文档 §3.2 兼容性合同），不要求用户清缓存；缺 channel 的历史畸形条目不参与 carry-over、不产生幻影多榜徽标；
3. 时钟回拨：age 负值钳 0（decay=1）；
4. preserve（全渠道零结果）路径零改动，既有防清空合同保持；
5. boost 聚合在 preserve 早退之前的 v2 铁律不触碰；carry-over 置于 preserve 早退之后，两者不冲突。

### 5.3 持久化键（SQLite settings）

| 键 | 变化 |
|----|------|
| `hot_topics_cache` | 条目增量落盘 score/sourceCount/viewRank/trend（向后兼容读） |
| `hot_topics_rank_config` | **新增**，可选，见 §3.4 |

## 6. 验收标准

1. 「全部」视图首屏为跨渠道统一热度序（微博/百度榜首不再排在知乎榜尾之后）；任意分类内由热到冷；
2. 多榜条目有「多榜」chip，tooltip 列出上榜渠道；名次徽标 tooltip 显示来源名次与综合热度；
3. 二次刷新后 trend 箭头正确（升/降/新上榜），flat 不渲染；首轮不显示箭头；
4. 「补拉该分类」的高热条目按真实热度插位（分类视图不再垫底）；
5. 刷新/翻页同分条目顺序稳定（确定性决胜）；
6. 旧缓存（升级前落盘数据）打开不报错、回退显示正常；
7. settings 配置 `hot_topics_rank_config` 部分渠道权重后仅该渠道评分变化，其余渠道权重不受影响（合并语义）；坏 JSON 配置不影响功能（fail-closed）；
8. 某渠道本轮被跳过时，其上轮条目仍短暂保留并随时间衰减下沉，最终跌出（carry-over）；
9. 全渠道失败时列表不清空、顺序不变（preserve 合同回归）；
10. 单测：scorer 22 例 + service 新增 7 例 + UI 新增 6 例全绿，既有 100+ 回归零破坏；eslint / locale-sync / debt 门禁通过。

## 7. 已知边界

- 教育/国际等无垂类源分类的排序质量取决于主榜命中，分类内可能整体偏后（与 v2 供给边界一致）；
- tophub 镜像微博的重复计权以 0.9 降权缓解，彻底去镜像需 URL 级指纹（后续迭代）；
- trend 依赖 10 分钟 TTL 内的上一轮缓存，间隔过长后 diff 意义弱化；
- 权重/半衰期暂无 UI 配置面板（settings 键直配，面向运营）。
