# 功能设计文档：热门选题统一热度排序（Hot Topics Heat Ranking）

> **文档类型**: 功能设计文档（Design Doc，技术设计视角）｜ 配套 PRD：`PRD-HOT-TOPICS-HEAT-RANKING-2026-09-22.md`
> **日期**: 2026-09-22 ｜ **分支**: `hot-topics-heat-ranking`（worktree `mp-hot-topics-heat-ranking`）
> **范围**: 方案 P0（统一评分+先排后截+分类内重排）/ P1（统一名次 UI+多榜徽标+trend 箭头）/ P2（时间衰减+渠道权重配置化）/ P3（工程细节：确定性决胜、落盘字段与旧缓存兼容、可解释性提示）
> **关联**: 《热门选题分类供给增强》PRD-HOT-TOPICS-CATEGORY-SUPPLY-2026-09-20（v2 聚合管线，本设计在其之上叠加评分层）

---

## 1. 问题定义与设计目标

### 1.1 现状（设计前真源核实）

v2 聚合管线**全链路没有任何 sort**：`fetchTopics → _aggregate` 按 `CHANNEL_CONFIGS` 数组固定顺序（知乎→头条→腾讯→B站→抖音→百度→微博→tophub）依次追加条目，boost 补拉永远垫底，最后 `slice(0, 400)` 截断；UI 层 `rank-badge` 显示的是过滤后的视图序号（`viewIndex + 1`），把"数组位置"当"排名"展示给用户。

由此产生 6 个具体不合理现象：

| # | 现象 | 根因 |
|---|------|------|
| 1 | 百度/微博榜首排在知乎尾部条目之后 | 渠道数组顺序偶然性 ≠ 热度 |
| 2 | 切到"财经"分类后仍是渠道块状分布，非分类内由热到冷 | 全局序未按分类重排 |
| 3 | boost 补拉的垂类头条永远沉底，「全部」视图前 400 几乎看不到 | 追加语义 + 截断在排序之前 |
| 4 | 三榜同现的全民事件与单渠道榜尾事件位置无差异 | `mergedFrom` 多源信号不参与排名 |
| 5 | 上轮旧闻与新上榜条目平权 | 无时间衰减 |
| 6 | 400 配额被排前渠道先占满 | 截断前无统一评分 |

### 1.2 设计目标

1. **科学**：跨渠道可比的统一热度分（归一化 + 多源加权 + 时间衰减），排名反映真实热度而非聚合偶然性；
2. **可解释**：用户能看到"为什么它排前面"（统一名次、多榜徽标、来源名次+热度 tooltip、trend 箭头）——排名的可解释性比排名本身更重要；
3. **稳定**：同分条目确定性决胜，翻页/刷新不抖动；
4. **兼容**：旧缓存条目（无 score/viewRank/sourceCount/trend 字段）不报错、自然回退，不要求用户清缓存；
5. **可运营**：渠道权重与半衰期可经 settings 配置，为后续点击数据校准留口。

### 1.3 非目标

- 不引入个性化（用户画像加权）；不做点击率反馈闭环（配置化只到 settings 键为止，UI 配置面板属后续迭代）；
- 不改去重算法本体（跨渠道按选题文本 trim 精确匹配维持 v2 现状）；
- preserve 早退路径（全渠道零结果保留陈旧缓存）**不叠加评分重排**——保持 2026-09-14 防清空语义与既有测试合同（`['A','B']` 断言）。

## 2. 评分模型（核心设计）

### 2.1 公式

对每条选题（去重合并后）：

\[ score = clamp01\big(\big(base \cdot w_c \cdot decay\big) \cdot HEADROOM + \alpha \log_2(sourceCount)\big) \]

