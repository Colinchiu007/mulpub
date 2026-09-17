# 改写引擎（Rewrite Engine）— 产品需求文档

> 立项日期: 2026-09-08 | 状态: Phase 3 桌面端完成（全链路贯通） | 复杂度: L | 风险: 中

## 一、产品概述

改写引擎是一套专业文案改写机制和模型，为内容生产者提供：

1. 爆款级文案生成：通过多套专业改写策略生成有传播力的文案
2. 去 AI 味：通过多层机制规避机器感，增加真人感
3. 自我进化：结合用户个人知识库，越用越懂用户
4. 多模式支持：智能仿写、扩写爆款、选题创作
5. 运营中心管理：策略可在运营中心配置和迭代

## 二、系统架构

核心模块：桌面端前端(Vue3) + 运营中心前端(Vue3) + 改写引擎服务层 + LLM推理层

数据流：用户输入 -> 模式选择 -> 策略匹配 -> Prompt构建 -> 敏感词检测 -> LLM推理 -> 去AI味后处理 -> 返回结果 -> 用户反馈 -> 更新知识库

## 三、改写策略系统（已实现）

### 3.1 策略数据模型

策略在 `ops-center/backend/models.py` 中定义为 `RewriteStrategy` 模型（表名 `rewrite_strategies`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String(100) PK | 策略唯一标识，如 `strategy-viral-storytelling` |
| name | String(200) | 策略名称 |
| description | Text | 策略描述 |
| version | String(20) | 版本号，默认 `1.0.0` |
| category | String(40) | 分类：viral/marketing/platform/style |
| industry | Text(JSON) | 适用行业列表，如 `["ecommerce","education"]` |
| purpose | Text(JSON) | 目的列表，如 `["engagement","conversion"]` |
| tone | Text(JSON) | 语言风格列表，如 `["casual","storytelling"]` |
| platforms | Text(JSON) | 适用平台列表，如 `["douyin","wechat_mp"]` |
| system_prompt | Text | 系统提示词 |
| user_prompt_template | Text | 用户提示词模板，支持 `{content}` `{knowledgeContext}` 占位符 |
| post_process_config | Text(JSON) | 后处理配置，如 `{"removeAITaste":true,"sensitiveCheck":true,"maxLength":2000}` |
| extra_metadata | Text(JSON) | 扩展元数据 |
| enabled | Integer | 0/1 启用状态 |
| sort_order | Integer | 排序权重 |
| deleted_at | String | 软删除时间戳 |
| created_at / updated_at / updated_by | String | 审计字段 |

### 3.2 内置种子策略（5 套）

| 策略 ID | 名称 | 分类 | 适用行业 | 平台 |
|---------|------|------|---------|------|
| strategy-viral-storytelling | 故事化爆款策略 | viral | general/ip-building/lifestyle | 抖音/小红书/公众号 |
| strategy-ecommerce-convert | 电商转化策略 | marketing | ecommerce/retail | 抖音/小红书/公众号 |
| strategy-douyin-viral | 抖音爆款口播策略 | platform | general/entertainment | 抖音 |
| strategy-xiaohongshu-cz | 小红书种草策略 | platform | ecommerce/lifestyle/beauty | 小红书 |
| strategy-knowledge-dry | 干货知识策略 | viral | education/technology/finance | 公众号/B站/知乎 |

### 3.3 运营中心后端 API

**路由前缀**：`/api/v1/rewrite-strategies`

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/` | 登录用户 | 列表所有策略（含软删除过滤） |
| GET | `/runtime` | 无认证 | 运行时下发（仅启用+未删除） |
| POST | `/` | 管理员 | 创建策略 |
| PUT | `/{strategy_id}` | 管理员 | 更新策略 |
| DELETE | `/{strategy_id}` | 管理员 | 软删除策略 |
| POST | `/{strategy_id}/toggle` | 管理员 | 启用/禁用策略 |

**数据校验规则**（`validate_strategy`）：
- id：`^[a-z0-9_-]{1,100}$`，必填
- name：1-200 字符，必填
- description：≤2000 字符
- category：必须是 viral/marketing/platform/style 之一
- industry/purpose/tone/platforms：字符串数组，每项 ≤200 字符，最多 50 项
- systemPrompt：1-5000 字符，必填
- userPromptTemplate：1-10000 字符，必填
- postProcess：JSON 对象
- sort_order：非负整数
- enabled：布尔值/0/1

**种子机制**：`ensure_rewrite_strategies_seeded()` 在 OpsCenter lifespan 启动时执行，对已存在的策略跳过（不覆盖运营修改），仅补齐缺失种子。

**软删除**：`delete_rewrite_strategy` 仅设置 `deleted_at` + 禁用，不物理删除。创建时若同名 ID 已软删，则恢复并应用新数据。

### 3.4 运营中心前端

**文件**：`ops-center/frontend/src/views/RewriteStrategies.vue`

**功能**：
- 策略列表表格（ID/名称/分类/行业/平台/内置标记/启用开关/操作）
- 分类过滤（全部/viral/marketing/platform/style）
- 新增/编辑弹窗表单（所有字段可编辑）
- 启用/禁用开关（即时切换）
- 软删除（确认弹窗）
- 表单校验（ID 格式、必填字段）

**菜单注册**：`config/menuItems.js` 中添加 `{ path: '/rewrite-strategies', label: '改写策略管理', icon: Edit }`

**路由**：`/rewrite-strategies` → `RewriteStrategies.vue`（需认证）

### 3.5 改写引擎核心包（已实现）

`packages/rewrite-engine/` 包含 7 个模块，25 个测试全部通过：

| 模块 | 文件 | 功能 |
|------|------|------|
| StrategyManager | `src/strategy-manager.js` | 5 套内置策略 + 远程策略合并 |
| StrategyMatcher | `src/strategy-matcher.js` | 5 维度加权匹配算法（行业30%+目的25%+平台20%+风格15%+历史10%） |
| AITasteRemover | `src/ai-taste-remover.js` | 去 AI 味后处理（短语替换+句式随机化+口语化） |
| KnowledgeBase | `src/knowledge-base.js` | LLM Wiki 理论用户知识库 |
| SensitiveFilter | `src/sensitive-filter.js` | 敏感词检测 |
| RewriteEngine | `src/rewrite-engine-core.js` | 核心编排（校验→匹配→构建→后处理） |

## 三_BACKUP、改写策略系统

策略是独立配置单元，核心字段：id/name/description/category/industry/purpose/tone/platforms/systemPrompt/userPromptTemplate/postProcess

策略分类：viral(爆款)/marketing(营销)/platform(平台适配)/style(风格)

策略匹配算法维度权重：行业30% + 目的25% + 平台20% + 风格15% + 历史评分10%

## 四、用户知识库

参考 LLM Wiki (Karpathy) 和 LLM Wiki V2 理论。知识库本地存储，包含用户偏好、风格指纹、历史成功案例、反馈日志。隐私优先，不上传云端。

## 五、改写模式

模式一(智能仿写)：结构重组+同义替换+句式变换+案例替换+数据重述+多策略叠加
模式二(扩写爆款)：主题发散+层次深化+钩子设计+长度控制+信息密度
模式三(选题创作)：选题分析->大纲生成->分段创作->整体润色->爆款要素注入

## 六、敏感词与合规

复用运营中心现有敏感词机制+增强前后置检测+Prompt层合规约束+改写日志

## 七、去 AI 味机制

分层：Prompt层(禁止AI套路)+后处理层(替换AI味短语+句式随机化)+知识库层(个性化)

## 八、运营中心管理

新增改写策略模块：CRUD/启用禁用/使用统计/策略下发

## 九、前端交互设计

### 9.1 桌面端改写面板（AiWriterPanel.vue 改写模式）

**入口**：发布页（Publish.vue）的「🤖 AI 辅助写作」按钮 → 面板内第四个 tab「🔄 AI 改写」

**布局**：面板宽度跟随现有 AiWriterPanel 容器（约 360px），内容垂直排列，各表单项间距 8px。

**交互流程**：

```
打开面板 → 选择改写模式 → 设置行业/目的/风格/平台/长度 →
选择策略(自动匹配/手动选择) → 输入或确认文案 →
点击"开始改写" → 等待 LLM 返回 → 展示结果+元数据 →
点击"应用"将结果填入正文编辑器
```

**表单字段**：

| 字段 | 控件类型 | 默认值 | 说明 |
|------|---------|--------|------|
| 改写模式 | 3 个 chip 按钮 | imitate | 智能仿写 / 扩写爆款 / 选题创作 |
| 行业 | select 下拉 | 通用 | 9 个选项：电商/教育/科技/金融/生活方式/美妆/娱乐/IP打造 |
| 目的 | select 下拉 | 通用 | 6 个选项：提升互动/提升转化/涨粉/建立权威/带货销售 |
| 语言风格 | select 下拉 | 通用 | 7 个选项：口语化/故事化/情感化/说服力/幽默/正式严谨 |
| 目标平台 | select 下拉 | 通用 | 6 个选项：抖音/小红书/公众号/B站/知乎 |
| 长度 | select 下拉 | 中（约1000字） | 短(500)/中(1000)/长(2000) |
| 策略选择 | radio + select | 自动匹配 | 自动匹配（推荐）/ 手动选择（下拉列出所有策略） |
| 输入文案 | textarea | 继承原文内容 | 非空即可（2026-09-12 起无最小字数），最多 6000 字 |

**结果展示**：

- 改写结果以可点击的 result-item 展示，点击「应用」触发 `apply-content` 事件，将结果填入编辑器
- 结果下方显示元数据行：策略名称 · AI味等级（百分比） · 原文 X 字 → 结果 Y 字
- 敏感词警告以 panel-error 显示

**错误处理**：

- 未配置 LLM：显示"需要配置 LLM API Key"
- 登录未完成：弹出登录窗口
- 改写失败：显示错误信息（敏感词/LLM调用失败/网络错误等）
- 策略列表加载失败：静默处理，仍可用自动匹配模式

**i18n 覆盖**：新增 `rewriteEngine.*` 命名空间，zh/en 共 56 个新 key，成对完整。

### 9.2 数据流

```
Vue 组件 (AiWriterPanel.vue)
  ↓ aiRewrite(params) / aiListRewriteStrategies() / aiGetRecommendedStrategies()
  ↓ 前端 API 层 (src/api/publisher.js)
  ↓ invoke("aiRewite") / invoke("aiListRewriteStrategies") ...
  ↓ preload (system.js) → ipcRenderer.invoke('ai:rewrite', ...)
  ↓ IPC Handler (electron/ipc-handlers/ai.js)
  ↓ RewriteEngineService (electron/services/rewrite-engine.js)
  ↓ @multi-publish/rewrite-engine (packages/rewrite-engine/)
  ↓ aiGenerator.generateWithDefault('llm') → LLM Provider
