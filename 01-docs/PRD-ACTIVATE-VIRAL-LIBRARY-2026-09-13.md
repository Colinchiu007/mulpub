# PRD — 爆款库激活与效果闭环

> 立项日期: 2026-09-13 | 状态: 实施中（PR #1746，分支 codex/activate-viral-library）| 复杂度: L+ | 风险: 高（DB schema 变更）
> OpenSpec change: openspec/changes/activate-viral-library

## 一、背景与问题

爆款库（viral_library）与个人知识库存在三层断裂，导致「结合爆款库/个人经历」功能实际空转：

1. **检索断点（P0）**：`searchViralItems`/`searchPersonalItems` 用整篇原文做 `LIKE '%整文%'` 子串匹配——长文改写场景命中率趋近于零，复选框形同虚设。
2. **注入浅层（P1）**：即使检索命中，注入的只有标题长度特征/前100字截断/标签频率——爆款最核心的结构化模式（钩子类型/情绪曲线/叙事结构）完全没提取。
3. **闭环缺失（P2）**：改写历史用完即弃、发布后表现数据无回采通道、「哪种模式在我账号上有效」无法归因。

另有两个隐性断裂（探索发现）：采集入库的互动指标恒为 0（PRD 声称的 metadata 映射从未实现）；采集页改写走 Python 链路对桌面 SQLite 爆款库完全不可见。

## 二、三层递进方案

```
P0 检索修复  → 长文改写时爆款库/个人库真正检索命中（关键词提取 + 多词 OR + 评分排序）
P1 模式卡片  → 入库时 LLM 提取结构化模式 → 改写时聚合注入风格指导
P2 效果闭环  → 改写历史持久化 → 发布关联 → 自动回采 → 模式级效果归因
```

## 三、P0 检索修复（已实现）

### 3.1 keyword-extractor 模块

位置：`packages/rewrite-engine/src/keyword-extractor.js`

**extractSync(text, topN)** — 纯同步规则提取：

- 切分：`Intl.Segmenter('zh', {granularity:'word'})` 词级切分（Node 22/Electron 内置零依赖；无 Segmenter 环境回退正则切分，中英文拼接）
- 合并：连续单字合并（小红书 = 小+红+书，上限4字）；孤立单字吸收紧邻 2-3 字词（自媒体 = 自+媒体）
- 过滤：中文停用词表（虚词/代词/副词/否定组合/ICU 词典怪切分防线子串）+ 英文停用词表（toLowerCase 匹配）
- 补充：bigram 高频拼接（「内容+质量→内容质量」，仅组合重复 ≥2 次时保留）
- 排序：词频降序，同频字典序

**extractWithLLM(text, topN, llmClient)** — 异步兜底：

- System prompt 要求严格 JSON `{"keywords": [...]}`
- 解析容错：剥代码围栏（matchAll 取最后一个围栏，防多围栏截断）→ JSON.parse → 逐词停用词过滤
- fail-open：LLM 异常/非法 JSON/无 client 均返回空数组，不抛错

**为什么不用正则贪婪切分**：`/[\u4e00-\u9fa5]{2,4}/g` 会把「自媒体运营」切成「自媒体运/营的核心」，词边界完全错位（viral-engine.js 的已知缺陷，实测确认）。

### 3.2 store 检索重构

`searchViralItems(query, limit)` / `searchPersonalItems(query, limit)`：

- **入参契约**：接受关键词数组（builder 已提取，直传避免二次分词稀释 LLM 兜底结果）或字符串（IPC 独立入口，内部 extractSync）
- SQL：每关键词生成 `(title LIKE ? OR content LIKE ? OR tags LIKE ? ...)` OR 组，候选集 `ORDER BY 互动数 DESC LIMIT 100`（确定性排序）
- JS 评分：`score = 命中数×10 + log10(1+likes+collections+comments) + confidence×5`（个人库无互动中项；confidence===0 不被 ||0.5 抬高）
- 零命中条目不返回；保留检索即强化（access_count+1 / 置信度重算 / 审计日志）

### 3.3 async 化与 LLM 兜底接线

