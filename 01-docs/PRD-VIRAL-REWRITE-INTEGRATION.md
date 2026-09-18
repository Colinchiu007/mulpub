# PRD — 爆款分析/文案生成 × 改写引擎/评估机制集成（viral-rewrite-integration）

> 版本：v1.0 ｜ 日期：2026-09-16 ｜ 分支：`viral-rewrite-integration`
> 关联：`01-docs/viral-copy-product-concept.md`（产品概念）、`01-docs/DEEP-ANALYSIS-SENSITIVE-DEDUP.md`（评估算法蓝本）
> 状态：P0 已实现（本 PR）；P1/P2 规划内（见 §9/§10）

---

## 1. 背景与问题

爆款分析页（`/viral-analysis`）与改写引擎（`/rewrite`）此前是两条平行链路：

| 链路 | 现状 | 缺口 |
|---|---|---|
| 爆款分析（ViralAnalysis.vue → orchestrator `/api/viral/*`） | 分析/生成结果一次性展示 | 结果不落库，改写引擎检索不到 |
| 改写引擎（RewriteView → `ai:rewrite` → rewrite-engine 包） | 三层知识库第 2 层已接入爆款库检索 | 生成文案无法一键进改写；质量评估只有防抄袭三维，无爆款维度 |
| 改写质量评估（RewriteQualityEvaluator） | SimHash 充分度 + Jaccard/embedding 语义保持 + 原创性 | 无法回答"改写后是否更有爆款相" |

**目标**：把"分析 → 生成 → 改写 → 评估"闭成一个环，P0 三项打通管道，P1/P2 逐步深化。

## 2. P0 交付范围（本 PR 已实现）

### 2.1 功能 A — 爆款分析结果存入爆款库

**用户流程**：
1. 爆款分析页输入主题 → 点「📊 爆款分析」→ 出结果；
2. 结果概览下方出现操作行：「💾 存入爆款库」按钮 + 说明文字（"将本次分析结果存入爆款库，供改写引擎参考"）；
3. 点击 → 按钮禁用（saving 态）→ 成功后按钮替换为「✅ 已存入爆款库，改写时可被「结合爆款库」检索引用」；
4. 失败时按钮恢复，旁边显示错误消息（`aria-live="polite"`）。

**数据契约（落库条目，经既有 IPC `knowledge-library:add-viral` → `KnowledgeLibraryService.addToViral` → `normalizeViralItem`）**：

| 字段 | 取值 | 校验/归一化（store 层既有逻辑） |
|---|---|---|
| `title` | `analyzedTopic`（分析成功时的主题快照） | 字符串，≤500 字 |
| `content` | 分析报告 Markdown（见 §2.1.1） | **必须非空字符串**（服务端硬校验，空则整条拒绝） |
| `tags` | `[目标平台, 推荐角度…, 上升关键词…]` 去重 | 字符串数组，过滤非字符串/空串，≤50 个 |
| `platform` | 所选目标平台 | ≤50 字 |
| `source` | 固定 `'manual'` | 枚举 `collection\|manual`，其他值归一化为 `manual` |
| `likes` / `comments` | `0` | 非负整数（分析报告不是互动数据，置零防污染排序） |

**状态机**：

```
idle ──分析成功──▶ saved可用（analyzedTopic 已快照）
  │                  ├── 点击保存 ──▶ saving（按钮 disabled）──成功──▶ saved（✅ 态，终态直至下次分析）
  │                  │                        └─失败──▶ idle（错误消息显示，可重试）
  │                  └─ 守卫：result 为空 / result.error / savingLibrary / savedToLibrary / analyzedTopic 空 → 直接 return
  └─ 新分析开始（doAnalyze）──▶ 全部重置（savedToLibrary=false, libraryMessage='', analyzedTopic=''）
```

**analyzedTopic 快照（评审修复 W-4）**：`doAnalyze` 成功时把 `topic.trim()` 快照到 `analyzedTopic`，落库 `title` 与报告内容均取快照——用户分析后修改/清空输入框不会造成 title 与报告失配；快照为空时保存按钮直接跳过。

#### 2.1.1 落库内容（content）格式

i18n 纯静态键 + 模板拼接（项目语料经 `toMessageFunctions` 转静态函数，**不支持 `{param}` 插值**——新增键一律为无占位符短标签）：

```markdown
## 爆款分析报告
主题: <analyzedTopic>
爆款潜力分: <overall_score>/100
趋势方向: <上升中|下降中|平稳>          （仅有 trend_direction 时）
推荐写作角度: <角度1 | 角度2 | …>        （≤6 个，仅有 suggested_angles 时）
上升关键词: <词1 | 词2 | …>             （≤10 个，仅有 rising_keywords 时）
因子分解: <标签: 分数(0-100) | …>        （仅有 factors 时；分数=f.score×100 四舍五入）
目标平台: <platform>
```