```

## 十、实施计划与进度

| Phase | 内容 | 状态 |
|-------|------|------|
| Phase 1 | 基础架构（核心包） | ✅ 完成 |
| Phase 2 | 策略系统（后端 + 运营中心前端） | ✅ 完成 |
| Phase 3 | 改写模式（桌面端 Electron 接入 + 前端面板） | ✅ 完成 |
| Phase 4 | 增强机制（敏感词/去AI味/知识库） | ✅ 完成 |
| Phase 5 | 前端（AiWriterPanel 改写 tab） | ✅ 完成 |
| Phase 6 | 测试与交付（PR/CI/合并） | 🔄 进行中 |

### 11.1 测试覆盖

| 层 | 测试 | 结果 |
|----|------|------|
| rewrite-engine 核心包 | 25/25 | ✅ |
| ops-center 后端 | 320/323（修复后 322/322） | ✅ |
| 桌面端 ai IPC | 10/10 | ✅ |
| 桌面端 rewrite-strategy-manager | 8/8 | ✅ |
| 桌面端 template-manager | 18/18 | ✅ |
| 桌面端 AiWriterPanel | 17/17（含 6 个改写模式用例） | ✅ |

### 11.2 关键文件索引

| 文件 | 用途 |
|------|------|
| `packages/rewrite-engine/src/rewrite-engine-core.js` | 核心引擎（三种模式 `_getModeInstructions` :210-242） |
| `packages/rewrite-engine/src/strategy-manager.js` | 内置策略 + mergeRemote |
| `packages/rewrite-engine/src/strategy-matcher.js` | 5 维度加权匹配 |
| `packages/rewrite-engine/src/ai-taste-remover.js` | 去 AI 味后处理 |
| `packages/rewrite-engine/src/knowledge-base.js` | LLM Wiki 用户知识库 |
| `packages/rewrite-engine/src/sensitive-filter.js` | 敏感词检测 |
| `apps/desktop/electron/services/rewrite-engine.js` | 桥接 service（aiGenerator 网关） |
| `apps/desktop/electron/services/rewrite-strategy-manager.js` | 远程策略持久化 + applyRemote |
| `apps/desktop/electron/ipc-handlers/ai.js` | IPC handler（`ai:rewrite` 等） |
| `apps/desktop/electron/preload/system.js` | preload 暴露（:229-231） |
| `apps/desktop/src/api/publisher.js` | 前端 API（:25-32） |
| `apps/desktop/src/components/AiWriterPanel.vue` | 改写模式 tab（Phase 3 新增） |
| `apps/desktop/src/locales/zh.js` / `en.js` | i18n（`rewriteEngine.*` 命名空间） |
| `ops-center/backend/services/rewrite_strategy_service.py` | 策略 CRUD + 种子 |
| `ops-center/backend/services/runtime_service.py` | bootstrap 并入 rewrite_strategies |
| `ops-center/backend/routers/rewrite_strategies.py` | 策略 API 路由 |
| `ops-center/frontend/src/views/RewriteStrategies.vue` | 运营中心策略管理页 |

## 十二、改写引擎 v2 升级（2026-09-09）

### 12.1 升级概述

本次升级对改写引擎的 5 个核心模块进行了全面重构：

| 模块 | v1 → v2 | 主要变更 |
|------|---------|---------|
| ai-taste-remover.js | 191行→879行 | 3-pass引擎+S1/S2/S3分级+句长方差+反注入护栏+人类基线保护 |
| knowledge-base.js | 276行→795行 | Ebbinghaus遗忘曲线+RRF混合搜索+知识图谱+矛盾检测+隐私过滤 |
| sensitive-filter.js | 76行→533行 | DFA自动机+6层词库分层+变体归一化+白名单+热更新 |
| strategy-manager.js | 156行→350行 | few-shot/CoT+导出导入+自定义策略+部分更新+metadata扩展 |
| rewrite-quality-evaluator.js | NEW(425行) | SimHash 64位指纹+海明距离判重+三维评分 |

### 12.2 去AI味引擎 v2

**3-pass处理流水线：** Pass1杀AI词汇(117条映射S1/S2/S3分级) → Pass2破AI结构(22种模式) → Pass3加人类质感(句长变化+口语化)。反注入护栏：改写后detect计数>原文时自动回滚。人类基线保护：人工高频用词(此外/然而/首先)密度≥3才替换。

### 12.3 用户知识库 v2

Ebbinghaus遗忘曲线 + RRF混合搜索 + 知识图谱(8种关系DFS) + 矛盾检测(bigram Jaccard>0.7) + 隐私过滤(12条正则) + 生命周期管理 + 质量评分。

### 12.4 敏感词过滤器 v2

DFA自动机O(n)+最长匹配、6层词库分层、变体归一化(全角→半角/繁→简/特殊字符→标准/重复字符去重)、词级+上下文白名单、增量热更新。

### 12.5 策略管理器 v2

新增数据结构：fewShot/chainOfThought/genre/metadata。新增方法：exportStrategy/importStrategy/addCustom/update/remove/toggle。

### 12.6 改写质量评估器

SimHash 64位指纹+海明距离判重(<3近似重复/>6充分改写)。三维评分：充分度/语义保持度/原创性。综合pass/warn/fail判定+改进建议。

### 12.7 集成变更

- rewrite-engine-core.js新增qualityEvaluator参数
- index.js新增导出RewriteQualityEvaluator/SimHash/computeSimHash/hammingDistance
- rewrite返回结果新增quality字段

### 12.8 深度分析文档

| 文档 | 内容 |
|------|------|
| DEEP-ANALYSIS-AI-TASTE.md | 4个去AI味开源项目深析+v1引擎14维差距+P0-P5方案 |
| DEEP-ANALYSIS-KNOWLEDGE-BASE.md | mem0/letta/LLM-Wiki-V2三源码深析+Node移植方案 |
| DEEP-ANALYSIS-SENSITIVE-DEDUP.md | houbb/sensitive-word+SimHash源码深析 |

## 十三、改写引擎 v3 — SQLite 持久化 + Embedding 质量评估（2026-09-09，PR #1594）

 ### 13.1 升级概述

本次升级将改写引擎的知识库从内存存储接入桌面端 SQLite 持久化，并为质量评估器接入 embedding 向量服务，使改写质量评估从纯本地算法升级为语义级向量评估。

v3.1 修复（2026-09-10，PR #1616）：
- quality 字段 TDZ 缺陷：修复 rewrite() 中 quality 变量在 response 对象构造后才声明导致永远 undefined 的 bug
- embedding 评估正式接入生产调用链：rewrite() 优先调用 evaluateAsync（embedding 余弦相似度语义评估）→ 失败回退 evaluate（SimHash+Jaccard）→ 再失败为 null
- 知识库持久化容错：recordFeedback() 异常不再阻塞主流程返回
- 引擎实例缓存：_ensureEngine() 首次构建后复用，避免每次 rewrite() 重建 KnowledgeBase/SQLiteStorage/QualityEvaluator
- createEngine() embedding 注入条件修正：从 === undefined（永远 false，初值为 null）改为 !options.qualityEvaluator

| 模块 | 变更 | 行数 |
|------|------|------|
| sqlite-storage.js | NEW | 65 行 |
| rewrite-quality-evaluator.js | v2→v3 | 470→514 行 |
| rewrite-engine.js (service) | v2→v3 | +28 行 |
| ai-generator.js | 新增 getEmbedding() | +42 行 |
| container.setup.js | 接线 store 注入 | +1 行 |
| index.js | 新增导出 | +10 行 |

### 13.2 SQLite 持久化适配器

**模块**：`packages/rewrite-engine/src/sqlite-storage.js`

实现 `{ get(key), set(key, value), isReady(), setDb(db) }` 接口，与 `MemoryStorage` 行为完全一致。适配器不直接依赖 sql.js，而是通过 `db.prepare().get()/.run()` 注入，由调用方提供具体 SQLite 实例。

**存储表结构**：

```sql
CREATE TABLE IF NOT EXISTS rewrite_engine_kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
)
```

**数据校验**：
- key：TEXT PRIMARY KEY，非空，≤1024 字符
- value：TEXT NOT NULL，存储 JSON 序列化的知识库对象（KnowledgeBase._data 的 `JSON.stringify`）
- 写入使用 `INSERT OR REPLACE`（幂等 upsert），读取通过 `SELECT value FROM ... WHERE key = ?`

**生命周期**：
- `constructor(db)` — 可选参数，传入则立即 `ensureTable` + 就绪
- `setDb(db)` — 延迟绑定，适配 Store 初始化时序（Phase 3 SQLite WASM 就绪后注入）
- `isReady()` — 返回 `this._ready && !!this._db`

**错误处理**：
- `ensureTable` 失败静默降级（catch + 不抛）
- `get` 在未就绪时返回 `null`，db 调用异常返回 `null`
- `set` 在未就绪时无操作，db 调用异常静默降级

**接线**：
- `RewriteEngineService._ensureEngine()`：store.db 可用 → `new SQLiteStorage(this._store.db)` → `new KnowledgeBase({ storage })`；不可用 → `new KnowledgeBase()`（内存 fallback）
- `container.setup.js`：`rewriteEngineService.setStore(c.get("store"))` 在构造后注入

### 13.3 Embedding 质量评估

**模块**：`packages/rewrite-engine/src/rewrite-quality-evaluator.js`

在原有同步 `evaluate()`（SimHash 64 位指纹 + 海明距离 + Jaccard）基础上，新增异步评估通道。

**新增方法**：

| 方法 | 签名 | 行为 |
|------|------|------|
| `evaluateAsync(original, rewritten)` | async → 报告 | 优先 embedding 余弦相似度（`method: 'embedding'`），失败回退 SimHash + Jaccard（`method: 'simhash'`） |
| `evaluateBatchAsync(items[])` | async → 报告数组 | 逐项调用 `evaluateAsync`（串行） |

**构造器变更**：

```javascript
// v3 新增 options.embeddingClient
new RewriteQualityEvaluator({ embeddingClient: { getEmbedding(text): Promise<number[]> } })
```

`embeddingClient` 为可选注入，未传时 `evaluateAsync` 完全等价于 `evaluate()`（SimHash 路径）。

**语义保持度计算**（embedding 路径）：
- 调用 `embeddingClient.getEmbedding(original)` 和 `embeddingClient.getEmbedding(rewritten)` 获取两向量
- 计算余弦相似度 → 归一化到 [0, 100] 作为 `semanticPreservation`
- embedding 调用失败 → 自动 fallback 到 SimHash + Jaccard（通过 `scoreSemanticPreservation` 函数）

**`cosineSimilarity(a, b)` 导出**：
- 输入：两个等长 `number[]` 向量
- 计算：`dot / (normA * normB)`
- 边界：零向量返回 0，长度不等返回 0
- 返回：[-1, 1] 浮点数

**建议生成**：`buildSuggestions(distance, sufficiency, semanticPreservation, method)` 新增可选 `method` 参数，embedding 模式下给出更精准的建议（如"语义保持度高但改写不够充分，建议增加新表达方式"）。

### 13.4 AIGenerator.getEmbedding()

**模块**：`apps/desktop/electron/services/ai-generator.js`

为改写引擎质量评估提供向量接口，通过 LLM 默认 provider 调用 `embeddings` API。

**方法签名**：`async getEmbedding(text: string): Promise<number[]>`

**实现流程**：

1. 检查 `ModelProviderManager` 已就绪
2. 调用 `manager.getDefault('llm')` 获取 LLM 默认 provider
3. 从 `providerWithKey.capability_models.embedding` 或 `config.default_embedding_model` 或默认 `'text-embedding-3-small'` 解析模型名
4. 调用 `manager.callAdapter(providerId, 'embeddings', { model, input: text })`
5. 从返回的 `result.data.data[0].embedding` 提取向量数组
6. 非数组时抛 `Error('Invalid embedding response format')`

**模型解析优先级**：
1. `capability_models.embedding` — 多模态预设的能力路由（如 OpenAI 预设的 `text-embedding-3-small`）
2. `config.default_embedding_model` — 运营后台下发或用户自定义默认 embedding 模型
3. `'text-embedding-3-small'` — 硬编码兜底（OpenAI 兼容 embed 模型）

**接线**：
- `RewriteEngineService._ensureEngine()`：检测 `aiGenerator.getEmbedding` 可用 → 包装为 `{ getEmbedding: (text) => this._aiGenerator.getEmbedding(text) }` → 传入 `new RewriteQualityEvaluator({ embeddingClient })`

### 13.5 数据流（质量评估路径）

```
用户发起改写评估
  ↓
