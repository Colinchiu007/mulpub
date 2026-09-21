# PRD：爆款分析页能力全量利用 + 本地生成算法优化

| 项 | 内容 |
|---|---|
| 文档编号 | PRD-VIRAL-PAGE-FULL-UTILIZATION-2026-09-21 |
| 日期 | 2026-09-21 |
| 状态 | **已签字**（2026-09-21，CEO 决策记录见 §10，可进入 Phase 1） |
| 关联修复 | #2131 / #2146（爆款页未登录鉴权白名单修复，已合并） |
| 关联子系统 | viral-rewrite-integration、viral_library/模式卡片（PRD-ACTIVATE-VIRAL-LIBRARY-2026-09-13）、publishImpactTracker |

---

## 1. 背景与问题诊断

爆款分析页（`apps/desktop/src/views/ViralAnalysis.vue`）定位为"AI 驱动的内容爆款因子分析 + 文案生成"，但实际只接入了 ViralEngine 的一小部分能力，且本地兜底算法产出质量不稳定。以下诊断全部基于 origin/main（50d98da60）代码取证：

| # | 问题 | 证据 |
|---|------|------|
| D1 | 云端路径事实上不可达：`ORCHESTRATOR_BASE = process.env.ORCHESTRATOR_URL \|\| ''`，且本地 python-backend **不存在** `/api/viral/{analyze,generate,trending}` 任何路由，三入口恒走本地兜底 | `viral-engine.js:21`；`packages/python-backend` 全量 grep 无 `/api/viral` |
| D2 | generate 支持 4 个 task（titles/hooks/rewrite/structures），页面写死 `task:'titles'`；hooks/rewrite/structures 三块结果面板是不可达死代码 | `ViralAnalysis.vue:326`、模板 196-221 行 |
| D3 | 本地 analyze 仅返回 `overall_score/trend_direction/suggested_angles/factors/summary/sample_size`，"平台对比 / 推荐结构 / 上升关键词"三块在本地模式恒空白 | `viral-engine.js:210-218`（_localAnalyze） |
| D4 | `viralTrending`（IPC + 引擎 + 本地兜底 `_localTrending` 齐备）渲染端零调用 | 仅 `api/publisher.js:201` 定义，src 无使用点 |
| D5 | 效果闭环断链：`patternExtractionService`（模式卡片提取）、`publishImpactTracker`（发布表现回采）已在 electron 容器注册并被发布事件喂养，但爆款分析页不读不展示任何闭环产物；页面只写库（`addViralToLibrary`），从不回读（`listViralItems/searchViralItems` 无调用） | `container.setup.js:231-234`、`phase4-events.js:57` |
| D6 | 单条生成结果的 `predicted_score/emotion/reasoning` 占位仅在 orchestrator 形态存在，本地形态恒缺失，UI 留白 | `viral-engine.js` _localGenerate 产出 `{title, structure}` |
| T1 | 本地标题模板为 10 条手写硬编码常量（自文件创建提交起未改动），`i % 10` 轮换，count=5 时永远命中前 5 条，同 topic 产出高度雷同 | `viral-engine.js:231-242` |
| T2 | `_extractKeywordsLocal` 用 2-4 字滑窗 + 停用词，易切出碎词，填槽后语义漂移 | `viral-engine.js` _extractKeywordsLocal |
| T3 | 非中文/短 topic 命中 `${kw0}` 回退时产出缺主语残句（如"这3个信号你中了几个？"） | `viral-engine.js:255-258` |
| T4 | 标题 `structure` 标注为查表硬配，与文案真实结构无关 | _localGenerate structures 数组 |

**一句话需求**：把爆款分析页从"两个按钮 + 一条直线"升级为 ViralEngine 全能力的统一入口（发现→诊断→生成→打分→存库→去改写），并把本地兜底算法从"固定句式填空"优化为"可复用、分平台、数据可反哺"的起稿器。

## 2. 需求澄清