- `KnowledgeContextBuilder.buildFullContext` → async；关键词解析在 useViralLibrary/usePersonalKnowledge 开关守卫**之后**（零开关零 LLM 调用）
- 规则提取 ≥1 个关键词即跳过 LLM（阈值 >= 1）；LLM 兜底经 `extractWithLLM`（chat 适配器包装 `generateWithDefault`，10s 超时 Promise.race）
- `rewrite-engine-core._buildPrompt` 调用链 await 化（rewrite 本身已 async 无破坏）
- 边界保持：检索为空不注入 / 未勾选不检索 / 三层皆空原行为

### 3.4 数据校验

- 关键词数组上限 20 条（store 入参过滤）
- LIKE 参数 `%`/`_` 转义防通配符注入
- SQL 全参数化（关键词只进绑定参数，不拼接 SQL 文本）

## 四、P1 模式卡片系统（已实现）

### 4.1 数据模型 viral_pattern_cards

| 字段 | 类型 | 校验 |
|---|---|---|
| viral_item_id | TEXT PK | FK → viral_library.id，一对一 |
| status | TEXT | pending / done / failed（终态，重试仅经 resetPatternCard） |
| attempts | INTEGER | 0-3，LLM 调用次数 |
| hook_type | TEXT | suspense/conflict/counterintuitive/question/story/data/empathy/other |
| hook_analysis | TEXT | ≤2000 字，钩子原理说明 |
| emotion_curve | TEXT | rise/fall/rise_fall/fall_rise/wave/flat |
| narrative_structure | TEXT | total_subtotal/problem_solution/chronological/contrast/list/story_lesson |
| cta_style | TEXT | question/challenge/resource/follow/comment/none |
| golden_quotes | TEXT(JSON) | ≤3 句，非字符串过滤 |
| title_formula | TEXT | 含 {占位符}；无占位符回退原标题 |
| schema_version | INTEGER | 当前 1，未来维度扩展预留 |
| extracted_at/last_error/created_at/updated_at | TEXT | |

**入库即建 pending 行**：`KnowledgeLibraryService.addToViral/addViralBatch` 后置钩子 `ensurePatternCard`（幂等）+ `triggerExtraction`。存量迁移回填 pending。

**级联**：deleteViralItem 后置钩子清理对应卡片。

### 4.2 PatternExtractionService

位置：`apps/desktop/electron/services/pattern-extraction-service.js`

- 队列：`listPendingPatternCards(10)`（仅 pending；failed 为终态）
- LLM：`generateWithDefault('llm', {messages})`，system prompt 含完整 schema + 枚举表
- 解析容错三层：剥围栏 → JSON.parse → 逐字段校验（非法枚举 hook_type 落 other 其余落空 / 金句过滤非字符串+截断3 / 公式无 {占位符} 回退原标题）
- 失败语义：单条失败 `recordPatternAttempt`（attempts+1，≥3 转 failed 终态）；源内容缺失直接 failed
- 防重入：`_running` 守卫 + `_pendingTrigger` 标记（运行中的触发不丢弃，本轮结束 setImmediate 补跑）
- 触发：启动后 30s + 入库后异步 + 每小时巡检（setInterval unref）
- **任何失败不阻塞入库/改写主流程**

### 4.3 注入升级（聚合风格指导）

`buildViralContext(keywords)` 重写：

1. 关键词数组直传 search → Top3 爆款
2. 逐条加载 done 卡片（getPatternCard adapter）
3. 有卡片 → `_buildPatternGuidance`（聚合视图）+ 浅层块拼接；卡片全字段为空 → 回退浅层
4. 无卡片/全 failed → 浅层特征（P0 行为兜底）

聚合指导格式（Q10=B 决策——聚合视图而非原始数据罗列）：

```
## 爆款风格指导（基于 N 条同主题爆款模式分析）
- 开头钩子：优先「悬念式（M/N 条采用）」——标题公式参考「{年龄}{事件}后我才明白{道理}」
  钩子原理：制造信息差引发好奇
- 情绪曲线：建议「先扬后抑」
- 叙事结构：建议「问题-方案」
- CTA：建议「提问式互动」
- 金句风格参考（学习句式，不复制）：「……」
```

主题不进卡片结构（Q11b）：主题由检索关键词解决，卡片只存平台表达模式，两维正交。

### 4.4 入口收敛

**Collection.vue**（Q15）：三个改写调用从 `aggregationRewrite`（Python，对桌面 SQLite 不可见）切换 `aiRewrite`（Node 引擎）：