RewriteEngineService (rewrite-engine.js)
  ↓
RewriteEngine.rewrite()
  ↓
RewriteQualityEvaluator.evaluateAsync(original, rewritten)
  ↓
  ├─ embeddingClient.getEmbedding() → AIGenerator.getEmbedding()
  │     ↓
  │   ModelProviderManager.callAdapter('openai', 'embeddings', { model, input })
  │     ↓
  │   OpenAIAdapter.embeddings() → POST /embeddings
  │     ↓
  │   返回 { data: [{ embedding: number[] }] }
  │     ↓
  │   cosineSimilarity(vecA, vecB) → semanticPreservation [0-100]
  │
  └─ 失败 → 回退 SimHash + Jaccard（纯本地）
```

### 13.6 测试覆盖

| 测试文件 | 数量 | 结果 |
|---------|------|------|
| sqlite-storage.test.js (NEW) | 7 | ✅ |
| rewrite-quality-evaluator.test.js (NEW) | 18 | ✅ |
| ai-taste-remover.test.js | 6 | ✅ |
| knowledge-base.test.js | 6 | ✅ |
| strategy-manager.test.js | 7 | ✅ |
| strategy-matcher.test.js | 6 | ✅ |
| **总计** | **50** | **全部通过** |

### 13.7 关键文件索引（v3 新增/修改）

| 文件 | 用途 |
|------|------|
| `packages/rewrite-engine/src/sqlite-storage.js` | SQLite 持久化适配器 |
| `packages/rewrite-engine/src/rewrite-quality-evaluator.js` | 质量评估器（v3: +embedding 异步通道） |
| `packages/rewrite-engine/src/index.js` | 新增导出 SQLiteStorage/cosineSimilarity |
| `packages/rewrite-engine/tests/sqlite-storage.test.js` | SQLiteStorage 单元测试 |
| `packages/rewrite-engine/tests/rewrite-quality-evaluator.test.js` | 质量评估器单元测试 |
| `apps/desktop/electron/services/ai-generator.js` | 新增 getEmbedding() |
| `apps/desktop/electron/services/rewrite-engine.js` | 桥接 SQLite + embedding 注入 |
| `apps/desktop/electron/core/container.setup.js` | store 注入 rewriteEngineService |

### 12.9 测试结果

| 测试文件 | 数量 | 结果 |
|---------|------|------|
| ai-taste-remover.test.js | 6 | PASS |
| knowledge-base.test.js | 6 | PASS |
| strategy-manager.test.js | 7 | PASS |
| strategy-matcher.test.js | 6 | PASS |
| **总计** | **25** | **全部通过** |

## 十三、内容质量评估机制（Python 端，2026-09-08；v1.3 校准 2026-09-10）

> 本文档补充章节：改写产出的内容质量自动化评估机制。完整说明见
> [DOC-CONTENT-QUALITY-EVAL-MECHANISM.md](./DOC-CONTENT-QUALITY-EVAL-MECHANISM.md)，
> 架构设计见 [ARCH-CONTENT-QUALITY-EVAL-2026-09-08.md](./ARCH-CONTENT-QUALITY-EVAL-2026-09-08.md)，
> 运营中心 PRD 见 ops-center/docs/PRD.md §12A.24。

### 13.1 目标与原则

改写引擎产出内容后，需要一个量化、自动化、可迭代的质量评估机制，解决：

1. 无量化标准：改写质量依赖人工主观判断，无法规模化
2. 无持续优化抓手：不知道具体哪个维度弱，改什么、改多少
3. AI 味不可见：改写内容是否像机器写的，没有量化指标
4. 合规风险盲区：敏感内容是否被改写消除，没有自动化检测
5. 克隆效果不可测：克隆模式下与原文的差异性，没有量化度量

**设计原则**：纯启发式 NLP 评分（仅依赖 Python 标准库 re/math/collections），
不调用外部 LLM，保证评估本身零成本、零延迟、可离线运行，可在 CI 与本地复现。

### 13.2 15 维度与权重

每个维度 0-100 分，加权综合为总分 0-100 分：

| 维度 ID | 中文名 | 权重 | 核心算法 |
|---------|--------|------|---------|
| viral_potential | 爆款潜力 | 12% | 标题长度/问叹号、前500字数据引用、热点词、内容长度、开头悬念 |
| logic | 逻辑性 | 10% | 句子/段落数、因果词、转折词、平均句长 |
| engagement | 趣味性 | 8% | 案例标记、人称对话感、长短句节奏、互动问句 |
| human_likeness | 去AI味 | 10% | AI模板词扣分、口语化加分、个性化标点、人称交互 |
| compliance | 违规风险 | 10% | 8 类敏感词正则检测扣分 |
| readability | 易读性 | 10% | 平均句长、常用字覆盖率、段落长度 |
| clone_divergence | 克隆差异度 | 6% | 与原文字符集 Jaccard、长度比 |
| information_density | 信息密度 | 6% | 数据/术语密度、虚词占比 |
| emotional_resonance | 情感共鸣 | 6% | 正/负面情感词统计 |
| structure | 结构完整性 | 6% | 开头/结尾/过渡/分点列表 |
| originality | 原创性 | 4% | 个人观点标记、新概念词、陈词滥调扣分 |
| platform_fitness | 平台适配 | 4% | 平台关键词命中、平台风格特化 |
| keyword_density | 关键词密度 | 3% | bigram 频率与分布 |
| call_to_action | CTA | 3% | CTA 句式统计 |
| brand_consistency | 品牌一致性 | 2% | 正式/口语语气一致性 |

### 13.3 评分等级与质量标准

| 综合分 | 等级 | 说明 |
|--------|------|------|
| >=90 | A+ | 优秀，适合直接发布 |
| 80-89 | A | 良好 |
| 70-79 | B | 一般，基本达标 |
| 60-69 | C | 较差 |
| <60 | D | 差，建议重新改写 |

**质量标准**（P0）：

- 达标线：最近 100 篇改写结果平均分 >=70（B 级）
- 优秀线：最近 100 篇平均分 >=80（A 级）
- 单篇及格线：单篇综合分 >=60
- 持续优化触发：平均值低于 70 时，分析短板维度（如去AI味、逻辑性、趣味性），
  针对性优化改写引擎提示词与策略，迭代直到达标

### 13.4 数据流与集成点

改写请求 → AggregationService.rewrite()（packages/python-backend/.../aggregation/service.py）
→ RewriteProcessor（content-aggregator-shared shared/rewriters/rewriter.py）
→ 改写结果 → ContentQualityEvaluator.evaluate(rewritten, original, platform)
→ QualityReport（15 维度 + 总分 + 等级 + 建议）
→ RewriteResult.quality_report 返回给调用方
→ 运营中心 POST /api/v1/quality-eval/evaluate 落库 quality_eval_records
→ 运营中心 GET /api/v1/quality-eval/stats 统计最近 100 篇平均值

**降级策略**：评估异常仅记录 warning 日志，不影响改写主流程返回。

> **v1.1 适用性语义**：
> - 无原文时克隆差异度 `applicable=false`，不参与综合分/警告/建议/最近 100 篇该维度均值；
> - 综合分按适用维度权重归一化；
> - 改写引擎质量报告与运营中心单篇评估响应共用同一序列化投影（`serialize_quality_report`），
>   字段一致，避免两端漂移；
> - 旧记录缺 `applicable` 时，仅克隆差异度按已存原文是否非空回退。

### 13.5 运营中心功能

**前端页面**：ops-center/frontend/src/views/ContentQualityEval.vue

| 功能 | 说明 |
|------|------|
| 单篇评估 | 输入正文（可选原文/标题/平台），点击评估，展示 15 维度评分雷达与总分、等级、建议 |
| 最近 100 篇统计 | 展示最近测试的 100 篇改写结果的平均分、等级分布、短板维度排行 |
| 记录查询 | 分页查看历史评估记录与明细 |

**后端 API**（路由前缀 /api/v1/quality-eval，需管理员认证）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /evaluate | 单篇评估并落库 |
| GET | /records?limit=N | 最近 N 条评估记录 |
| GET | /stats?limit=100 | 最近 N 篇平均分/等级分布统计 |

**数据存储**：SQLite 表 quality_eval_records，字段包含 content/original_content/title/platform/style、
overall_score/grade 及各维度分数字段、created_at。

### 13.6 校验与测试

- 单篇内容 <20 字：返回 400「内容过短」
- 未登录：返回 401
- 无 LLM API Key：改写接口返回 400 友好中文提示（评估接口本身不依赖 LLM，可独立使用）
- 回归测试：ops-center/backend/tests/test_quality_eval_api.py（导入路径修复、评估/统计/记录全链路、短内容 400、未认证 401）

### 13.7 校准迭代记录（v1.2 / v1.3）

> 完整校准细节见 DOC-CONTENT-QUALITY-EVAL-MECHANISM.md §13.6 / §13.7。
> 这里只记录 PRD 层面的结论与后续缺陷。

v1.2 短文度量校准（2026-09-10）：首轮真实 LLM 验收（20 篇，均值 69.5）暴露
评估器对口语化短文/金句文案的系统性度量偏差，新增 7 个回归测试锁定：金句情绪张力、
短文无 CTA 不扣分、微博文体平台适配、「绑架」比喻义不误判违规、钩子+金句收尾结构。
校准后同 20 篇均值 70.11，达标。

v1.3 深度文 CTA / 第一人称叙事校准（2026-09-10）：v1.2 后仍 9 篇低于 70，
定位到两类真实度量盲区：深度论证文（>400 字）CTA 误伤（此前扣 10 分）、第一人称
叙事标记（我见过/我一开始/我当时）未被原创性识别。修复后同 20 篇均值 70.2 达标，
AI 模板均值 59.83（红线 ≤62 保持）。

剩余 9 篇低于 70 的边界：4 篇纯金句微博短文（<70 字）属短文固有边界，不宜
继续放宽阈值（会推高 AI 模板）；其余 5 篇中 index 2 抖音改写混入导演脚本标记，
属改写引擎 prompt 真实缺陷（见 13.8）。

### 13.9 平台字段透传修复（v1.4，2026-09-10）

> P1「平台字段传递缺失」已修复。RewriteRequest/RewriteResult 新增 platform 字段
>（默认「通用」，取值：微信/抖音/小红书/知乎/微博/B站/通用，与评估器
> _PLATFORM_KEYWORDS 键一致），AggregationService.rewrite() 将 request.platform
> 透传给 ContentQualityEvaluator，替换原硬编码 platform=通用。
> 新增回归测试 3 个：RewriteRequest 默认 platform、接受 platform、
> rewrite() 不得硬编码 platform（inspect 源码断言）。
> 实测同一篇内容 platform_fitness 随平台变化（小红书 58 / 微博 63 / 知乎 55 / 通用 60），
> 证明平台适配维度现已按真实目标平台评分。

### 13.8 改写引擎侧待办缺陷（后续独立任务）

| 优先级 | 缺陷 | 说明 |
|--------|------|------|
| ~~P1~~ | ~~平台字段传递缺失~~ | ✅ 已于 v1.4 修复（见 13.9） |
| P1 | 抖音改写脚本标记污染 | short_video 策略 prompt 未约束 LLM 输出纯正文，产出混入「开头…」导演脚本残留 |
| P2 | 跨进程持久化缺口 | 改写成功后的 quality_report 不自动写入运营中心 quality_eval_records，最近 100 篇均值当前仅统计运营中心手动评估记录 |

### 13.10 改写质量评估报告桌面端闭环（v1.5，2026-09-13）

> 目标：让桌面端改写结果展示质量评估报告，实现「AI 生成内容质量可量化、可运营」的桌面端消费侧闭环。

#### 13.10.1 数据流

```
RewriteEngine.rewrite()
  └─ RewriteQualityEvaluator.evaluateAsync(original, rewritten)
       └─ 返回 quality 字段 { sufficiency, semanticPreservation, originality, simhashDistance, verdict, suggestions, method }
            └─ aiRewrite IPC 透传 data.quality
                 └─ RewriteView.vue 从 data.quality 读取并展示质量评估报告