- **目标用户**：内容运营/自媒体创作者（已登录与未登录游客均是用户，未登录必须可用——延续 #2146 的公开通道合同）。
- **核心痛点**：
  1. 用户感知"功能没反应/内容空白/生成雷同"，页面价值远低于引擎实际能力；
  2. 本地模式下大量 UI 区块恒空白，形成"半成品"观感；
  3. 已建成的"发布→回采→归因→模式卡片"闭环没有前端出口，数据资产沉睡。
- **不做的代价**：爆款引擎继续被低估，viral_library 闭环建设投入无法兑现为用户价值。
- **成功标准（可量化）**：
  - S1 页面可达的 generate task 从 1 个提升到 ≥2 个（titles + hooks），死代码面板清零（可达或移除）；
  - S2 本地模式下"上升关键词 / 推荐结构"两块渲染率 100%（当前 0%）;
  - S3 同一 topic 生成 5 条标题：去重后仍为 5 条（互异性），且分平台模板分桶生效（平台不同→产出不同）；
  - S4 trending 能力在爆款页有 UI 出口且点击可回填主题（端到端可用）；
  - S5 效果闭环至少一个可视化出口（模式卡片命中展示或实测表现展示）；
  - S6 未登录游客全流程（分析/生成/热门回填）无 AUTH_REQUIRED 报错（守住 #2146 合同）。
- **约束条件**：
  - 技术栈：Vue3 + Element Plus 渲染端 / electron IPC 服务层，不新增运行时第三方依赖（分词复用 `packages/rewrite-engine/src/keyword-extractor.js`）；
  - 本期**不实现** orchestrator 服务端路由（见 Out of Scope）；
  - 所有新增用户可见文案 zh/en 成对写入 locales（CI Gate 7 拦截）；
  - 涉前端 UI 变更：走 /plan-design-review + 视觉回归基线；
  - 运行时代码变更走 worktree 隔离（start-mp-task），TDD。
- **不做清单**：见 §8。

