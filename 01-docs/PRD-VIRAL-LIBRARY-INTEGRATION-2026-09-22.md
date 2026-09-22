# PRD — 爆款库四链路数据结合（viral-library-integration）

> 版本：v1.0 ｜ 日期：2026-09-22 ｜ 基线：origin/main `7a7d5cc76`
> 关联：`PRD-VIRAL-REWRITE-INTEGRATION.md`（分析×改写子链路，P0/P1 已交付）、`PRD-VIRAL-PAGE-FULL-UTILIZATION-2026-09-21.md`（爆款页三件套 F1-F8，#2152/#2159/#2154 已合并）
> 交付编排：**P0、P1、P2 各自单独 PR**（见 §8 分支规划），本文为三 PR 共同的上游规格。
> 状态：待 CEO 签字（质量节拍 Phase 0.3 → 1）

---

## 1. 背景与问题

### 1.1 四功能是一条内容流水线，目前只有"改写"一环接得好

```
采集(Collection) ──素材──▶ 爆款库 viral_library ──判据──▶ 爆款分析(ViralAnalysis) ──信号──▶ 改写引擎(Rewrite)
                                  ▲                                ▲
                                  └────── 回采(platform-metrics) ──┘（断）
热榜(HotTopicsService /hot-topics) ──方向──▶ 热门选题（两套并存，不通）
```

- 改写链路（titleHint / viral-signal 信号注入 / 爆款潜力第 4 维评估）已由 `PRD-VIRAL-REWRITE-INTEGRATION.md` P0/P1 交付，是本 PRD 的**已验证范式**：不加新表、不加新 IPC、复用既有通道传可选字段。
- 其余环节全部靠"页面跳转"串联，**数据层是断的**。以下 5 个断点全部经代码取证（附录 A 有文件:行号索引）。

### 1.2 断点清单（取证结论）

| # | 断点 | 关键证据 | 后果（量化） |
|---|------|---------|-------------|
| ① | **采集互动数据进了"错的表"**：`Collection.vue` `addCollectedToViral`（L1602-1623）构造 viralItem 时**不带** `likes/comments/published_at`；`url-collector.js` HTTP 结果已有 `publishTime`（L312-321）被契约层丢弃，且采集解析器**完全没有** metrics 解析 | Collection.vue:1606-1615、url-collector.js:312-321 | `viral-engine-local.js` 总分 60% 权重（engagement 0.35 + interaction 0.25）由 **avgLikes/avgComments 均值**决定（L206-216）：缺数据条目按 `Number(x)\|\|0` 记 0 进分母（L197-198），**主动稀释均值**——1 条零值混进 3 条真数据 ≈ 掉 15 分；`searchViralItems` 按 `(likes+collections+comments) DESC` 排序（store L203），零值条目恒沉底；`trend` 判定 `avgLikes>1000` 永远到不了 → 采集条目永远 `stable`；爆款页 F7 回读 `like_count: Number(item.likes)\|\|0` 恒 0 → F8 角标退化 |
| ② | **两套"热门选题"不同源**：`/hot-topics`（HotTopicsService：8 渠道热榜、上限 400、LLM 分类、SQLite 缓存、preservedStaleCache）与爆款分析页 F3 `viralTrending`（articleData ∪ listViralItems top30 本地启发式抽词，ViralAnalysis.vue L506-542）互不感知 | hot-topics-service.js、ViralAnalysis.vue:506-542 | F3 与热榜页给出不同的"热门"答案，用户认知割裂；热榜的强外部信号没有喂进爆款分析的选题依据 |
| ③ | **回采体系不回写爆款库**：platform-metrics 注册表（zhihu/baijiahao/kuaishou/bilibili 4 parser，`fetchMetrics` 返回 `{views,likes,comments,favorites,shares}`）+ performance-recrawl-service + addManualSnapshot + recomputeAttribution 一整套已存在，但只写 tracked_content/performance 域 | platform-metrics/index.js、performance-recrawl-service.js | 爆款库条目的互动数**入库即定格**（且大多是 0），没有任何数据回流机制；已付的 LLM/浏览器回采成本没有惠及爆款分析与检索排序 |
| ④ | **改写引擎只吃文本信号，不吃强度**：titleHint/viralAngles/viralKeywords 以软约束注入 prompt（rewrite-engine-core.js L338-349），但 factor 分数、模式卡片 `expected_lift` 等**定量信号**不进 prompt、不参与排序 | rewrite-engine-core.js:338-349 | 模型不知道"参考的这批爆款平均 5 万赞、评论区活跃"，生成强度无锚点；模式卡片的 lift 数据（F6）只用于展示，不反哺生成 |
| ⑤ | **批量采集挤爆模式卡片队列**：入库即建 pending 卡片，`processQueue` 每轮仅 10 条（pattern-extraction-service.js L56），已有防重入补跑（L49-52/L77-82），但队列无上限、无合并窗口 | pattern-extraction-service.js:48-84 | 一次批量采集 100+ 条 → LLM 提取排队 10+ 轮、延迟放大，pending 无界增长；同题重复采集重复付费提取 |