```

#### 13.10.2 质量报告字段（RewriteQualityEvaluator 返回）

> ⚠️ **v1.6 已修订**（2026-09-16，见 13.11）：`semanticPreservation` 口径、`verdict` 判据与新增字段
> `mode` / `textSimilarity` 以 §13.11 为准。本表为 v1.5 历史记录。

| 字段 | 类型 | 说明 |
|------|------|------|
| sufficiency | number 0-100 | 改写充分度（SimHash 海明距离映射） |
| semanticPreservation | number 0-100 | 语义保持度（Jaccard + 关键词重合，或 embedding 余弦） |
| originality | number 0-100 | 原创性（充分度×0.5 + (1-Jaccard)×100×0.5） |
| simhashDistance | number | 原文与改写文的 SimHash 海明距离 |
| verdict | pass/warn/fail | 结论（距离<3 或语义>90 或语义<30 → fail；距离≤6 或语义<50 → warn；否则 pass） |
| suggestions | string[] | 改进建议 |
| method | simhash/embedding | 评估方式（embedding 优先，失败回退 simhash） |

#### 13.10.3 前端展示（RewriteView.vue）

- 改写结果区新增「质量评估」区块（`data-testid="rewrite-quality-report"`），展示充分度/语义保持度/原创性/结论/评估方式/改进建议
- 结论颜色区分：pass=绿 / warn=黄 / fail=红
- quality 缺失时显示「本次改写未生成质量评估」（`data-testid="rewrite-quality-none"`）
- i18n：zh/en 成对新增 `rewritePage.quality*` 12 个 key

#### 13.10.4 数据校验

- quality 必须为对象才展示；非对象/缺失 → 显示占位
- verdict ∈ { pass, warn, fail }，其他值按 fail 显示
- method ∈ { simhash, embedding }，其他值按 simhash 显示
- suggestions 必须为数组，非数组不展示

#### 13.10.5 验收标准

1. 改写成功后质量评估报告展示（充分度/语义保持度/原创性/结论/建议）
2. quality 缺失时显示占位文案
3. zh/en 文案成对（CI Gate 7）
4. RewriteView.test.js 新增 2 用例（质量报告展示 + quality 缺失占位）

---

### 13.11 质量评估口径修正 + 结论文案中性化 + 结果区复制按钮（v1.6，2026-09-16）

> 触发：用户实际反馈——输入「秋天来了」4 字、选题创作模式、输出约 831 字成文，质量报告显示
> 「语义保持度 9.89 / 结论：不合格」，字数栏显示 `{original} 字 → {result} 字`，且结果区无一键复制入口。
> 完整根因追溯与 QM-5 五步反思见 [BUGFIX-REWRITE-QUALITY-UX-2026-09-16.md](./BUGFIX-REWRITE-QUALITY-UX-2026-09-16.md)。

#### 13.11.1 语义保持度：对称 Jaccard → 非对称覆盖率

| 项 | v1.5（旧） | v1.6（新） |
|----|-----------|-----------|
| 公式 | `charJaccard × 70 + keywordOverlap × 30` | `charCoverage × 70 + keywordCoverage × 30` |
| 字符分量 | `|A∩B| / |A∪B|`（对称，被输出长度稀释） | `|A∩B| / |A|`（非对称，对长度增长鲁棒） |
| 关键词分量 | `∩ / max(|kwA|, |kwB|)`（分母被长文放大） | `∩ / |kwA|`（以原文关键词为分母） |
| 语义含义 | 两段文本整体有多像 | **原文内容有多少被结果保留** |
| 事故数值 | 4 字 → 831 字 = **9.89** | 同组文本 = **100** |

新增导出：`charCoverage`、`keywordCoverage`、`normalizeMode`。

#### 13.11.2 新增 `textSimilarity`：独立承担「是否没改够」判据

覆盖率口径下，任何足够长的输出都会包含原文全部字符（实测 4 字 → 831 字覆盖率恒为 100），
因此**不能再以「语义保持度高」判「改动过少」**。新增 `textSimilarity`（对称 Jaccard，0-100）
承担该判据：`similarity > 0.9` → `fail`。若只换口径不分离该判据，会把「没改够」误判扩散到全部长文扩写场景。

#### 13.11.3 模式分档判定（`determineVerdict`）

新增第三参数 `{ mode }`（`'imitate' | 'expand' | 'create'`，缺省 `imitate`），由
`rewrite-engine-core.js` 从 `rewrite(params).mode` 透传。

| 模式 | `fail` 条件 | `warn` 条件 |
|------|------------|------------|
| **任意** | `distance < 3` **或** `similarity > 0.9` | — |
| `create` 选题创作 | 无（除上条） | 语义分 < `band.offTopic` |
| `expand` 扩写 | 语义分 < `band.weak`（原文信息丢失） | `distance ≤ 6`（扩写幅度不足） |
| `imitate` 智能仿写 | 语义分 < `band.weak` | `distance ≤ 6` 或语义分 < `band.moderate` |

**依据**：`create` 模式输入是**主题种子**（常仅几字），输出是据此新写的成文，语义保持度天然偏低属预期；
套用 `imitate` 的「语义保持度 < 30 → 偏离原意 → fail」等价于要求新文章与几个字的主题高度相似，逻辑不成立。

##### 13.11.3.1 语义分标度分组（`SEMANTIC_BANDS`，CCG 评审 W-1 修复）

`semanticPreservation` 在两条评估路径上的**标度不同**，不能共用一组阈值：

| 路径 | 标度 | 关键锚点 |
|------|------|---------|
| `simhash`（覆盖率口径） | `charCoverage×70 + keywordCoverage×30` | 0 = 原文内容完全丢失；100 = 完全保留 |
| `embedding`（余弦映射） | `((cos + 1) / 2) × 100` | **余弦 0（完全无关）→ 50**；-1 → 0；1 → 100 |

**缺陷**：若 embedding 路径套用覆盖率阈值（`<15 / <30 / <50`），"完全无关"的 50 分会越过全部 fail 阈值，
使 embedding 路径几乎恒定 `pass`（`create` 模式下尤其明显）。

**修复**：阈值按标度分组（`SEMANTIC_BANDS`，`determineVerdict` / `buildSuggestions` 均按 `method` 选取）：

| 阈值组 | `offTopic` | `weak` | `moderate` |
|--------|-----------|--------|-----------|
| `simhash` | 15 | 30 | 50 |
| `embedding` | 30 | 45 | 60 |

`embedding` 组整体上移：以余弦 -0.1（≈45）作为"内容大量丢失"分界、余弦 0（50）作为"需注意"起点。
`method` 经 `normalizeMethod` 归一化（非法/缺省/`null` → `simhash`）。

#### 13.11.4 质量报告字段（v1.6）

| 字段 | 类型 | 变化 |
|------|------|------|
| sufficiency | number 0-100 | 不变 |
| semanticPreservation | number 0-100 | **口径变更**（覆盖率） |
| textSimilarity | number 0-100 | **新增**（对称 Jaccard，判"没改够"） |
| originality | number 0-100 | 不变（内部改用 `charJaccard` 变量直接计算） |
| simhashDistance | number | 不变 |
| mode | string | **新增**（实际生效的改写模式，非法值回退 `imitate`） |
| verdict | pass/warn/fail | **判据按 mode 分档** |
| suggestions | string[] | **措辞按 mode 分派**，移除「偏离原意」类负面表述 |
| method | simhash/embedding | 不变 |

#### 13.11.5 结论文案与配色中性化（RewriteView.vue + locales）

| 键 | v1.5 | v1.6（zh / en） |
|----|------|-----------------|
| `rewritePage.qualityVerdictPass` | 合格 | 合格 / `Pass` |
| `rewritePage.qualityVerdictWarn` | 需注意 | 需注意 / `Needs attention` |
| `rewritePage.qualityVerdictFail` | **不合格** / `Failed` | **建议优化** / `Suggestions available` |

配色原则（经设计评审后定稿）：结论文字**保持中性 `--ink`**，颜色信号仅由左侧 3px 强调条承担。

| 选择器 | v1.5 | v1.6 |
|--------|------|------|
| 结论文本 `.quality-metric strong` | `--ink`（#1892 定） | **`--ink`（不上色）** |
| 强调条 `.quality-accent-fail` | `#dc2626` 错误红 | **`#ea580c` 暖橙** |

