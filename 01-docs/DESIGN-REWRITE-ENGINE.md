# 改写引擎（Rewrite Engine）功能设计文档

> 文档定位：本文档整合改写引擎从立项调研到 v3 交付的全过程，涵盖需求背景、机制设计、技术实现、算法原理、功能清单、优势点、数据流与测试覆盖，是改写引擎的完整功能设计与实现总纲。
>
> 关联文档：
> - 产品需求：[PRD-REWRITE-ENGINE.md](./PRD-REWRITE-ENGINE.md)
> - 开源调研：[OSS-ANALYSIS-REWRITE-ENGINE.md](./OSS-ANALYSIS-REWRITE-ENGINE.md)
> - 深度分析：[DEEP-ANALYSIS-AI-TASTE.md](./DEEP-ANALYSIS-AI-TASTE.md)、[DEEP-ANALYSIS-KNOWLEDGE-BASE.md](./DEEP-ANALYSIS-KNOWLEDGE-BASE.md)、[DEEP-ANALYSIS-SENSITIVE-DEDUP.md](./DEEP-ANALYSIS-SENSITIVE-DEDUP.md)
> - 源码位置：`packages/rewrite-engine/`、`apps/desktop/electron/`、`ops-center/`
>
> 版本演进：v1（基础架构）→ v2（五模块深度重构）→ v3（SQLite 持久化 + Embedding 质量评估）
>
> 最新交付：PR #1594 已合并至 main（merge commit `58cfd1c`，2026-09-09）

---

## 一、背景与目标

### 1.1 需求起源

改写引擎源于「专业文案改写机制和模型」的核心诉求：内容生产者需要把一条素材改写成多平台、多风格、能成为爆款的文案或图文文章。人工改写耗时、易重复、质量不稳定，且无法规模化。

关键痛点（从立项对话归纳）：

1. **改写成爆款难**：普通改写只是同义替换，无法产出有传播力的爆款内容。
2. **AI 味太重**：直接调用 LLM 的改写结果带有明显机器痕迹，平台和读者都能一眼识别。
3. **抄袭判定风险**：低质量改写与原文字面相似度过高，容易被平台算法判为抄袭。
4. **千人一面**：所有用户拿到的是通用结果，不贴合个人的写作风格和领域积累。
5. **策略不可管理**：改写「怎么改」的逻辑散落在代码里，运营无法配置、无法迭代。
6. **质量不可量化**：改写好坏依赖主观判断，没有可迭代的量化抓手。

### 1.2 设计目标

改写引擎要实现的六大能力：

| 能力 | 说明 |
|------|------|
| 爆款级生成 | 通过多套专业改写策略生成有传播力的文案 |
| 去 AI 味 | 多层机制规避机器感，增加真人感 |
| 自我进化 | 结合用户个人知识库，越用越懂用户 |
| 多模式支持 | 智能仿写 / 扩写爆款 / 选题创作 |
| 策略可管理 | 策略在运营中心配置、下发、迭代 |
| 质量可量化 | 自动化评估改写质量，形成优化闭环 |

### 1.3 设计原则

1. **策略即模板**：每套策略 = 完整理论体系 + 明确指令 + 确定性约束，应用结果尽量可复现。
2. **检测优先于改写**：先诊断（AI 味/敏感词/相似度），再改写，再验证。
3. **纯本地算法优先**：敏感词、质量评估、去 AI 味等尽量用纯 JS/Python 启发式算法，零外部 LLM 成本，可离线复现。
4. **隐私优先**：知识库全部存本地，不上传云端。
5. **fail-closed**：所有异常路径宁可不改也不产出错误结果，敏感词、空结果、越界输入一律拦截。

---

## 二、系统总体架构

### 2.1 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│  桌面端前端 (Vue 3)                                          │
│  AiWriterPanel.vue 改写 tab — 模式/行业/目的/风格/平台/长度     │
└──────────────────────────┬──────────────────────────────────┘
                           │ ipcRenderer.invoke('ai:rewrite', ...)