### 1.3 核心修复原则（三 PR 共同遵守）

1. **不加新表、不加新 IPC、不加新 userData**——`viral_library` 提升为爆款域唯一事实源，`likes` 等列已存在（`store-schema.js` L168-185，`INTEGER DEFAULT 0` **无 NOT NULL 约束** → 存 NULL 零迁移）。
2. **统一 engagement 口径**：`NULL = 未知（不参与统计）`，`0 = 真实零互动（参与统计并如实拉低均值）`。二者语义必须分离——这是对现有"`Number(x)||0` 把缺数据压平成 0"的根本纠正。
3. **fail-open**：任一环节拿不到 metrics 就存 NULL，绝不猜测填 0；分析引擎对全 NULL 样本回退现有保守口径（word-count 主导），行为与今天逐字节一致（回归保护）。

## 2. 目标用户与场景

- **目标用户**：使用"采集→入爆款库→分析→改写→发布"工作流的内容运营者（现有桌面端核心用户）。
- **Happy path**：用户采集一篇知乎高赞回答 → 入爆款库时点赞/评论数与发布时间自动带入 → 爆款分析页对该主题分析时，avgLikes 由真实数据驱动、趋势判 rising → 改写时注入"参考爆款平均 X 赞"强度锚点 → 发布后回采把真实互动写回爆款库，闭环。
- **Alternative path**：采集平台不在 parser 支持范围（如抖音短视频页）→ metrics 存 NULL → 分析引擎跳过该条目计算均值（不稀释）→ 表格显示 `-` → 后续该 URL 被跟踪发布并回采成功 → 互动数补写。
- **Error path**：metrics 解析出负数/超界/非数字 → clamp/丢弃存 NULL；回采写库失败仅 warn 不回滚原域事务；热榜渠道失败沿用 F3 本地口径（降级不空白）。

## 3. P0 规格 — 采集→爆款库互动数据契约修复（单独 PR-1）

**一句话**：把采集页面上已存在的互动数字段带到 `viral_library`，并在分析与检索口径中区分"未知(NULL)"与"真零(0)"。纯契约修复，无新 UI 结构。

### 3.1 数据流

```
url-collector._collectViaHttp/_collectViaBrowser
  └─ 新增 parseEngagement(platform, $/html) → { likes, comments, collectedAt } | null   [P0-a]
       ▼ 透传（HTTP 已带 publishTime；browser 新增同名字段）
Collection.vue addCollectedToViral
  └─ viralItem 增加 likes/comments/published_at（拿不到 → 不设字段，让 normalize 落 NULL） [P0-b]
       ▼ 既有 IPC knowledge-library:add-viral（通道零改动）
normalizeViralItem
  └─ likes/collections/comments：null/undefined → 存 NULL；有限数 → clamp[0, MAX_SAFE]；published_at 透传 [P0-c]
       ▼
viral-engine-local._analyzeLocal 等均值口径
  └─ 分子分母只计非 null 条目；全部 null → 回退现口径；trend 同口径 [P0-d]
searchViralItems / ViralLibraryTable / F7 回读
  └─ 排序 IFNULL(x,0)；表格 null → "-"；F7 like_count 保留 null [P0-e]
```

### 3.2 功能逻辑与数据校验

**P0-a 采集侧 metrics 解析**（`url-collector.js`）：
- 新增私有方法 `_parseEngagement(hostname, $, html)`，返回 `{ likes, comments, publishTime }` 各字段可为 `null`；
- 平台规则（首版 4 站，与 platform-metrics 注册表对齐）：

| 平台 | likes 来源 | comments 来源 |
|---|---|---|
| 知乎 | `.ConversationItem-Score` / JSON-LD `interactionStatistic` | 页面计数按钮（解析失败→null） |
| 小红书（浏览器模式） | `like_value` / `interactInfo.collectedCount` 内联 JSON | `commentCount` 内联 JSON |
| B 站 | `.video-info-detail` 或初化 JSON `stat.view`→仅作 likes 缺失时 null | `stat.reply` |
| 通用兜底 | JSON-LD `interactionStatistic.userInteractionCount` | 同左 `Comment` 类型 |

- 数字解析支持 `1.2万/3.4w/1,234` 格式（复用 `ViralLibraryTable.formatNum` 的逆函数思路，独立实现于主进程侧）；解析失败、非有限、<0 → `null`；>2^53-1 → `null`（存疑不算截断）。
- **负数与 NaN 一律 null**，不 clamp 到 0（0 是强语义："确认零互动"，只有页面明确显示 0 才产出 0）。

**P0-b 契约透传**（`Collection.vue` `addCollectedToViral`）：
- viralItem 追加 `likes: m.likes ?? undefined`、`comments: m.comments ?? undefined`、`published_at: item.publishTime || ''`（undefined 字段序列化后 IPC 不携带，normalize 落 NULL——与 REWRITE-INTEGRATION §2.2 titleHint 同范式）；
- 采集结果面板不新增展示（透明化：用户无感知，入库后才见数据）。