**为什么结论文本不上色**（设计评审实测依据）：

1. 三态色在 12-13px 小字号下对比度均低于 WCAG AA 4.5:1（pass 3.23:1 / warn 3.02:1 / fail 3.37:1），彩色文字反而降低可读性；
2. 三态中 warn 与 fail 的色相仅差约 12°，小字号下几乎无法区分——颜色信息本就不该由文字承载；
3. 颜色信号已由强调条承担（非文本图形，门槛 3:1，暖橙 `#ea580c` 对白底 3.37:1 达标）。

原则：结论栏只承载"有没有可改进的地方"，不承载"合格/不合格"的判决语义；中性化的是**文案**，颜色中性化体现为强调条去红。

#### 13.11.6 i18n 命名插值根因修复（全仓影响）

`apps/desktop/src/i18n/index.js` 的 `toMessageFunctions` 原把**所有**字符串叶子包成 `() => source`，
丢弃 vue-i18n 传入的插值参数 → 含 `{param}` 的语料在 `t()` 通道原样输出花括号。

修复：含 `{param}` 的字符串编译为命名插值 Message Function（纯正则替换，**不使用 `new Function`**，CSP 安全）；
无占位符的字符串维持常量函数。缺参回退空串，与 `utils/notifyCore.js` 语义对齐。