| 因子 | 定义 | 取值 |
|------|------|------|
| `heatNorm` | 渠道内 log 域 min-max 百分位：\(\frac{\log_{10}(hotValue+1)-\min_c}{\max_c-\min_c}\)，把量纲各异的 hotValue（B站播放量/微博讨论量/头条 hotEvent）压到 [0,1] 同尺度 | 缺 hotValue 或非正 → −1（无效，交给名次兜底）；渠道内全同值/单条 → **−1**（无分布信息，不得给假满分——绿灯轮修正，否则榜尾孤条与榜首同分） |
| `rankNorm` | 名次兜底：\(1-\frac{rank-1}{\maxRank_c}\)，榜首≈1 末位≈0；**RSS 类无 hotValue 渠道（IT之家/新浪滚动）不因字段缺失得 0 分** | [0,1] |
| `base` | \(\max(heatNorm, rankNorm)\) | [0,1] |
| \(w_c\) | 渠道权重：国民级综合榜 1.0（weibo/baidu/douyin/toutiao/zhihu），tencent 0.95，tophub 0.9（微博镜像，降权防重复计权），bilibili 0.85，垂类源 0.8（sina_finance/ithome_tech），未登记渠道 DEFAULT 0.9 | 可配置 |
| `decay` | 时间衰减 \(2^{-age/H}\)，半衰期 H=6h（热搜生命周期经验值），age=now−fetchedAt | (0,1] |
| `sourceBonus` | 多榜加权 \(\alpha\log_2(sourceCount)\)，α=0.12；sourceCount=去重来源渠道数（主渠道+mergedFrom 去重） | 2 榜 +0.12，4 榜 +0.24 |
| `HEADROOM` | 0.9：主项乘 0.9 封顶，顶部预留 ≈0.1 给多榜加成，**避免各渠道榜首都顶到 1.0 后 clamp 削平、多榜/热度信号失去区分度**（设计评审修正项） | — |

**为什么多榜加权是最强信号**：一条选题同时上微博+百度+知乎榜，是三套独立算法/三群独立用户共同验证的"全民热点"，不需要任何主观权重；log2 增长抑制同源刷量。

### 2.2 排序与截断（P0）

- 排序键：`score` 降序；同分**确定性决胜**链：`rank` 升序（缺 rank 视同榜首，按 1 处理，与评分侧口径统一——评审 m-3）→ `channel` 名升序 → `id` 升序（字典序），保证任意输入顺序产生同一输出（幂等，消除每轮抖动）；
- `viewRank`：排序后统一赋值 1..N（**统一名次的唯一真源**，UI 直接渲染）；
- **先排后截**：`scoreTopics(allTopics) → slice(0, MAX_TOPICS=400)`。400 配额按热度分配而非渠道顺序抢占；boost 条目按真实热度插位，不再机械沉底。

### 2.3 trend 计算（P1 数据源）

`markTrend(scored, previous)`：与上一轮缓存对比。

- **匹配键：选题文本 trim 优先，id 兜底**（关键设计决策：条目 id=`渠道:名次` 跨轮不稳定——同一事件下轮换渠道上榜或名次变化都会换 id，只有文本可跨轮追踪）；
- `diff = 上轮序号 − 本轮 viewRank`；`diff ≥ 3 → 'up'`，`diff ≤ −3 → 'down'`，其余 `'flat'`；上轮无此条目且上轮非空 → `'new'`；首轮（无上一轮）→ `null`（UI 不渲染，静默）。
- 阈值 3（riseBand）：吸收同分小抖动，避免箭头乱跳。

### 2.4 配置化（P2）

settings 键 `hot_topics_rank_config`（JSON 对象，可选）：

```json
{ "channelWeights": { "weibo": 1.0, "bilibili": 0.85 }, "halfLifeMs": 21600000 }
```

- 读取入口 `HotTopicsService._readRankConfig()`：缺省/解析失败/非对象一律 fail-closed 返回 `{}`（用内置默认），只 `log.warn` 不抛错；
- 传入 `scoreTopics(topics, { now, channelWeights, halfLifeMs })`；scorer 内部**合并语义**（评审 m-1）：覆盖表与内置表 `Object.assign({}, CHANNEL_WEIGHTS, override)` 合并，**未列渠道保持内置值**而非回退 DEFAULT；非法项（非有限正数）逐键丢弃，整体覆盖表非对象/数组视为无覆盖；
- 默认即当前内置表，运营可在不改代码情况下调权重（后续接点击数据校准）。

