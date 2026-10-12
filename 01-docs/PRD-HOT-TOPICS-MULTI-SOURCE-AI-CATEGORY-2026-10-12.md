# PRD + 实施方案：热门选题多源扩展 · 新增 AI 分类 · 归类准确性优化

---

## 1. 文档信息

| 项 | 内容 |
|---|---|
| 文档标题 | PRD + 实施方案：热门选题多源扩展 · 新增 AI 分类 · 归类准确性优化 |
| 版本 | v1.0 |
| 日期 | 2026-10-12 |
| 作者 | PM + 技术文档（基于已完成的真实代码改动与三份已落盘调研报告） |
| 关联 change | `openspec/changes/hot-topics-multi-source-ai-category`（proposal / design / tasks / specs 四件已落盘） |
| 关联调研 | `01-docs/research/hot-topics-sources-douyin-xhs.md`、`01-docs/research/hot-topics-sources-toutiao-ifeng.md`、`01-docs/research/hot-topics-classification-accuracy.md` |
| 关联研究报告 | `01-docs/RESEARCH-HOT-TOPICS-MULTI-SOURCE-2026-10-12.md` |
| 状态 | 代码已落地；**质量节拍（定向测试 / pytest / locale 门禁 / eslint / QM-1 打包）与提交、PR、合并待执行** |
| 实现工作区 | `D:/Data/projects/mp-worktrees/mp-hot-topics-multi-source`（分支 `hot-topics-multi-source`） |

### 1.1 影响面（按层）

| 层 | 文件 | 改动性质 |
|---|---|---|
| 主进程 · 服务 | `apps/desktop/electron/services/hot-topics-service.js`（650 行） | 渠道配置 8 → 10、抖音 `fallbacks`、小红书固定头常量、`ai` 补拉源、`_collectChannel` 两条新合同、`_collectBoostChannel` 分类归属修正 |
| 主进程 · 解析 | `apps/desktop/electron/services/hot-topics/channels.js`（359 行） | 新增 `parseCnNumber` / `parseXiaohongshu` / `parseIfeng` / `parseIfengInline` / `extractIfengAllData`；增强 `parseDouyin`；修正 `parseToutiao` |
| 主进程 · 分类 | `apps/desktop/electron/services/hot-topics/classifier.js`（437 行） | v3：11 类含 `ai`、`RAW_CATEGORY_WEAK_MAP`、`DOMAIN_LEVEL_RAW`、strong/weak + `STRONG_MULT`/`MIN_SCORE`、`_matchesLatin`、`normalizeForMatch`、`general` 不变量 |
| 主进程 · 评分 | `apps/desktop/electron/services/hot-topics/scorer.js`（181 行） | 新增渠道权重 `xiaohongshu = 1.0`、`ifeng = 0.95` |
| 主进程 · 类别目录 | `apps/desktop/electron/services/content-categories.js`（147 行） | 内置 10 → 11 类（新增 `ai`） |
| 渲染层 | `apps/desktop/src/views/HotTopics.vue`（708 行） | `CATEGORY_KEYS` 11 类、`CHANNEL_KEYS` 新增 `xiaohongshu`/`ifeng` |
| 渲染层 · 类别目录 | `apps/desktop/src/features/content/content-categories.js`（137 行） | 内置 10 → 11 类 |
| 渲染层 · 文案 | `apps/desktop/src/locales/hot-topics/{zh,en}.js`、`apps/desktop/src/locales/content-categories/{zh,en}.js` | `categories.ai`、`channels.xiaohongshu`、`channels.ifeng`（zh/en 成对） |
| 运营端 | `ops-center/backend/services/content_category_service.py`（340 行） | `CATALOG` 新增 `ai`（置于 `tech` 之后），并修正 `tech` 描述为「不含 AI，见 ai」 |
| 测试 | `hot-topics/classifier.test.js`、`hot-topics-new-sources.test.js`、`hot-topics-boost-classify.test.js`（新增）；`hot-topics-service.test.js`、`content-categories.test.js`、`test_content_categories_api.py`（同步更新） | 见 §11 |

---

## 2. 需求背景与目标用户 / 用户故事

### 2.1 背景

「热门选题」是桌面端的内容创作入口：从多渠道公开热榜聚合选题，支持一键创作文案、爆款分析、一键发布。用户 2026-10-12 提出三件事，全部源自**实际使用中看到的症状**：

1. 数据源太少 —— 只有 8 个渠道，且缺少小红书、凤凰网两个国民级内容平台。
2. 现有 10 个分类里没有 AI —— AI 内容被压进「科技」，而 AI 已是独立的一大块内容域。
3. **「科技类别下，有时候存在和科技不沾边的内容」** —— 归类不准，要求分析标准与逻辑并给出优化办法。

调研确认三条都不是错觉（见研究报告 §1.2）。

### 2.2 目标用户

| 用户 | 场景 | 关心什么 |
|---|---|---|
| 自媒体内容创作者（主） | 每天打开热榜挑选题，按分类筛自己擅长/感兴趣的领域 | 「我要看情感类」能不能筛出情感类；分类下**不要混进不沾边的内容** |
| 视频/图文多平台运营 | 挑选题后一键生成文案 + 发布 | 选题数量够多、来源够广（多平台覆盖） |
| AI 内容垂类创作者（新增画像） | 只做 AI 赛道，需要 AI 选题池 | 有独立 AI 分类、能补拉 AI 选题 |
| 运营中心运营者 | 维护内容类别目录（改名/排序/停用） | 改名后桌面端立刻生效；不能出现「运营端能配、桌面端认不出」 |

### 2.3 用户故事

| # | 用户故事 | 验收绑定 |
|---|---|---|
| US-1 | 作为创作者，我希望热榜里能看到小红书和凤凰网的选题，这样我不用另开网页手动找 | 缓存 `channelStats` 里出现 `xiaohongshu` / `ifeng` 且 `count > 0` |
| US-2 | 作为 AI 垂类创作者，我希望有一个独立的「AI」分类，这样我不用在「科技」里翻找 | `ai` chip 有数据；`ai` chip 为空时点「补拉该分类」能产生新条目 |
| US-3 | 作为创作者，我希望点进「科技」分类时看到的都是科技内容，不要混进「今晚吃什么」这种 | `rawCategory='科技'` + 无关文本不再落 `tech` |
| US-4 | 作为创作者，我希望科技相关但表达不典型的标题（如「华为发布折叠屏手机」）不要被丢进「综合」 | 漏判面测试通过 |
| US-5 | 作为运营者，我希望在运营中心新增/改名类别后桌面端不会出现「认不出的 key」 | 跨端 5 处 key 与顺序一致的测试断言 |
| US-6 | 作为用户，我希望某个渠道挂了的时候界面能告诉我「部分渠道获取失败」，而不是只显示 0 条 | `channelStats[ch].error` → 顶部 warning 列出失败渠道名 |
| US-7 | 作为用户，我希望小红书头部失效时维护者能快速定位（而不是当成普通网络故障排查） | 日志里出现点明 `shield` 的 406 专项告警 |

---

## 3. 功能范围

### 3.1 P0（本轮必须完成，已落地）

| # | 功能 | 验收要点 |
|---|---|---|
| P0-1 | 新增小红书渠道（App 端免登录热搜，6 个固定头） | 渠道配置存在、6 头非空、`riskLevel='high'`、解析器产出 `xiaohongshu` 条目 |
| P0-2 | 新增凤凰网渠道（JSON 主出口 + 内联兜底） | 主出口读 `link.url`；兜底显式声明 `parser: 'ifeng_inline'`；花括号配对正确 |
| P0-3 | 抖音顺序降级链（`aweme-lq.snssdk.com` → `iesdouyin`） | `fallbacks` 长度 2；两个兜底**不作为独立渠道 id** 出现；三端点共用 `parseDouyin` |
| P0-4 | 「空列表视为失败」合同 | 解析 0 条时抛错 → 走 fallback → 全失败 `recordFailure`，`error` 含 `empty list` |
| P0-5 | 「fallback 顺序降级而非并发」合同 | 顺序尝试；同源条目不被算成 `sourceCount >= 2` |
| P0-6 | 「406 单独告警」合同 | 错误含 406 时产出点明 `shield` 的 warn |
| P0-7 | 今日头条字段修正 | 优先 `InterestCategory[0]`、回退 `Category`、`HotValue` 字符串转数字 |
| P0-8 | 新增 `ai` 一级分类（跨端 5 处 + 4 个 locale） | 11 类、`ai` 紧随 `tech`、跨端 key 与顺序一致 |
| P0-9 | 宽泛桶让位 + 域级泛称不参与裁决 | `'科技'` + 无关文本 → `general`；`'知识'` + 财经文本 → `finance` |
| P0-10 | 强/弱词打分 + `MIN_SCORE` | 单个双字弱词不成类；两个弱词可成类 |
| P0-11 | 拉丁词边界 + 全角归一 | `Air`/`said` 不命中 `AI`；`ＡＩ` 命中 `ai` |
| P0-12 | 补拉条目走分类器（不再硬挂 `boostCategory`） | 补拉源里原生分类为「财经」的条目主分类为 `finance` |
| P0-13 | `CATEGORY_BOOSTS.ai` + `onlyCategory` 分类器筛选 | `ai` 源存在、`sources` 非空、只保留分类器判为 `ai` 的条目 |
| P0-14 | `general` 语义收窄 | 有真实分类时 `categories` 不含 `general` |
| P0-15 | 用户显式请求补拉但该分类无源 → 出声告警 | 日志含 `no boost source configured for category` |

### 3.2 P1（本轮部分完成 / 明确登记为后续）

| # | 功能 | 本轮状态 |
|---|---|---|
| P1-1 | LLM 送审集合改造（`general` ∪ 低置信 ∪ 原生/关键词冲突） | **未做**（`hot-topics-service.js:491` 仍是只处理 `general`） |
| P1-2 | 负向词表（`negative`）与跨域误伤防护 | **未做**（词表修补只做了加词与 `'上市'` 降级） |
| P1-3 | 相对边际判据（`ABS_FLOOR` + `MARGIN`）替代单点 `MIN_SCORE` | **未做** |
| P1-4 | 分类评测集 + 混淆矩阵 + `tech` 误判率基线 | **未做**（标注集不存在） |
| P1-5 | LLM 缓存键归一 + `model`/`promptVersion`/`decidedBy` 留痕 | **未做** |
| P1-6 | 「汽车」类内容的归属（tophub 放在科技域下，本项目降为 `general`） | **未做**，登记待决策 |

### 3.3 P2（登记，不排期）

| # | 功能 |
|---|---|
| P2-1 | 域内子标签（`tech`：芯片/消费电子/航天/新能源/机器人；`ai`：大模型/AIGC/Agent/算力）—— 不改 `CATEGORY_KEYS` 契约 |
| P2-2 | 拼音/缩写消歧（`Sora` 命中人名、`Kimi` 命中人名） |
| P2-3 | 域名白名单（借鉴 `TrendRadar` 的 `expected_domain`），当前只做协议白名单 |
| P2-4 | UI 展示 2 / 存储 3 / 过滤全部 的口径统一（会动视觉回归基线） |
| P2-5 | 凤凰网主机名 `__nd__` 动态发现（从展示页读 `window.allData.__nd__` 再拼 URL） |

### 3.4 明确**不在范围**（本轮不做，且不得顺手做）

| 项 | 排除理由（可取证） |
|---|---|
| **头条号创作者平台** | 无 cookie 下 `mp.toutiao.com` 三个热点入口全部 **502**；`/activity/hot-selection` 另有 `tag_info.hotboard_invitation` 邀请权限门槛；GitHub 代码搜索 `mp.toutiao.com/hot` **0 命中**无参考实现；**无法证实其与今日头条热榜同源**。若后续确需，必须先做一次登录态抓包确认响应结构，且 cookie 必须与发布用登录态**隔离** |
| **小红书 Web / 创作者平台登录态方案** | `/explore` 未登录已 302 → `/login`（`__INITIAL_STATE__` 不存在）；`/api/sns/web/v1/*` 需 `X-S`/`X-T`/`x-S-Common` 签名 + 登录 Cookie，需引入 Playwright 与反爬对抗，且**不提供热榜**；创作者平台必须登录且路径未核实 |
| **快速采集（quick-collect）源注册表** | 属另一模块，其测试明确要求「不存在需要登录态的源」；本次范围只在热门选题 |
| **第三方托管聚合 API**（如 `60s` 托管实例） | 与本项目同源，且从本机出口 429（Cloudflare 1027），可用性不由我们控制 |
| **签名方案（`a_bogus` / `X-S`）** | 热榜用不到，且会把渠道复杂度推到 Playwright 级别 |
| **扩张一级分类数量 / 二级子标签** | 11 类处于合理区间（tophub 一级 16 类）；子标签登记 P2 |
| **改 UI 交互结构** | chip / 渠道下拉 / 空态补拉沿用既有交互，本轮只增枚举与文案键 |