- style → `userSettings.tone`（轻松易懂→casual / 正式严谨→formal / 吸引眼球→catchy / 深度分析→professional / 认知锚点→anchor）
- length → `userSettings.targetLength`（keep→medium / compress→short / expand→long）
- mode 统一 imitate（保留原文语义）
- knowledgeOptions 透传（复选框已存在，默认：爆款库开/个人经历关）
- 错误归一化：aiRewrite 异常 catch 后转 `{__error: {code:-99, message}}`，业务错误透传原始 res，统一走 formatUserError

**HotTopics.vue**（Q18=A）：两处 `aiRewrite(mode:'create')` 传入 `knowledgeOptions.useViralLibrary: hotUseViral.value`；新增「结合爆款库」复选框**默认勾选**（创作场景无原文风格约束，注入纯增益）。

### 4.5 模式分析 Tab（Q13-B）

KnowledgeBasePage 爆款库 Tab 内二级视图（PatternAnalysisPanel.vue）：

- 列表：条目 ID / 状态徽标（分析中-橙/已完成-绿/失败-红）/ 钩子类型 / 情绪曲线 / 标题公式 / 尝试次数
- 筛选：状态下拉（全部/分析中/已完成/失败）
- 详情抽屉：完整卡片（含钩子分析/金句列表/最后错误）
- 操作：重新分析（resetPatternCard → pending → 异步入队）
- 枚举标签显式 i18n key 映射（静态扫描可识别）

## 五、P2 效果闭环（已实现）

### 5.1 数据模型（4 新表 + 1 列）

**rewrite_history**：`id / mode / original_excerpt(≤500字) / rewritten_content / strategy_id / knowledge_refs(JSON) / matched_keywords(JSON) / owner_subject / created_at`。不设自动清理。每次 ai:rewrite 成功由 RewriteEngineService 写入（写失败仅日志不阻塞）；响应新增 `rewriteHistoryId`。

**publish_history** 加列 `rewrite_history_id`。

**tracked_content**：`id / platform / post_id / url / publish_history_id / rewrite_history_id / recrawl_status / last_recrawl_at / next_recrawl_at / owner_subject / created_at`。recrawl_status ∈ pending/ok/failed/unsupported/untrackable/manual。

**performance_snapshot**：`id / tracked_content_id / source(auto/manual) / views / likes / comments / favorites / shares / raw(JSON) / captured_at`。auto 与 manual 同表共存，趋势可回放。

**pattern_performance**：`id / dimension / value / platform / sample_count / avg_views / avg_likes / avg_comments / avg_favorites / engagement_score / computed_at`。engagement_score = avg_likes + avg_comments + avg_favorites × 2（首版启发式）。

### 5.2 发布关联链路（Q12=A）

- 发布入口显式携带 rewriteHistoryId（task.rewriteHistoryId 或 article.rewriteHistoryId）
- phase4-events `task:success` → 写 publish_history + 登记 tracked_content：
  - 有 postId 或 http(s) URL → pending，nextRecrawlAt = T+1h
  - 都没有 → untrackable（仅手动录入）

### 5.3 平台指标解析器注册表（Q7=A 分层 / Q14）

位置：`apps/desktop/electron/services/platform-metrics/index.js`

```js
{ platform, resolveContentUrl(postId, resultUrl), async fetchMetrics({url, postId}) }
```

- **第一批**：zhihu（页面 initialData 正则）/ baijiahao（页面阅读/点赞/评论正则）/ kuaishou（m.gifshow.com 页面）/ bilibili（公开 API 优先 + 页面回退）
- fetch 超时 10-15s（AbortController）；HTTP 非 2xx 抛错
- 未注册平台 → unsupported；新平台 = 新增 parser + registerParser，核心零改动

### 5.4 PerformanceRecrawlService（Q8=B）

- 触发：启动后 30s + 每 24h 巡检
- 筛选：`next_recrawl_at <= now AND created_at > now-7d AND status IN (pending, ok)`
- 采样节奏：+1h/+6h/+24h/+72h/+7d（按发布时间推进），7 天窗口后停止
- 执行：顺序 + 2-5s 随机抖动（_jitter 可测试覆写）
- 失败：单条记 failed + 1h 重试；连续 3 次转 manual（UI 手动录入兜底）
- 成功：写 performance_snapshot → 更新 tracked_content（ok + nextRecrawlAt 推进）