**影响面**：locales 中 68 条 `{param}` 叶子 / 16 处 `t(key, params)` 调用点一次性恢复，含
`rewritePage.metaLength`（本次事故）、`memberCenter.daysRemaining`、`accountsPage.creatorTabTitle`、
`story2video.sceneMaterial.*`、`knowledgeBase.importResult`、`tagSuggest.hotMatch`、`stageProgress.composeSegments` 等。

**为什么长期未被发现**：`notifyCore.interpolateMessage` 读取的是 locales **原始树**并自行正则插值，
通知通道一直正常 → 形成"`{param}` 可用"的虚假安全感。

#### 13.11.7 结果区复制按钮

- 位置：结果文本框正下方、动作行（存入草稿/视频创作/去发布）之上；**左对齐**（与动作行次按钮对齐——动作行仅主按钮「去发布」用 `margin-left:auto` 推右，右对齐会形成 Z 形错位，设计评审 Q4）
- 新增共享工具 `apps/desktop/src/utils/clipboard.js`：异步 Clipboard API 优先 → 隐藏 textarea + `execCommand` 回退 → 失败返回 `false`（不抛异常）；空串直接拒绝；临时节点 `finally` 清理
- 删除 `useFilmEngineering.js` 的本地重复实现改为复用（全仓共 **9 个**非测试源码文件使用剪贴板 API，已迁移 2 个 → **剩余 7 处**登记为 P1 后续项）
- 交互：成功 toast「已复制到剪贴板」+ 按钮切「✅ 已复制」1.5s；失败 toast「复制失败，请手动选中文本后复制」且**立即复位**；无内容时 warning；组件卸载清计时器
  - 注：toast 与按钮文案切换构成双重反馈，属**有意保留**——toast 同时承担 `notify:log` 上报与无障碍播报，按钮切换承担就地确认
  - `:disabled="!rewriteResult.trim()"` 为防御性写法：结果卡片仅在 `rewriteResult` 为真时渲染，故实际只在纯空白结果时生效