---

## 4. 功能逻辑

### 4.1 主链路（单轮抓取）

```
fetchTopics({ force, boostCategories })
  │
  ├─ ① 缓存判定：fresh（fetchedAt 在过去且 age < CACHE_TTL_MS=10min）且非 force → 直接返回缓存
  │     · 时钟回拨防护：fetchedAt 在未来视为过期
  │     · 并发去重：同一时刻只允许一个 fetch 在飞（带显式 boostCategories 的用户动作不复用旧请求）
  │
  ├─ ② 10 个主渠道并发：_collectChannel(cfg, fetchedAt)
  │     ├─ 限流：ChannelThrottle.tryAcquire(id, intervalMinutes) 未到间隔 → { skipped: true }（不报错）
  │     ├─ 熔断：ChannelBreaker.isOpen(id) → { skipped: true, breakerOpen: true }
  │     ├─ 尝试序列 attempts = [主端点, ...config.fallbacks]
  │     │    for 每个 attempt（顺序，不并发）：
  │     │       fetch（统一注入 DESKTOP_UA + config.headers，AbortController 10s 超时）
  │     │       → 非 2xx 抛 'HTTP <status>'
  │     │       → parser（fallback 未声明 parser 则继承主端点）
  │     │       → JSON.parse 或原文喂给 HTML/RSS 解析器
  │     │       → rawItems.slice(0, MAX_PER_CHANNEL=50) → 逐条 classifyTopicMulti → 写 category/categories
  │     │       → 【合同①】items.length === 0 ⇒ throw 'empty list …'（不记成功）
  │     │       → recordSuccess(config.id)；i>0 时 info 日志 'recovered via fallback #i'
  │     └─ 全部 attempt 失败 → recordFailure(id)（3 连败 → OPEN 冷却 30min）
  │          · 错误含 406 → 【合同③】专项 warn：点明 shield 已失效、需人工更新静态常量
  │
  ├─ ③ 去重合并：_aggregate(results)  —— 跨渠道按 topic.trim() 去重，先到者保留
  │     · 命中已有条目 → 补 mergedFrom、并入标签（上限 3）
  │     · general → 具体分类允许升级（"只升不降"）
  │
  ├─ ④ 稀疏分类定向补拉（CATEGORY_BOOSTS）
  │     · wanted = options.boostCategories ∩ CATEGORY_KEYS（非法项剥离）
  │     · 触发条件：wanted.has(cat)（UI 显式动作，不受阈值限制）或 counts[cat] < cfg.threshold
  │     · 显式请求但 cfg.sources 为空 → warn 'no boost source configured for category: <cat>'（出声，不静默）
  │     · _collectBoostChannel：限流/熔断键用 source.id（与主榜隔离）
  │         → filterCategory（微博垂类：只留该原生分类条目）
  │         → onlyCategory（AI 专题：用分类器本身筛，不新增第二份关键词表）
  │         → 分类归属：先走 classifyTopicMulti；判出明确分类则以分类器为准，
  │           只有 general 才用 boostCategory 兜底（垂类榜本身即该分类定向供给，兜底仍保供）
  │         → id = channel:board:rank（board 段防与主榜撞号）
  │
  ├─ ⑤ 全渠道零结果保护：allTopics 为空且上一轮有数据 → 保留旧 topics 与 fetchedAt，
  │     只落盘本轮 channelStats，打 preservedStaleCache 标记（不用空列表覆盖非空缓存）
  │
  ├─ ⑥ 跨轮 carry-over：本轮被跳过/失败的渠道，沿用上一轮缓存条目参与统一评分
  │     （时间衰减按 age 使其下沉；channel 未知的旧形态条目不沿用）
  │
  ├─ ⑦ 统一热度评分：scoreTopics（渠道内 log10 归一 → 名次兜底 → 渠道权重 → 多榜加成 → 时间衰减）
  │     → markTrend（与上一轮名次对比 up/down/new/flat）
  │     → slice(0, MAX_TOPICS=400)  ← 先评分后截断
  │
  ├─ ⑧ LLM 兜底：_applyLlmLabels(topics)
  │     · 送审集合：仅 category === 'general' 的条目（**这是本轮的已知缺口**，见 §13 P1-1）
  │     · 命中落盘标签缓存（hot_topics_llm_labels，上限 LLM_LABELS_MAX=500）则直接应用
  │     · 单轮上限 LLM_BATCH_LIMIT=40
  │     · 返回值白名单校验：非 11 类枚举一律忽略，保持原判
  │     · fail-open：未配置 provider / 抛错 → 静默降级，保持关键词结果
  │
  └─ ⑨ 写缓存 hot_topics_cache { topics, fetchedAt, channelStats }
```

### 4.2 新增合同 A：**空列表视为失败**

**现状/规则**：解析器返回 0 条时抛 `Error('empty list (endpoint returned 0 items; treated as failure)')`（`hot-topics-service.js:332`），该次 attempt 记失败并继续 fallback；全部 attempt 都失败才 `recordFailure`。

**为什么必须这样（不是「顺手加的严格性」）**：

- 抖音缺 `User-Agent` **或**缺 `Referer` 时，对端返回的是 **HTTP 200 + `word_list: []`**，不是 4xx（调研报告《抖音/小红书》逐项隔离实验 3/4/5）。
- 若按「HTTP 200 即成功」判断：
  1. 会把 0 条当成成功结果，**`recordSuccess` 归零失败计数 ⇒ 熔断器永不打开**；
  2. 界面上只显示「该渠道 0 条」，`channelStats.ok` 仍为 `true`，**没有任何可排查信号**（用户看到的是「抖音没数据」，而真实原因是请求头不完整）。
- 同一合同对小红书也成立：头部失效是 406，但其他异常也可能给空 `items`。
- **反面清单**：空列表**不得**写入缓存、**不得** `recordSuccess`、**不得**在 UI 上表现为「该渠道正常但今天是 0 条」。

**副作用与缓解**：极端情况下某渠道「今天真的没有榜」会被记为失败并最终熔断 30 分钟 —— 这是**有意的保守取舍**（本模块的失败成本是「少一个渠道」，错判成功的成本是「用户以为有数据但永远为 0 且无人发现」）。

### 4.3 新增合同 B：**fallback 顺序降级而非并发**

**现状/规则**：`attempts = [主端点, ...config.fallbacks]`，用 `for` 顺序尝试（`hot-topics-service.js:310-351`）；fallback 未声明 `parser` 时**继承主端点解析器**，声明了才覆盖（凤凰网内联出口字段名与主出口不同，故在 fallback 上显式声明 `parser: 'ifeng_inline'`）。

**为什么要顺序而不是并发**（两条独立理由，缺一不足以支撑）：

1. **风控面**：三个抖音端点数据同源，并发只会把对该平台的瞬时请求量放大 2–3 倍，而成功率并不因为并发提高（同源即同时挂/同时可用）。参考实现 `wimdaw/hot-topics` 用的也是 `firstOk` 顺序兜底。
2. **评分污染（更隐蔽、更严重）**：`scorer.js` 的 `sourceBonus = SOURCE_BONUS_ALPHA · log2(sourceCount)`（`:41`、`:116`）是「**跨榜同现 = 全民热点**」这一客观信号的全部实现。如果同源端点作为**并列渠道**并发抓取，同一条选题会被跨「渠道」去重、`sourceCount` 变成 2 ⇒ 凭空多出 `+0.12` 分。这不是「多一点分」，而是**把这个信号的语义从「多平台都热」偷换成「多写了几行配置」**，直接失真。
3. **落地约束（可测试）**：`CHANNEL_CONFIGS` 的 id 集合**不得**出现 `douyin_app` / `douyin_ies`（测试显式断言 `not.toContain`）。

**副作用与缓解**：主端点慢时整体耗时增加（最坏 3×10s 超时 = 30s，但只在主端点失败路径上发生；正常路径只有 1 次请求）。

### 4.4 新增合同 C：**406 单独告警**

**现状/规则**：`_collectChannel` 捕获异常后，若错误信息包含 `406`，输出一条**点明「固定请求头（shield）已失效，需人工更新静态常量（不是网络故障）」**的 warn（`hot-topics-service.js:341-345`）；否则输出通用的 `attempt i/n failed: <msg>`。

**为什么**：小红书 6 个头里 `shield` 是**静态 token**（抓包得来的固定值，等效签名），平台轮换后全部依赖方同时失效，且**没有任何自动续期手段**。它是本模块**唯一需要人工介入**的故障形态；与「网络抖动」「对端限流」混在一条通用日志里，会让排查成本从「看一眼就知道要换常量」变成「先怀疑网络、再怀疑代码」。

**实现细节（避免误判）**：判定用 `msg.includes('406')` 而非 `res.status === 406`，因为错误是在 `_fetchChannel` 里被折叠成 `'HTTP ' + res.status` 字符串向上抛的；这一取舍已在测试中锁定（构造 `new Error('HTTP 406')`）。

### 4.5 补拉（`CATEGORY_BOOSTS`）逻辑

| 环节 | 规则 | 为什么 |
|---|---|---|
| 触发条件 | `wanted.has(cat)`（UI 显式）**或** `counts[cat] < cfg.threshold`（自动） | 自动补拉治「结构性稀疏」；UI 显式动作治「用户明确要看某分类但为空」 |
| `threshold` 取值 | `finance: 6`、`tech: 6`、`emotion: 4`、`health: 4`、`ai: 4`；`education` / `international` 为 `4` 但 `sources: []` | 阈值高则补拉频繁（成本/风控），低则分类易稀疏 |
| 限流/熔断键 | `source.id`（与主榜渠道隔离；微博情感/健康垂类共用端点但各自独立节流） | 同一端点的两次垂类抓取不应互相影响节流状态 |
| `filterCategory` | 解析后只保留 `rawCategory === filterCategory` 的条目（微博垂类：`情感` / `健康医疗`） | 微博 `hot_band` 是一个大杂榜，垂类只是其中一部分 |
| `onlyCategory` | 用**分类器本身**筛（如 `ai`），不新增第二份关键词表 | 判据漂移：两份词表必然出现「补拉进来的判据与展示时的判据不一致」 |
| **分类归属（本轮修正）** | 先走 `classifyTopicMulti`；判出明确分类 → **以分类器为准**；只有 `general` → 用 `source.boostCategory` 兜底 | v2 无条件硬挂 `boostCategory`：`tech` 的补拉源是 IT之家 RSS（综合科技资讯流，含发布会预告/促销/行业八卦/企业人事），`threshold=6` 极易触发 ⇒ 这些全部被硬挂 `tech`。**这是「科技类混入不沾边内容」的第二大根因** |
| id 形态 | `channel:board:rank`（如 `weibo:tech:3`、`ithome_tech:ai:2`） | 与主榜 `channel:rank`（如 `weibo:3`）不撞号；撞号会污染勾选状态（`selectedIds` 以 id 为键） |
| 无源出声 | 用户显式请求但 `cfg.sources` 为空 → `warn('no boost source configured for category: ' + cat)` | B4 的静默失败：`ai` chip 为空时点「补拉」原本 `boostSources` 为空，**点击无任何效果且不报错** |
| `ai` 补拉源 | 复用 IT之家 RSS（`parser: 'ithome_rss'`）+ `onlyCategory: 'ai'` | AI 没有公开的「AI 榜」垂类端点；复用已验证可用的端点 + 分类器筛选，是成本最低且判据单一的方案。**端点可用性已由「tech 补拉长期在用同一端点」间接支撑，但本轮未重新实测该端点在 AI 场景下的召回率** |

### 4.6 既有交互的边界（不在本轮但必须理解）

- **限流/熔断跳过不算失败**：`channelStats.ok = !r.error`，跳过时 `ok` 保持 `true`，避免渠道下拉误标「不可用」。
- **全渠道零结果不清缓存**：一次网络抖动（或 10s 抓取超时）不会把用户已抓到的选题清空（2026-09-14 实测缺陷的回归保护）。
- **先评分后截断**：`scoreTopics` → `markTrend` → `slice(0, MAX_TOPICS)` → 再跑 LLM，保证「保头部即保热点」。
- **LLM 在截断之后跑**：被 `slice(0, 400)` 丢掉的条目永远拿不到 LLM 分类（登记 P1，见 §13）。

---

## 5. 分类体系设计

### 5.1 11 类枚举与顺序（顺序即 UI 默认排序，是跨端契约）