该 content 天然可被 `KnowledgeContextBuilder.buildViralContext` 的浅层特征块提取（标题模式/关键词），进入改写 Prompt 的「## 爆款风格参考」段。

### 2.2 功能 B — 生成标题一键去改写（titleHint 链路）

**用户流程**：
1. 爆款分析页点「✨ 生成文案」→ 标题列表每行出现「去改写」按钮；
2. 点击 → 路由跳转 `/rewrite?titleHint=<标题>`（`$router.push({ path, query })`，兼容 SPA hash 路由）；
3. 改写页 `onMounted` 读取 `route.query.titleHint`，`trim` + 200 字截断后存入 `titleHint` ref，内容输入框上方显示可移除 chip：「标题参考：<hint> [移除]」；
4. 用户照常输入/粘贴原文，点「开始改写」→ `aiRewrite` params 携带 `titleHint`（无 chip 时为 `undefined`，JSON 序列化后字段不出现）；
5. 引擎侧把 titleHint 作为**软约束**追加到 userPrompt。

**引擎侧契约（`rewrite-engine-core.js`）**：

```
params.titleHint
  → _sanitizeTitleHint: 非字符串 → null；\s+ 折叠为单空格；trim；空 → null；>200 字符截断
  → _buildPrompt(…, titleHint)：在模板 {placeholder} 替换完成之后追加（防 hint 内 {industry} 等字面量被二次展开）：
    "\n\n## 标题参考（来自爆款文案生成，软约束）\n改写结果的主题方向、关键词与开头钩子应与以下标题保持一致（学习其结构与关键词，不要逐字复制）：\n「<hint>」"
```

- 追加在 userPrompt 尾部，不动 systemPrompt、不动策略模板；
- 与既有策略传参契约（`strategyId: manual?(id||null):null`）正交，不冲突；
- IPC 通道 `ai:rewrite` 为 params 透传，**无新增通道、无 preload 改动、bundle 无需重打包**。

### 2.3 功能 C — 改写质量评估第 4 维：爆款潜力

**评估流程（`rewrite-engine-core.js` rewrite() 第 8.5 步）**：

```
第 8 步质量评估（SimHash/embedding，不变）
        ↓
第 8.5 步：若构造时注入 viralScorer（可选）：
  score(original) 与 score(rewritten) 并行计算
    ├── 任一抛错            → 记 warn 日志，无 result.viral（fail-open）
    ├── score 非有限数       → 不产出 viral
    ├── mode 不一致          → 不产出 viral（量纲不可比，防误导性 delta）
    └── 通过 → result.viral = {
          original:  round(score×10)/10,   // 原文爆款潜力 0-100
          rewritten: round(score×10)/10,   // 改写文爆款潜力 0-100
          delta:     round((新-旧)×10)/10, // 正=更有爆款相
          mode:      'orchestrator' | 'local-fallback'
        }
```

**评分器实现（主进程 `ViralEngine.scoreText`，经 `container.setup.js` 注入）**：

- 优先 orchestrator `/api/viral/analyze`（纯文本因子：标题结构/情感触发/长度窗口；**互动数据置零**——original/rewritten 同口径，delta 才可比）；
- orchestrator 不可用/超时/返回非法 → 回退本地启发式（`_localAnalyze`，mode 标记 `local-fallback`）；
- **独立 8 秒短超时**（`_callApi` 新增可选 `timeoutMs` 参数，默认仍 120s）：被动评分维度不得拖慢改写主流程（评审 W-1）；
- orchestrator 分数做 `Number.isFinite` + `0-100 clamp` 防御（评审 W-3）。

**渲染端展示（RewriteView 质量评估报告区）**：

- 新增一行指标：`爆款潜力：改写前 <original> → 改写后 <rewritten>（变化 <delta>）`，`data-testid="rewrite-viral-info"`；
- delta 为 null（理论上不出现，防御）显示 `-`；
- 引擎未返回 viral（scorer 未注入/失败/跨模式）→ 该行整体不渲染，**原三维报告不受影响**（回归保护测试覆盖）。

**注入链**：`container.setup.js` → `RewriteEngineService.setViralScorer((text) => c.get("viralEngine").scoreText(text))` → `_ensureEngine()` 构造 `RewriteEngine({ viralScorer })`。`setViralScorer` 与其他 setter 一致置 `_engine=null` 触发懒重建。

