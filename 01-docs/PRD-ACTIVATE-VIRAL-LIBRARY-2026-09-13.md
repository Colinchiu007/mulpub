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

## 十二、知识库视图一致性与手动/链接采集入口（2026-09-21 增量，kb-hotsync-ui-fix）

### 12.1 背景与根因

用户反馈三处知识库（KnowledgeBasePage）体验问题，逐项溯源：

| # | 现象 | 根因 | 分类 |
|---|---|---|---|
| 1 | 「添加爆款」弹窗标题与页面右上按钮同名，用户无法区分「手动录入」与「链接采集」两条路径 | 弹窗与入口按钮共用同一 i18n key `knowledgeBase.addViral`，缺少路径区分文案；采集页（`/collection`）已有链接采集能力但无跨页入口 | 交互设计缺口 |
| 2 | 「爆款库 / 模式分析」视图显示 3 个标签，切到「个人知识库」只剩 2 个（模式分析消失） | Q13-B 原设计把模式分析定义为「爆款库 Tab 内**二级视图**」，实现时落地为**一级标签**并对标签按钮加了 `v-if="activeTab === 'viral' \|\| activeTab === 'pattern'"` 条件渲染。设计与实现漂移：面板本身仍按 `activeTab === 'pattern'` 独立渲染，标签按钮却被条件隐藏 | 实现与设计漂移（缺陷） |
| 3 | 「添加知识」文案与实际语义（含人设/背景/经历/观点/文件批量导入）不匹配 | `knowledgeBase.addPersonal` 早期沿用「知识」单词语义，未随个人知识库内容类型扩展而更新 | 文案准确性 |

**逃逸分析（为什么没被拦住）**：

- 单元测试：`KnowledgeBasePage.vue` 与 `ViralFormDialog.vue` 此前**零测试覆盖**（全库检索 `KnowledgeBasePage|ViralFormDialog|kb-tab-btn` 在 `*.test.js` 中 0 命中），标签数量、按钮文案、弹窗标题均无断言；
- 集成/E2E：views-coverage / views-deep 未纳入知识库页；
- 视觉回归：知识库页无基线截图用例；
- 代码审查：条件渲染 `v-if` 在标签按钮上属"看似合理"的局部优化（模式分析只对爆款有意义），审查时被语义合理性掩盖，未对照 PRD 原文「二级视图」核验；
- CI 门禁：Gate 7（locale 成对 / CJK / key 存在性）只校验文案机制，不校验文案一致性，无法发现"两个视图标签数不同"。

### 12.2 变更清单

| 层 | 文件 | 变更 |
|---|---|---|
| 视图容器 | `apps/desktop/src/views/KnowledgeBasePage.vue` | ① 移除模式分析标签按钮的 `v-if`，三标签恒定渲染；② 新增 `onCollectByLink()`：关闭弹窗 + `router.push('/collection')`；③ 弹窗绑定 `@collect`；④ 引入 `useRouter` |
| 弹窗组件 | `apps/desktop/src/components/ViralFormDialog.vue` | ① 标题改用 `addViralManual`；② 标题右侧新增 `【用链接采集】` 文字链接按钮（`data-testid="viral-form-collect-link"`，`v-if="!isEdit"`）；③ `defineEmits` 增加 `collect`；④ 新增 `.dialog-header-left` / `.dialog-collect-link` 样式 |
| 文案 | `apps/desktop/src/locales/zh.js` / `en.js` | 新增 `addViralManual`、`collectByLink`；`addPersonal` 改为「添加内容」/「Add Content」（zh/en 成对） |
| 回归保护 | `apps/desktop/src/views/KnowledgeBaseHotsyncUi.test.js`（新增） | 9 例，见 12.8 |

### 12.3 显示项

**标签栏（三视图恒定一致）**

| 项 | 规则 |
|---|---|
| 标签集合 | 爆款库 / 模式分析 / 个人知识库，**任何 activeTab 下都渲染 3 个**，不再条件隐藏 |
| 选中态 | `.kb-tab-btn.active`：白底 + 主文本色 + 500 字重 + 阴影；未选中为 muted 色 |
| 等宽 | 每个标签 `flex: 1`，3 标签均分容器宽度（原 2 标签视图布局随之变为 3 等分） |
| 页面副标题 | 随 activeTab 切换：viral → `viralSubtitle`；pattern → `patternSubtitle`；personal → `personalSubtitle` |
| 右上操作区 | viral → 「＋ 添加爆款」+「导出到飞书」；personal → 「＋ 添加内容」+「批量导入」+「导出到飞书」；pattern → 仅「导出到飞书」（模式卡片由爆款派生，无独立新增语义） |