## 3. 架构与数据流

```
fetchTopics({force, boostCategories})
  ├─ 新鲜缓存早退（fromCache）                    ← 不重排（缓存内已有序）
  ├─ 主聚合 _collectChannel ×8 → _aggregate（去重/mergedFrom/分类升级）
  ├─ boost 聚合 _collectBoostChannel（preserve 之前，v2 评审 MAJOR-1 合同不变）
  ├─ 全渠道零结果 → preserve 早退                ← ★ 原样返回 previous，不评分不重排不 carry
  ├─ ★ 跨轮 carry-over（评审 M-1）：本轮被限流/熔断/失败跳过的渠道，沿用上一轮缓存条目
  │     参与统一评分；按 topic 文本 trim 去重，channel 未知的旧形态条目不沿用
  ├─ ★ scoreTopics(allTopics, {now: fetchedAt, rankCfg}) → 就地写 score/sourceCount + 返回排序新数组 + viewRank
  │     （decay 以 fetchedAt 为 now：本轮新条目 age=0 不衰减，carry 旧条目 age>0 自然下沉）
  ├─ ★ markTrend(scored, previous)               → 就地写 trend
  ├─ ★ scored.slice(0, MAX_TOPICS)               → 先排后截
  ├─ _applyLlmLabels(topics)（v2 方案C，位置不变：截断后）
  └─ _writeCache({topics, fetchedAt, channelStats})   ← topics 含 score/sourceCount/viewRank/trend 落盘
IPC hot-topics:fetch 整体透传（preload 无字段白名单，无需改）
HotTopics.vue
  ├─ filteredTopics = filter(分类/渠道) → ★ 按 score 降序稳定重排（分类内由热到冷）
  ├─ rank-badge ★ 显示 viewRank（旧缓存回退 viewIndex+1）；title ★「来源第N名 · 综合热度X」（旧数据回退 sourceRank）
  ├─ ★ 多榜徽标 sourceCount≥2 → 「多榜」chip，title 列 mergedFrom 渠道名
  └─ ★ trend 箭头 up↑ / down↓ / new「新上榜」；flat/null 不渲染
```

### 3.1 模块划分

| 模块 | 文件 | 职责 |
|------|------|------|
| 评分器（新增） | `electron/services/hot-topics/scorer.js` | 纯函数：`scoreTopics` / `markTrend` / `logNorm` / `clamp01` + 常量表。无 IO 无网络，天然可桩 |
| 聚合服务 | `electron/services/hot-topics-service.js` | 接线：读配置 → 评分 → trend → 截断 → 落盘；preserve 路径零改动 |
| 视图 | `src/views/HotTopics.vue` | 统一名次渲染、分类内重排、多榜徽标、trend 箭头、旧缓存兼容回退 |
| i18n | `src/locales/{zh,en}.js` | 6 个新键成对（hotTopics 命名空间） |

### 3.2 数据契约（条目字段增量）

| 字段 | 类型 | 写入方 | 说明 / 校验 |
|------|------|--------|-------------|
| `score` | number ∈ (0,1] | scoreTopics | clamp01；NaN 输入视为 0；落盘后旧缓存缺失 → UI 回退链 |
| `sourceCount` | int ≥1 | scoreTopics | `Set([channel, ...mergedFrom]).size`，重复渠道不重复计 |
| `viewRank` | int ≥1 | scoreTopics | 排序后连续序号，UI 名次唯一真源 |
| `trend` | 'up'\\|'down'\\|'flat'\\|'new'\\|null | markTrend | 首轮 null；flat 不渲染 |
| `mergedFrom` | string[] | _aggregate（v2 已有） | 本设计仅消费，不改写入逻辑 |