**P0-c store 归一化**（`knowledge-library-store.js` `normalizeViralItem` L19-22）：

| 输入 | 现状 | 新规则 |
|---|---|---|
| `undefined` / `null` / `''` | `Number(x)||0` → 0 | **NULL**（未知） |
| 有限数 ≥0 | 原值 | 原值（0 如实保留） |
| 负数 / NaN / Infinity / 非数字字符串 | 0 | **NULL** |
| > Number.MAX_SAFE_INTEGER | 原样（危险） | **NULL** |
| `like_collect_ratio` | likes/collections 含 0 除 | collections 为 NULL 或 0 → ratio 存 NULL（不产出误导值） |

- `published_at`：维持 string 透传；渲染端按现有 `.slice(0,10)` 显示（ViralLibraryTable L57 已如此），无迁移。
- **存量数据不回灌**：已入库的 0 不猜测改 NULL（无法区分真 0 与假 0）。新写入起生效；P1-b 回采可自然修复匹配 URL 的存量条目。

**P0-d 分析引擎口径**（`viral-engine-local.js` L190-221，及 orchestrator 不可用时的同类均值点）：
- 累加循环改为：`likes != null` 才 `totalLikes += likes; likesN++`；`avgLikes = likesN ? totalLikes/likesN : null`；
- `avgLikes === null` 时：engagementScore/interactionScore 按**现回退分支**处理（等价于今天的保守估算路径），trend 保持 `stable`；
- F7 回填链（ViralAnalysis `pickLibraryItem` L630-649）：`like_count: item.likes ?? null`（不再 `||0`），下游同样 null 跳分母。

**P0-e 检索与显示**：
- `searchViralItems` 排序改 `ORDER BY (IFNULL(likes,0)+IFNULL(collections,0)+IFNULL(comments,0)) DESC, created_at DESC`——NULL 与 0 排序行为不变（都沉底），但分析域语义已分离；
- `ViralLibraryTable.formatNum(null)` → 显示 `-`（与 ratio/published_at 列的既有 null 口径 L56-57 对齐）；
- 爆款分析页 F8 角标：like_count null 的条目不渲染角标（等同 untracked 口径，REWRITE-INTEGRATION §8 已确立"缺数不误导"原则）。

### 3.3 交互逻辑与显示项

| 触点 | 变化 | 说明 |
|---|---|---|
| 采集页「加入爆款库」按钮 | 流程不变 | 成功 toast 文案沿用 `knowledgeBase.addSuccess`；失败沿用 `loadFailed`（现状即如此，P0 不动采集页 UI） |
| 知识库-爆款库表格 | 点赞/评论列：无数据显示 `-` 不再显示 `0` | 数据列已存在，仅 null 格式化 |
| 爆款分析页 F7 库条目 | 有互动数的条目副标题追加 `· 赞 {n}` | 仅在 likes 非 null 且 >0 时渲染 |
| 爆款分析结果 F8 角标 | null 视为 untracked 不显示 | 防"0 赞"误导标签 |

### 3.4 提示文字（i18n，zh/en 成对新增）

| 键 | zh | en |
|---|---|---|
| `knowledgeBase.metricUnknown` | 无数据 | No data |
| `viralAnalysis.libItemLikes` | 赞 {n}（注：项目语料不支持插值的文件内用拼接，locale 键存短标签"赞"，渲染端拼接数字，与 REWRITE-INTEGRATION §2.1.1 同范式） | Likes |

渲染端非 locale 文件零新增 CJK 字面量（基线门禁沿用）。

### 3.5 P0 验收标准（AC）

- AC-P0-1：知乎/小红书(浏览器)/B站 采集页含互动数时，入库条目 `likes>0` 比例 100%（fixture 页断言）；解析失败站点存 NULL 不存 0。
- AC-P0-2：均值污染回归——3 条 likes=[5000,5000,5000] + 1 条 NULL 的分析分与 3 条样本一致（NULL 不进分母）；与 1 条显式 0 的分数**不同**（0 进分母）。
- AC-P0-3：存量 0 值条目行为与今日逐字节一致（回归锁）。
- AC-P0-4：`pnpm vitest run` 全量绿；Electron 打包 QM-1 通过；CJK 基线扫描 PASS。

### 3.6 PR-1 落地交付记录（实现即证据，2026-09-22）

> 本节为 PR-1（P0）合入实现回写的实况，与最终代码逐文件对齐。

**数据校验与解析（F-101/F-102/F-103，主进程）**