┌──────────────────────────▼──────────────────────────────────┐
│  Electron 主进程                                              │
│  ipc-handlers/ai.js → RewriteEngineService（桥接层）          │
│  ├─ 注入 store（SQLite）                                      │
│  ├─ 注入 aiGenerator（LLM 网关，含 getEmbedding）              │
│  └─ 注入 strategyManager（远程策略）                           │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  @multi-publish/rewrite-engine 核心包（纯 JS，无重依赖）        │
│  RewriteEngine（编排） → 策略匹配 → Prompt 构建 → LLM → 后处理  │
│  ├─ StrategyManager / StrategyMatcher（策略）                  │
│  ├─ AITasteRemover（去 AI 味）                                │
│  ├─ KnowledgeBase + SQLiteStorage（知识库）                    │
│  ├─ SensitiveFilter（敏感词 DFA）                              │
│  └─ RewriteQualityEvaluator（质量评估）                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  LLM 推理层（通过 AIGenerator 统一网关）                        │
│  chatCompletion（改写）/ embeddings（质量评估向量）             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  运营中心（ops-center，FastAPI + Vue 3）                       │
│  ├─ 改写策略管理（CRUD + 运行时下发）                          │
│  └─ 内容质量评估（15 维度评分 + 统计）                          │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心数据流

```
用户输入文案
  → 模式选择（imitate/expand/create）
  → 策略匹配（自动/手动）
  → Prompt 构建（策略模板 + 模式指令 + 知识库上下文）
  → 敏感词前置检测（拦截）
  → LLM 推理（chatCompletion）
  → 去 AI 味后处理（3-pass）
  → 敏感词后置检测（警告）
  → 质量评估（SimHash + embedding）
  → 返回结果 + 元数据
  → 用户反馈 → 更新知识库（异步）
```

---

## 三、核心模块设计

`packages/rewrite-engine/src/` 共 9 个模块，全部纯 JavaScript 实现，无第三方重依赖。

### 3.1 RewriteEngine 核心编排器（rewrite-engine-core.js）

**职责**：改写流程的总编排器，串联校验 → 检测 → 匹配 → 构建 → 推理 → 后处理 → 评估 → 反馈八大步骤。

**核心方法 `rewrite(params)`**：

```javascript
async rewrite({ mode, content, userSettings, strategyId })
```

**执行流程（8 步）**：

1. **输入校验**（`_validate`）：空内容 → `EMPTY_CONTENT`；Unicode 码点计数 > 6000 → `TOO_LONG`（2026-09-12 起移除 < 20 的 TOO_SHORT 下限）。
2. **敏感词检测（前置）**（`_sensitiveCheck('pre')`）：**只记录、不拦截**（rewrite-sensitive-precheck-relax，2026-10-20 起）。命中结果仍会算出，用于第 8 步的知识库「双零命中」条件。历史上此处命中即返回 `SENSITIVE_CONTENT` 整篇拒绝，因词库为内置示例级且无配置入口，实测日常词汇（如「爆炸」）即可拦下一篇长文而用户无法调节，故取消拦截。恢复拦截只需把 `_sensitiveCheck` 的返回值改回 `blocked: stage === 'pre' && hits.length > 0`，调用点无需改动。
3. **策略匹配**（`_resolveStrategy`）：手动指定 strategyId 直接取；否则自动匹配 Top1。
4. **Prompt 构建**（`_buildPrompt`）：策略 systemPrompt + 模式指令组成 system prompt；userPromptTemplate 替换 `{content}` `{industry}` `{purpose}` `{tone}` `{platform}` `{knowledgeContext}` `{mode}` `{targetLength}` 八个占位符。
5. **LLM 推理**：无 llmClient → `NO_LLM_CLIENT`；异常 → `LLM_ERROR`；空结果 → `EMPTY_RESULT`。
6. **后处理**（`_postProcess`）：去 AI 味（默认开启）+ 长度截断（上限优先级：userSettings.wordCountRange.max > 策略 postProcess.maxLength > 默认 3000）。
7. **敏感词后置检测**（`_sensitiveCheck('post')`）：命中则附 warnings + sensitiveHits，不阻断返回。**这是用户唯一可见的敏感词提示通道**——注意 `Collection.vue` 的采集入口目前不消费 `warnings`（见 3.6 节）。
8. **质量评估 + 反馈**：SimHash 评估（失败降级 null），**前置与后置均零命中时**才异步记录到知识库（命中敏感词的内容不进知识库，避免固化成学习样本）。

**三种模式的指令模板**（`_getModeInstructions`）见第四章。

**容错设计**：质量评估 try-catch 降级 null；敏感词检测 try-catch 降级放行（fail-open 并留痕）；知识库反馈仅在「前置 + 后置双零命中」时触发。

### 3.2 StrategyManager 策略管理器（strategy-manager.js）

**职责**：管理策略生命周期——内置策略加载、远程策略缓存、查询、导出/导入、增删改。

**数据模型（策略字段）**：