- i18n 新增 zh/en 成对 5 键：`copyResult` / `copyResultDone` / `copySuccess` / `copyFailed` / `copyEmpty`

#### 13.11.7.1 字数概览按模式分派用词（设计评审 Q5）

| 模式 | 文案键 | 渲染示例 |
|------|--------|---------|
| `create` 选题创作 | `rewritePage.metaLengthFromTopic` | `主题 4 字 → 结果 831 字` |
| 其余（含缺 mode 回退） | `rewritePage.metaLength` | `原文 30 字 → 结果 18 字` |

**依据**：选题创作模式的输入是**主题种子**而非待改写正文，标成「原文」会把种子误读为"需保留语义的原文"——这正是 semantic 9.89 误判的同一概念陷阱。`rewriteMeta.mode` 取自 `data.metadata.mode`，缺省回退 `imitate`（向后兼容旧后端）。

#### 13.11.8 验收标准

1. 结果栏字数概览显示「原文 N 字 → 结果 M 字」，界面任何位置不含 `{}`
2. 选题创作「短种子 → 长成文」不再判 `fail`；离题种子判 `warn`
3. 近似重复文本在三种模式下**仍判 `fail`**
4. 结论第三态显示「建议优化」，界面不再出现「不合格」
5. 复制按钮可用且失败时不误显"已复制"
6. `packages/rewrite-engine` **132 例**（基线 102 → +30）、桌面端定向 **90 例**（RewriteView 60 / i18n 17 / clipboard 9 / cohere-design-system 4）全绿
7. i18n 全量插值守卫测试通过（哨兵注入法，覆盖未来新增语料）
8. embedding 路径按独立阈值组判定（余弦 0 → 语义分 50 不再被误判达标）
9. 结论文本保持中性色（对比度达标），三态颜色仅由强调条承载
10. 复制按钮与动作行左对齐；选题创作模式字数概览显示「主题」而非「原文」

#### 13.11.9 已知局限

| 优先级 | 项 |
|--------|----|
| P1 | 另有 **7 处**剪贴板重复实现待迁移（`NavBar.vue` / `TagSuggester.vue` / `usePublishFlow.js` / `Collection.vue` / `FilmEngineeringView.vue` / `PromptEvalView.vue` / `ResultView.vue`）；其中 `NavBar.vue` 无回退分支、`TagSuggester.vue` 与 `usePublishFlow.js` 的回退分支缺 `finally` 清理（`execCommand` 抛异常时临时 textarea 不被移除） |
| P1 | JS↔Python 双评估器无 parity 测试：仓库有两套独立评估器（JS 3 维 SimHash / Python 15 维启发式），Python 侧早已修过同类"短文被长文标准误判"问题（`test_evaluator_shorttext_calibration.py`），JS 侧直到本次才修 |
| P2 | 数字类内容假阴性：纯数字/参数化文本（价格、日期、指标）仅数字改变时覆盖率仍高 → 判 `pass` |
| P2 | Markdown / 标点噪声虚高：标点与结构性符号大量进入 2-gram top-N，抬高分值 → 噪声虚高。需在 `tokenize` 阶段过滤 |
| P2 | `extractKeywords` 走字符 2-gram，未做拉丁词切分 → 英文长文关键词覆盖率偏弱（实测语义保持度 73 vs 中文 100；`charCoverage` 占 70% 已兜住） |
| P2 | **结论区信息层级**（设计评审 Q3）：结论排在 5 项中的第 4 位、视觉权重与单个数字相同；`9.89` / `99.37` 这类**无单位高精度浮点数**对普通内容创作者是"伪精度"（4 字输入上的两位小数无决策价值）；「评估方式：SimHash 指纹」对创作者无意义。建议重构为**主/次/辅助三级**：主=结论（含强调条）、次=改进建议、辅助=三项数值降级为等级或加 tooltip、评估方式下沉或移除 |
| P2 | `create` 模式的 `band.offTopic → warn` 仍是覆盖率/余弦近似，更准确应引入「主题相关性」独立判据 |
| P2 | `distance < 3` 与 `gramSize = 4` 在超短文本（< 10 字）上区分度弱（4 字种子经 `gramSize=4` 只切出 1 个 token，指纹退化） |
| P2 | `scoreSufficiency` 分辨力有限：距离→分数是人为分段线性映射，实测 96% 相似的英文文本充分度仅 60、完全不同文本 100（未作为主判据，故不阻塞） |
| P3 | 无单位浮点数（`9.89` / `99.37`）直接展示给普通内容创作者，信息层级待优化；「评估方式：SimHash 指纹」对普通用户无意义，可下沉为次要信息 |
| P3 | 桌面端 `AIGenerator.getEmbedding()` 未配置 embedding 模型时抛错 → `evaluateAsync` 静默回退 SimHash，用户侧长期显示「SimHash 指纹」 |