- 采集解析器拆出为独立模块 `apps/desktop/electron/services/url-collector-engagement.js`（导出 `parseEngagement($, html)` 与 `parseEngagementNumber(v)`）；`url-collector.js` 保留 `_parseEngagement`/`_parseEngagementNumber` 两个薄委托方法（测试与调用方契约不变）。拆分动机：主采集器随 P0 逻辑增 85 行越过债务熔断 500 行预算（`FILES_OVER_500 98>97`），拆分后回落至 488 行、指标回到基线 95。
- `parseEngagementNumber`：支持「`1.2万`/`3.4w`/`1,234`/纯数字」→ 非负整数；负数、NaN、Infinity、非数字、超 `MAX_SAFE_INTEGER` 一律 `null`（绝不猜 0）；`0`/`"0"` 保留为真实零。
- `parseEngagement` 三级回退：① JSON-LD `interactionStatistic`（LikeAction/CommentAction）；② 平台内联 JSON 正则（小红书 `likedCount`/`commentCount`、B站 `like`/`reply`，字符串与数值两形态）；③ 知乎 `.VoteButton .CountNumber` DOM。全 fail-open：解析异常不影响采集主结构，字段级 `null` 即"未知"。HTTP 与 stealth 共用 `_parseHtml`，单点生效。

**存储口径（F-105/F-107，主进程）**

- `normalizeViralItem` 改用 `_engagementNum`：`null/undefined/''/负数/非有限/超 MAX_SAFE` → 存 NULL；真 0 保留。`ratio` 仅当 likes 与 collections 均已知且 `collections>0` 时计算（`Math.round(likes/collections*100)/100`），否则 NULL。
- `searchViralItems` 排序 `ORDER BY (IFNULL(likes,0)+IFNULL(collections,0)+IFNULL(comments,0)) DESC, created_at DESC LIMIT 100`——NULL 与 0 排序行为一致（同沉底），但分析域语义已分离。
- `viral_library` 列无 NOT NULL 约束 → NULL 语义零 schema 迁移。

**分析引擎（F-106，主进程）**

- `viral-engine-local.localAnalyze` 互动均值改 `likesN`/`commentsN` 独立分母口径：未知（null/undefined/''/非有限/负）跳过分子分母；全未知时回退基线 0（与存量行为逐字节一致）。`sample_size: totalTitles` 仍为条目总数（不随均值分母变动）。

**渲染端（F-104/F-108/F-109 显示口径，渲端）**

- `Collection.vue addCollectedToViral`：透传 `likes: item.engagement?.likes ?? undefined`、`comments: ... ?? undefined`、`published_at: item.publishTime || ''`（undefined 不落字段→主进程存 NULL）。
- `ViralAnalysis.vue pickLibraryItem`：`like_count: item.likes ?? null`、`comment_count: item.comments ?? null`（不再 `Number||0` 压平，引擎据此走 untracked）。
- `ViralLibraryTable.vue formatNum`：`null/undefined/''` → `'-'`（不伪造 0）；真 0 如实显示。
- **F-109 后半（F7 条目副标题「赞 {n}」+ `metricUnknown`/`libItemLikes` 新 locale 键）未纳入本 PR**：保持"零新增用户可见文案"不变量（Gate 7 无需 zh/en 成对变更），副标题属显示增强，归后续显示增强类需求。

**测试与门禁（F-110/F-111，CI）**

- 新增测试 30 个（collector +9 / store viral 契约 +7 / engine NULL 口径 +5 / 渲染端契约 +9），逐批 TDD 红→绿；apps/desktop 全量 vitest 572 files / 10524 tests 通过。
- Gate 7 本地预检：CJK / zh-en 成对 / key 存在性全 PASS（无新增文案）。QM-1：electron-builder `--win --dir` EXIT=0，asar 含全部改动文件，打包产物启动 10s 存活、stderr 无致命错误。
- CI 补充：因本 PR 首次将 PRD/Feature/Test-Plan 纳入版本库，同时满足 Doc-Sync 硬门禁（代码变更需同步 `01-docs/`）。
## 4. P1 规格 — 数据回流闭环 + 选题并源 + 队列保护（单独 PR-2）

**一句话**：回采把真实互动写回 `viral_library`；F3 热门选题并入热榜信号；模式卡片队列加上限与合并窗口。

### 4.1 P1-a 回采写回爆款库（`performance-recrawl-service.js`）

- 回采成功（fetchMetrics 返回任一非空字段）后，**追加一步旁路写回**：按规范化 URL 匹配 `viral_library.url`（norm 规则：去协议差异 `http(s)` 视同、小写 host、去尾斜杠、去 utm_* 查询参；两侧同函数 `_normUrlForMatch`），命中且目标列为 NULL 或回采值更大时更新 `likes/comments`（单调不减：互动只增是平台常识，减小视为解析错误拒绝）；
- 写回经新增 store 方法 `updateViralEngagementByNormUrl(url, { likes, comments })`（**无新 IPC**，仅主进程内部调用）；`updated_at` 同步刷新；`source` 不变；
- **写回失败 fail-open**：try/catch + warn 日志，不影响 tracked_content 域原有事务；
- 更新 `like_collect_ratio` 仅在 collections 也已知时重算，否则置 NULL（P0-c 口径一致）；
- 显示联动：爆款库表格条目 hover tooltip 追加"已于 {date} 回采更新"（新增 i18n 键 `knowledgeBase.engagementRecrawled`：zh「互动数据已于 {日期} 自动回采更新」——日期由渲染端拼接，locale 存短标签「互动数据已自动回采更新」/ "Engagement auto-updated via re-crawl"）。