| 字段 | 说明 |
|------|------|
| id / name / version | 标识 |
| category | viral(爆款)/marketing(营销)/platform(平台)/style(风格) |
| industry / purpose / tone / platforms | 适用行业/目的/风格/平台（数组） |
| systemPrompt | 系统提示词（角色设定 + AI 套路禁令） |
| userPromptTemplate | 用户提示模板（含 8 个占位符） |
| postProcess | 后处理配置 `{ removeAITaste, sensitiveCheck, maxLength }` |
| genre / chainOfThought / fewShot | v2 新增：文体、思维链、少样本示例 |
| metadata | 目标受众、最佳场景等元数据 |

**策略来源（source）三级**：

- `builtin`：硬编码 5 套种子策略（不可物理删除，只能禁用）
- `remote`：运营中心运行时下发（可删除）
- `custom`：用户自定义（可删除）

**核心方法**：

| 方法 | 说明 |
|------|------|
| loadBuiltins() | 幂等加载 5 套内置策略 |
| mergeRemote(list) | 合并远程策略（按 id 覆盖） |
| listEnabled() | 列出所有启用策略 |
| get(id) / listByCategory(cat) | 查询 |
| exportStrategy/exportAll/importStrategy/importAll | 导出导入（剔除内部 source 字段保证往返一致） |
| addCustom/update/remove/toggle | 增删改（内置只禁用，远程/自定义可删除） |

**5 套内置种子策略**：

| 策略 ID | 名称 | 分类 | 适用行业 | 平台 |
|---------|------|------|---------|------|
| strategy-viral-storytelling | 故事化爆款策略 | viral | general/ip-building/lifestyle | 抖音/小红书/公众号 |
| strategy-ecommerce-convert | 电商转化策略 | marketing | ecommerce/retail | 抖音/小红书/公众号 |
| strategy-douyin-viral | 抖音爆款口播策略 | platform | general/entertainment | 抖音 |
| strategy-xiaohongshu-种草 | 小红书种草策略 | platform | ecommerce/lifestyle/beauty | 小红书 |
| strategy-knowledge-dry | 干货知识策略 | viral | education/technology/finance | 公众号/B站/知乎 |

每套策略均含 chainOfThought（思维链指令）、fewShot（少样本示例）、metadata（受众/最佳场景）。

### 3.3 StrategyMatcher 策略匹配器（strategy-matcher.js）

**职责**：根据用户设置与历史评分，为策略打分排序，返回 Top N 推荐。

**五维加权评分算法**：

| 维度 | 权重 | 匹配逻辑 |
|------|------|---------|
| 行业 industry | 30% | 用户行业 ∈ 策略 industry（子串/全等双向匹配） |
| 目的 purpose | 25% | 用户目的 ∈ 策略 purpose |
| 平台 platform | 20% | 用户平台 ∈ 策略 platforms |
| 风格 tone | 15% | 用户风格 ∈ 策略 tone |
| 历史 history | 10% | 策略历史评分（1-5 分 → 0-20% 贡献） |

**兜底规则**（保证确定性）：

- 单维度无用户值时给 30% 基础分（避免全零）
- 历史维度：有评分按 `rating/5` 折算；无评分但属偏好策略给 60%；无任何数据给 30%
- 最终分数 `Math.round(score * 100) / 100`，保留两位小数

### 3.4 AITasteRemover 去 AI 味引擎（ai-taste-remover.js）

**职责**：去除 LLM 改写结果的机器痕迹，增加真人感。这是改写引擎「去 AI 味」的核心。

**3-Pass 处理流水线**：

```
Pass 1: 杀 AI 词汇 — 替换 AI 惯用词为人类表达
Pass 2: 破 AI 结构 — 检测并修复结构模式（开头套路、排比等）
Pass 3: 加人类质感 — 句长变化、口语化、留白、作者观点可见
```

**严重度分级（S1/S2/S3）**：

| 级别 | 含义 | 处理策略 |
|------|------|---------|
| S1 | AI 标志性结构词（综上所述/总而言之/值得注意的是/在当今社会等） | 单次命中即改 |
| S2 | 常见 AI 词汇（首先/其次/此外/与此同时等） | 密度驱动（达到阈值才改） |
| S3 | 风格偏好 | 可选修复 |

**四个关键防御机制**（借鉴 im-not-ai 的工程化设计）：

1. **反注入护栏**（`_rollbackInjection`）：改写后 AI 模式计数 > 原文时自动回滚，防止「改写器制造新 AI 味」。
2. **人类基线保护**（`_densityThreshold`）：人类高频用词（此外/然而/首先）密度 ≥3 才替换，避免损坏正常人类文本。
3. **句长方差检测**（`_detectRhythm`）：用方差（SD）而非均值判断节奏，人类文本段内句长变化更大（借鉴 sepia 的 StoryScope 研究）。
4. **检测优先于改写**：`detect()` 先诊断，`process()` 再改写。

**核心方法**：