#### 13.11.10 CCG 双模型评审记录（2026-09-16）

按质量节拍「M+ 复杂度双模型外部审查」要求，对本次改动并行执行两个独立后端审查：

| 后端 | Critical | Warning | Info | 处置 |
|------|----------|---------|------|------|
| claude | 0 | 3 | 6 | W-1 / W-2 / W-3 已修；Info 已修 4 条，1 条经核实为误报 |
| codex | 0 | 5 | 7 | W-1 / W-5 已修；W-2 / W-3 / W-4 经核实为"预存/误报/风格建议"，登记不改 |

**已修复项**：

| 编号 | 问题 | 修复 |
|------|------|------|
| W-1（claude） | embedding 路径语义分标度与覆盖率共用阈值 → "完全无关"（50 分）越过全部 fail 阈值，embedding 路径几乎恒定 pass | 引入 `SEMANTIC_BANDS` 按 `method` 分组选阈值；新增 5 例回归测试（余弦 0 → warn、余弦 -1 → fail、create 不误报"切题"等） |
| W-2（claude） | 占位符正则提取为模块级带 `g` 标志常量，存在 `lastIndex` 共享状态风险 | 内联到 `replace` 调用点，每次新建正则；新增 2 例连续插值一致性测试 |
| W-3（claude） | `evaluate()` 未向 `buildSuggestions` 传 `method`，与 `evaluateAsync` 不对称 | 显式传 `method: 'simhash'`；新增对照测试（simhash 路径不出 embedding 说明、embedding 路径出） |
| W-1（codex） | `notifyError` 传冗余 `{ fallback: t(...) }`，key 存在时 fallback 永不触发且多一次 i18n 查找 | 简化为 `notifyError('rewritePage.copyFailed')` |
| W-5（codex） | `evaluateBatch` 的 JSDoc `@returns` 缺新字段 | 补齐 `textSimilarity` / `mode` |
| I-1（claude） | `new Set(str)` 按 UTF-16 code unit 建集，BMP 外字符（emoji）被拆成代理对 → 覆盖率/相似度失真 | 新增 `charSet()` 用 `Array.from()` 按码点建集；纯 BMP 文本结果不变（零回归）；新增 2 例 emoji 测试 |
| I（claude/codex） | 剪贴板重复实现数量登记为 4 处，实际为 9 处（剩 7 处） | 修正 `clipboard.js` 头注释与本文档 §13.11.7 / §13.11.9 |
| I-2（codex） | `clipboard.js` 的 `default export` 无消费方 | 移除，仅保留 named export |
| I-3 / I-4（codex） | `textSimilarity` 精度选择无说明；`determineVerdict` / `buildSuggestions` 未标内部 API | 补充精度设计注释；加 `@internal` 标记 |

**经核实未采纳项**：

| 编号 | 原判 | 核实结论 |
|------|------|---------|
| W-4（codex） | `zh.js:2325 photo.metaLength` 被本次改动同步修改但未记录 | **误报**：该行在本次改动前即为 `'原文 {original} 字 → 结果 {result} 字'`，未被本次修改触及（本次仅改 `rewritePage.metaLength`）。已用 `git diff` 核对 |
| W-2（codex） | 同一组件混用 `collection.*` 与 `rewritePage.*` 通知命名空间 | 属实但为**预存风格问题**（改写主流程通知键早于本次变更），迁移需同步评估 `errorCategory` 日志归类影响，登记为后续项，不在本 PR 扩大范围 |
| W-3（codex） | `usePublishFlow.js` 回退分支缺 `finally` 清理 | 属实但为**预存缺陷**，已登记于 §13.11.9 P1（迁移时一并修复） |
| I-6（claude） | `buildSuggestions` 中 `method` 为死代码 | **误报**：`method` 用于输出 embedding 口径说明（该函数的**必要**参数）。恰恰因 `evaluate()` 未传而暴露不对称，已由 W-3 修复 |

#### 13.11.11 设计评审记录（2026-09-16）

由团队「设计顾问」对本次改动做只读设计/文案评审（含实测对比度），结论与处置：

| 编号 | 评审结论 | 处置 |
|------|---------|------|
| Q1 | 文案「建议优化」方向正确，但三态存在**混轴**（合格=评价 / 需注意=提示 / 建议优化=动作）；建议整体改为单轴三档（质量优秀/良好/尚可） | **部分采纳**：本次仅按用户明确诉求做第三态中性化（不合格 → 建议优化）；三态混轴属**更大范围的产品文案统一**，需同期评估 zh/en 与既有测试，登记为后续项 |
| Q2 | 三态色对比度全部低于 WCAG AA 4.5:1（实测 3.23 / 3.02 / 3.37），warn 与 fail 色相差约 12° 难区分 | **采纳**：取消结论文本上色（保持 `--ink`），颜色信号仅由强调条承担（非文本图形 3:1 达标）；强调条失败态由 `#dc2626` 改 `#ea580c` |
| Q3 | 结论区信息过载：结论排第 4 位、无单位浮点数伪精度、评估方式对创作者无意义 | **未采纳（登记 P2）**：#1892 刚重构该区域，本 PR 不重复改动；已给出主/次/辅助三级重构建议并登记 |
| Q4 | 复制行右对齐与左对齐的动作行形成 Z 形错位；toast + 文案切换双重反馈；`:disabled` 近乎死代码；并发现结果卡 `v-if="rewriteResult"` 导致清空文本框整块丢失结果卡 | **部分采纳**：① 已改左对齐；② 双重反馈**有意保留**（toast 兼作 `notify:log` 上报与无障碍播报）；③ `:disabled` 保留为防御性写法；④ 清空文本框丢卡属**预存行为**（非本次引入），登记为 P2 待 UX 决策 |
| Q5 | create 模式下输入是「主题种子」却标为「原文」，是 semantic 9.89 误判的同一概念陷阱 | **采纳**：新增 `metaLengthFromTopic`，create 模式显示「主题 N 字 → 结果 M 字」（§13.11.7.1） |
| 另 | 该组件曾引用 `--surface-secondary` / `--text-primary` / `--text-secondary` 等**未定义令牌**（暗色主题下低可读） | **已由 #1892 一并修复**：核实当前组件使用的 11 个变量在 tokens/design-system 中全部有定义，无需再改 |

**评审价值**：Q2（对比度实测）与 Q5（「原文」用词语义）是本次未自查出的两处真实问题；Q4 的 Z 形错位为真实视觉缺陷。Q3/Q4-④ 已登记，不在本 PR 扩大范围。