## 3. 方案对比

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A：本地全量化 + 闭环接入（推荐）** | 盘活 ViralEngine 本地已有能力（hooks/trending/scoreText/字段补齐），接入模式卡片与表现回采的读取展示；本地模板算法工程化升级 | 零 LLM 成本、离线可用、改动集中在 2 个文件 + locales、无新依赖 | 本地启发式天花板仍在（长文 rewrite 类做不了） |
| B：云端优先 | 先在 python-backend 补 /api/viral/* 三路由接 LLM，页面直接吃重任务 | 产出质量上限高 | 引入 LLM 成本与账户依赖；未登录游客付费路径未定义；属独立商业决策；周期长 |
| A+B 分期 | 本期 A，P2 单独立项做 B | — | 需冻结接口形态避免二次改 UI |

**决策**：本期执行方案 A。UI 上通过 `mode` 徽标如实标示"本地算法"，为 B 预留 task 枚举扩展位（`hooks/rewrite/structures` 的 IPC opts 契约不变，B 落地时仅去掉禁用态）。

## 4. 功能规格（Feature 详情）

### F1【P0】生成 task 选择器（标题 / Hook）

- **交互**：【生成文案】按钮左侧加分段控件（el-radio-group 风格按钮），选项"标题 / Hook"，默认"标题"。切换 task 不自动触发生成，需再点按钮。
- `doGenerate` 按所选 task 传参（`task: 'titles' | 'hooks'`），结果面板按 `genResult.task` 渲染（Hook 面板已存在于模板，改活代码路径即可）。
- rewrite/structures 不出现在选择器中（本地不可产出，见 §8 Out of Scope）。
- **错误状态**：生成失败 → 现有 `viral-error-banner` 横幅（formatUserError 友好文案），不新增形态。
- **AC**：
  - AC1.1 选 Hook 点生成 → 渲染 ≥4 条 Hook 卡片（本地 _localGenerate hooks 分支）；
  - AC1.2 task 切换后旧 genResult 清空，不残留上一形态结果；
  - AC1.3 未登录全程可用（回归 #2146 场景）。

### F2【P0】本地 analyze 字段补齐（上升关键词 / 推荐结构 / 平台分）

- `_localAnalyze` 返回增补：
  - `rising_keywords`：复用 rewrite-engine `extractSync` 从样本标题提取，产出 `[{word}]`（与渲染端 `.word` 取值合同一致，`ViralAnalysis.vue:155`）；
  - `suggested_structures`：从固定结构池（盘点式/悬念式/对比式/清单式/故事式）按 factors 得分最高因子映射 2-3 条 `{structure, expected_lift}`；expected_lift 本地模式标注为估算值；
  - `platform_scores`：以 overall_score 为基准按平台风格系数微调（0.85–1.05），如实展示"本地估算"。
- **AC**：AC2.1 本地模式三块新区块渲染率 100%（S2）；AC2.2 字段类型与既有模板取值合同一致（object 带 `.word`、array of object）；AC2.3 orchestrator 形态（若未来返回同名字段）直接透传不被本地覆盖。

### F3【P0】trending 接入：热门选题速选

- **位置**：空状态（EmptyState）下方 + 输入区"热门选题"折叠行，两者共用一个 `TrendingQuickPick` 区块。
- 调用既有 `viralTrending(articles)`（`publisher.js:201`，走 `_localTrending`），渲染选题词卡片列表；点击卡片 → 回填 `topic` 输入框（不自动分析）。
- 未登录可用（trending 已在 PUBLIC_CHANNELS 白名单）。
- **错误状态**：trending 失败/空返回 → 区块整体隐藏，不报错打扰主流程（渐进增强）。
- **AC**：AC3.1 有数据时点击回填成功且按钮可用态刷新；AC3.2 失败时静默隐藏（console 留痕）；AC3.3 不新增 IPC 通道。

### F4【P0】本地 scoreText 逐条打分排序（predicted_score 真实化）

- `_localGenerate` titles 分支产出的每条标题，由 handler 层调用 `_localAnalyze` 同源启发式（或直接 `scoreText(title)`）计算 `predicted_score`（0-100 整数），按分降序排列后再返回；产出补 `emotion` 标签（由模板元数据表驱动，模板条目扩展 `{tpl, structure, emotion}`）。
- **AC**：AC4.1 本地生成结果每条含 `predicted_score`，UI"预测分"不再空缺（D6 关闭）；AC4.2 列表按分数降序；AC4.3 打分失败不阻断生成（fail-open，缺分不排序错位）。

### F5【P0】本地模板算法工程化优化（详规格见 §5）

### F6【P1】模式卡片命中展示与套用

- 分析结果区新增"命中的历史爆款模式"卡片区：读取 patternExtractionService 产出的 `viral_pattern_cards`（经既有 IPC/服务接口，若渲染端无只读通道则新增 `viralPatternList` 一个查询通道，属本期唯一允许新增的 IPC），按 topic 关键词匹配展示 top3（模式名、样本量、平均提升）。
- "套用"按钮：将模式的结构标签注入生成 task（titles 按 structure 过滤模板桶）。
- **依赖**：viral_library 内已有实测归因数据（冷启动为空 → 区块隐藏）。
- **AC**：AC6.1 无卡片数据时区块不出现；AC6.2 套使用后生成结果 structure 字段与所选模式一致。

### F7【P1】爆款库回读：从库中选参考

- 输入区增加"从爆款库选"入口（el-dialog + `searchViralItems`/`listViralItems` 既有 IPC），选中条目以其标题回填 topic，并在分析时作为附加样本进入 articles 数组。
- **AC**：AC7.1 空库时对话框给引导空态；AC7.2 选中回填后 doAnalyze 的 articles 含该条目。

### F8【P1】发布表现回采可视化

- 生成标题卡片增加"实测"角标：若 `publishImpactTracker` 中存在与该 topic/标题关联的历史发布记录，展示实测互动 vs 预测分对照（数据经 F6 的查询通道一并返回或新增只读字段，不新增第二条通道）。
- 无记录时不显示（不制造空态）。
- **AC**：AC8.1 有回采数据时对照展示；AC8.2 无数据零开销隐藏。

### F9【P0】本地/云端模式标识透明化

- 生成结果区补 `mode` 徽标（与分析区 `viral-mode-badge` 同款），本地兜底显示"本地算法"；tooltip 说明能力边界（长文改写请前往改写页/AI 服务）。
- **AC**：AC9.1 local-fallback 时徽标可见；AC9.2 徽标文案入 locales zh/en 成对。

## 5. 本地模板优化规格（F5 详单）

定位声明：**本地模板是"离线可用的标题/Hook 灵感起稿器"，不是内容生成器**。禁止用更多模板伪装 LLM 长文能力。

| # | 优化项 | 规格 | 优先级 |
|---|--------|------|--------|
| T-1 | 模板桶重构 | 模板由扁平数组改为 `{tpl, structure, emotion, platforms[]}` 对象表；按 `platform` 参数分桶（小红书偏数字/emoji、公众号偏悬念长句、通用兜底全桶），"通用"不再等于"随机前 N" | P0 |
| T-2 | 互异性采样 | 候选生成量 = count×3，按编辑距离去重后取 top count（配合 F4 打分排序）；解决 `i % 10` 恒命中前 5 条（S3 的依据） | P0 |
| T-3 | 关键词升级 | `_extractKeywordsLocal` 替换为复用 `keyword-extractor.js#extractSync`（rewrite-engine 既有、零新依赖）；viral-engine 侧保留原滑窗函数仅作降级路径 | P0 |
| T-4 | 填槽清洗与残句防御 | `${kw}` 填充前清洗（长度≥2、不含标点边界、非纯停用词）；清洗失败时使用含 topic 占位的中性句式兜底，**禁止输出缺主语残句**（T3 关闭） | P0 |
| T-5 | 结构标注真实化 | structure 由模板元数据表驱动（与 F4 的 emotion 同一张表），不再是 index 查表硬配 | P0 |
| T-6 | 数据反哺（闭环钩子） | 模板桶权重读取 `viral_pattern_cards` 中实测高表现 structure 类型（有高表现结构 → 该桶优先采样）。冷启动无数据时退化为均匀采样 | P1（依赖 F6 通道） |

**明确不做**：不新增手写模板数量堆砌（10 条够用，问题在采样与填槽不在数量）；不做本地长文 rewrite。

## 6. 错误状态总表（分析页全页）

| 状态 | 触发 | 呈现 |
|------|------|------|
| 空 | 初始进入 | EmptyState + 热门选题速选（F3，有数据才出现） |
| 载 | analyze/generate 进行中 | 现有 UiSkeleton；按钮 disabled |
| 错 | IPC 非 0 / 异常 | 现有 error-banner（formatUserError），分析/生成两区独立不互吞 |
| 边 | trending 失败 | 区块静默隐藏（F3） |
| 边 | topic 清洗后为空 | 生成按钮 disabled（现有 `!topic.trim()` 合同延伸到清洗后） |
| 边 | 模式卡片/回采无数据 | 对应区块隐藏，不出现空壳 |
| 边 | 未登录 | 全流程可用（白名单），无 -3 报错（#2146 回归位） |

## 7. 非功能需求

- **N1 i18n**：新增文案全部走 `locales/zh.js`+`en.js` 成对提交（CI Gate 7）；渲染端非 locales 文件不得新增中文字符串字面量（基线扫描）。分段控件、徽标、对话框标题均需双语键。
- **N2 性能**：trending/打分均为本地同步或短耗时路径，生成 5 条含打分总耗时 < 300ms；trending 区块懒加载不拖首屏。
- **N3 离线**：F1-F5、F9 全部离线可用；F6-F8 无数据时零呈现。
- **N4 鉴权**：不改动 PUBLIC_CHANNELS 白名单（viral:analyze/generate/trending 已在）；新增查询通道 `viralPatternList` **不入白名单**（Q1 已决：游客不展示闭环区块），实现时按登录态门控渲染。
- **N5 IPC 序列化**：所有经 `viralGenerate` 传参保持纯 JSON（Vue proxy 须 `JSON.parse(JSON.stringify())` 脱壳，遵守 QM-1 检查项）。

## 8. Out of Scope（本期不做）

1. ~~python-backend 补 `/api/viral/*` 路由 / 接 LLM~~ → 独立立项（方案 B），需先回答未登录游客付费与配额策略。
2. rewrite / structures 两种 task 的前端可达路径（依赖 1）。
3. 爆款库页面（文案库/采集库）自身的重构——F7 只在爆款页开只读入口。
4. `_localAnalyze` 启发式评分模型本身的算法升级（因子权重学习等）。
5. 自动写入/导出飞书（exportViralToFeishu 已有，不在本期动）。

## 9. Feature List 汇总（依赖与规模）

| ID | 功能 | 优先级 | 预估 | 依赖 | 涉及文件 |
|----|------|--------|------|------|----------|
| F1 | task 选择器（标题/Hook） | P0 | 2h | — | ViralAnalysis.vue, locales |
| F2 | 本地 analyze 字段补齐 | P0 | 3h | T-3（分词） | viral-engine.js, 单测 |
| F3 | 热门选题速选 | P0 | 3h | — | ViralAnalysis.vue（或 TrendingQuickPick 子组件）, locales |
| F4 | predicted_score 打分排序 | P0 | 2h | F5-T-5 | viral-engine.js |
| F5 | 模板工程化（T-1~T-5） | P0 | 4h | — | viral-engine.js, 单测 |
| F9 | 模式徽标透明化 | P0 | 1h | — | ViralAnalysis.vue, locales |
| F6 | 模式卡片展示/套用 | P1 | 4h | 只读通道确认 | ViralAnalysis.vue, phase5-ipc/preload |
| F7 | 爆款库回读 | P1 | 3h | — | ViralAnalysis.vue, locales |
| F8 | 表现回采可视化 | P1 | 2h | F6 | ViralAnalysis.vue |
| T-6 | 模板数据反哺 | P1 | 2h | F6 | viral-engine.js |

P0 合计 ≈15h，P1 合计 ≈15h；P0 改动集中 `ViralAnalysis.vue` + `viral-engine.js` + locales，无新 IPC；P1 可能新增 1 条只读 IPC（F6）。

## 10. 决策记录（2026-09-21 CEO 签字）

| # | 决策 | 结论 | 对规格的落点 |
|---|------|------|--------------|
| Q1 | F6 新增只读 IPC `viralPatternList` | **放行**。该通道**不入** PUBLIC_CHANNELS 白名单——闭环区块仅登录态可见，游客隐藏（维持 N4 收紧面） | F6 依赖项关闭；N4 按默认执行 |
| Q2 | 本地模式"平台对比"呈现 | **展示估算值 + "本地估算"标注**（文档默认方案） | F2 platform_scores 规格生效，UI 需在平台对比区块带估算角标（文案入 locales 成对） |
| Q3 | P0 / P1 交付方式 | **拆两个 PR，P0 先行**：PR-1 = F1/F2/F3/F4/F5/F9（零新 IPC）；PR-2 = F6/F7/F8/T-6（含 viralPatternList 通道） | §9 Feature List 按此分组；PR-1 合并后再启动 PR-2 |

**后续流程**：Phase 1.1 /plan-eng-review（PR-1 架构评审）→ Phase 1.2 /plan-design-review（UI 变更）→ worktree 建支（start-mp-task）→ TDD 实施。

---

## 11. Test Plan（质量节拍 Phase 1→2）

### 11.1 策略

- TDD：`viral-engine.js` 所有逻辑改动（F2/F4/F5/T-6）先写单测红再实现绿；Vue 层用组件测试 + CDP E2E 双保险。
- 分层：单元（引擎逻辑）→ IPC 合同（handler 返回形态）→ 组件（渲染分支）→ E2E（CDP 真实 Electron）→ 视觉回归（基线截图）→ CI 门禁（locale 成对/中文字面量）。
- 回归防逃逸重点：**#2146 未登录场景必须作为固定回归位**（历史上正是该场景静默失败逃逸了所有测试层）。

### 11.2 范围矩阵

| 层 | 覆盖 | 不覆盖 |
|----|------|--------|
| 单元 | _localAnalyze 新字段、_localGenerate 采样/去重/分桶/清洗、predicted_score 排序与 fail-open | orchestrator 网络路径（不存在，桩测除外） |
| IPC 合同 | viral:generate/viral:analyze 返回 JSON 形态与既有渲染合同（.word/.title/structure）字段兼容；纯 JSON 可序列化 | 打包态（属 QM-1 单独验证） |
| 组件 | task 切换清空、面板条件渲染、徽标可见性、trending 回填、错误横幅 | 全站样式 |
| E2E (CDP) | 未登录：输入主题→生成（标题/Hook 两 task）→结果渲染；热门选题点击回填；生成结果含预测分 | 登录付费链路（本期无） |
| 视觉回归 | 爆款页默认态、分析结果态、生成结果态、含新徽标/选择器态 4 组基线 | 其他页面 |
| 门禁 | Gate 7 locale zh/en 成对；src 中文字面量扫描 | — |

### 11.3 场景清单（关键用例）

**单元 — viral-engine**
1. UT-1 titles：同 topic+通用平台 生成 5 条 → 互异（编辑距离>阈值）且每条含 `{title, structure, emotion, predicted_score}`（S3/AC4.1）。
2. UT-2 分桶：同 topic 分别传"小红书/公众号/通用" → 产出集合不完全相同（S3）。
3. UT-3 清洗负例：topic 为英文/数字/标点串/空白 → 不输出缺主语残句，`${kw}` 槽位有 topic 兜底（T-4/AC 关闭 T3）。
4. UT-4 打分 fail-open：mock scoreText 抛错 → 生成仍返回 code:0，predicted_score 缺失但条数与顺序稳定（AC4.3）。
5. UT-5 _localAnalyze 新字段：rising_keywords 为 `[{word}]`、suggested_structures 为 `[{structure, expected_lift}]`、platform_scores 为 object（AC2.2 合同）。
6. UT-6 分词降级：extractSync 抛错时回落滑窗实现，不崩溃（T-3）。
7. UT-7 hooks 分支：task:'hooks' 本地返回 ≥4 条 `{hook, technique}`（支撑 F1 端到端）。
8. UT-8（P1）T-6 反哺：注入高表现 structure 卡片数据 → 该桶采样权重提升；空数据 → 均匀采样（AC6/冷启动）。

**IPC 合同**
9. IC-1 经真实 handler（含 withSenderCheck）调用 viral:generate → 返回 `{code:0, data}`，data 可 `JSON.stringify` 往返无异常（N5）。
10. IC-2 reactive proxy 入参（模拟 Vue 对象）→ 不出现 "An object could not be cloned"（QM-1 检查项固化）。

**组件测试**
11. CT-1 task 选择器切换 → genResult 置 null，旧面板消失（AC1.2）。
12. CT-2 trending mock 失败 → TrendingQuickPick 不渲染、无错误横幅（AC3.2）。
13. CT-3 本地结果渲染：mode 徽标可见、预测分可见（AC9.1/AC4.1）。

**E2E（CDP，真实未登录实例）**
14. E2E-1 未登录（identity signed_out）→ 输入主题 → 生成文案（标题）→ ≥3 条标题卡片含预测分，无 AUTH_REQUIRED/-3（S6/S1）。
15. E2E-2 切换 Hook → 生成 → Hook 卡片渲染（AC1.1）。
16. E2E-3 点击热门选题 → 主题回填 → 爆款分析 → 概览分与上升关键词区块渲染（S2/S4）。
17. E2E-4 分析后"存入爆款库" → ✅ 态出现（既有链路回归，防 F 系列改动破坏）。

**视觉回归**
18. VR-1 四态基线（§11.2）在正确工作目录生成并入库，CI 像素守卫跑通（防"行号敏感基线在错误工作目录生成"既往坑）。

### 11.4 Bug 反哺预留

E2E-1 同时登记为"未登录爆款链路"回归保护位——对应逃逸链教训：静默早退（空 topic / -3 鉴权）必须可见化（error-banner 或 disabled 态），任何"点击无反应"类 Bug 的回归测试必须打在 UI 闭环层而非仅 IPC 层。

### 11.5 门禁与完成定义（DoD）

- [ ] 上述 P0 用例全绿；CI（lint/单测/Gate 7/视觉）通过后才可合并（禁止 auto-merge 提前合并，走 CI-gated PR 流程）；
- [ ] 修改 electron/services 后执行 QM-1 打包验证；
- [ ] 成功标准 S1-S6 逐项可复核（S2/S3 由 UT/VR 证据，S4/S6 由 E2E 截图证据）；
- [ ] locales 成对、无新增中文字面量违规；
- [ ] 文档同步：本 PRD 状态更新为"已实现"，CHANGELOG 收录。

---

## 12. PR-2 实现详解（F6/F7/F8/T-6，零新增 IPC）

> 本节为已实现代码的落地说明书，逐条对齐数据校验、流程、功能逻辑、交互逻辑、显示项与提示文字，供后续维护与验收复核。PR-2 相比规划收紧的一点：**未新增 `viralPatternList` 通道**，F6/F8 全部复用既有 IPC（`performance:list-pattern-performance`、`impact:get-recent-snapshots`、`knowledge-library:list-viral-items`/`search-viral-items`），故 §10-Q1 的白名单决策在实现期不再需要触达。

### 12.1 F6 我的模式命中（结构套用）

- **数据来源**：渲染端 `listPatternPerformance({ dimension: 'narrative_structure', pageSize: 10 })`（既有 IPC，`knowledge-library.js` 导出），store 侧已按 `engagement_score DESC` 排序。
- **数据校验/过滤**：`res.code === 0` 且 `res.data.items` 为数组才处理；逐条 `filter` 掉 `value` 为空的卡片；`slice(0, 3)` 取 TOP3；`sampleCount = Number(item.sample_count) || 0`。任一校验失败或抛错 → `patternHits = []`（区块整体隐藏，fail-open）。
- **显示项**：分析区上方「我的模式命中」区块，每张卡片显示 `patternLabel(value) · {n} 篇样本`。`patternLabel` 经 `$t('viralAnalysis.narrative.' + value)` 映射，六枚举与引擎 `NARRATIVE_LABELS` 语义一一对应：list=数字盘点 / contrast=对比评测 / problem_solution=避坑警示 / story_lesson=个人经历背书 / total_subtotal=深度长文 / chronological=入门教程。
- **交互逻辑**：点击卡片 = 套用该结构（`applyPattern`）；再次点击同一卡片 = 取消（`appliedStructure=null`）；已套用态显示「已套用：X」+「取消」按钮。套用的枚举值经 `doGenerate` 的 `opts.structure` 传给引擎（**传叙事枚举 `'list'`，非本地化标签**）。
- **提示文字**：区块说明 `patternHitHint`、套用按钮 title `applyPatternHint`。
- **冷启动/未登录**：无卡片或 code≠0 → 区块不渲染（AC6.1），零空壳。
- **TestIDs**：`viral-pattern-hits`、`viral-pattern-hit`、`viral-applied-pattern`、`viral-cancel-pattern`。

### 12.2 F7 从爆款库选择（回读）

- **入口**：输入区「从爆款库选择」按钮（`viral-lib-open`），带 `pickFromLibraryHint`。
- **对话框**：自绘 fixed overlay modal（非 el-dialog，规避 teleport 到 body 导致组件测试 `find` 不可见），`role="dialog"`，遮罩 `@click.self` 关闭，`v-if="showLibraryDialog"` 控制渲染。
- **列表加载**：打开时 `listViralItems({ page: 1, pageSize: 30 })`；失败/非 0 → 空列表（走空态），不报错打断。
- **搜索**：`searchLibrary()` 仅当 `libQuery.trim()` 非空才调 `searchViralItems(query, 30)`；回车或点「搜索」触发；`libLoading` 期间禁用；返回非法（非 code0 或非数组）时**不破坏**已展示列表。
- **数据校验/回填**：`pickLibraryItem(item)` 取 `item.title.trim()`，空标题直接 return；否则 `topic = title`；把该条目追加进 `articleData` JSON 数组：`{ title, like_count: Number(item.likes)||0, comment_count: Number(item.comments)||0, platform_code: item.platform||'general' }`；原 `articleData` 非法 JSON 时**整体覆盖**（残句不如丢残句）；随后 `JSON.stringify(articles, null, 2)` 写回。
- **显示项**：每条 `item.title` + 元信息行 `{platform} · 👍{likes} · 💬{comments}`（👍💬 属允许的内容类 emoji，非功能图标）。空态 `libraryEmpty` + `libraryEmptyHint` 引导。
- **联动**：回填后分析/生成三源（topic、articleData）自动生效，无需额外按钮。
- **TestIDs**：`viral-lib-dialog`、`viral-lib-search-input`、`viral-lib-loading`、`viral-lib-item`、`viral-lib-empty`。

### 12.3 F8 发布表现实测角标

- **数据来源**：`getRecentImpactSnapshots()`（新增渲染层 API + preload 绑定，底层复用既有主进程 handler `impact:get-recent-snapshots`，`publish-impact-tracker.js` 返回 `impact_snapshots` 表近 20 行，含 `title/top_engagement/total_mentions`）。**零新增 IPC 通道**。
- **暴露面**：`preload/publish.js` 增 `getRecentImpactSnapshots: () => ipcRenderer.invoke('impact:get-recent-snapshots')`；`api/publisher.js` 增 `invokeWithFallback("getRecentImpactSnapshots", { code: -1, data: [] })`。preload 计数基线 publish 116→117、api 总键 315→316。
- **数据校验**：`res.code === 0` 且 `res.data` 为数组才建索引；以 `row.title.trim()` 为 key 去重（后到覆盖先到），值 `{ topEngagement, totalMentions }`；抛错/未登录（fallback code -1）→ `measuredMap` 保持空。
- **显示项**：仅当生成标题在 `measuredMap` 命中（`measuredInfo(titleText(t))` 非 null）时，标题卡片右上角显示「实测 {fmtScore}」角标（`viral-measured-badge`），无 emoji 功能图标（避开 icon-usage 守卫的 📈 禁用）。
- **交互/边界**：纯展示只读，无点击；未登录或无回采数据 → 零渲染、零开销（AC8.2）。

### 12.4 T-6 结构数据反哺 boost（引擎）

- **聚合**：`_patternStructureCounts()` 从注入的模式卡片样本聚合 `{ 结构标签: 样本数 }`。
- **排序主键**：titles 候选排序键 `(countB - countA) || (scoreB - scoreA) || (idxA - idxB)`——样本数（反哺权重）优先，其次本地预测分，最后原始稳定序。
- **冷启动等价**：`counts` 为空时，boost 全 0，排序退化为 `(scoreB-scoreA) || (idxA-idxB)`，与 PR-1 基线**逐位一致**（回归保证）。
- **显式过滤互斥**：当调用方经 F6 显式传入 `structure` 过滤时，**跳过 boost**（用户已指定结构，不再叠加反哺权重）。
- **fail-open**：聚合与注入全链异常安全，任何一步失败退化为无 boost 排序，不阻断生成。

### 12.5 locales（zh/en 成对，27 键）

sectionPatternHits / patternHitHint / applyPatternHint / patternSample(`{n}`) / appliedPattern / cancelPattern / pickFromLibrary / pickFromLibraryHint / libraryDialogTitle / librarySearchPlaceholder / librarySearch / libraryLoading / libraryEmpty / libraryEmptyHint / closeDialog / measuredBadge / measuredBadgeHint / narrative.{list,contrast,problem_solution,story_lesson,total_subtotal,chronological}。`patternSample` 用 `{n}` 插值（与项目既有 15 处插值键一致）。

### 12.6 验收复核（PR-2 相关 S/AC）

- S5 效果闭环可视化出口：F6（模式命中）+ F8（实测角标）双出口 ✅
- AC6.1 无卡片区块隐藏 ✅ / AC6.2 套用后生成 structure 与所选一致 ✅
- AC7.1 空库引导空态 ✅ / AC7.2 选中回填 articles 含该条目 ✅
- AC8.1 有回采对照展示 ✅ / AC8.2 无数据零开销隐藏 ✅
- T-6 冷启动逐位一致 + 显式过滤跳 boost ✅（UT-8）