| 序 | key | 中文名 | 英文名 | 覆盖内容（口径以 `content_category_service.py:44-56` 的说明为准） |
|---|---|---|---|---|
| 1 | `general` | 综合 | General | 未命中其它分类时的兜底分类 |
| 2 | `society` | 社会 | Society | 民生、法治、事故、就业等社会新闻 |
| 3 | `finance` | 财经 | Finance | 股市、楼市、宏观、公司财报等 |
| 4 | `tech` | 科技 | Tech | 芯片、互联网、数码、航天等（**不含 AI，见 `ai`**） |
| 5 | **`ai`** | **AI** | **AI** | 大模型、AIGC、智能体、算力、AI 应用等 |
| 6 | `entertainment` | 娱乐 | Entertainment | 明星、影视、综艺、音乐、游戏等 |
| 7 | `sports` | 体育 | Sports | 赛事、球队、运动员等 |
| 8 | `emotion` | 情感 | Emotion | 恋爱、婚姻、亲子、家庭关系等 |
| 9 | `education` | 教育 | Education | 升学、招生、校园、教师等 |
| 10 | `health` | 健康 | Health | 医疗、疾病、养生、医保等 |
| 11 | `international` | 国际 | International | 海外、外交、国际局势等 |

**为什么 `ai` 紧随 `tech`**：AI 是从科技里切出来的子域，二者在 UI 上相邻便于对照；且运营端的 `CATALOG` 描述里 `tech` 显式写「不含 AI，见 ai」，把「切分」这件事写在唯一真源上。

### 5.2 判定优先级（逐条）

入口只有一个：`classifyTopicMulti(rawCategory, channel, topicText)`。**先并行准备两份证据（互不短路）**，再裁决：

**证据 1：原生映射 `_mapNative(rawCategory, channel)`，按固定顺序短路**

| 顺序 | 查表 | weak | 语义 |
|---|---|---|---|
| ⓪ | `DOMAIN_LEVEL_RAW.has(key)` → **直接返回 `null`** | — | **域级泛称**：栏目名不是单条定性，一律不参与裁决也不兜底 |
| ① | `RAW_CATEGORY_MAP[channel][key]` | `false` | **可信原生**：渠道明确声明内容域 |
| ② | `GENERIC_RAW_MAP[key]` | `false` | 通用中文分类名，全渠道生效 |
| ③ | `GENERIC_RAW_MAP[lower]` | `false` | 同上，兜小写（如 `'ai'`） |
| ④ | `RAW_CATEGORY_WEAK_MAP[channel][key]` | **`true`** | **宽泛桶**：一个桶混装多个内容域 |

> `key = rawCategory.trim()`（**保留大小写**，中文命中不受影响），`lower` 才小写（`'AI'` 这类拉丁值靠第 ③ 级兜住）。

**证据 2：关键词打分 `_scoreKeywords(topicText)`** —— 按 `KEYWORD_RULES` 逐类累加，低于 `MIN_SCORE` 的整类丢弃，按分数降序（并列保持声明顺序，V8 稳定排序）。

**主标签四档裁决**

| 优先级 | 条件 | 结果 |
|---|---|---|
| ① 最高 | `native && !native.weak` | 主标签 = 可信原生分类 |
| ② 次之 | 否则 `hits.length > 0` | 主标签 = 关键词最高分 |
| ③ 兜底 | 否则 `native`（必为 weak） | 主标签 = 宽泛桶 |
| ④ 最终 | 三者皆无 | `general` |

**关键语义**：宽泛桶（weak）**只在关键词零命中时**才生效；只要关键词有任何 ≥ `MIN_SCORE` 的信号，**文本证据一律压过宽泛桶**。域级泛称则连兜底资格都没有 —— 这就是 `'科技'` + 无关文本必落 `general` 的机制。

**多标签组装**：先 push 主标签，再把 `hits` 里未出现过的分类按分数降序补入 → **剔除 `general`** → `slice(0, 3)` 封顶 → 主标签恒在首位。即「单标签主分类 + 最多 2 个次标签 = 最多 3 标签」。

### 5.3 AI 与科技的边界

| 维度 | `ai` | `tech` |
|---|---|---|
| **核心判据** | 主体是**模型 / 算法 / 智能能力本身** | 主体是**硬件 / 基础设施 / 工程实体** |
| **strong 词（权重 = 词长 × 2）** | 人工智能、大模型、大语言模型、生成式、AIGC、AGI、多模态、深度学习、神经网络、机器学习、智能体、算力、智算、`AI芯片`、`AI绘画`、`AI视频`、`AI编程`、`AI手机`、`AI眼镜`、提示词、ChatGPT、GPT、OpenAI、DeepSeek、Claude、Gemini、Midjourney、Stable Diffusion、Sora、Llama、Transformer、英伟达、**AI** | 科技、芯片、半导体、光刻机、操作系统、浏览器、数据库、云计算、区块链、量子计算、航天、火箭、卫星、空间站、探月、火星、自动驾驶、新能源、光伏、储能、电池、5G、6G、通信、开源、程序员、算法、机器人、人形机器人、数码、智能手机、GPU、显卡、折叠屏 |
| **weak 词（权重 = 词长）** | 豆包、通义、文心一言、Kimi、智谱、模型训练、训练数据、算法工程师、推理成本、token | 手机、电脑、笔记本、互联网、软件、硬件、黑科技、无人机、相机、屏幕、发布会、科技圈 |
| **重叠裁决** | 「AI 芯片 / 算力需求」→ `ai`（强调模型算力载体）；「国产芯片半导体产业链」→ `tech`（强调制造/产业链） | 依据：**语境词优先**，由打分裁决；不允许「科技栏目的原生分类」覆盖关键词证据 |
| **不该进 `ai`** | 泛化的「算法」（推荐算法）、「智能化」营销词、公司名含 AI 但内容无关 | — |
| **不该进 `tech`** | 汽车销量/补贴/价格 → `finance`；手机丢失/诈骗 → `society`；明星代言手机 → `entertainment` | — |

**「AI ⇒ ai」有意保留为强词，但已用词边界兜住最脏的误命中**：`'AI'` 是 2 字 strong（4 分），单靠它即可成类。这是**有意设计**（`AI 应用落地加速` 这种短标题只能靠它），代价由 `_matchesLatin` 的词边界承担（`Air`/`said`/`train` 不再命中）。已登记的残余风险：`'AI 换脸诈骗'` 这类主体是诈骗/娱乐的标题仍会落 `ai`（负向词表未做，见 §13 P1-2）。

### 5.4 关键词 strong/weak 口径

| 口径 | 规则 | 代码 |
|---|---|---|
| strong 命中权重 | `词长 × STRONG_MULT`，`STRONG_MULT = 2` | `classifier.js:261`、`:326` |
| weak 命中权重 | `词长` | `classifier.js:329` |
| 成类阈值 | 总分 `< MIN_SCORE = 3` → 整类丢弃 | `classifier.js:267`、`:331` |
| `MIN_SCORE = 3` 的确切语义 | 双字弱词 = 2 分 < 3 ⇒ **单个双字弱词不足以成类**；双字强词 = 4 分 ⇒ 单强词即可成类；两个双字弱词 = 4 分 ⇒ 可成类 | `classifier.js:263-266` |
| strong 该放什么 | **分类名本身与专有术语**（科技/财经/健康/半导体/A股/世界杯…） | `classifier.js:119-123` 注释 |
| weak 该放什么 | **泛化词**（消费/比赛/父母/手机/上市…） | 同上 |
| 禁裸单字 | 中文关键词长度必须 ≥ 2（中文无词边界，裸字必然误伤：v1 的 `'判'` 吞掉「判定/预判/判定」） | 测试 `关键词规则内不得出现裸单字` 机械锁死 |
| 排序 | 分数降序；**并列保持 `KEYWORD_RULES` 声明顺序** | `classifier.js:333` |
| 大小写 | `rawText` 原样用于中文子串匹配；`lowerText = rawText.toLowerCase()` 只供拉丁词匹配 | `classifier.js:320-321` |

> **隐性耦合（必须知道）**：并列时按声明顺序取主标签，等于产生了一套**未文档化的类间优先级**（`ai > international > society > finance > tech > entertainment > sports > emotion > education > health`）。改动 `KEYWORD_RULES` 的书写顺序会**静默改变主标签**。

### 5.5 拉丁词边界与全角归一

| 项 | 规则 | 代码 |
|---|---|---|
| 是否走边界 | `LATIN_ONLY_RE = /^[A-Za-z0-9]+$/` 命中（纯拉丁/数字词）才走边界 | `classifier.js:269`、`:310` |
| 边界定义 | 命中位置**前一个字符**与**后一个字符**都不得是 `[a-z0-9]`；不满足则从 `i+1` 继续找下一次出现 | `classifier.js:289-301` |
| CJK 作边界 | `«说AI了»` 中 `说`/`了` 不是 `[a-z0-9]` ⇒ 命中 | 测试覆盖 |
| 含中文的关键词 | 走 `rawText.includes(kw)`（如 `'AI芯片'`、`'新能源'`） | `classifier.js:310` |
| 全角归一 | `[\uFF01-\uFF5E]`（全角 ASCII）→ 减 `0xFEE0` 得半角；中文输入法下 `ＡＩ` 很常见 | `classifier.js:272`、`:278-281` |
| **未做的** | 完整 `NFKC` 归一（全角数字已顺带覆盖，但其它兼容字符未处理）；拼音/缩写消歧 | §13 P2 |

### 5.6 `DOMAIN_LEVEL_RAW` 域级泛称清单与语义

| key | 为什么是「栏目的名字」而不是「单条的定性」 |
|---|---|
| `科技` | 榜单叫「科技」只说明这个分区聊科技，**不等于**分区里每一条都是科技内容（用户症状的第一现场） |
| `互联网` | 行业泛称，可承载裁员、监管、平台经济等社会/财经议题（微博实测有 `'互联网'` 原生分类） |
| `科学科普` | 跨学科泛科普：恐龙、地质、生物、天文（微博/B站实测有该桶，v2 曾整批映射 `tech`） |
| `知识` | B站「知识」区混装历史/法律/职场/财经/科普 —— v2 头号错配源 |
| `资讯` | 与「综合」同义 |
| `热点` | 只是「这是热榜」的同义反复，零信息 |

**语义**：命中该集合的原生分类，`_mapNative` **直接返回 `null`** ⇒ 该条目的分类**完全交由关键词裁决**；关键词也无信号时落 `general`。设计取舍明说：**把噪声放进「综合」比放进「科技」更不容易误导用户**。

### 5.7 `general` 的语义收窄规则

| 规则 | 内容 |
|---|---|
| R1（本轮已实现） | **`general` 只表示「无判别力信号」**。只要文本给出了任何真实分类，`categories` 里就不得残留 `general`（实现方式：先组装 → `filter(c => c !== 'general')` → 空则回退 `['general']` → `slice(0,3)`） |
| R2（本轮**未**实现） | 内部字段 `origin: 'no_signal' \| 'generic_bucket' \| 'native_general'` 区分三种产生点，供 LLM 送审与 UI tooltip 使用 |
| R3（本轮**未**实现） | 仅 `origin === 'no_signal'` 的条目进 LLM 送审集合（`generic_bucket` / `native_general` 已是「明确判定为泛资讯」，不该被当「未命中」重判） |

**R1 解决的问题**：宽泛桶兜底为 `general` 而关键词给出真实分类时，若不剔除 `general`，UI 的**多标签计数**与**空态判定**都会被污染 —— 一条「其实有信号」的条目看起来像「没信号」。

---

## 6. 数据校验

> 表列含义：**校验对象** / **规则** / **失败行为** / **代码位置** / **测试**。
> 「测试」列中 ✔ 表示已被现有测试锁定；「—」表示暂无测试（登记为缺口）。

### 6.1 渠道抓取与解析