**兼容性合同（P3）**：所有新字段缺省安全——UI `topic.viewRank ?? viewIndex + 1`；`sourceCount(x)` 回退 `1 + Set(mergedFrom 去重且排除主渠道自身).size`（旧缓存同渠道跨榜合并会把自身 push 进 mergedFrom，幻影徽标——评审 m-2）；badge title 无 score 回退 `sourceRank` 旧文案；filteredTopics 缺 score 条目视为 −1 沉底且保持原相对序（Array.sort 稳定性，ES2019 规范保证）；缺 channel 的旧形态条目不参与 carry-over。

## 4. UI 规格（显示项 / 交互 / 提示文字）

### 4.1 显示项

| 位置 | 显示 | 条件 | data-testid |
|------|------|------|-------------|
| 条目行首徽标 | 统一名次 `viewRank` | 恒显示（回退见 §3.2） | （既有 `.rank-badge`） |
| 徽标 tooltip | 「来源第 {rank} 名 · 综合热度 {heat}」，heat=round(score×100) | 有 score | 同上 |
| 渠道标签后 | 「多榜」chip（tag 样式） | sourceCount≥2 | `hot-topic-multi-badge` |
| 多榜 chip tooltip | 「同时上榜：{sources}」（顿号连接的渠道中文名） | 同上 | 同上 |
| 行内 | ↑（红升绿降按现有色板）/ ↓ / 「新上榜」 | trend=up/down/new | `hot-topic-trend-up/down/new` |

### 4.2 交互逻辑

- **分类 chip 切换**：点击分类后列表按 score 降序展示该分类内容（分类内由热到冷），无 score 的旧条目沉底；
- **渠道过滤 + 分类过滤叠加**：先过滤后重排，两维过滤共用同一重排；
- 「补拉该分类」（v2 既有）：返回后 boost 条目参与统一评分自然插位，不再垫底；
- 收藏 tab / 复制 / 批量创作：名次语义变化不影响选中集合（仍按 id）。

### 4.3 提示文字（locale 增量，zh/en 成对）

| 键 | zh | en |
|----|----|----|
| `hotTopics.multiBadge` | 多榜 | Multi-board |
| `hotTopics.multiBadgeTip` | 同时上榜：{sources} | Also trending on: {sources} |
| `hotTopics.heatScoreTip` | 来源第 {rank} 名 · 综合热度 {heat} | Source rank #{rank} · heat {heat} |
| `hotTopics.trendUp` | 较上轮上升 | Rising since last refresh |
| `hotTopics.trendDown` | 较上轮下降 | Falling since last refresh |
| `hotTopics.trendNew` | 新上榜 | New |

## 5. 校验与边界

1. **入参防御**：`scoreTopics` 非数组/空数组 → `[]`；hotValue 非正/NaN/null → logNorm=0 → 名次兜底；rank 非法 → 1；
2. **权重覆盖校验**：仅接受有限数，其余项回退默认表；`halfLifeMs ≤ 0` 视为无效；
3. **除零保护**：渠道内 max−min < 1e-9（全同值/单条）→ heatNorm=−1 交名次兜底（无分布信息不给假满分）；maxRank 至少 1；
4. **时钟回拨**（v2 既有）：不影响评分（age 负值钳 0 → decay=1）；
5. **preserve 路径**：零改动透传，防止把"保留陈旧缓存"语义与"重排"耦合（既有测试合同 `topics.map(t=>t.topic)===['A','B']` 必须保持）；
6. **boost 在 preserve 之前**（v2 评审 MAJOR-1 铁律）：本设计不触碰该顺序；
7. **trend 首轮静默**：previous 为空数组时全部 null，不出现满屏「新上榜」。

## 6. 测试策略（TDD 先红后绿）