| 方法 | 说明 |
|------|------|
| process(text) | 完整 3-pass 改写 |
| detect(text) | 诊断 AI 模式（返回命中详情） |
| analyze(text) | 结构化分析报告 |
| detectAITasteLevel(text) | 返回 AI 味等级（0-1，供前端显示百分比） |

**词库规模**：AI_PHRASE_MAP 约 117 条映射（S1/S2/S3 分级）+ FORBIDDEN_OPENING_PATTERNS 22 种开头套路模式。

### 3.5 KnowledgeBase 用户知识库（knowledge-base.js）

**职责**：存储用户偏好、风格指纹、历史成功案例、反馈日志、知识图谱与知识条目，让改写「越用越懂用户」。

**理论蓝本**：Karpathy LLM Wiki 理论 + Colinchiu007/LLM-Wiki-V2（Ebbinghaus 遗忘曲线、RRF 混合搜索、知识图谱）。

**数据模型（DEFAULT_KB）**：

```javascript
{
  version: 2,
  preferences: { industries, tones, platforms, preferredStrategies },
  styleFingerprint: { avgSentenceLength, commonPhrases, openingPatterns, closingPatterns, emojiUsage, punctuationStyle },
  successfulRewrites: [],
  feedbackLog: [],
  entities: {},        // 知识图谱节点
  relations: [],       // 知识图谱边（8 关系类型）
  knowledgeItems: []   // 知识条目
}
```

**七大核心机制**：

1. **Ebbinghaus 遗忘曲线置信度**（`_computeConfidence`）：`(基础0.5 + 来源0.1/个 + 权威0.2 + 访问0.02/次) × 0.5^(天数/30)`，上限 0.99。
2. **RRF 混合搜索**（`search` + `_reciprocalRankFusion`）：关键词通道 + 标签/类别通道融合，`score = Σ 1/(60+rank)`。
3. **知识图谱**（`addEntity`/`addRelation`/`queryGraph`）：8 关系类型（uses/depends_on/causes/contradicts/supersedes/related_to/part_of/implemented_by），DFS 遍历带深度限制与防环。
4. **矛盾检测**（`detectContradictions`）：bigram Jaccard 相似度 > 0.7 且否定词状态相反时标记 conflict。
5. **隐私过滤**（`_filterPrivacy`）：12 条正则（api_key/google_key/github_token/password/phone_cn/id_card/bank_card/jwt/aws_key/private_key 等）替换为 `***`。
6. **生命周期管理**（`consolidate`/`_checkLifecycle`）：active → stale(90天) → deprecated(180天) → archived(低频)。
7. **质量评分**（`rateQuality`）：结构 0.3 + 引用 0.4 + 可读性 0.3。

**存储抽象**：`constructor({ storage })` 接受任意 `{ get, set }` 接口。默认 `MemoryStorage`（内存 Map），v3 起生产环境注入 `SQLiteStorage` 持久化。

### 3.6 SensitiveFilter 敏感词过滤器（sensitive-filter.js）

**职责**：敏感词检测与过滤，防止改写内容触碰合规红线。

**核心算法：DFA 确定性有限自动机**（借鉴 houbb/sensitive-word）：

- 敏感词集合构建为**前缀树（Trie）**，词尾节点标记 end
- 单遍扫描文本 O(n)，与词库规模无关
- **最长匹配原则**：长词不被短词截断

**三层变体对抗**（归一化）：

1. **字符归一化**（`normalizeChar`）：全角→半角、繁体→简体（敏感词相关高频字映射）、特殊符号→标准字符。
2. **忽略字符**（`IGNORE_CHARS`）：空格、标点、特殊符号，实现「插字对抗」检测。
3. **词库分层**（6 层）：政治/色情/暴力/赌博/广告/其他，每层独立启用/禁用、独立处理策略（block/warn）。

**白名单双层**：词级白名单 + 上下文白名单（避免误伤）。

**热更新**：`addWord`/`removeWord`/`updateWordList`/`syncCategories` 无需重建整棵树，支持运营中心增量同步。

**核心方法**：`detect(text)`（返回命中详情）、`filter(text)`（替换为掩码）、`getStats()`、`getCategoryPolicy()`。

**⚠️ 词库来源与配置入口（rewrite-sensitive-precheck-relax 审查发现，未闭合）**：