| # | 校验对象 | 规则 | 失败行为 | 代码位置 | 测试 |
|---|---|---|---|---|---|
| V1 | 渠道响应非 2xx | `!res.ok` → 抛 `'HTTP ' + status` | 记为该 attempt 失败 → 继续 fallback → 全失败 `recordFailure` | `hot-topics-service.js:278` | ✔ `_collectChannel`「主端点异常（非空）也走 fallback」 |
| V2 | 请求超时 | `AbortController` + `setTimeout(FETCH_TIMEOUT_MS = 10s)`，`finally` 清定时器 | 抛 AbortError → 同 V1 路径 | `:266-282`、`:31` | — |
| V3 | JSON 解析失败 | 响应以 `{`/`[` 开头才尝试 `JSON.parse`；否则原文交给 HTML/RSS 解析器 | `JSON.parse` 抛错 → 同 V1 路径 | `:316`、`:385` | — |
| V4 | **解析出空列表** | `items.length === 0` → **抛错**（合同 A） | 记失败并继续 fallback；全失败 `recordFailure`；`error` 含 `empty list` | `:331-332` | ✔ 「主端点返回空列表 → 视为失败并恢复」「全部尝试都返回空列表 → 记失败」 |
| V5 | 无对应解析器 | `CHANNEL_PARSERS[...]` 不存在 → 抛 `'no parser for ' + key` | 同 V1 路径（配置错误会在日志里显形，而不是静默 0 条） | `:314-315`、`:383-384` | — |
| V6 | 渠道配置自洽 | 每个渠道 `intervalMinutes >= 5`、`url` 以 `https://` 开头、恰好 10 项 | 测试断言（配置错误即红） | `:64-106` | ✔ 「共 10 个渠道，全部 intervalMinutes >= 5 且 https」 |
| V7 | 抖音兜底不得成为并列渠道 | id 集合不含 `douyin_app` / `douyin_ies` | 测试断言 | `:75-78` | ✔ 「抖音 fallback 链是同源顺序降级」 |
| V8 | 小红书固定头齐全 | 6 个键全部非空（`User-Agent`/`referer`/`xy-direction`/`shield`/`xy-platform-info`/`xy-common-params`） | 测试断言 | `:80-92` | ✔ 「小红书渠道带齐五件套固定头」 |
| V9 | 凤凰网兜底解析器 | fallback 显式声明 `parser: 'ifeng_inline'` | 测试断言（共用解析器会静默产出空列表） | `:99-101` | ✔ 「凤凰网 fallback 使用 ifeng_inline 解析器」 |
| V10 | 406 特征信号 | 错误信息含 `406` → 单独 warn（点明 `shield`） | 与普通网络失败分开记日志 | `:341-345` | ✔ 「406 单独告警并点出 shield 失效」 |
| V11 | 内联 HTML 的对象提取 | `extractIfengAllData` 做**花括号配对**并跳过字符串字面量与转义 | 提取失败返回 `null` → 解析器返回 `[]` → 走 V4 | `channels.js:175-202` | ✔ 「内联出口…必须做花括号配对」（构造含 `}` 的多行 JSON） |
| V12 | 解析器不得抛错于畸形结构 | 各解析器对 `null` / 结构缺失一律返回 `[]` | 返回空数组 → 走 V4 | `channels.js`（各解析器入口均有 `Array.isArray` 保护） | ✔ 「结构缺失 / 空 items → 空数组，不抛错」「无 allData / 结构不符 → 空数组」（注：抖音、小红书、凤凰网内联三处已锁；**其余 9 个解析器未逐一覆盖畸形结构**） |
| V13 | 中文数量字符串 | `'947.5w'`/`'1.2万'` → ×10000 取整；空/非数字/`'热'` → `null` | 返回 `null`（条目热度缺失，由 scorer 名次兜底） | `channels.js:96-102` | ✔ `parseCnNumber` 6 断言 |

### 6.2 条目级校验

| # | 校验对象 | 规则 | 失败行为 | 代码位置 | 测试 |
|---|---|---|---|---|---|
| V14 | `topic` 为空 | 每个解析器末位 `.filter(x => x.topic)`；`parseDouyin` 在循环内 `if (!topic) continue` | **丢弃该条**（不产出空标题条目） | `channels.js` 各解析器 `filter`；`:120` | ✔ 间接（各解析器用例均断言产出条数与内容） |
| V15 | `rank` 唯一性 | 百度：置顶推广位（`isTop: true`，无 `index`）**跳过**，避免其 `rank` 回退 `i+1=1` 与正式榜首 `index=1` 撞号；微博：`rank` 用数组序 `i+1`（实测 `band_list` 的 `realpos` 偶发 `null`，回退会撞号）；补拉条目 id 含 `board` 段 | 撞号会污染 `selectedIds`（勾选状态以 id 为键） | `channels.js:236`、`:256-258`；`hot-topics-service.js:399` | ✔ 「补拉条目 id 仍带 board 段（与主榜不撞号）」断言 `new Set(ids).size === ids.length` |
| V16 | URL 协议白名单 | 所有解析器的 `url` **必须**经 `sanitizeUrl`（= 共享单一实现 `safeHttpUrl`），禁止新增第二份 `/^https?:/` | 非法/缺失 → `null`（条目保留、不产出锚点） | `channels.js:15`、`:29`（每个解析器独立调用） | — （仓级另有 `href-scheme-contract` 扫描，但**未覆盖本文件**） |
| V17 | 跨渠道去重键 | `topic.trim()` 为唯一键；命中已有条目 → 补 `mergedFrom`、并入标签（上限 3）、`general → 具体分类` 允许升级 | 重复条目不新增，只合并且记来源 | `hot-topics-service.js:436-448` | ✔ `hot-topics-service.test.js` 相关用例 |
| V18 | 旧缓存/旧形态条目兼容 | `categories` 缺失时归一为 `[category || 'general']` 并 `slice(0,3)` | 渲染层另有回退（`categories[]` 优先，回退 `[category]`） | `:431-435`；`HotTopics.vue:361-363` | ✔ 「falls back to view index for legacy cache entries」「legacy mergedFrom containing own channel does not show phantom multi badge」 |
| V19 | 全渠道零结果不得清缓存 | `allTopics.length === 0 && previous.length > 0` → 保留旧 `topics` 与 `fetchedAt`，只落盘新 `channelStats`，打 `preservedStaleCache` | 不用空列表覆盖非空缓存 | `:579-590` | ✔ `hot-topics-service.test.js` 相关用例 |
| V20 | 跨轮 carry-over 的渠道合法性 | 仅沿用「本轮缺席」渠道的旧条目；`channel` 未知的旧形态条目不沿用；已在 `byTopicKey` 中的不重复 | 跳过该条 | `:595-609` | ✔ `hot-topics-service.test.js` 相关用例 |

### 6.3 分类校验

| # | 校验对象 | 规则 | 失败行为 | 代码位置 | 测试 |
|---|---|---|---|---|---|
| V21 | **分类枚举白名单（LLM 返回）** | `typeof lab === 'string' && CATEGORY_KEYS.includes(lab)` | **一律忽略，保持原判**（不写入缓存、不改 `category`） | `hot-topics-service.js:511` | ✔ 间接（`CATEGORY_KEYS` 由 `llm-classifier.js` 复用为 prompt 可选值） |
| V22 | 分类枚举白名单（LLM 缓存命中） | `typeof cached === 'string' && CATEGORY_KEYS.includes(cached)` | 非法值视为未命中 → 可能重新送审，但不应用 | `:493` | — |
| V23 | 分类枚举白名单（IPC 入参） | `wanted` 只接受 `CATEGORY_KEYS` 内的字符串 | 非法项**静默剥离**（不报错、不补拉） | `:555-556` | — |
| V24 | 分类枚举白名单（IPC 参数长度） | `payload.boostCategories` 每项 `typeof === 'string' && length <= 32`，且 `slice(0, 10)` | 超长/非字符串剥离；超过 10 项截断 | `ipc-handlers/hot-topics.js:69-70` | — |
| V25 | `MIN_SCORE` 阈值 | 总分 `< 3` 的类整类丢弃 | 该类不进入 `hits`，不参与主标签与次标签 | `classifier.js:331` | ✔ 「单个双字弱词不足以成类」（`消费` → `general`；`消费 投资` → `finance`） |
| V26 | 拉丁词边界 | 拉丁/数字关键词前后不得是 `[a-z0-9]` | 不命中（该词不计分） | `classifier.js:289-301` | ✔ 「英文缩写走词边界：Air / said 等不得命中 AI」 |
| V27 | 全角归一 | 匹配前 `[\uFF01-\uFF5E]` → 半角 | 不归一会漏判（`ＡＩ` 不命中 `AI`） | `classifier.js:278-281` | ✔ 「全角拉丁词可命中（ＡＩ → ai）」 |
| V28 | 禁裸单字 | 遍历全部 `KEYWORD_RULES`：中文关键词长度 ≥ 2；拉丁词长度 ≥ 2 | 测试即红（防止 `'判'` 式黑洞回归） | `classifier.js:124-258` | ✔ 「关键词规则内不得出现裸单字」 |
| V29 | 词表覆盖完整性 | 除 `general` 外每类都必须有规则，且每条规则的 `strong`/`weak` 都是数组、`strong` 非空 | 测试即红 | 同上 | ✔ 「KEYWORD_RULES 覆盖除 general 外的全部类别」 |
| V30 | `general` 不变量 | 有真实分类时 `categories` 不含 `general`；全空时 `categories === ['general']` | 测试即红 | `classifier.js:418-419` | ✔ 「general 是无信号专属」「无任何信号 → general 且 categories 非空」 |
| V31 | 主标签恒为 `categories[0]` | `category === finalCats[0]` | 测试即红 | `classifier.js:420-423` | ✔ 多处断言 `r.categories[0]` |
| V32 | 标签上限 3 | `slice(0, 3)` | 超出丢弃 | `classifier.js:419`；`:434`、`:444`、`:496`、`:516` | ✔ 「最多 3 个」 |

### 6.4 跨端类别目录校验

| # | 校验对象 | 规则 | 失败行为 | 代码位置 | 测试 |
|---|---|---|---|---|---|
| V33 | **5 处分类 key 与顺序一致** | 必须是 `general, society, finance, tech, ai, entertainment, sports, emotion, education, health, international`，键名与**顺序**都一致：① `classifier.js` `CATEGORY_KEYS`；② `electron/services/content-categories.js` `DEFAULT_CONTENT_CATEGORIES`；③ `src/features/content/content-categories.js`；④ `HotTopics.vue` `CATEGORY_KEYS`；⑤ `ops-center ... content_category_service.CATALOG` | 任一处漏改 ⇒「运营端能配、桌面端认不出」的静默漂移 | `classifier.js:24-27`（契约声明）、`:34-37`；`content-categories.js:20-32`；`features/content/content-categories.js:23-26`；`HotTopics.vue:344`；`content_category_service.py:44-56` | ✔ ① `classifier.test.js`「渲染层内置类别 key 与分类器 CATEGORY_KEYS 完全一致（顺序也一致）」；② `content-categories.test.js`「内置 11 类与 classifier.js CATEGORY_KEYS 一致」；③ `test_content_categories_api.py::test_catalog_seeded_and_list`（前 11 项 key 顺序 + `preset_keys` 长度 11） |
| V34 | 运营下发 `category_key` 正则 | `CATEGORY_KEY_RE = /^[a-z][a-z0-9_]{1,31}$/`（小写字母开头，仅小写字母/数字/下划线，长度 2–32） | 逐条进 `dropped`（`reason: 'key'`），**不静默丢** | `content-categories.js:35`、`:84-87`；`content_category_service.py:34`、`:81-87` | ✔ 双端测试 + `test_create_update_validation`（非法 key → 400） |
| V35 | 去重 | 重复 `category_key` → `dropped`（`reason: 'duplicate'`） | 丢弃重复项 | `content-categories.js:88-91` | ✔ |
| V36 | 上限 | `MAX_CATEGORIES = 50`，超出部分 `dropped`（`reason: 'limit'`） | 截断并出声 | `content-categories.js:38`、`:103-110` | ✔ |
| V37 | 名称归一 | 非空 name 取 `trim().slice(0, 20)`；空则回退内置默认名 → `key` 本身 | 不产出空名称 | `content-categories.js:92-94`、`:38`（`MAX_NAME_LEN=20`） | ✔ |
| V38 | 排序归一 | 先按 `sort_order` 升序排序，再**归一化为 `0..n-1`** | 渲染顺序稳定（与运营端 reorder 语义一致） | `content-categories.js:111-113` | ✔ |
| V39 | 结构非法 / 空数组 fail-open | 非对象/非数组/`items` 非数组 → `invalidShape: true` 回退内置；空数组 → 回退内置（`usingDefault: true`） | 界面**不会变成零分类**（离线与旧版运营中心都要可用） | `content-categories.js:62-74` | ✔ 「未下发 / 空 / 结构非法 → 内置 11 类」 |
| V40 | 逐条出声不静默 | 非法项进 `dropped` 带 `reason`；渲染层消费时输出 `console.warn`（含 reason 集合） | 调用方决定要不要提示 | `useContentCategories.js`（消费侧） | ✔ `useContentCategories.test.js` |
| V41 | 运营端内置类保护 | `is_preset=1` 可改名/禁用/排序但**不可删除** | 删除请求被拒（400） | `content_category_service.py:18-22`、`:290` | ✔ |

### 6.5 交互与参数校验