| 层 | 文件 | 契约要点 |
|----|------|---------|
| 纯函数 | `hot-topics/scorer.test.js`（新） | 原语（logNorm/clamp01 边界）、渠道内归一、低权重榜首>高权重尾条、缺 hotValue 名次兜底、多榜加分、viewRank 连续、同分确定性（输入序无关）、衰减、权重覆盖、trend up/flat/new/首轮 null |
| service 集成 | `hot-topics-service.test.js` 追加 7 例 | 聚合序→热度序、score/sourceCount 落盘、**先排后截**（420 条场景尾 20 条不被渠道序挤掉，断言存活 ≥20 保持判别性）、P2 配置生效与默认决胜、trend 跨轮（文本匹配）、carry-over+衰减下沉（评审 M-1）|
| UI | `HotTopics.test.js` 追加 6 例 | viewRank 徽标 + score 降序渲染、旧缓存回退（P3 兼容）、多榜徽标、旧缓存幻影徽标不渲染（评审 m-2）、trend 三箭头且 flat 不渲染、分类过滤内重排 |
| 回归 | 既有 100+ 用例 | preserve 语义、boost-before-preserve、分类/补拉/收藏全链路零破坏 |

## 7. 已知边界与后续迭代

- 教育/国际等无垂类源分类的排序质量取决于主榜命中条目，分类内可能整体沉底（score 低）——与 v2 供给边界一致；
- topHub 镜像微博的重复计权已用 0.9 降权缓解，彻底去镜像需 URL 级指纹（后续）；
- 权重/半衰期配置暂无 UI 面板（settings 键直配）；trend 依赖 10 分钟 TTL 内的上一轮缓存，长间隔使用后两轮 diff 意义弱化；
- ~~半衰期在"同一轮 fetchedAt 相同"时无区分作用~~ **已解决（评审 M-1）**：接通跨轮 carry-over 后，被跳过渠道的旧条目以 age>0 参与评分，衰减在生产链路真实生效；carry 置于 preserve 早退之后，全渠道零结果合同（不重排）不受影响；

## 8. 决策记录（Decision Log）

| 决策 | 理由 | 被否方案 |
|------|------|---------|
| 评分放 service 聚合尾部（截断前）而非 _aggregate 内 | aggregate 是纯合并，评分是独立横切面；保持 v2 评审"显式动作在 preserve 前"结构不动 | 在 aggregate 里边合并边打分（耦合、难桩） |
| `base = max(heatNorm, rankNorm)` | RSS 渠道无 hotValue 不能得 0；两信号取max 而非相加，避免榜首双满分 >1 | heatNorm+rankNorm 加权平均（缺 hotValue 渠道仍被惩罚） |
| HEADROOM=0.9 + 加性 sourceBonus | 保住顶部区分度（clamp 削平问题的修正） | 全乘性 bonus（榜首无加成空间）、先 clamp 后加 bonus（可超 1） |
| trend 用选题文本匹配 | id=渠道:名次 跨轮不稳定 | id 匹配（设计缺陷，红灯评审时自查修正） |
| preserve 路径不重排 | 2026-09-14 合同 + UI 已按旧序展示过，二次排序制造"没刷新却变序"错觉 | 保留后也评分（破坏既有测试与直觉） |
| 权重默认非全 1 而是分层表 | 国民级/垂类/镜像的结构性差异客观存在；配置化留校准口 | 全 1（tophub 镜像双计权更重） |
| 单条/全同值渠道 heatNorm=−1 交名次兜底（绿灯轮修正） | 渠道内无分布信息时不得给假满分，否则榜尾孤条与榜首同分 | heatNorm=1.0（首版实现，产生假满分缺陷） |
| 跨轮 carry-over 使 decay 真实生效（评审 M-1） | 首版 decay 因子在生产链路 age≡0（死旋钮）；跳过渠道的旧条目沿用参与评分+衰减，热度不足自然跌出截断 | 删除衰减（损失 P2 意图）、用落盘时刻充当抓取时刻（失真） |
| 权重覆盖采用合并语义（评审 m-1） | 运营只调单渠道时，未列渠道不应被压平为 DEFAULT | 整体替换（首版，覆盖一个键会压平全表） |