- 引擎侧过滤器由 `apps/desktop/electron/services/rewrite-engine.js:213` 以 `new SensitiveFilter()` 注入，用的是本文件 3.6 所述的**内置 24 词示例库**（`BUILTIN_WORDS_BY_CATEGORY`）。
- **运营中心的 `content_policy.word_list` 远程词库不进这条链**——它只被 `ipc-handlers/sensitive.js`（编辑器「🔍 检测敏感词」手动检测/替换 IPC）消费。两套词库**互不同步**：同一篇文案在 shared-utils 词库与引擎词库下可能命中不同词（实测分别命中「走私」与「爆炸」）。
- 因此引擎侧当前**没有任何用户可调开关**（无 UI、无白名单注入）。2026-10-20 已按用户确认取消前置拦截（见 3.1 节第 2 步）；后置检测保留为唯一用户可见通道。
- 未闭合项：① 若将来要「严格模式」，正解是把 `content_policy.word_list` 接进引擎注入链并加用户级开关，**不要再复制第三份词库**；② `warnings` 的消费面不完整——`RewriteView.vue` 把它写进红色错误区（与「有结果」并存，视觉语义矛盾）、`AiWriterPanel.vue` 同样进 `panelError`，而 `Collection.vue` 的 4 个采集入口**完全丢弃 `warnings`**。也就是说采集页入口目前没有任何后置敏感词提示。

### 3.7 RewriteQualityEvaluator 质量评估器（rewrite-quality-evaluator.js）

**职责**：量化改写质量，防止抄袭判重，为优化提供抓手。

**三维评分体系**：

| 维度 | 说明 |
|------|------|
| sufficiency 充分度 | 基于 SimHash 海明距离（0-3 近似重复 / >6 充分改写） |
| semanticPreservation 语义保持度 | 基于 Jaccard + 关键词重合，或 embedding 余弦相似度 |
| originality 原创性 | 充分度 × 0.5 + (1-Jaccard) × 100 × 0.5 |

**SimHash 64 位指纹算法**：

- FNV-1a 64 位哈希（`fnv1a64`）
- 字符 n-gram 分词（中文按字符滑动窗口，默认 gramSize=4）
- 每个 token 哈希后按位加权求和，权重为正的位取 1
- 海明距离 < 3 判近似重复

**v3 双通道评估**：

```javascript
// 同步通道（纯本地，向后兼容）
evaluator.evaluate(original, rewritten)  // → { method: 'simhash', ... }

// 异步通道（优先 embedding，失败回退 SimHash）
await evaluator.evaluateAsync(original, rewritten)  // → { method: 'embedding' | 'simhash', ... }
await evaluator.evaluateBatchAsync(items)
```

**embedding 通道逻辑**：

1. 调用 `embeddingClient.getEmbedding()` 获取原文/改写文向量
2. `cosineSimilarity(vecA, vecB)` 计算余弦相似度
3. 归一化到 [0,100] 作为语义保持度：`((sim + 1) / 2) * 100`
4. 任何失败自动回退 SimHash + Jaccard

**`cosineSimilarity(a, b)`**：`dot / (normA × normB)`，零向量/长度不等返回 0，返回 [-1, 1]。

### 3.8 SQLiteStorage 持久化适配器（sqlite-storage.js）

**职责**：知识库的 SQLite 持久化适配器，替代内存存储。

**接口**：`{ get(key), set(key, value), isReady(), setDb(db) }`，与 MemoryStorage 行为一致。

**存储表**：

```sql
CREATE TABLE IF NOT EXISTS rewrite_engine_kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
)
```

**设计要点**：

- **依赖注入**：不直接依赖 sql.js，通过 `db.prepare().get()/.run()` 注入，由调用方提供 SQLite 实例。
- **延迟绑定**（`setDb`）：适配 Store 初始化时序（Phase 3 SQLite WASM 就绪后注入）。
- **幂等 upsert**：写入用 `INSERT OR REPLACE`。
- **fail-closed 降级**：未就绪 get 返回 null、set 无操作；db 异常静默降级不抛。

---

## 四、三种改写模式

引擎支持三种改写模式，由 `mode` 参数路由，每种有独立的指令模板。

### 4.1 模式一：智能仿写（imitate）

**目标**：通过多种策略调整，保证平台算法不判定为抄袭。

**核心指令**：

1. 保留原文核心观点和信息，但彻底重新组织表达方式
2. 更换段落结构、句式、案例、修辞手法
3. 确保改写后与原文相似度低于 40%
4. 不使用原文标志性短语和独特表达
5. 可改变叙述视角（如第一人称改第三人称）

**实现手段**：结构重组 + 同义替换 + 句式变换 + 案例替换 + 数据重述 + 多策略叠加，配合 SimHash 海明距离判重验证。

### 4.2 模式二：扩写爆款（expand）

**目标**：用户给的文案太短/太简单，扩写成更有深度的内容。

**核心指令**：