| # | 校验对象 | 规则 | 失败行为 | 代码位置 | 测试 |
|---|---|---|---|---|---|
| V42 | 批量上限 | `BATCH_LIMIT = 20`；超过则提示、不执行 | `notifyInfo('hotTopics.batchLimit')` | `HotTopics.vue:348`、`:555-557`、`:569-571` | ✔ `HotTopics.test.js` 相关用例 |
| V43 | 空选择 | `selected.length === 0` → 提示、不执行 | `notifyInfo('hotTopics.noSelection')` | `:551-553`、`:565-567` | ✔ |
| V44 | 刷新竞态 | 请求序号 `requestSeq`；`seq !== requestSeq` 时丢弃旧响应 | 丢弃过期响应，不覆盖新数据 | `:481-504` | ✔ |
| V45 | 收藏条目入参 | `_sanitizeTopic`：**白名单字段剥离** + 各字段长度上限（`id ≤ 128`、`topic ≤ 500`、`channel ≤ 32`、`category ≤ 32`、`url ≤ 2048`） | 非法对象返回 `null`（拒绝写入） | `ipc-handlers/hot-topics.js:42-57` | — |

---

## 7. 交互逻辑

### 7.1 分类 chip

| 行为 | 实现 |
|---|---|
| chip 列表来源 | **运营下发的 `contentCategories` 为准**（`HotTopics.vue:356`）；读不到时 `contentCategories` 已是内置 11 类，界面不会变零分类（fail-open） |
| chip 顺序 | 运营 `sort_order` 归一后的顺序；内置回退时即 `CATEGORY_KEYS` 顺序 |
| chip 文案 | `categoryLabel(key, t)`：运营下发名优先 → 内置本地化名（`contentCategories.<key>`）→ **最终回退 key 本身** |
| 计数 | `categoryCounts` 按**多标签口径**：条目在每个 `categories` 成员下都 +1；「全部」chip 不显示计数 |
| 计数渲染 | `data-testid="hot-topic-cat-count-<key>"`；`| 0` 兜底 |
| 点击 | `@click="activeCategory = cat.value"`；与渠道下拉是**与**关系（两个条件同时过滤） |
| 过滤 | `topicCategories(x).includes(activeCategory)`；`topicCategories` 优先 `categories[]`，回退 `[category]`（兼容旧缓存） |
| 排序 | 过滤后按 `score` 降序（缺 `score` 的旧条目沉底且保持原序） |

### 7.2 空态「补拉该分类」

| 行为 | 规则 |
|---|---|
| 触发条件 | `categoryEmpty = activeCategory !== 'all' && topics.length > 0 && !topics.some(x => topicCategories(x).includes(activeCategory))` —— 即「全局有数据但当前分类过滤后为空」 |
| 展示 | `EmptyState` 用 `emptyCategoryTitle` / `emptyCategoryDesc` / `boostAction`（文案见 §9） |
| 动作 | `boostCurrentCategory()` → `refresh(true, { boostCategories: [activeCategory] })`（**强制刷新**且不被主渠道限流跳过的零结果路径吞掉） |
| 与阈值的关系 | UI 显式触发的分类**不受 `threshold` 限制**（`wanted.has(cat)` 直接入选） |
| 无源时的行为 | 服务层 `warn('no boost source configured for category: ' + cat)`；**界面本轮未新增提示文案**（见 §9.4） |
| 当前实际有源的分类 | `finance`（2 源）、`tech`（1 源）、`emotion`（1 源）、`health`（1 源）、**`ai`（1 源，本轮新增）** |
| 当前无源的分类 | `education`、`international`（`sources: []`）→ 点「补拉该分类」只会在日志出声，界面无变化 |

### 7.3 渠道下拉

| 行为 | 规则 |
|---|---|
| 选项来源 | `CHANNEL_KEYS`（渲染层常量），本轮新增 `xiaohongshu`、`ifeng`，顺序为 `zhihu, toutiao, tencent, bilibili, douyin, xiaohongshu, ifeng, baidu, weibo, sina_finance, ithome_tech` |
| **为什么下拉不含 `tophub`** | 微博官方渠道成功时，tophub（同源微博榜）条目会被跨渠道去重合并到 `weibo` 名下 —— 下拉暴露它会造成「显示有数据、切进去空列表」。服务层保留该渠道作微博数据兜底 |
| 选项文案 | `t('hotTopics.channels.' + k)` |
| 不可用标记 | `channelStats[ch] && !channelStats[ch].ok` → 追加 ` (不可用)` |
| 与分类的关系 | 与分类是**与**过滤 |

### 7.4 刷新与自动刷新

| 行为 | 规则 |
|---|---|
| SWR 首屏 | `hotTopicsGetCache()` 命中且 `topics.length > 0` → **立即渲染**并**后台静默刷新**（不显示中央提示）；未命中 → 网络抓取 + 中央加载提示 |
| 中央加载提示 | 首次无缓存抓取 / 手动刷新时显示（`HotTopicsCentralLoading`，非弹窗）；后台刷新不显示 |
| 手动刷新 | 「刷新」按钮 → `refresh(true)`（force）+ 中央提示 |
| 自动刷新 | `REFRESH_INTERVAL_MS = 30 * 60 * 1000`（30 分钟），后台静默 |
| 并发刷新 | 已有 in-flight 时：手动刷新仅补显中央提示并复用当前请求；后台刷新静默返回 |
| 发布中禁止刷新 | `publishing.value === true` → 直接 return |
| 部分失败提示 | `failedChannels`（`channelStats` 中 `error` 非空的渠道）非空 → 顶部 `el-alert` warning 列出渠道名 |
| 加载失败 | `topics.length === 0 && failedChannels.length > 0` 或 `res.code !== 0` 或抛错 → `notifyError('hotTopics.loadFailed')` |
| 上次刷新时间 | 页头显示 `lastRefresh`（`HH:mm`） |

### 7.5 加载更多

| 行为 | 规则 |
|---|---|
| 渲染截断 | `topicRenderLimit` 初始 30，`renderedTopics = filteredTopics.slice(0, topicRenderLimit)` |
| 提示 + 按钮 | `topicsTruncated` 为真时显示 `LoadMoreRow`：`shownTruncated`（已显示前 N 条，共 M 条）+ `loadMoreTopics` 按钮 |
| 点击 | `topicRenderLimit += 30` |
| 与全选的关系 | 「全选」基于 `filteredTopics` **全量**集合（语义是「选中全部筛选结果」），与只渲染前 N 条不冲突 |

### 7.6 勾选与批量上限

| 行为 | 规则 |
|---|---|
| 单条勾选 | `toggleSelect(id)`（`selectedIds` 是 `Set`） |
| 全选 / 取消全选 | `allFilteredSelected = filteredTopics.length > 0 && every(id in selectedIds)` |
| 计数文案 | `selectedCount`（已选 N 条） |
| 批量创作 | `createCopyBatch`：空选择 → 提示；`> 20` → 提示；否则跳 `/rewrite?topic=<首条>`（本期简化，session 队列消费属后续迭代） |
| 批量发布 | `startPublish`：同样的空/上限校验 → 逐条改写 → 保存草稿 → 进度区展示 |
| 发布进度区 | 改写完成后保留，展示 `publishProgress`（改写中 done/total）+ 每项状态（…/⏳/✅/❌ + 重试）+ 完成文案 |
| 「去发布」按钮 | 仅当存在成功草稿（`status === 'success' && draftId`）时显示 —— 避免「取消且零成功」时点击无反馈 |
| 发布中 | `publishing` 为真时渠道下拉与批量条禁用 |

### 7.7 收藏

| 行为 | 规则 |
|---|---|
| 两个标签页 | `tabHot`（热门选题）/ `tabFavorites`（收藏选题，带数量角标） |
| 单条收藏 | ♡ / ♥ 按钮；`toggleFavorite(topic)`；IPC `hotTopicsFavoriteAdd` / `Remove` |
| 收藏列表 | 独立组件 `HotTopicsFavorites`（减少 `HotTopics.vue` 行数），行结构与热门行一致 |
| 空态 | `favoritesEmptyTitle` / `favoritesEmptyDesc` |
| 收藏条目能力 | 取消收藏 / 创作文案 / 生成视频（与热门行一致） |
| 损坏条目 | 保留行、允许清理、禁用依赖 topic 的动作 |
| 按用户隔离 | 收藏落 `hot_topics_favorites`，`owner` 取当前 identity 的 `sub` |
| 时间展示 | `favoritedAt`（收藏于 <时间>） |

---

## 8. 显示项

| 位置 | 显示内容 | 数据来源 | 为空时表现 |
|---|---|---|---|
| 页头标题 / 副标题 | `hotTopics.pageTitle` / `pageDesc` | locale | — |
| 页头上次刷新 | `hotTopics.lastRefresh`（`HH:mm`） | `res.data.fetchedAt` 或 `getCache` 的 `fetchedAt` | `fetchedAt === 0` → 整条不渲染 |
| 刷新按钮 | `refresh` / `refreshing`；`loading || publishing` 时禁用 | 组件状态 | — |
| 部分渠道失败 warning | `hotTopics.partialFail`（渠道名用「、」连接） | `channelStats` 中 `error` 非空的项 → `channels.<id>` 文案 | 无失败渠道 → 整条不渲染 |
| 分类 chip | 分类名（运营下发名优先） | `contentCategories`（运营下发 → 内置 11 类） | 读不到下发 → 内置 11 类；**不会零分类** |
| 分类 chip 计数 | `<key>` 的多标签计数 | `topics[].categories` 聚合 | `0` |
| 渠道下拉 | 渠道名；`ok === false` 追加「(不可用)」 | `CHANNEL_KEYS` + `channelStats` | 无数据 → 空列表 |
| 条目名次徽标 | `viewRank ?? viewIndex+1`（**当前筛选视图内序号**，非来源榜名次）；tooltip：`heatScoreTip`（来源第 N 名 · 综合热度 X）或 `sourceRank`（无 `score` 的旧数据） | `scorer.js` 写入的 `viewRank` / `score` / `rank` | `score` 缺失 → tooltip 退回 `sourceRank` |
| 条目标题 | `topic`，超过 **60 字符**截断加 `…` | `topics[].topic` | 空标题条目已在解析层被丢弃（V14） |
| 条目标签 | `categories` 的**前 2 个**（`slice(0, 2)`），渲染为分类名 | `topics[].categories`（旧缓存回退 `[category]`） | 无 `categories` → 回退 `[category]`；两者皆无 → `['general']` |
| 条目渠道标签 | `channels.<channel>` | `topics[].channel` | 未知渠道 key → vue-i18n 回显键名（**风险点**，见 §12） |
| 多榜徽标 | `multiBadge`（「多榜」）+ tooltip `multiBadgeTip`（同时上榜：A、B） | `sourceCount >= 2`（旧缓存回退 `mergedFrom` 去重长度 +1，且排除自身渠道） | `sourceCount < 2` → 不渲染 |
| 趋势箭头 / 新上榜 | ↑ / ↓（tooltip `trendUp`/`trendDown`）或 `trendNew` | `scorer.js` `markTrend` 写入的 `trend` | `trend` 为空（首轮无上轮数据）→ 不渲染 |
| 热度值 | `formatHotValue(hotValue)`（万缩写） | `topics[].hotValue` | 缺失（RSS / 内联凤凰网）→ 不渲染 |
| 更新时间 | `HH:mm` | `topics[].fetchedAt` 或 `lastRefresh` | 均为 0 → 空 |
| 收藏按钮 | ♡ / ♥ | `useHotTopicsFavorites` | — |
| 条目操作按钮 | 创作文案 / 爆款分析（带 `topic` 跳 `/viral-analysis`，预填不自动发起）/ 生成视频（`genVideoBusy` 时禁用） | — | — |
| 空态（全局） | `emptyTitle` / `emptyDesc` / `emptyAction` | — | 触发条件：`filteredTopics.length === 0 && !loading` 且非 `categoryEmpty` |
| 空态（分类） | `emptyCategoryTitle` / `emptyCategoryDesc` / `boostAction` | — | 触发条件：`categoryEmpty` |
| 加载更多行 | `shownTruncated` + `loadMoreTopics` | `filteredTopics.length` vs `renderedTopics.length` | 未截断 → 不渲染 |
| 中央加载提示 | `refreshLoadingTitle` / `refreshLoadingDesc` | 组件状态 | `showCentralLoading === false` → 不渲染 |
| 收藏空态 | `favoritesEmptyTitle` / `favoritesEmptyDesc` | — | 收藏 tab 且 `favorites.length === 0` |
| 生成视频进度弹窗 | 阶段进度 / 错误文案 / 重试 / 后台运行 / 取消 / 关闭 | `useHotTopicsGenVideo` | 无任务 → 不渲染 |

---

## 9. 提示文字

### 9.1 本轮新增的用户可见文案（逐条）

> 结论：**本轮新增的用户可见文案只有 3 条**（1 个分类名 + 2 个渠道名 × zh/en 成对）。其余全部沿用既有键。