### 4.2 P1-b F3 热门选题并入热榜信号（`ViralAnalysis.vue loadTrending`）

- F3 数据源从 `articleData ∪ listViralItems top30` 扩展为 **`hotTopics top N（IPC 已有 getHotTopics 链路）∪ 上述本地源`**，每条趋势项标注来源徽标：`hotlist`（热榜）/ `library`（爆款库）/ `articles`（本次分析）；
- 排序：hotlist 项恒前（外部热度 > 内部词频），本地项维持现有分数序；上限 400→截 12 展示（与现 F3 卡片区尺寸兼容，超出滚动）；
- **两套容错口径不合并**（明确决策）：热榜失败/preservedStaleCache 时 F3 静默降级为纯本地源（今日行为），本地也空 → F3 空态卡（今日行为），热榜超时不阻塞爆款分析主流程（`Promise.race` 800ms，热榜是增强项不是依赖项）；
- 点击 hotlist 趋势项：沿用 F3 现有"点击填入主题"交互，不新造交互。

### 4.3 P1-c 模式卡片队列保护（`pattern-extraction-service.js` + 入队点）

- **pending 上限**：入队前查 `countPendingPatternCards()`（store 新增查询方法，非 IPC），> 500 → 新卡片直接标 `deferred` 态（新状态，非终态），每小时巡检时若 pending 回落到 < 200 再批量转回 `pending`；deferred 计数>0 时爆款库页头提示条（见 4.4）；
- **合并窗口**：入库去重增强——同 `norm_url` 已存在 viral 条目时走 `INSERT OR REPLACE` 语义下**复用原卡片**（不重建 pending，避免同题重复 LLM 付费）；实现为入队前 `getPatternCardByViralId` 检查（现有主键语义已支持，仅显式化）；
- 每轮 10 条与防重入补跑维持现状（已够温和），不改调度。

### 4.4 P1 显示项与提示文字

| 触点 | 内容 | i18n 键 |
|---|---|---|
| F3 趋势卡来源徽标 | 「热榜」/「库内」/「分析」 | `viralAnalysis.trendSrcHotlist` / `trendSrcLibrary` / `trendSrcArticles`（zh 热榜/库内/分析；en Hot list / Library / Analysis） |
| 爆款库页头（deferred>0） | 「模式提取排队中（{n} 条延后处理），分析功能不受影响」 | `knowledgeBase.patternQueueBacklog`（zh/en 成对；n 渲染端拼接） |
| 回采 tooltip | 「互动数据已自动回采更新」 | `knowledgeBase.engagementRecrawled` |

### 4.5 P1 验收标准

- AC-P1-1：URL 变体（http/https、尾斜杠、utm 参）回采后爆款库条目互动数更新，且 `likes` 单调不减（变小拒绝并 warn）。
- AC-P1-2：热榜 IPC 抛错/超时 800ms → F3 与今日渲染结果一致（降级回归锁）。
- AC-P1-3：一次灌入 600 条 → pending 峰值 ≤ 500+单轮边界，deferred 计数正确、爆款库页头提示出现；队列回落后 deferred 自动转 pending。
- AC-P1-4：F3 hotlist 项排前且徽标正确；点击行为与本地项一致。

### 4.6 PR-2 落地交付记录（实现即证据，2026-09-22）

> 本节为 PR-2（P1）合入实现回写的实况，与最终代码逐文件对齐。三条链路：P1-a 回采写回、P1-b 选题并源、P1-c 队列保护。

**P1-a 回采写回爆款库（无新 IPC，主进程内部）**

- 触发点：`performance-recrawl-service.js _recrawlOne` 在 tracked 域更新成功（`updateTrackedContent` ok）后调用 `this._writeBackViral(contentUrl || item.url, metrics)`；整段 fail-open——写回抛错仅 `log.warn`，不回滚 tracked 域更新、不向上抛出（U-203b）。
- 解析器注入用 DI seam `const parser = (this._getParser || getParser)(item.platform)`，测试可覆写 `_getParser`；`_jitter` 可注入去抖。
- 写回核心 `knowledge-library-viral-engagement.js`（从 store 拆出的伴生模块，`_engagementNum` 单源、无循环依赖）`updateViralEngagementByNormUrl(url, engagement)`：
  - 双侧 `_normUrlForMatch` 规范化匹配（协议 http/https 视同、host 小写、去 fragment、去尾斜杠、去 utm_* 查询参并排序；path 段大小写保留）；JS 侧比较，无 schema 迁移。
  - 单调不减口径：字段本轮未知（null）→ 不动旧值；NULL→可补；变大→更新；变小→`log.warn` 拒绝（解析错误防御）；相等→no-op。
  - `like_collect_ratio` 仅在 likes 与 collections 双已知且 `collections>0` 时按 P0-c 口径重算；`updated_at` 刷新；`source` 不变；返回 `{ matched, updated }`。