## 3. 数据校验汇总

| 校验点 | 规则 | 失败行为 |
|---|---|---|
| titleHint（引擎） | 非字符串/空白 → null；>200 截断 | 忽略该约束，改写照常 |
| titleHint（渲染端 onMounted） | 非字符串/trim 空 → 不设 chip；>200 截断 | chip 不出现 |
| titleHint（goRewrite） | 非字符串/trim 空 → 不跳转；>200 截断 | 不跳转 |
| 落库 content | 服务端 `addToViral` 硬校验非空 | 返回 `VALIDATION_ERROR`，前端显示 message |
| 落库 title | analyzedTopic 快照 ≤500 | 空快照 → saveToLibrary 直接跳过 |
| tags | 非字符串/空串过滤，≤50 | 静默过滤 |
| viral score（引擎） | `Number.isFinite` + 两侧 mode 相等 | 无 result.viral |
| viral score（scoreText） | orchestrator 值 `Number.isFinite` + clamp[0,100] | 回退本地启发式 |
| viral 字段（渲染端） | original/rewritten 均为有限数字才展示 | 指标行不渲染 |

## 4. 提示文字（i18n 清单，zh/en 成对）

新增命名空间 `viralAnalysis`：

| 键 | zh | en |
|---|---|---|
| `saveToLibrary` | 存入爆款库 | Save to viral library |
| `savedToLibrary` | 已存入爆款库，改写时可被「结合爆款库」检索引用 | Saved to viral library; retrievable via "Use viral library" when rewriting |
| `saveToLibraryHint` | 将本次分析结果存入爆款库，供改写引擎参考 | Save this analysis to the viral library for the rewrite engine |
| `saveFailed` | 存入爆款库失败 | Failed to save to viral library |
| `goRewrite` | 去改写 | Rewrite |
| `reportTitle` | 爆款分析报告 | Viral analysis report |
| `reportTopic` / `reportScore` / `reportTrend` / `reportAngles` / `reportKeywords` / `reportFactors` / `reportPlatform` | 主题 / 爆款潜力分 / 趋势方向 / 推荐写作角度 / 上升关键词 / 因子分解 / 目标平台 | Topic / Viral potential score / Trend / Suggested angles / Rising keywords / Factors / Target platform |

`rewritePage` 追加：`titleHintLabel`（标题参考）、`titleHintRemove`（移除）、`qualityViralLabel`（爆款潜力）、`qualityViralBefore`（改写前）、`qualityViralAfter`（改写后）、`qualityViralDelta`（变化）。

**约束**：全部为纯静态键；渲染端 `.vue`/`.js` 非 locale 文件零新增 CJK 字面量（CJK 基线门禁 PASS 实测）。

## 5. 测试映射（TDD）

| 用例组 | 文件 | 覆盖 |
|---|---|---|
| V1-V3 | `packages/rewrite-engine/tests/rewrite-engine-core.test.js` | titleHint 注入/截断/非法忽略（含模板替换后追加、无 `{placeholder}` 二次展开） |
| V4-V7 | 同上 | viralScorer 产出/抛错 fail-open/无效值/未注入回归 |
| V8-V9 | 同上（评审修复） | 跨 mode 丢弃、NaN/Infinity 丢弃 |
| ST1-ST6 | `apps/desktop/electron/services/viral-engine.test.js` | scoreText orchestrator 透传/回退/clamp/NaN 回退/空输入 null/8s 超时 |
| A1-A9 | `apps/desktop/src/views/ViralAnalysis.test.js` | 落库条目构建/守卫（无结果/已保存/空快照）/失败消息/异常兜底/doAnalyze 重置/goRewrite 跳转+截断+非法 |
| R1-R5 | `apps/desktop/src/views/RewriteView.test.js` | chip 预填与移除/params 携带/移除后不携带/viral 指标渲染/无 viral 回归 |

实测：rewrite-engine 21/21；ViralAnalysis+RewriteView+viral-engine 75/75；views-coverage2+ai handler+ipc-contract 23/23。

## 6. 交互逻辑细节

- 保存按钮 saving 态 `disabled`，防重复提交；`savedToLibrary` 后按钮消失、✅ 态出现（终态，直到下一次分析重置）；
- `doGenerate` 不重置落库状态（生成标题不影响分析结果的有效性）；
- chip「移除」在 rewriting 期间同样 disabled；
- 错误消息容器 `aria-live="polite"`，失败后可重试（按钮恢复）；
- 路由跳转保留在 home 虚拟标签内的 SPA 导航（`/rewrite` 为 SPA 路由，无 WebContentsView 切换）。