| # | locale 键 | 中文原文 | 英文原文 | 生效位置 |
|---|---|---|---|---|
| T-1 | `hotTopics.categories.ai` | `AI` | `AI` | 热门选题页分类 chip、条目标签 |
| T-2 | `contentCategories.ai` | `AI` | `AI` | 采集库类别标签、账号分组预设标签（运营未下发时的内置回退名） |
| T-3 | `hotTopics.channels.xiaohongshu` | `小红书` | `Xiaohongshu` | 渠道下拉、条目渠道标签、多榜 tooltip 来源名、部分失败 warning |
| T-4 | `hotTopics.channels.ifeng` | `凤凰网` | `iFeng` | 同上 |

**成对性（CI Gate 7）**：`hotTopics.categories.ai` 在 `locales/hot-topics/zh.js:18` 与 `en.js:18`；`channels.xiaohongshu`/`channels.ifeng` 在 `zh.js:26` 与 `en.js:26`；`contentCategories.ai` 在 `locales/content-categories/zh.js:10` 与 `en.js:10`。**四对全部成对**。

### 9.2 既有的分类与渠道文案（本轮未改，但受分类/渠道扩展影响）

| locale 键 | 中文原文 | 英文原文 |
|---|---|---|
| `hotTopics.categories.general` | 综合 | General |
| `hotTopics.categories.society` | 社会 | Society |
| `hotTopics.categories.finance` | 财经 | Finance |
| `hotTopics.categories.tech` | 科技 | Tech |
| `hotTopics.categories.entertainment` | 娱乐 | Entertainment |
| `hotTopics.categories.sports` | 体育 | Sports |
| `hotTopics.categories.emotion` | 情感 | Emotion |
| `hotTopics.categories.education` | 教育 | Education |
| `hotTopics.categories.health` | 健康 | Health |
| `hotTopics.categories.international` | 国际 | International |
| `hotTopics.channelAll` | 全部渠道 | All channels |
| `hotTopics.categoryAll` | 全部 | All |
| `hotTopics.channelUnavailable` | 不可用 | Unavailable |

> **口径说明**：分类 chip 的**实际显示文案优先取运营下发名**（`categoryLabel` 链：下发名 → 内置本地化名 → key 本身）。上表的 `hotTopics.categories.*` 与 `contentCategories.*` 是**离线/未下发时的回退名**。两处同时维护是既有设计（内容类别是展示资产，不是权限）。

### 9.3 既有的空态 / 补拉 / 失败 / 多榜等提示（本轮沿用，逐条列出）

| # | locale 键 | 中文原文 | 英文原文 |
|---|---|---|---|
| N-1 | `hotTopics.emptyTitle` | 暂无热门选题 | No topics yet |
| N-2 | `hotTopics.emptyDesc` | 点击刷新按钮获取最新选题，或等待自动刷新 | Click refresh to fetch the latest topics, or wait for auto refresh |
| N-3 | `hotTopics.emptyAction` | 立即刷新 | Refresh now |
| N-4 | `hotTopics.emptyCategoryTitle` | 该分类暂无内容 | No topics in this category |
| N-5 | `hotTopics.emptyCategoryDesc` | 当前分类下暂时没有选题，可定向补拉该分类垂类榜单 | No topics here yet. You can fetch this category trending boards on demand |
| N-6 | `hotTopics.boostAction` | 补拉该分类 | Fetch this category |
| N-7 | `hotTopics.partialFail` | 部分渠道获取失败：{channels} | Some channels failed: {channels} |
| N-8 | `hotTopics.loadFailed` | 选题获取失败，请稍后重试 | Failed to fetch topics, please retry later |
| N-9 | `hotTopics.multiBadge` | 多榜 | Multi-board |
| N-10 | `hotTopics.multiBadgeTip` | 同时上榜：{sources} | Also trending on: {sources} |
| N-11 | `hotTopics.heatScoreTip` | 来源第 {rank} 名 · 综合热度 {heat} | Source rank #{rank} · heat {heat} |
| N-12 | `hotTopics.sourceRank` | 来源渠道内第 {rank} 名（列表序号为当前筛选视图内顺序） | Rank #{rank} on source channel (list numbers are sequential within the current filtered view) |
| N-13 | `hotTopics.trendUp` / `trendDown` / `trendNew` | 较上轮上升 / 较上轮下降 / 新上榜 | Rising since last refresh / Falling since last refresh / New |
| N-14 | `hotTopics.shownTruncated` | 已显示前 {shown} 条，共 {total} 条选题 | Showing first {shown} of {total} topics |
| N-15 | `hotTopics.loadMoreTopics` | 加载更多选题 | Load more topics |
| N-16 | `hotTopics.refreshLoadingTitle` / `refreshLoadingDesc` | 刷新中 / 正在从网上实时获取热门信息，一般需要5-10秒，请耐心等候 | Refreshing / Fetching the latest trending topics from the web in real time. It usually takes 5-10 seconds, please wait |
| N-17 | `hotTopics.lastRefresh` | 上次刷新 {time} | Last refresh {time} |
| N-18 | `hotTopics.noSelection` | 请先勾选至少一条选题 | Please select at least one topic first |
| N-19 | `hotTopics.batchLimit` | 一次最多批量处理 20 条选题，请减少选择 | Batch limit is 20 topics, please reduce your selection |
| N-20 | `hotTopics.selectAll` / `deselectAll` / `selectedCount` | 全选 / 取消全选 / 已选 {count} 条 | Select all / Deselect all / {count} selected |
| N-21 | `hotTopics.favoritesEmptyTitle` / `favoritesEmptyDesc` | 暂无收藏选题 / 在热门选题中点击 ♡ 即可收藏感兴趣的选题 | No favorites yet / Click ♡ on any topic to save it here |
| N-22 | `hotTopics.refresh` / `refreshing` | 刷新 / 刷新中… | Refresh / Refreshing… |

### 9.4 **本轮未新增用户可见文案的部分（如实声明，不编造）**

| 场景 | 本轮实现 | 是否有用户可见提示 |
|---|---|---|
| 用户显式点「补拉该分类」但该分类**无补拉源**（`education` / `international`） | 服务层输出 `warn('[hot-topics] no boost source configured for category: ' + cat)` | **❌ 没有**。界面表现为「刷新后仍为空态」，**沿用既有键**，未新增 toast / alert 文案 |
| 小红书 406（`shield` 失效） | 服务层输出专项 warn | **❌ 没有专门的用户文案**；用户通过「部分渠道获取失败：小红书」这条既有 warning（N-7）间接感知 |
| 渠道经 fallback 恢复 | 服务层输出 `info('... recovered via fallback #N')` | **❌ 没有**用户文案（刻意：恢复对用户是透明的好事） |
| 全渠道零结果保留旧缓存 | 缓存打 `preservedStaleCache: true` | **❌ 没有**用户文案（本轮未消费该字段） |
| 新渠道/新分类本身 | 见 §9.1 | ✅ 有（T-1 ~ T-4） |

> 因此：**凡是 §9.1 未列出的文案，本轮一律未新增，沿用既有键**。上表四项均只有日志侧信号，没有用户可见文案 —— 这是本轮的一个明确缺口，登记见 §13 P1-7。

---

## 10. 验收标准

> 编号即验收项。每条给出**可执行判据**。凡本轮未执行的，明确标注「待执行」而不是「已通过」。

| # | 验收项 | 判据 | 状态 |
|---|---|---|---|
| A1 | 新增渠道出现在渠道配置 | `CHANNEL_CONFIGS` 恰好 10 项，id 集合含 `xiaohongshu` 与 `ifeng`；每项 `url` 以 `https://` 开头、`intervalMinutes >= 5` | 代码已满足；测试已写（**待跑**） |
| A2 | 新增渠道能在缓存里看到条目 | 抓取后 `hotTopicsGetCache()` 的 `topics[]` 中存在 `channel === 'xiaohongshu'` 与 `channel === 'ifeng'` 的条目；`channelStats` 中两者 `ok === true` 且 `count > 0` | **待执行（需真实抓取）** |
| A3 | AI chip 有数据 | 抓取后 `categoryCounts.ai > 0`；条目 `categories` 含 `ai` | **待执行（需真实抓取）** |
| A4 | `ai` 补拉可用 | `CATEGORY_BOOSTS.ai` 存在、`sources.length >= 1`、每个源 `boostCategory === 'ai'` 且 `board === 'ai'` | 代码已满足；测试已写（**待跑**） |
| A5 | `ai` chip 为空时点「补拉该分类」不再静默无反应 | 该分类在 `wanted` 中且 `sources` 非空 → 产生补拉抓取；若 `sources` 为空 → 日志出现 `no boost source configured for category` | 代码已满足；测试已写（**待跑**） |
| A6 | `rawCategory='科技'` + 无关文本**不再落 `tech`** | `classifyTopic('科技','toutiao','今晚吃什么') === 'general'`；`classifyTopic('科技','toutiao','任意文本') === 'general'` | 代码已满足；测试已写（**待跑**） |
| A7 | 域级泛称有关键词证据时仍由关键词裁决 | `classifyTopic('科技','toutiao','芯片产业新突破') === 'tech'` | 代码已满足；测试已写（**待跑**） |
| A8 | 宽泛桶不覆盖关键词 | `classifyTopic('知识','bilibili','央行降息利好股市') === 'finance'`；零信号时 `=== 'general'` | 代码已满足；测试已写（**待跑**） |
| A9 | 「汽车」不再错挂 `tech` | `classifyTopic('汽车','weibo','任意文本') === 'general'`；`classifyTopic('汽车','toutiao','任意文本') === 'general'` | 代码已满足；测试已写（**待跑**） |
| A10 | **boost 不硬挂** | 构造 `boostCategory='tech'` 的补拉源返回原生分类「财经」的条目 → 该条目 `category === 'finance'` 且 `categories` 不含 `tech`；无任何信号时才用 `boostCategory` 兜底 | 代码已满足；测试已写（**待跑**） |
| A11 | **跨端 key 一致** | 渲染层 `DEFAULT_CATEGORY_KEYS` 与 `classifier.CATEGORY_KEYS` `toEqual`（长度 11、顺序一致）；运营端前 11 项 key 顺序一致且 `preset_keys` 长度 11 | 代码已满足；测试已写（**待跑**） |
| A12 | 拉丁词边界生效 | `'Air Jordan 复刻发售'` / `'He said nothing about the market'` 结果**不得为** `ai`；`'AI 应用落地加速' === 'ai'` | 代码已满足；测试已写（**待跑**） |
| A13 | 全角归一生效 | `classifyTopic(null,'zhihu','ＡＩ 应用落地加速') === 'ai'` | 代码已满足；测试已写（**待跑**） |
| A14 | `MIN_SCORE` 生效 | `'消费' === 'general'`（2 分 < 3）；`'消费 投资' !== 'general'` | 代码已满足；测试已写（**待跑**） |
| A15 | `general` 不变量 | 有真实分类时 `categories` 不含 `general`；全空时 `categories === ['general']` | 代码已满足；测试已写（**待跑**） |
| A16 | 空列表视为失败 | 全部尝试返回 0 条 → `items === null`、`error` 含 `empty list`、`breaker.failures.get(id) === 1`、日志含 `empty list` | 代码已满足；测试已写（**待跑**） |
| A17 | fallback 顺序降级 + 恢复不记失败 | 主端点空/异常、fallback 成功 → `viaFallback === 1`、`recordSuccess`（失败计数归零） | 代码已满足；测试已写（**待跑**） |
| A18 | 406 专项告警 | 错误含 `406` → 日志同时含 `406` 与 `shield` | 代码已满足；测试已写（**待跑**） |
| A19 | 同源端点不作为并列渠道 | `CHANNEL_CONFIGS` id 不含 `douyin_app` / `douyin_ies` | 代码已满足；测试已写（**待跑**） |
| A20 | 内联对象提取必须配对 | 构造含 `}` 的多行 `allData` → `extractIfengAllData` 取到完整对象、`update_time` 正确 | 代码已满足；测试已写（**待跑**） |
| A21 | 今日头条字段修正 | `parseToutiao` 优先 `InterestCategory[0]`、回退 `Category`；`HotValue` 字符串可转数字；`ClusterIdStr` 可拼 URL | 代码已满足；测试已写（**待跑**） |
| A22 | **测试数** | 新增测试：`classifier.test.js` 静态 25 处 `it` 声明（其中 1 处为 8 例参数化循环 ⇒ **运行 32 例**）；`hot-topics-new-sources.test.js` **18 例**；`hot-topics-boost-classify.test.js` **6 例** ⇒ 新增合计 **56 例** | 用例已写（**待跑**） |
| A23 | 既有契约测试同步 | `hot-topics-service.test.js`（静态 56 处 `it` 声明）与 `content-categories.test.js` 已同步 v3 行为（`10 channel configs`、`ai` 独立成类、`汽车` 归综合） | 已更新（**待跑**） |
| A24 | pytest 通过 | `cd ops-center/backend && pytest tests/test_content_categories_api.py` 全绿（含 `test_catalog_seeded_and_list` 断言 11 类顺序） | **待执行** |
| A25 | locale 成对 | `node scripts/check-locale-sync.js` 通过 | **待执行** |
| A26 | 品牌残留 | `node scripts/check-no-brand-residue.js` 通过（含本文档与研究报告） | **待执行** |
| A27 | eslint | 改动文件 eslint 无 error | **待执行** |
| A28 | **QM-1 打包验证** | `cd apps/desktop && pnpm exec electron-builder --win --dir --publish never` 退出码 0；asar 清单含目标文件；打包后启动 8s 无致命 stderr（`Failed to load platform config` / `PluginLoader.*mkdir failed` / `ENOTDIR.*app.asar`） | **待执行**（`openspec/.../tasks.md` 6.5 未勾选） |
| A29 | 打包前 worktree 依赖就绪 | `node scripts/verify-worktree-deps.js` 断言每个 `@multi-publish/*` 解析到当前 worktree | **待执行** |
| A30 | 质量节拍记录 | `.quality-gates.md` 新增本次执行记录 + `scripts/gate-record-debt-ledger.json` 登记 | **待执行** |