**「手动添加爆款」弹窗**

| 项 | 规则 |
|---|---|
| 标题（新增态） | 「手动添加爆款」（`addViralManual`），与页面按钮「添加爆款」形成"入口—方式"区分 |
| 标题（编辑态） | 仍为「编辑」（`knowledgeBase.edit`），编辑场景不出现采集入口 |
| 采集入口 | 标题右侧下划线珊瑚色文字按钮「用链接采集」，与标题水平间距 12px，位于关闭 ✕ 之前 |
| 表单字段 | 标题 / 链接 / 正文*（必填）/ 博主 / 平台 / 话题标签 / 封面 / 发布时间 / 点赞数 / 收藏数 / 评论数（保持不变） |

### 12.4 交互逻辑

1. **入口**：爆款库视图点「＋ 添加爆款」（或空态「新增爆款」）→ 打开弹窗；
2. **改道采集**：弹窗内点「用链接采集」→ 关闭弹窗（同时清空 `editingViral`，不残留编辑态）→ SPA 路由跳转 `/collection`，由采集页链接输入框走「输入链接 → 自动采集标题/正文/封面 → 入库」流程；
   - 跳转采用 `router.push` 而非新窗口，保持 home 虚拟标签内导航，与既有 `/rewrite?titleHint=` 跳转链路同构；
   - 弹窗自身不持有路由依赖（仅 `emit('collect')`），路由决策收敛在容器组件，便于单测与复用；
3. **手动录入**：填表 → 保存 → `addViralToLibrary` / `updateViralItem` → 成功 toast → 关闭弹窗 → `viralRef.loadData()` 刷新表格；
4. **标签切换**：三标签任意顺序互切，面板按 `activeTab` 条件渲染（`v-if`），切换即挂载/卸载，模式分析面板 `onMounted` 自动拉取卡片列表；
5. **文案变更**：个人知识库「＋ 添加知识」→「＋ 添加内容」，点击行为不变（打开 `PersonalFormDialog`，其标题沿用 `addPersonal` → 同步显示「添加内容」）。
   - 同一动作在页面内有**两个入口**：右上主按钮（`addPersonal`）与列表空态 CTA（`empty.personal.action`，原「新增知识」）。二者必须同口径为「添加内容」，否则空库用户（首次使用的主路径）仍会看到旧文案，形成"同一按钮两种叫法"的口径漂移；
   - 空态标题「暂无知识内容」与说明「添加个人知识后，可在创作时自动引用你的表达风格」保持不变（描述对象仍是"知识内容"，非按钮动作）。

### 12.5 数据校验

本次为 UI/文案层变更，未新增写入路径；相关既有校验保持并复核：

| 校验点 | 规则 | 失败行为 |
|---|---|---|
| 弹窗必填 | `content.trim()` 非空 | 表单内联 `form-error`（`role="alert"`）提示必填，不发请求 |
| 弹窗长度 | `content.length <= 50000` | 内联错误，不发请求 |
| 链接格式 | `url` 非空时须为 http/https 可解析 URL | 内联错误提示，不发请求 |
| 采集入口 | 无输入（跳转即采集页，链接校验由采集页 `collection.enterLink` 承担） | — |
| 标签渲染 | 三标签恒定存在，不再依赖 activeTab | 由单测数组等值断言锁定（防回归） |
| i18n | zh/en 成对新增；渲染端非 locales 文件零新增 CJK 字面量 | CI Gate 7 拦截 |

### 12.6 提示文字（i18n，zh/en 成对）

| 键 | zh | en | 变更 |
|---|---|---|---|
| `knowledgeBase.addViralManual` | 手动添加爆款 | Add Viral Manually | 新增（弹窗标题） |
| `knowledgeBase.collectByLink` | 用链接采集 | Collect via Link | 新增（采集入口） |
| `knowledgeBase.addPersonal` | 添加内容 | Add Content | 修改（原「添加知识 / Add Knowledge」） |
| `knowledgeBase.addViral` | 添加爆款 | Add Viral | 不变（页面右上入口按钮） |
| `knowledgeBase.empty.personal.action` | 添加内容 | Add Content | 修改（原「新增知识 / Add knowledge」，与右上按钮同口径） |

### 12.7 模式分析功能说明（实现现状）

**它是什么**：把「爆款库」里每条内容交给 LLM 做一次**表达模式抽取**，产出与原文解耦的结构化「模式卡片」，再在改写时把同类爆款的模式**聚合**成一段风格指导注入 Prompt。它分析的是"怎么写"，不是"写了什么"。