- 显示：爆款库表标题单元格挂 tooltip `knowledgeBase.engagementRecrawled`「互动数据已自动回采更新 — <更新时间前 10 字符>」，仅 `source==='collection'` 且更新/创建时间有差异时出现（`recrawlTooltip`）。

**P1-b F3 热门选题并入热榜信号（`ViralAnalysis.vue`）**

- 纯逻辑抽到 `src/utils/viral-trending-merge.js`（4 个纯函数：`collectTrendingArticles` / `mapLocalKeywords` / `mapHotlistTopics` / `mergeTrending`），`.vue` 侧薄委托，行为逐字节不变（U-221 回归锁）。
- 并源顺序：热榜信号恒前（外部热度 > 内部词频）→ 本地 `viralTrending` 词（src 依来源标题集合判 library/articles，未命中默认 library）；跨源按 word 去重、首见胜出；`slice(0, 12)` 截断。
- 热榜仅读缓存 `hotTopicsGetCache()`（不触发抓取）+ `Promise.race` 800ms 超时兜底 resolve(null)；任何抛错/超时 → 静默降级为纯本地源，与不接热榜时渲染完全一致（AC-P1-2 降级回归锁 U-221b）。
- 显示：趋势词按钮内对 `src==='hotlist'` 项加来源徽标 `.viral-trend-badge`，文案 `viralAnalysis.trendSrcHotlist`「热榜」/ `trendSrcLibrary`「库内」/ `trendSrcArticles`「分析」；点击回填主题行为与本地项一致（AC-P1-4）。

**P1-c 模式卡片队列保护（`viral-pattern-store.js` + `pattern-extraction-service.js`）**

- `PATTERN_STATUS` 新增非终态 `deferred`；模块常量 `PENDING_BACKLOG_LIMIT=500` / `DEFERRED_PROMOTE_BELOW=200` / `DEFERRED_PROMOTE_MAX=200`（实例属性 `this.X ?? 常量` 可覆盖，便于测试）。
- 入队点 `ensurePatternCard`：`const status = this.countPendingPatternCards() >= limit ? 'deferred' : 'pending'`——积压超 500 直接标 deferred，不丢弃。
- 巡检回落 `promoteDeferredPatternCards({ below, max })`：pending ≥ below 或 max≤0 时返回 0；否则 quota=min(max, below-pending)，老卡优先（`created_at ASC`）批量转回 pending；`LIMIT` 拼接纯数字无引号（规避 sql.js 方言）。同 `norm_url` 已存在卡片走 `INSERT OR IGNORE` 天然复用、不重建 pending。
- 计数 `countPendingPatternCards` / `countDeferredPatternCards`；聚合 `patternQueueStats()`（`Promise.all` → `{ pending, deferred }`）。
- 链路打通：store `patternQueueStats` → service `getPatternQueueStats` → IPC `knowledge-library:pattern-queue-stats` → preload（`index.bundle.js` 已重建含 `getPatternQueueStats`）→ renderer api → `KnowledgeBasePage.vue` `onMounted` 拉取。
- 显示：爆款库页在 `activeTab==='viral' && queueDeferred > 0` 时显示提示条 `knowledgeBase.patternQueueBacklog`「模式提取排队中（{n} 条延后处理），分析功能不受影响」（n 渲染端插值）；拉取失败 try/catch 静默，不打扰主流程（AC-P1-3）。

**测试与门禁（CI）**

- 三批 TDD 红→绿：P1-a writeback 14/14、P1-c queue 22/22、P1-b 并源/tooltip/backlog 69/69。
- apps/desktop 全量 vitest：10618 用例，修复后 10616 通过 / 2 跳过 / 0 失败。唯一红 `build-preload「bundle 与源码 API 路径一致」` 根因是新增 preload 方法 `getPatternQueueStats` 未同步提交产物——`node scripts/build-preload.js` 重建 `index.bundle.js` 后转绿。
- 债务熔断：本次改动撑破两文件，按「拆模块不提基线」修复——`knowledge-library-store.js` 513→425（回采写回域拆伴生模块）、`ViralAnalysis.vue` 1031→990（F3 并源逻辑拆 utils）；`check-debt-budget` filesOver1000 32/32、filesOver500 97/97 全回基线。
- Gate 7：5 个新 locale 键 zh/en 1:1 成对（`trendSrcHotlist`/`trendSrcLibrary`/`trendSrcArticles`、`patternQueueBacklog`、`engagementRecrawled`）；i18n 成对回归随全量套件通过。QM-1：electron-builder `--win --dir` 打包验证，详见 PR 说明。


## 5. P2 规格 — 强度注入改写 + 选题联动（单独 PR-3）

**一句话**：把"定量爆款信号"接进改写引擎与选题入口，补 REWRITE-INTEGRATION 只传文本的最后一块。

### 5.1 P2-a 信号强度进 prompt（延续 viral-signal 范式）