### 5.5 归因重算 PatternAttributionService

- 链路：`tracked_content(有rewrite_history_id) ⋈ rewrite_history.knowledge_refs(viral_library) ⋈ pattern_cards(done) ⋈ latest_snapshot`
- 四维聚合：hook_type / emotion_curve / narrative_structure / cta_style → 均值 + sample_count
- 全量替换 pattern_performance（幂等；空数据清空表）
- 触发：IPC 手动（效果洞察页「重算归因」按钮）；扩展路线：每日回采后自动

### 5.6 UI（Q13-B+）

**发布历史页**：loadRecords 后异步合并 tracked_content 最新快照（taskId 关联）→ 现有 views/comments/likes/favorites/shares 渲染位显示真实数据；手动录入对话框（unsupported/untrackable 平台兜底，写 manual 快照）。

**效果洞察页**（/performance-insights + PerformanceInsights.vue，「更多」菜单知识库旁）：

- 四维模式排行表：模式值/样本数（<3 标注「样本不足」）/平均阅读/点赞/评论/收藏/互动得分（进度条归一化）
- 空态引导文案；「重算归因」按钮
- 数值格式：≥1万 显示 

（数值格式说明：≥10000 显示为 X.X万，取整展示）

## 十一、用户可见文案清单（i18n zh/en 成对）

新增命名空间 `knowledgeBase.pattern*`（54 key）与 `perfInsights.*`（20 key）+ `historyPage.manualEntry*`（3 key）+ `hotTopics.useViralLibrary`。全部通过 CI Gate 7 三项检查（CJK 硬编码 / key 存在性 / zh-en 成对）。

关键提示文案：

- 模式分析空态：跟随表格空数据展示
- 重新分析成功：「已加入重新分析队列」；失败：「重新分析失败，请稍后重试」
- 效果洞察空态标题：「暂无归因数据」；提示：「发布带改写关联的内容并回采表现数据后，这里会展示各表达模式的效果排行」
- 归因重算成功：「归因重算完成」；失败：「归因重算失败，请稍后重试」
- 样本不足标注：「样本不足」（sample_count < 3）

---

## 鍗佷簩銆?026-09-21 澧為噺锛氫晶杈规爮銆屾洿澶氥€嶉€変腑鎬佷慨澶?+ 鏁堟灉娲炲療椤电簿鑷村寲

鏈?搂5.6銆屾晥鏋滄礊瀵熼〉銆嶅湪 2026-09-21 鍋氫簡 UI/UE 绮捐嚧鍖栵紝骞朵慨澶嶄簡渚ц竟鏍忋€屾洿澶氥€嶈彍鍗曠己閫変腑鎬佺殑闂銆?
瀹屾暣鐨勬暟鎹牎楠屻€佸姛鑳介€昏緫銆佷氦浜掗€昏緫銆佹樉绀洪」涓庣敤鎴峰彲瑙佹枃妗堣锛?
`01-docs/PRD-SIDEBAR-INSIGHT-POLISH-2026-09-21.md`銆?

瑕佺偣锛?
- 渚ц竟鏍?more 瀛愰」缁戝畾 active + `aria-current="page"`锛涖€屾洿澶氥€嶈Е鍙戝櫒 `moreOpen || hasActiveMoreItem` 甯搁┗楂樹寒锛沗watch(route.path)` 娣遍摼鑷姩灞曞紑銆?
- 鏁堟灉娲炲療椤垫柊澧烇細骞冲彴绛涢€夈€佹瑙堟潯銆佷袱绾х┖鎬併€佸彲閲嶈瘯閿欒妯箙銆佹帓琛岃〃锛堝悕娆″窘鏍?鏈€浼樻ā寮?chip/浣庢牱鏈鍛?寰楀垎杩涘害鏉★級銆?
- 褰掑洜鍙ｅ緞涓嶅彉锛坄engagement_score = avg_likes + avg_comments + avg_favorites 脳 2`锛夛紱鍓嶇浜屾鏄惧紡闄嶅簭淇濊瘉銆屾渶浼樻ā寮?= 棣栬銆嶃€?