**数据模型**：`viral_pattern_cards`，与 `viral_library` 一对一（`viral_item_id` 外联）。字段：`status`（pending/done/failed）、`hook_type`、`hook_analysis`、`emotion_curve`、`narrative_structure`、`cta_style`、`golden_quotes`（≤3）、`title_formula`、`attempts`、`last_error`、`extracted_at`。

**六个维度（枚举前后端 + i18n 三处必须一致）**：

- 钩子类型 8 种：悬念式 / 冲突式 / 反常识 / 提问式 / 故事式 / 数据式 / 共情式 / 其他
- 情绪曲线 6 种：逐步升温 / 逐步下沉 / 先扬后抑 / 先抑后扬 / 波浪起伏 / 平铺直叙
- 叙事结构 6 种：总分总 / 问题-方案 / 时间线 / 对比 / 清单 / 故事+道理
- CTA 方式 6 种：提问式互动 / 挑战式 / 资源引导 / 关注引导 / 评论引导 / 无 CTA
- 标题公式：自由文本，须含 `{占位符}`，否则回退原标题
- 金句：原文摘录 ≤3 句；钩子分析：≤50 字有效性说明

**流程**：

1. **入库即建卡**：`addToViral / addViralBatch` 后置钩子 `ensurePatternCard`（幂等 `INSERT OR IGNORE`，status=pending）+ `triggerExtraction` 异步入队；
2. **队列提取**：`PatternExtractionService.processQueue` 每轮最多 10 条；Prompt 只送标题 + 平台 + 正文前 3000 字；
3. **解析容错**：剥 ```json 代码围栏 → `JSON.parse` → 逐字段枚举白名单校验（未知钩子降级 other，非法曲线/结构/CTA 置空）→ 金句过滤非字符串并截断 3 条；
4. **失败与兜底**：单条异常记 `attempts` 不中断整轮；LLM 连续失败 ≥2 次触发**本地规则预填**（零成本启发式：标题反常识词/问号/数字 → 钩子；尾部「评论区/关注我/私信」→ CTA；段落数与转折词 → 曲线/结构；数字占位符化 → 标题公式），卡片转 done 且 `last_error` 标记来源，**不进 failed 终态**；无显著信号的字段留空，避免稀释聚合统计；源内容被删 → 直接标 failed 终止重试；
5. **调度**：启动后 30s + 入库后异步 + 每小时巡检（timer `unref`），任何失败不阻塞入库/改写主流程（fail-open）；防重入用 `_pendingTrigger` 标记，本轮结束后立即补跑。

**怎么用（用户视角）**：

1. 先在「采集」页用链接采集爆款，或在「爆款库」手动添加（正文必填——正文是模式抽取的唯一输入源）；
2. 入库后等待自动分析（启动 30s 巡检 / 每小时巡检 / 入库即时触发），「模式分析」标签的状态列从「分析中」变「已完成」即产出卡片；
3. 在「模式分析」标签可按状态筛选、刷新、打开详情抽屉查看完整卡片（含钩子原理、金句、最后错误）；结果不满意或当时 LLM 失败，点「重新分析」→ 卡片 reset 为 pending → 重新入队；
4. 改写时勾选「结合爆款库」，引擎按关键词检索 Top3 同主题爆款，加载其 done 卡片，`_buildPatternGuidance` 聚合为「## 爆款风格指导（基于 N 条同主题爆款模式分析）」段落注入 Prompt；
5. 发布后经「效果洞察」页「重算归因」，把 `tracked_content ⋈ rewrite_history.knowledge_refs ⋈ pattern_cards ⋈ snapshot` 聚合为四维模式效果排行（`pattern_performance`），反哺"哪种钩子/结构在我的账号上真的有效"。

**边界与局限**：

- 卡片只存**平台表达模式**，不存主题（Q11b 决策：主题由检索关键词解决，两维正交）；
- 卡片全字段为空时 `_buildPatternGuidance` 返回空串，上层自动回退浅层特征块（标题模式/关键词），不会注入空洞指导；
- 本地规则预填精确度低于 LLM，仅作"聚合可用"兜底，可经「重新分析」由 LLM 覆盖，也可人工修正；
- 归因样本 `sample_count < 3` 时效果洞察标注「样本不足」，不据其调整策略；
- 模式分析依赖可用模型供应商：未配置 LLM 时，卡片经 2 次失败后落到本地规则预填（表现为「已完成」但字段较少、`hook_analysis` 带「（本地规则预填）」前缀）。

### 12.8 测试映射与实测

| 用例 | 断言 |
|---|---|
| K1-K3 | 三个 activeTab（viral / personal / pattern）下标签集合恒为 `[爆款库, 模式分析, 个人知识库]`（缺陷 2 的回归锁） |
| K4 | 个人知识库视图添加按钮含「添加内容」且不含「添加知识」（缺陷 3） |
| K5-K6 | 弹窗新增态标题为「手动添加爆款」；编辑态仍为「编辑」且不显示采集入口 |
| K7-K8 | 采集入口存在、文案为「用链接采集」；点击 emit `collect` 一次 |
| K9 | 容器收到 `collect` 后关闭弹窗并 `push('/collection')` |
| K10 | zh：`addPersonal` 与 `empty.personal.action` 均严格等于「添加内容」，且不含「新增知识」（两处入口口径一致） |
| K11 | en：`addPersonal` 与 `empty.personal.action` 均等于 "Add Content"（Gate 7 成对性前置保证） |

实测：`KnowledgeBaseHotsyncUi.test.js` 11/11 通过（K10-K11 为追加的空态文案口径锁）；`views-coverage.test.js` + `more-components.test.js` 19/19 无回归；CI Gate 7 三项（zh/en 成对、CJK 基线无新增硬编码、key 存在性）全部 PASS。关联回归 `viral-signal` + `ViralAnalysis` 共 43/43、`rewrite-engine` 知识/模式相关 33/33 通过。

**浏览器实测取证**（headless Chromium 1440x900，本 worktree Vite dev server，`#/knowledge-base`）：三视图标签恒为 `[爆款库, 模式分析, 个人知识库]`；个人知识库右上按钮「＋ 添加内容」；弹窗 `.dialog-title` 为「手动添加爆款」，其右侧「用链接采集」计算样式为 `text-decoration: underline` + `color: rgb(239, 87, 87)` + `cursor: pointer`；点击后 `location.hash === "#/collection"` 且弹窗节点消失。追加轮复核（个人知识库空库态）：页面内所有含"添加/新增"的按钮文本为 `["＋ 添加内容", "添加内容"]`，`staleLabelPresent(新增知识) === false`，标签数仍为 3。