- `viral-signal` store 快照追加 `engagement: { avgLikes, avgComments, sampleCount } | null`（分析成功时从因子回填；纯会话内存，不落库，与现有 store 生命周期一致）；
- `/rewrite?titleHint=` 跳转链路参数扩展为携带整个快照（现有 query → 改为 sessionStorage 中转 `mp-viral-signal` 键，避免超长 URL；改写页 onMounted 读取后即删）；
- 引擎注入段（`rewrite-engine-core.js`，与 viralAngles 同区追加、同 sanitize 纪律）：

```
## 爆款强度参考（软约束）
同题材参考样本（{sampleCount} 条）平均互动：点赞 ~{avgLikes}、评论 ~{avgComments}。
生成内容的信息密度与钩子强度应向头部样本（前 25% 分位）对齐；不要虚构具体数字写入正文。
```

- `_sanitizeEngagement`：非有限数/样本数 <3 → 整段不注入（样本太少均值无统计意义，宁缺毋滥——同 mode 一致性校验的"宁可缺省不可误导"原则）；avgLikes 展示取整百（`Math.round(x/100)*100`），防精确数被模型原样抄进文案。
- IPC 零新增（`ai:rewrite` params 透传），preload 零改动。

### 5.2 P2-b 模式卡片 expected_lift 参与检索排序

- `KnowledgeContextBuilder.buildViralContext` 组装爆款参考块时，对带模式卡片的条目按 `IFNULL(expected_lift,0)` 降序优先采样（lift 为 NULL 的排后不丢弃）；
- 卡片 pending（尚未有 lift）不参与加权重排（等同 NULL），提取完成后自然受益。

### 5.3 P2-c 热榜→爆款分析一键联动

- 热门选题页（HotTopics）每条热榜项追加「爆款分析」按钮 → 路由 `/viral-analysis?topic=<条目标题>`；爆款分析页 `onMounted` 读 `route.query.topic`（trim + 200 截断，同 titleHint 校验范式）预填主题输入框但**不自动发起分析**（保留用户确认，防误触计费）。

### 5.4 P2 提示文字

| 键 | zh | en |
|---|---|---|
| `rewritePage.strengthRefLabel` | 爆款强度参考 | Viral strength reference |
| `hotTopics.analyzeAction` | 爆款分析 | Analyze |
| `viralAnalysis.topicPrefillNotice` | 主题已从热门选题带入，点击「爆款分析」开始 | Topic imported from trending picks. Click "Analyze" to start. |

### 5.5 P2 验收标准

- AC-P2-1：注入段仅当 sampleCount≥3 且均值为有限数时出现；改写引擎在未携带信号时行为逐字节不变（回归锁，同 REWRITE-INTEGRATION V7 范式）。
- AC-P2-2：sessionStorage 中转快照在改写页读取后被清除（二次进入不残留）。
- AC-P2-3：热榜按钮跳转预填正确且不自动分析；超长主题截断 200。
- AC-P2-4：buildViralContext 对带 lift 卡片样本排序优先，无卡片样本不丢弃。

## 6. 非功能需求

- **性能**：F3 热榜并入用 800ms race，分析主流程 P95 无可感知退化（benchmark 对比 PR 前后）；URL norm 匹配在回采低频路径上，全表 norm 扫描 ≤ 5 万条时可接受（viral_library 现实规模 <10³）。
- **兼容**：NULL 列对旧版本可读（旧 normalize 的 `Number(null)||0`→0，降级只是回到今日行为）；IPC 通道零新增；DB 零迁移（列已存在且无 NOT NULL）。
- **隐私**：采集 metrics 仅为公开页面计数，无个人信息；sessionStorage 信号快照仅本机。
- **成本**：P1-c 合并窗口直接减少重复 LLM 提取付费。

## 7. 不做清单（Out of Scope）

1. **不合页**：爆款分析/热榜/采集/知识库仍是独立页面，只打通数据不做 UI 合并。
2. **不建新表/新服务**：包括拒绝"engagement_snapshots 新表"方案（viral_library 列已够）。
3. **不动 orchestrator（Python 侧）**：cross-repo，F2 因子正则漂移另立专项（REWRITE-INTEGRATION §10-G）。
4. **不回灌存量假 0**：无法区分真 0/假 0，猜测比留白更糟；靠 P1 回采自然修复可跟踪子集。
5. **不统一两套热榜容错口径**：HotTopicsService 与 F3 各自的降级策略服务不同 UX（整页 vs 内联卡片），强行合并会耦合故障域。
6. **不做互动数预测模型**：属产品概念 Phase 2 远期（REWRITE-INTEGRATION §10-F），本期只回流真实数据。

## 8. PR 编排与分支规划

| PR | 分支（D 盘隔离 worktree） | 范围 | 依赖 |
|---|---|---|---|
| PR-1 (P0) | `codex/viral-lib-engagement-contract` | §3 全部（采集解析/透传/NULL 语义/引擎口径/显示） | 无（纯契约，先行） |
| PR-2 (P1) | `codex/viral-lib-recrawl-hotlist-bridge` | §4 全部（回采写回/F3 并源/队列保护） | PR-1 合入（NULL 口径是写回判断前提） |
| PR-3 (P2) | `codex/viral-signal-strength` | §5 全部（强度注入/lift 排序/热榜联动） | PR-1（读 likes）；与 PR-2 仅 §5.3 软依赖（可并行开发，联调在后） |