## 7. 兼容性

- 未注入 viralScorer / 无 titleHint 的所有既有调用方行为**逐字节不变**（V7/R5 回归测试锁定）；
- `ai:rewrite` params 新增可选字段，旧前端不发该字段时引擎走 `_sanitizeTitleHint(undefined) → null`，零影响；
- 爆款库检索（`searchViralItems` LIKE 匹配）对新落库条目无需任何适配；
- preload bundle 无改动（零新增 IPC 方法/通道）。

## 8. 已知局限

- 本地启发式评分（orchestrator 不可用时）量纲偏粗（5000 赞满分等经验阈值），`mode` 字段已如实标注 `local-fallback`，前端不区分展示（delta 对比仍同口径有效）；
- 落库条目的 `likes/comments=0` 会在爆款库按互动排序时沉底——设计如此（分析报告不是真实爆款内容），后续可考虑独立"分析报告"来源标记（见 §9-E）；
- titleHint 为 LLM 软约束，无法保证改写结果严格遵循（prompt 注明"学习结构，不要逐字复制"）。

## 9. P1 规划（✅ 已全部交付：#1940 / #1942 / #1947，2026-09-18）

- **✅ D. 模式卡片本地规则预填兜底**（#1940 + #1947 评审加固）：PatternExtractionService 在 LLM 失败 2 次后用本地启发式预填 `pattern_cards`（hook_type 优先级链/尾部 CTA 信号/段落结构启发/title_formula 数字占位符化），卡片不再进 failed 终态；无显著信号字段留空不稀释聚合统计；`hook_analysis` 前缀「（本地规则预填）」+ `last_error` 来源标记可辨。单测 8 例。
- **✅ E. 爆款信号跨页注入**（#1942 + #1947 评审加固）：Pinia store `viral-signal`（会话内存）承接分析成功信号 → `/rewrite?titleHint=` 带入时快照 → `aiRewrite` params 携带 `viralAngles/viralKeywords` → 引擎「## 爆款信号参考（软约束）」段。**实现形态调整**：规划原文为「策略推荐排序」，实际为「信号注入 Prompt」——策略库无 angle 维度可调，注入引导更直接。单测：引擎 E1-E4 + store 3 例 + 集成 3 例。
- **✅ 爆款库来源标记**（#1940）：normalizeViralItem `source` 枚举扩展 `'analysis'`，爆款分析落库带 `source: 'analysis'` 与真实采集区分（列表筛选 UI 留待后续按需）。
- **评审加固**（#1947）：chip 移除同步清信号、信号注入计数标识（signalBadge）、title_formula 单位保留、注入边界加固（控制字符过滤 + 条目「」包裹）。

## 10. P2 规划（跨仓库/数据回流，另立专项——P1 已全部交付，P2 待排期）

- **F. 真实互动数据回流校准**：`rewrite_history` 已持久化（rewriteHistoryId）→ 发布后真实表现回写 → 按 knowledge-evolution 的 `scoreQuality/feedbackBoost` 钩子校准爆款权重与策略推荐——即产品概念文档 Phase 2 的"互动分预测模型（基于历史数据训练）"；
- **G. 消除双实现**：标题结构/情感检测目前 JS（orchestrator 侧 Python 12 种正则）与 Electron 侧浅层正则各一套，统一为单一真源（Node 调 orchestrator，或规则下沉共享包），杜绝漂移。orchestrator 仓库（platform-orchestrator）独立版本管理，需另立 PR。

## 11. 决策记录

| 决策 | 理由 | 备选 |
|---|---|---|
| 落库复用 `addViralToLibrary` 而非新建 viral_analysis 表 | 管道零新增（IPC/服务/存储/检索全现成），content 报告天然可被浅层特征提取 | 新表（拒绝了：需新 IPC + 4 处登记链 + 检索适配，成本不成比例） |
| viral 结果挂 `result.viral` 顶层而非 `quality.viral` | quality 可能为 null（评估器失败），顶层挂载不受影响；渲染端独立归一化 | 挂 quality（拒绝：null 语义纠缠） |
| scoreText 独立 8s 超时 | 被动第 4 维不得阻塞 120s 的改写主流程（评审 W-1） | 复用 analyze 的 120s（拒绝） |
| mode 一致性校验 | orchestrator 与 local 分数量纲不同，跨模式 delta 误导（评审 W-2） | 输出并标注（拒绝：宁可缺省不可误导） |
| 落库 title 用 analyzedTopic 快照 | 防止分析后编辑输入框造成 title/报告失配（评审 W-4） | 实时 topic（拒绝） |