1. 基于原文核心思想深度扩展
2. 增加背景介绍、原因分析、案例支撑、数据引用
3. 从 What → Why → How → So What 四层次递进
4. 目标长度按 targetLength（short≈500 / medium≈1000 / long≈2000 字）
5. 保证扩写是「信息增量」而非「注水」

### 4.3 模式三：选题创作（create）

**目标**：用户给出选题，智能创作一篇全新文案/文章。

**核心指令**：

1. 基于选题创作全新完整文案
2. 先分析选题确定内容类型，再生成结构化大纲
3. 每段按写作指导独立生成，最后统一风格
4. 自动注入爆款要素：钩子、情绪转折、金句、互动引导
5. 目标长度按 targetLength

---

## 五、去 AI 味机制详解

### 5.1 三层去味架构

改写引擎的去 AI 味是「分层」而非单一后处理：

```
层 1: Prompt 层 — 策略 systemPrompt 内置「禁止 AI 套路」禁令
层 2: 后处理层 — AITasteRemover 3-pass 替换短语 + 句式随机化
层 3: 知识库层 — 个性化风格指纹注入，越用越像本人
```

### 5.2 关键设计洞察（来自开源深析）

四条总纲性结论直接落地到实现：

1. **检测器优先于改写器**：先 `detect()` 诊断，再 `process()` 改写，改写后再 `detectAITasteLevel()` 验证。
2. **反注入护栏是硬需求**：改写器会逆注入新 AI 味，必须「改写后计数 ≤ 原文」的确定性校验（`_rollbackInjection`）。
3. **人类基线反转防误报**：多个「公认 AI 味」模式人类用得更多，无条件替换会损坏人类文本，必须密度驱动（`_densityThreshold`）。
4. **句长方差而非均值**：节奏信号是句长分布（SD），人类文本段内变化更大（`_detectRhythm`）。

---

## 六、敏感词与合规机制

### 6.1 双重检测

- **前置检测**：改写前拦截含敏感词的原文，不进入 LLM（返回 `SENSITIVE_CONTENT`）。
- **后置检测**：改写后扫描结果，命中则附警告 + sensitiveHits，不阻断返回（供用户人工审核）。

### 6.2 DFA 算法优势

对比 v1 线性 indexOf：

| 特性 | v1 | v2（DFA） |
|------|-----|-----------|
| 复杂度 | 逐词 O(n×m) | 单遍 O(n) |
| 最长匹配 | 无 | 长词不被短词截断 |
| 变体对抗 | 无 | 全半角/繁简/插字三层归一化 |
| 热更新 | 重建 | 增量增删无需重建 |
| 分层管理 | 无 | 6 层词库独立策略 |

### 6.3 合规策略映射

| 分类 | 默认策略 |
|------|---------|
| 政治/色情/暴力/赌博/其他 | block（拦截） |
| 广告 | warn（警告） |

---

## 七、质量评估机制

### 7.1 双实现并存

改写引擎有两套互补的质量评估：

1. **Node 端 RewriteQualityEvaluator**（packages/rewrite-engine）：SimHash 判重 + 三维评分 + embedding 语义评估，随改写流程实时返回。
2. **Python 端 ContentQualityEvaluator**（ops-center）：15 维度启发式 NLP 评分，零 LLM 成本，运营中心量化统计。

### 7.2 Python 端 15 维度

每个维度 0-100 分，加权综合为总分：

| 维度 | 权重 | 核心算法 |
|------|------|---------|
| viral_potential 爆款潜力 | 12% | 标题/问叹号/数据引用/热点词/开头悬念 |
| logic 逻辑性 | 10% | 句子段落数/因果词/转折词/句长 |
| engagement 趣味性 | 8% | 案例/对话感/长短句节奏/互动问句 |
| human_likeness 去AI味 | 10% | AI模板词扣分/口语化加分 |
| compliance 违规风险 | 10% | 8 类敏感词正则 |
| readability 易读性 | 10% | 句长/常用字/段落长度 |
| clone_divergence 克隆差异度 | 6% | 字符集 Jaccard/长度比 |
| information_density 信息密度 | 6% | 数据/术语密度 |
| emotional_resonance 情感共鸣 | 6% | 正负面情感词 |
| structure 结构完整性 | 6% | 开头/结尾/过渡/分点 |
| originality 原创性 | 4% | 个人观点/新概念/陈词滥调扣分 |
| platform_fitness 平台适配 | 4% | 平台关键词/风格 |
| keyword_density 关键词密度 | 3% | bigram 频率分布 |
| call_to_action CTA | 3% | CTA 句式 |
| brand_consistency 品牌一致性 | 2% | 语气一致性 |

### 7.3 质量标准