每个 PR 独立过 TDD + QM-1 打包 + 视觉回归 + CI 全绿后 auto-merge；三 PR 串行合入避免 locales 成对修改冲突（同文件 `zh.js/en.js`，遵循 append 型文档冲突经验：各 PR 键集合互斥、按 PR 顺序登记）。

## 9. 决策记录

| 决策 | 理由 | 拒绝的备选 |
|---|---|---|
| likes 用 NULL 区分"未知/真零" | 列无 NOT NULL 约束零迁移；`Number(x)||0` 压平是断点①的根因本体，不分离则均值修复无意义 | 加 `has_metrics` 布尔列（拒绝：新列+迁移+双字段一致性负担）；-1 哨兵值（拒绝：魔法数，聚合易漏） |
| 存量 0 不回灌 | 无法事后区分真 0/假 0；猜测数据比缺失更有害 | 全量置 NULL（拒绝：抹掉 analysis/manual 条目的真实 0 语义，且违反 §8-FULL-UTILIZATION"分析报告置零防污染"既定设计） |
| 回采单调不减 + URL norm 匹配 | 平台互动只增常识；norm 规则与 publish-impact-tracker 域外独立实现但规则对齐 | 双写同步（拒绝：耦合两域事务） |
| F3 并热榜用 800ms race 不合并容错 | 热榜是增强项非依赖项；两口径服务不同 UX | F3 完全替换为热榜数据（拒绝：热榜故障会让爆款页选题区空白） |
| 强度注入样本 <3 不生效 | 小样本均值无统计意义，防误导 prompt 锚点 | 照注入并标注样本数（拒绝：模型不读免责标注） |
| sessionStorage 中转信号快照 | query 携带 JSON 超长且脏历史；与 hash 路由兼容性最好 | URL 参数（拒绝：2KB+ 编码 URL 脆弱） |
| deferred 卡片新状态而非丢弃 | 保留"延后"可见性与自动回落，不静默丢提取任务 | 限流丢弃（拒绝：静默丢失违反可见反馈纪律） |

## 附录 A：断点证据索引（基线 7a7d5cc76）

| 证据 | 位置 |
|---|---|
| 采集入爆款库不携带互动数 | `apps/desktop/src/views/Collection.vue` L1602-1623（viralItem 字段清单） |
| HTTP 采集已有 publishTime 被丢弃、无 metrics | `apps/desktop/electron/services/url-collector.js` L312-321 |
| normalize 压平缺省为 0 | `apps/desktop/electron/services/store/knowledge-library-store.js` L19-22 |
| 列定义允许 NULL（无 NOT NULL） | `apps/desktop/electron/services/store-schema.js` L168-185 |
| 均值稀释与权重 | `apps/desktop/electron/services/viral-engine-local.js` L190-221（0.35/0.25 权重、`Number(a.like_count)||0`、trend 阈值） |
| 互动排序沉底 | `knowledge-library-store.js` L203（`ORDER BY (likes+collections+comments) DESC`） |
| F7 回填恒 0 | `apps/desktop/src/views/ViralAnalysis.vue` L630-649；F3 数据源 L506-542 |
| 表格列已就绪 | `apps/desktop/src/components/ViralLibraryTable.vue` L17-21, L53-57 |
| 改写只吃文本软约束 | `packages/rewrite-engine/src/rewrite-engine-core.js` L338-349 |
| 卡片队列每轮 10 + 防重入 | `apps/desktop/electron/services/pattern-extraction-service.js` L48-84 |
| 回采体系现成 | `apps/desktop/electron/services/platform-metrics/index.js`、`performance-recrawl-service.js` |
| 已验证范式（零通道扩展） | `01-docs/PRD-VIRAL-REWRITE-INTEGRATION.md` §2.2/§7 |

## 附录 B：错误状态表（四态覆盖）

| 区域 | 空 | 加载 | 错误 | 边界 |
|---|---|---|---|---|
| 采集 metrics 解析 | 存 NULL、表格显示 `-` | 采集 loading 不变 | 解析异常→NULL+debug 日志（不弹窗，透明降级） | 万/w/逗号格式；负数/超界→NULL |
| 回采写回 | URL 不匹配→静默跳过 | 低频后台无感 | 写库失败→warn、原事务不回滚 | likes 变小→拒绝+warn |
| F3 热榜并源 | 双源皆空→今日空态卡 | 800ms 内联 loading 骨架 | 热榜失败→纯本地降级（与今日一致） | 400 条截 12+滚动 |
| 卡片队列 | 正常无感 | — | 计数查询失败→不阻塞入库 | >500→deferred 提示条 |
| P2 强度注入 | 样本<3→段不注入 | — | sessionStorage 读失败→改写照常无锚点 | JSON 脏数据全字段 sanitize |