---

## 11. 测试与质量节拍

### 11.1 测试文件与用例数（逐文件实测值）

| 文件 | 性质 | 静态 `it` 声明数 | 运行时用例数 | 覆盖内容 |
|---|---|---|---|---|
| `apps/desktop/electron/services/hot-topics/classifier.test.js` | **新增**（206 行） | 25 | **32**（其中 1 处为 8 例参数化循环） | 分类体系 11 类 + `ai` 紧随 `tech`；渲染层与分类器 key/顺序一致；`KEYWORD_RULES` 覆盖完整性；禁裸单字；AI × tech 边界 5 例；**6 条根因回归锁**；8 类正例质量抽查；`classifyTopicMulti` 4 例；词表修补回归 5 例 |
| `apps/desktop/electron/services/hot-topics-new-sources.test.js` | **新增**（283 行） | 19 | **19** | `parseCnNumber` 1 例；`parseDouyin` 三端点同构 3 例；`parseXiaohongshu` 2 例；`parseIfeng`/`parseIfengInline`/`extractIfengAllData` 3 例；`parseToutiao` 字段修正 1 例；`CHANNEL_CONFIGS` 4 例；`_collectChannel` 三条新合同 4 例 |
| `apps/desktop/electron/services/hot-topics-boost-classify.test.js` | **新增**（120 行） | 6 | **6** | 补拉条目分类归属 4 例（异质条目不硬挂、零信号才兜底、id 带 board 段且唯一、解析器报错 fail-closed）；`ai` 补拉供给 2 例（配置存在且 `boostCategory`/`board` 为 `ai`、`onlyCategory` 用分类器筛） |
| `apps/desktop/electron/services/hot-topics-service.test.js` | 同步更新（既有） | 56 | 未逐例统计 | 含 `has 10 channel configs…`（断言含 `xiaohongshu`/`ifeng`）、`ai` 独立成类、`汽车` 归综合、`科学科普` 归综合 |
| `apps/desktop/electron/services/content-categories.test.js` | 同步更新（既有） | 未逐例统计 | — | 「内置 11 类与 classifier.js CATEGORY_KEYS 一致」「未下发 / 空 / 结构非法 → 内置 11 类」 |
| `ops-center/backend/tests/test_content_categories_api.py` | 同步更新（既有） | pytest 用例 | — | `test_catalog_seeded_and_list` 断言前 11 项 key 顺序与 `preset_keys` 长度 11 |
| **新增合计** | — | **49** | **56** | — |

> 说明：`HotTopics.test.js`（952 行 / 44 处 `it` 声明）本轮**未新增**针对新渠道/新分类的断言 —— 渲染层的新枚举由 `classifier.test.js` 的跨端一致性断言覆盖（它直接 import 渲染层的 `DEFAULT_CATEGORY_KEYS`）。

### 11.2 门禁项（逐项列出，凡未跑即标「待执行」）

| # | 门禁 | 命令 | 状态 |
|---|---|---|---|
| G1 | 定向测试 | `apps/desktop` 下跑 hot-topics 相关 + `content-categories` 双端 + `HotTopics.vue` | **PASS**：8 文件 / **198 passed**（收口后；含新增 locale 键回归锁） |
| G2 | ops-center pytest | `cd ops-center/backend && pytest tests/test_content_categories_api.py` | **PASS**：**9 passed**（补 2 条「非空存量库」用例） |
| G3 | locale 成对 | `node .github/scripts/check-locale-sync.js --pair-base origin/main / --keys / --cjk` | **PASS**：三项全过（keys 1875；cjk 基线 1489 / 当前 1224，无新增硬编码） |
| G4 | 品牌残留 | `node scripts/check-no-brand-residue.js` | **PASS**（扫描 8142 个 tracked 文件） |
| G5 | eslint | 改动文件 lint | **PASS**：exit 0 |
| G6 | **QM-1 打包验证** | `cd apps/desktop && pnpm exec electron-builder --win --x64`（或 `--win --dir`） | **PASS**：`build:vue` rc=0（37.77s）+ `electron-builder --win --dir --publish never` rc=0，asar **151022004 B** |
| G7 | 打包产物校验 | `pnpm exec asar list dist-electron/win-unpacked/resources/app.asar`（含目标文件）+ 启动存活与致命输出检查 | **PASS（判据通道已修正，见注）**：asar 含全部改动模块；解包后从产物 require 三模块（11 类含 `ai` / 13 解析器含 `xiaohongshu`\`ifeng` / 10 渠道且 `CATEGORY_BOOSTS` 含 `ai`）；经 **interactive 用户会话**（`explorer.exe`）启动打包 exe 存活 12s、日志出现 `main-window-shown`、禁用标记 6 项全 0、进程计数回基线 0 |
| G8 | worktree 依赖解析 | `node scripts/verify-worktree-deps.js` | **PASS**（11 个 workspace 链接解析到本 worktree） |
| G9 | 质量节拍记录 | 更新 `.quality-gates.md` + 登记 `scripts/gate-record-debt-ledger.json` | **PASS**：`check-gate-record-debt.js` rc=0、`check-pr-exec-record.js --mode=enforce` OK |

> **G7 判据通道修正（重要，如实登记）**：实测本机 **Windows GUI 子系统下打包 exe 的 stdout/stderr 恒为空**
> （显式带 `ELECTRON_ENABLE_LOGGING=1` 亦无输出；`--user-data-dir=` 参数还会被 exe 以 `bad option` 拒绝并 rc=9），
> 且 **harness 直接 spawn 的 GUI 进程会立即 rc=0 静默退出**（userData 零变更、Chromium 未初始化）。
> 因此「捕获 stderr 判三类禁用标记」在本机**结构性不可区分**，本轮改以「日志文件 + 进程存活 + 进程计数回基线」为判据。

### 11.4 QM-6 双模型外部评审（收口回填）

| 项 | 结论 |
|---|---|
| 路由真源 | `~/.claude/.ccg/config.toml` → `[routing.backend].primary=claude`、`[routing.frontend].primary=opencode`（本机无 `codeagent-wrapper`，改为直接调用两个 CLI，并行、只读） |
| frontend（`opencode`） | **结构化 JSON：Critical 0 / Warning 2 / Info 2**；两条 Warning 与一条 Info 已修，另一条 Info 如实登记为「已知版本错配窗口」，评审自身也建议本次不改 |
| backend（`claude`） | **本轮未产出结构化 findings**（本机运行 > 60 分钟、日志 0 字节）——按「frontend 单模型结构化 + backend 未产出」记账，**不声称双模型均已通过** |
| 已修 ①（Warning） | `classifier.js` 的 `DOMAIN_LEVEL_RAW` 前置短路使 9 条映射成为不可达死条目，且 `GENERIC_RAW_MAP` 注释举的唯一理由正是那条死条目 ⇒ 删死条目 + 改注释（**不选**「恢复强表 `科技` 优先级」，那会重现用户报的缺陷） |
| 已修 ②（Warning） | 两条跨端契约测试标题声称「与 classifier.js 一致」却用手抄字面量 ⇒ 改为**真实 import** 后 `toEqual` |
| 已修 ③（Info） | ops-center 存量 10 类库补 `ai` 的 `sort_order` 冲突靠字母序 tiebreak ⇒ 补 2 条「非空存量库」pytest 用例 + 把口径写进 `_provision_from_catalog` 文档串 |
| 登记 ④（Info） | 桌面端 v3 配旧版 ops-center（仍下发 10 类）时 `ai` 条目在分类下拉不可见 ⇒ **已知版本错配窗口，升级顺序：先 ops-center 后桌面端** |
| 反证（防假绿） | 两条新回归锁各做一次变异：删 `ithome-ai` locale 键 ⇒ **1 failed**；调换 `CATEGORY_KEYS` 中 `ai`/`entertainment` ⇒ **2 failed**；变异后文件按 SHA 还原 |

### 11.3 QM-1 打包验证的专项要求（本模块适用）

因为本次改动落在 `apps/desktop/electron/` 下，QM-1 是**强制项，不得用单测替代**（require 路径、文件 glob 覆盖、语法错误只能在打包产物中检出）：

1. `cd apps/desktop && pnpm exec electron-builder --win --dir --publish never`，退出码必须 0。
2. `pnpm exec asar list dist-electron/win-unpacked/resources/app.asar` 必须包含 `hot-topics-service.js`、`hot-topics/channels.js`、`hot-topics/classifier.js`、`hot-topics/scorer.js`（**新增文件不会自动进 asar，必须核对**）。
3. 打包产物启动 8 秒不崩溃，且 **stderr 无** `Failed to load platform config`、`PluginLoader.*mkdir failed`、`ENOTDIR.*app.asar`、配置/插件路径指向 ASAR 内部。
4. 打包前先 `node scripts/verify-worktree-deps.js` —— 禁止借用指向其他分支源码的 workspace 链接生成交付产物。

---

## 12. 风险与回滚