| 综合分 | 等级 | 说明 |
|--------|------|------|
| >=90 | A+ | 优秀，可直接发布 |
| 80-89 | A | 良好 |
| 70-79 | B | 一般，基本达标 |
| 60-69 | C | 较差 |
| <60 | D | 差，建议重写 |

---

## 八、知识库设计（LLM Wiki 理论）

### 8.1 自我进化闭环

```
改写 → 用户采纳/修改/拒绝反馈 → recordFeedback
  → 更新策略偏好 + 风格指纹 + 行业/风格偏好
  → getContextSummary 注入下次 Prompt 的 {knowledgeContext}
  → 策略匹配的 history 维度权重提升
  → 越用越懂用户（正向飞轮）
```

### 8.2 检索优先级算法

```
检索优先级 = 置信度 × ln(1 + 访问次数)
置信度 = (基础 + 来源 + 权威 + 访问) × 遗忘曲线衰减
状态降级系数：active 1.0 / stale 0.5 / deprecated 0.1 / archived 0.01
```

---

## 九、前端交互设计

### 9.1 改写面板（AiWriterPanel.vue）

**入口**：发布页「🤖 AI 辅助写作」→ 面板内「🔄 AI 改写」tab。

**表单字段**：

| 字段 | 控件 | 默认 | 选项 |
|------|------|------|------|
| 改写模式 | 3 chip | imitate | 智能仿写/扩写爆款/选题创作 |
| 行业 | select | 通用 | 电商/教育/科技/金融/生活方式/美妆/娱乐/IP打造（9 项） |
| 目的 | select | 通用 | 提升互动/转化/涨粉/建立权威/带货销售（6 项） |
| 语言风格 | select | 通用 | 口语化/故事化/情感化/说服力/幽默/正式严谨（7 项） |
| 目标平台 | select | 通用 | 抖音/小红书/公众号/B站/知乎（6 项） |
| 长度 | select | 中 | 短(500)/中(1000)/长(2000) |
| 策略选择 | radio+select | 自动匹配 | 自动匹配（推荐）/手动选择 |
| 输入文案 | textarea | 继承原文 | 20-6000 字 |

**结果展示**：可点击 result-item + 元数据行（策略名称 · AI 味等级百分比 · 原文 X 字 → 结果 Y 字）+ 敏感词警告 panel-error。

**错误处理**：未配置 LLM / 未登录 / 改写失败（敏感词/LLM/网络）/ 策略加载失败（静默降级）。

**i18n**：`rewriteEngine.*` 命名空间 zh/en 共 56 个 key 成对完整。

### 9.2 IPC 数据流

```
AiWriterPanel.vue
  → aiRewrite/aiListRewriteStrategies/aiGetRecommendedStrategies (src/api/publisher.js)
  → ipcRenderer.invoke('ai:rewrite' | 'ai:list-rewrite-strategies' | 'ai:get-recommended-strategies')
  → ipc-handlers/ai.js（withSenderCheck 发送者校验）
  → RewriteEngineService
  → @multi-publish/rewrite-engine
  → aiGenerator.generateWithDefault('llm')
```

---

## 十、运营中心管理

### 10.1 改写策略管理

- **API**：`/api/v1/rewrite-strategies`（GET 列表 / GET runtime 下发 / POST 创建 / PUT 更新 / DELETE 软删 / POST toggle）
- **前端**：`RewriteStrategies.vue`（列表表格 + 分类过滤 + 新增/编辑弹窗 + 启停开关 + 软删）
- **数据校验**：id `^[a-z0-9_-]{1,100}$`、name 1-200、category 枚举、systemPrompt 1-5000、userPromptTemplate 1-10000、数组项 ≤200 字符 ≤50 项
- **种子机制**：lifespan 启动时补齐缺失种子，不覆盖运营修改
- **软删除**：只设 deleted_at + 禁用，不物理删除

### 10.2 内容质量评估

- **API**：`/api/v1/quality-eval`（POST /evaluate / GET /records / GET /stats）
- **前端**：`ContentQualityEval.vue`（单篇评估雷达 + 最近 100 篇统计 + 记录查询）
- **存储**：SQLite 表 quality_eval_records

---

## 十一、开源参考与技术复用

改写引擎的算法与机制大量借鉴高 star 开源项目，源码级分析见 4 份深度文档。