**预防措施落地**：

1. 新增视图级测试文件补齐 `KnowledgeBasePage` / `ViralFormDialog` 的覆盖空白，标签集合以**数组等值断言**（而非长度 ≥N）锁定，任何标签增减必须显式改测试；
2. §4.5 的「爆款库 Tab 内二级视图」表述由本增量修正为**一级标签**（三视图恒定可见），后续改标签结构须同步更新 §4.5 与 §12.3；
3. 跨页跳转入口统一走 `emit + router.push` 模式（弹窗组件不持有路由依赖），保持可单测。

---

## 十三、2026-09-21 增量：侧边栏「更多」菜单选中态修复 + 效果洞察页 UI/UE 精致化

本增量对 §5.6「效果洞察页」做了 UI/UE 精致化，并修复了侧边栏「更多」菜单缺选中态的问题。
完整的数据校验、功能逻辑、交互逻辑、显示项与用户可见文案见：
`01-docs/PRD-SIDEBAR-INSIGHT-POLISH-2026-09-21.md`。

### 13.1 侧边栏「更多」选中态（Bug 修复）
- more 组子项此前为裸 `router-link` 无选中态；现绑定 `active` class + `aria-current="page"` + `data-testid`。
- 「更多」触发器高亮条件改为 `moreOpen || hasActiveMoreItem`，子项命中时触发器常驻高亮。
- 新增 `watch(() => route.path)`：命中 more 组路由时自动展开，覆盖硬刷新深链（`onMounted` 早于异步路由解析的缺口）。

### 13.2 效果洞察页精致化
- 新增平台筛选下拉（选项从数据派生、复用 `PLATFORM_NAMES`）、数据概览条（总样本/模式数/最近计算）。
- 两级空态（页面级 + 维度级）、可重试错误横幅、排行表（名次徽标 / 最优模式 chip / 低样本警告徽标 / 得分进度条）。
- `rowsFor` 前端二次显式降序，保证「最优模式 = 首行」；`recomputing` 守卫防重复重算。
- 修复 `dimValueLabel` 枚举翻译守卫 bug（原硬编码比较使 `hook_type` 恒不翻译）；前缀查表 + `te()` 探测。
- 归因口径不变（`engagement_score = avg_likes + avg_comments + avg_favorites × 2`）。
- 字号字面量全部 token 化为 `var(--font-size-*)`（Gate16 font-size 缩放门禁）。

### 13.3 关联
- 分支 `sidebar-insight-polish`（worktree 隔离，D 盘）· PR #2134 · 12 例单测（`MpSidebar.more-active.test.js` 5 + `PerformanceInsights.test.js` 7）