| # | 风险 | 影响面 | 缓解（已落地） | 回滚动作 |
|---|---|---|---|---|
| R1 | **小红书 `shield` 静态 token 被平台轮换** | 该渠道 406，无可抓数据；**没有自动续期手段** | ① 406 单独告警（点明需人工替换常量）；② `shield` 抽为集中常量 `XHS_SHIELD`（一处替换）；③ `intervalMinutes=30`、`riskLevel='high'`；④ 熔断 3 连败冷却 30min，避免每轮无效重试 | 替换 `XHS_SHIELD` 常量；若短期无法取得新值 → 从 `CHANNEL_CONFIGS` 摘除 `xiaohongshu` 一行（其他渠道不受影响） |
| R2 | **凤凰网 `ne883dbn.ifeng.com` 换域** | 主端点失败 | 主机名由前端 `window.allData.__nd__` 动态下发，理论上可变；已配 `fallbacks: [{ url: 'https://i.ifeng.com/', parser: 'ifeng_inline' }]`（约 51 条） | 替换 URL 常量；或把 `__nd__` 动态发现升为 P2-5 |
| R3 | **抖音端点加风控 / 加签名** | 主端点返回空列表 | ① 「空列表视为失败」使熔断器能正常打开（不再假装成功）；② 两级 fallback（其中 `aweme-lq.snssdk.com` 零头部可用）；③ `riskLevel='high'`、`intervalMinutes=15` | 摘除 `douyin` 渠道；或只保留 `aweme-lq.snssdk.com` 作主端点 |
| R4 | **域级泛称降级使 `tech` 条目减少** | `tech` chip 变稀疏；`'科技'` 栏目的条目零信号时落 `general` | ① 关键词表扩充（`折叠屏`/`GPU`/`显卡`/`智能手机` 等）；② `CATEGORY_BOOSTS.tech` 补拉（`threshold=6`）；③ 有科技信号时仍由关键词判 `tech` | 从 `DOMAIN_LEVEL_RAW` 移除 `'科技'`（一行），即回到「渠道自称科技即可信」的旧行为 |
| R5 | **词表调整导致个别类召回变化** | 个别选题落 `general`（漏判面）或跨类（误判面） | ① 测试覆盖 8 类正例 + 6 条根因反例 + 词表修补回归 5 例；② 源报告已给出「`general` 占比 ≤ 15%」「`tech` 误判率 ≤ 8%」等**建议门槛**，待标注集就绪后纳入 P1 评测 | 回退单个词表条目（改动面最小）；把 `'上市'` 从 weak 改回 strong 会立刻把汽车发布误判回 `finance`，故不建议整体回退 |
| R6 | **`MAX_TOPICS = 400` 在 10 渠道 × 50 候选下截断** | 最低热度尾部条目被丢弃；LLM 也在截断之后跑 ⇒ 被丢条目永远拿不到 LLM 分类 | 统一热度评分后截断（保头部即保热点）；上限兼顾 IPC 载荷 | 调大 `MAX_TOPICS`（需同步评估 IPC 载荷与渲染性能） |
| R7 | **新增渠道拉高单轮耗时** | 10 渠道并发 + 最多 4 条补拉源；单渠道最坏 3×10s 超时 | 并发抓取（`Promise.all`）；限流器按 `intervalMinutes` 节流；超时 10s | 调小 `FETCH_TIMEOUT_MS` 或摘除慢渠道 |
| R8 | **`shield`/设备指纹常量属他人设备标识** | 合规风险 | 常量公开自 MIT 开源项目（`60s` / `hot-topics`），**不是本项目私有凭证、不是用户数据**；已在代码注释中写明来源与轮换风险 | 若法务判定不可用 → 摘除该渠道（不影响其他 9 个渠道） |
| R9 | **未知渠道 key 导致 UI 回显 locale 键名** | 条目渠道标签与多榜 tooltip 用 `t('hotTopics.channels.' + channel)`；若某条目的 `channel` 既不在 `CHANNEL_KEYS` 也未被登记进 locale，界面会显示 `hotTopics.channels.<id>` 原文。`tophub` 属**已知的有意留白**（刻意不进下拉、但 locale 有名字）；真正的暴露面是**将来新增补拉源时忘记同步 locale** | 现存全部渠道（含补拉用的 `weibo` / `sina_finance` / `ithome_tech`）均已登记进 `hotTopics.channels`（zh/en 成对） | 新增任何 `source.channel` 时，同一提交内补 `hotTopics.channels.<id>`（zh/en 成对） |
| R10 | **`ai` 补拉源的召回率未实测** | AI 补拉可能产出很少条目（取决于 IT之家 RSS 当天是否含 AI 题） | `onlyCategory` 用分类器筛，判据与展示一致；无源时出声告警 | 若召回长期偏低 → 换源（tophub `/c/ai`，须先实测） |
| R11 | **`_aggregate` 的标签合并仍无条件** | 产生 `[emotion, tech]` 类语义互斥双标签，污染计数与过滤 | **未缓解**（登记 §13 P1-3） | — |

---

## 13. 后续迭代（P1 / P2）

> 全部来自调研报告 §六 与 设计文档 §4 的**未落地项**；本节的每一条都对应一个已定位的机制缺口，不是泛泛的「优化空间」。

### 13.1 P1（建议下一轮）

| # | 项 | 问题（机制级） | 建议改法 | 判据来源 |
|---|---|---|---|---|
| P1-1 | **LLM 送审集合改造**（最关键） | 现为 `if (t.category !== 'general') continue` ⇒ 已错判为 `tech` 的条目**永不进 LLM**，LLM 结构上无法纠错 | 改为 `general ∪ lowConfidence ∪ (原生与关键词冲突)`，并按优先级排序取批（`general=1 < lowConfidence=2 < disagreement=3`），避免永远只有头部 40 条被处理 | 调研报告 §2.6 机制 #1；`hot-topics-service.js:491` |
| P1-2 | **负向词表（`negative`）** | 中文子串匹配必然跨词误命中：`'手机'` 命中 `«手机丢了怎么办»`、`'电池'` 命中 `«电动车电池起火»` | `KEYWORD_RULES` 每条规则新增 `negative` 数组；命中则对本类 `score -= neg.length × NEG_MULT`（或整类剔除，按配置）。**必须与阈值调整同时上**，否则是把误判面换成漏判面 | 调研报告 §4.2 的负向词表清单 |
| P1-3 | **去重合并的互斥检查 + 「只升不降」收紧** | `_aggregate` 无条件并标签 ⇒ 产生 `[emotion, tech]` 互斥双标签；`general → 具体类` 的升级可被 boost 版反向污染 | ① `general → 具体类` 允许（保持）；② `具体类 → 具体类`：**不覆盖主标签，只并入次标签**；③ 并标签前查互斥表（如 `tech × emotion`） | 调研报告 §六 P0-2 剩余项；`hot-topics-service.js:443-448` |
| P1-4 | **相对边际判据替代单点阈值** | `MIN_SCORE = 3` 对「单弱词标题」一刀切；科技垂类大量标题只用弱词表达（`«华为发布折叠屏手机»` 类） | `ABS_FLOOR = 2` + `MARGIN = 1.5`：有判别力 ⟺ `top1 ≥ ABS_FLOOR` 且（`top2 === 0` 或 `top1/top2 ≥ MARGIN`）；不满足标 `lowConfidence`（仍给主标签保 UI 可用，但进 LLM 送审集合） | 调研报告 §六 P1-1；`classifier.js:267` |
| P1-5 | **LLM 缓存键归一 + 可审计留痕** | 键为原始 `topic` 文本（空白/全半角差异 → 重复计费；超 200 字符截断 → 键碰撞）；缓存只有 `{topic: label}`，**无法区分「关键词判的」与「LLM 判的」** | 复合键 = `sha1(NFKC(text).trim().toLowerCase())` + `modelId` + `PROMPT_VERSION`；值升级为 `{ label, model, promptVersion, decidedBy: 'llm'\|'keyword'\|'native', ts }`；**兼容读取旧格式**（string → `decidedBy:'keyword'`）；`LLM_LABELS_MAX` 裁剪改为按 `ts` 最旧优先 | 调研报告 §3.6、§六 P1-4 / P2-1 |
| P1-6 | **LLM 失败记忆 / 熔断** | provider 未配置或持续报错时，每轮对同一批 40 条重复尝试，无退避、无「已知不可用」标记 | 复用 `ChannelBreaker` 模式：连续 3 次空返回/抛错 → 冷却 30min，冷却期内直接 return 并 warn 一次 | 调研报告 §六 P1-5 |
| P1-7 | **补拉无源的用户可见提示** | 用户点「补拉该分类」而该分类无源（`education` / `international`）时，界面**无任何变化**，只有日志 | 消费 `contentCategories` + 下发补拉源清单，在 `boostCurrentCategory()` 里判断目标分类是否有源；无源则给明确提示（新增 locale 键，zh/en 成对） | 本文档 §9.4 |
| P1-8 | **分类评测集 + 混淆矩阵 + 基线** | 现有测试是**行为锁**，不是**准确率度量**；`tech` 误判率无基线，「优化了多少」无法回答 | 从 `hot_topics_cache` 导出 ≥ 600 条真实标题（每类 ≥ 30，`tech` ≥ 120、`ai` ≥ 60），落盘 `01-docs/research/fixtures/hot-topics-golden.jsonl`；新增 `classifier.eval.test.js` 输出 11×11 混淆矩阵与指标，门槛未达标即 fail 并接 CI | 调研报告 §5.1–5.5（门槛为**建议值**，须先跑基线再定） |
| P1-9 | **`origin` 字段分离 `general` 三种语义** | 「明确判定为泛资讯」被当「未命中」送 LLM | 条目新增内部字段 `origin: 'no_signal' \| 'generic_bucket' \| 'native_general'`；仅 `no_signal` 进 LLM 送审 | 调研报告 §1.6、§六 P0-2 |
| P1-10 | **「汽车」类内容的归属决策** | tophub 把「汽车」放在科技域下的二级标签；本项目把它直接降为 `general` ⇒ 汽车内容失去归属（实测 `«新款 SUV 上市»` → `finance`） | 二选一：① 不新增 `auto` 一级分类，把「汽车」的弱映射从 `general` 改为 `tech` 并配负向词；② 保持 `general`，靠关键词覆盖（需接受部分汽车题落 `finance`） | 调研报告 §3.3、§4.4 |

### 13.2 P2（登记，不排期）

| # | 项 | 说明 |
|---|---|---|
| P2-1 | **域内子标签** | 给 `tech` 加 `芯片/消费电子/航天/新能源/机器人`、给 `ai` 加 `大模型/AIGC/Agent/算力` 作为条目第三个字段 `subTags[]`；UI 在分类 chip 已选中时展开为二级筛选。**不改 `CATEGORY_KEYS` 契约**（`ai` 是一级分类还是子标签的取舍见调研报告 §3.3） |
| P2-2 | **拼音/缩写消歧** | `'Sora'` 命中 `«Soraya…»`、`'Kimi'` 命中赛车手人名 —— 完整拉丁词，词边界挡不住。需负向词 + 语境，无证据表明是主要错源 |
| P2-3 | **域名白名单** | 借鉴 `TrendRadar` 的 `expected_domain`（返回链接必须 HTTPS 且匹配目标域，否则丢弃并告警）。当前只有协议白名单（`safeHttpUrl`） |
| P2-4 | **UI 展示 2 / 存储 3 / 过滤全部 的口径统一** | 推荐方案：`activeCategory !== 'all'` 时，把该分类在 `categories` 里提到首位展示 ⇒ 用户看到的标签与所处分类自洽。**会动视觉回归基线**，需与 QM-4 一起排期 |
| P2-5 | **凤凰网 `__nd__` 动态发现** | 主机名由 `ishare.ifeng.com/hotNewsRank` 页面的 `window.allData.__nd__` 下发；可从展示页读该值再拼 API URL，作为换域时的自动兜底 |
| P2-6 | **多标签上限从 3 提升** | 一条横跨 4 域的题必丢 1 域；提升上限会同时抬高计数噪声与 UI 密度 |
| P2-7 | **NFKC 完整归一** | 当前只做全角 ASCII → 半角；完整 NFKC 可覆盖其它兼容字符 |
| P2-8 | **`preservedStaleCache` 的用户感知** | 缓存已打该标记但界面未消费；可在「上次刷新」处提示数据为陈旧值 |
| P2-9 | **`MAX_TOPICS` 与 LLM 执行顺序** | LLM 在截断之后跑 ⇒ 被丢条目永远拿不到 LLM 分类；改为截断前送审（或对截断边界条目优先送审） |
| P2-10 | **注释漂移清理** | `HotTopics.vue:294`（「回退内置 10 类」）、`content_category_service.py:8`（「保持那 10 个 key 不变」）、`:290`（「只把内置 10 类…回退」）、`llm-classifier.js:6`（「10分类枚举」）仍写 10 —— 均属文档级不一致，其中前两处正好是**跨端契约的说明文字** |

---

## 附 A：本文档不含的项（避免误读）

| 项 | 状态 |
|---|---|
| 测试实跑结果 | ❌ 本文档**未执行**任何测试；§10 / §11 中标注「待执行」的项不得当作已通过 |
| QM-1 打包产物 | ❌ 未生成 |
| 分类准确率数字（`tech` 误判率等） | ❌ 无基线 —— 标注集尚不存在，调研报告的门槛为**建议值** |
| 头条号响应结构 | ❌ 未取得（必须登录态） |
| 小红书/凤凰网真实条目数落库验证 | ❌ 未执行（需真实抓取） |

## 附 B：跨端 5 处契约的完整落点（便于评审逐处核对）

| # | 文件 | 载体 | 本次改动 |
|---|---|---|---|
| ① | `apps/desktop/electron/services/hot-topics/classifier.js` | `CATEGORY_KEYS`（`:34-37`） | 新增 `ai`（紧随 `tech`） |
| ② | `apps/desktop/electron/services/content-categories.js` | `DEFAULT_CONTENT_CATEGORIES`（`:20-32`） | 新增 `{ category_key: 'ai', name: 'AI' }` |
| ③ | `apps/desktop/src/features/content/content-categories.js` | `DEFAULT_CATEGORY_KEYS_INTERNAL`（`:23-26`） | 新增 `'ai'` |
| ④ | `apps/desktop/src/views/HotTopics.vue` | `CATEGORY_KEYS`（`:344`） | 新增 `'ai'` |
| ⑤ | `ops-center/backend/services/content_category_service.py` | `CATALOG`（`:44-56`） | 新增 `("ai", "AI", "大模型、AIGC、智能体、算力、AI 应用等")`，并把 `tech` 描述改为「芯片、互联网、数码、航天等（不含 AI，见 ai）」 |

> 另有 4 处**显示名**（非 key）也要成对：`locales/hot-topics/{zh,en}.js` 的 `categories.ai` 与 `locales/content-categories/{zh,en}.js` 的 `ai` —— 它们是「显示资产」而非契约 key，但漏改会造成中英不一致（CI Gate 7 拦截）。