| 开源项目 | Star | 借鉴内容 |
|---------|------|---------|
| blader/humanizer | 45k | 33 个 AI 模式清单 + 标记→改写→校验流程 + 事实保真铁律 |
| op7418/Humanizer-zh | 17k | 中文 AI 味模式清单 + 50 分质量评分表 |
| Nanako0129/sepia | 2.4k | 句长方差（SD）算法 + 文体分层 + 四操作分离 |
| epoko77-ai/im-not-ai | — | S1/S2/S3 严重度 + 反注入护栏 + 人类基线反转 |
| houbb/sensitive-word | 6k | DFA 自动机 + 变体归一化 + 热更新 |
| yanyiwu/simhash | 1.2k | 64 位指纹 + 海明距离判重 |
| LLM-Wiki-V2（Colinchiu007） | — | Ebbinghaus 遗忘曲线 + RRF 混合搜索 + 知识图谱 |
| mem0ai/mem0 / letta-ai/letta | — | 向量记忆 + 记忆块自编辑范式 |

**复用原则**：直接移植成熟的纯 JS/Python 算法，不重复造轮子；保留证据边界（引用 `项目:文件:行号`）。

---

## 十二、功能优势点总结

1. **爆款导向的策略体系**：不是同义替换，而是「故事化/电商/口播/种草/干货」五类垂直爆款策略 + 可无限扩展的自定义策略。
2. **三层去 AI 味 + 反注入护栏**：Prompt 层禁令 + 3-pass 后处理 + 知识库个性化，且有「改写后计数 ≤ 原文」的确定性护栏，这是区别于简单正则替换器的关键。
3. **确定性可复现**：策略含明确指令 + 思维链 + 少样本示例，应用结果可预期；纯本地算法（DFA/SimHash）完全可离线复现。
4. **自我进化知识库**：LLM Wiki 理论的完整移植——遗忘曲线、RRF 搜索、知识图谱、矛盾检测、隐私过滤、生命周期，让引擎越用越懂用户。
5. **三种模式覆盖全场景**：智能仿写 / 扩写爆款 / 选题创作。
6. **质量量化闭环**：Node 端 SimHash + embedding 实时评估 + Python 端 15 维度统计，形成「改写 → 评估 → 迭代优化」闭环。
7. **隐私优先**：知识库全本地存储，12 条正则过滤敏感凭证，不上传云端。
8. **fail-closed 工程纪律**：空内容/越界/敏感词/空结果/异常一律明确拦截或降级，不产出脏数据。
9. **运营可管理**：策略全生命周期（CRUD/启停/软删/运行时下发）在运营中心可视化配置，无需改代码。
10. **零外部依赖**：核心包纯 JS，质量评估纯标准库 Python，评估零 LLM 成本。

---

## 十三、测试覆盖

| 测试文件 | 数量 | 结果 |
|---------|------|------|
| sqlite-storage.test.js | 7 | ✅ |
| rewrite-quality-evaluator.test.js | 18 | ✅ |
| ai-taste-remover.test.js | 6 | ✅ |
| knowledge-base.test.js | 6 | ✅ |
| strategy-manager.test.js | 7 | ✅ |
| strategy-matcher.test.js | 6 | ✅ |
| **核心包总计** | **50** | **全部通过** |

另有：ops-center 后端 322/322、桌面端 ai IPC 10/10、rewrite-strategy-manager 8/8、AiWriterPanel 17/17。

---

## 十四、关键文件索引

| 文件 | 用途 |
|------|------|
| packages/rewrite-engine/src/rewrite-engine-core.js | 核心编排（8 步流程 + 三模式指令） |
| packages/rewrite-engine/src/strategy-manager.js | 内置策略 + 远程合并 + 导出导入 |
| packages/rewrite-engine/src/strategy-matcher.js | 五维加权匹配 |
| packages/rewrite-engine/src/ai-taste-remover.js | 3-pass 去 AI 味 |
| packages/rewrite-engine/src/knowledge-base.js | LLM Wiki 知识库 |
| packages/rewrite-engine/src/sensitive-filter.js | DFA 敏感词 |
| packages/rewrite-engine/src/rewrite-quality-evaluator.js | SimHash + embedding 评估 |
| packages/rewrite-engine/src/sqlite-storage.js | SQLite 持久化 |
| packages/rewrite-engine/src/index.js | 包出口（createEngine + 全部导出） |
| apps/desktop/electron/services/rewrite-engine.js | 桥接 service |
| apps/desktop/electron/services/ai-generator.js | LLM 网关（含 getEmbedding） |
| apps/desktop/electron/core/container.setup.js | store 注入 |
| apps/desktop/electron/ipc-handlers/ai.js | IPC handler |
| apps/desktop/src/components/AiWriterPanel.vue | 改写面板 |
| ops-center/backend/routers/rewrite_strategies.py | 策略 API |
| ops-center/frontend/src/views/RewriteStrategies.vue | 策略管理页 |
