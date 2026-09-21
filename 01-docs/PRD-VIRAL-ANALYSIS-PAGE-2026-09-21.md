# PRD / 功能规格 — 爆款分析页（Viral Analysis）修复与精致化

- 日期：2026-09-21
- 类型：Bug 修复 + UI 精致化（混合，中等规模，完整质量节拍）
- 分支 / worktree：`viral-analysis-polish` @ `D:\Data\projects\mp-worktrees\mp-viral-analysis-polish`
- 关联页面：`apps/desktop/src/views/ViralAnalysis.vue`（路由 `#/viral-analysis`）
- 关联概念文档：`01-docs/viral-copy-product-concept.md`、`01-docs/PRD-VIRAL-REWRITE-INTEGRATION.md`

---

## 一、背景与问题

用户反馈：爆款分析页「实际功能好像不起作用」，且「页面不够精致」。

### 1.1 根因（CDP e2e 实测确认，非推测）

| # | 层 | 根因 | 实测证据 |
|---|----|------|---------|
| 1 | 鉴权门禁 | `license-access-control.js` 未把 `viral:analyze/generate/trending` 列入 `PUBLIC_CHANNELS`，未登录用户被判需登录，IPC 直接返回 `{code:-3, errorCode:'AUTH_REQUIRED'}` | 修复前 CDP 直调 `viral:analyze` 返回 `code:-3` |
| 2 | 本地兜底被架空 | `ViralEngine` 设计了 orchestrator 不可用时回退本地启发式分析（`_localAnalyze/_localGenerate/_localTrending`，v2.3.43 设计意图＝离线可用），但门禁在到达引擎之前就拦截，兜底永远走不到 | 无登录态下拿不到任何结果 |
| 3 | 渲染层吞错 | `ViralAnalysis.vue` 拿到 `code:-3` 后既不提示也不展示，用户看到「点了没反应」 | 页面静默无反馈 |
| 4 | 生成结果嵌套 | 生成结果 `genResult` 渲染在 `v-if="result"`（分析结果）块内部，只点「生成文案」不点「爆款分析」时生成区根本不挂载 | 单独生成无输出 |
| 5 | 契约不一致 | `_localGenerate` 返回顶层字符串数组（`titles:[string]`），而渲染层读取 `genResult.data.titles`（对象结构），永远取空 | 生成区即使渲染也是空白 |

### 1.2 设计意图澄清

`viral-copy-product-concept.md` 已定义后端 API 契约为 `POST /api/viral/generate → { task, data: { titles|hooks|... } }`。即**生成结果应嵌套在 `data` 下**，`titles` 为对象数组（含 `title`/`structure` 等）。旧 `_localGenerate` 的顶层字符串数组属于实现偏离设计，本次一并纠正对齐。

---

## 二、修复方案

### 2.1 鉴权门禁（`electron/ipc-handlers/license-access-control.js`）

将 `viral:analyze`、`viral:generate`、`viral:trending` 加入 `PUBLIC_CHANNELS`。

- 依据：与 `hot-topics`/aggregation 同属本地内容工具，orchestrator 不可用时由 `ViralEngine` 本地兜底，未登录必须可用。
- `requiredLevelForChannel` 对 PUBLIC 返回 `'public'`，`hasAccess('public')` 恒为 true。

### 2.2 本地兜底契约（`electron/services/viral-engine.js` `_localGenerate`）

返回结构对齐渲染层与设计契约：

```js
// titles 任务
{ success:true, mode:'local-fallback', task:'titles', platform,
  data:{ titles:[ { title:string, structure:string }, ... ] }, summary }
// hooks 任务
{ success:true, mode:'local-fallback', task:'hooks', platform,
  data:{ hooks:[ { hook:string, technique:string }, ... ] }, summary }
```

- `structures` 模板集合（时效+新手友好 / 指南+数字盘点 / 悬念式提问 / 避坑警示 / 入门教程 / 个人经历背书 / 反差制造好奇 / 进阶玩法 / 对比评测 / 精选合集）。

### 2.3 渲染层（`src/views/ViralAnalysis.vue`）

1. **错误可见化**：分析结果 `result.error`、生成结果 `genResult.error` 各渲染一条错误横幅（`data-testid="viral-analyze-error"` / `"viral-generate-error"`），文案走 `formatUserError`（`-3 AUTH_REQUIRED` 等映射为 locale 友好提示），失败不再静默。
2. **生成结果独立渲染**：`genResult` 块从 `v-if="result"` 内移出，独立 `v-if="genResult"`；空状态 `EmptyState` 仅在 `!result && !genResult` 时展示。
3. **doGenerate 补错误分支**：非成功响应时 `genResult = { task, error: formatUserError(res, {fallback}).message }`。
4. **容错方法**：
   - `titleText(t)`：兼容字符串与 `{title}` 对象两种契约，取不到返回空串。
   - `factorPct(f)`：`score>1` 视为百分制直接裁剪到 [0,100]，`≤1` 视为小数比例 ×100；非法值返回 0。
   - `fmtScore(v)`：`Number.toFixed(1)`，非有限值返回 `'-'`。
   - `taskLabel(task)`：titles/hooks/rewrite/structures → locale 任务名，未知回退原值。

---

## 三、页面行为契约（显示项 / 交互 / 提示文字）

### 3.1 输入区

| 控件 | 说明 | 校验 |
|------|------|------|
| 主题 / 关键词 | 文本输入，必填 | 空则不触发分析/生成 |
| 目标平台 | 下拉（通用/抖音/小红书/…） | 有默认「通用」 |
| 手动输入文章数据（可选） | 折叠面板，粘贴真实互动数据提高精度 | 可留空，走纯主题启发式 |
| 「爆款分析」按钮 | 主色实心 | 触发 `viral:analyze` |
| 「生成文案」按钮 | 主色描边（原 danger 红底，精致化改） | 触发 `viral:generate` |

### 3.2 分析结果区（`result`）

- **爆款潜力分**：大号数字 + `/100` 单位（tabular-nums 等宽），配趋势图标与「平稳/上升/下降」标签。
- **本地分析徽章**：`mode==='local-fallback'` 时展示 Cpu 图标 + 「本地分析」，提示结果来自本地启发式引擎。
- **推荐写作角度**：主色标签（`cohere-tag-info`）。
- **存入爆款库**：按钮 + 成功态 `✅` + 提示语，供改写引擎三层知识库检索。
- **因子分解**（`DataLine` 图标）：卡片网格，每卡含因子名、进度条（颜色随分值 `scoreColor`）、分值。
- **平台评分**（`Connection` 图标）：各平台分卡片。
- **推荐标题结构**（`Trophy` 图标）：结构卡 + 期望互动增益。
- **上升关键词**（`Key` 图标）：关键词标签，最多 10 个。

### 3.3 生成结果区（`genResult`，独立渲染）

- 区块标题：`生成结果 · {任务名}`（`MagicStick` 图标）。
- **titles**：编号列表，每行含标题文本、结构/情感标签、预测分、「去改写」按钮（跳转改写并带入标题）。
- **hooks**：钩子文本 + 技法说明。
- 错误时展示错误横幅而非静默。

### 3.4 提示文字（locale `viralAnalysis.*`，zh/en 成对）

| key | zh |
|-----|-----|
| analyzeFailed | 分析失败，请稍后重试，或检查网络与服务状态 |
| generateFailed | 文案生成失败，请稍后重试 |
| localModeBadge | 本地分析 |
| localModeHint | orchestrator 服务不可用，结果来自本地启发式引擎 |
| taskTitles / taskHooks / taskRewrite / taskStructures | 标题生成 / 开场钩子 / 内容改写 / 结构建议 |
| sectionPlatformScores / sectionSuggestedStructures / sectionGenerateResult | 平台评分 / 推荐标题结构 / 生成结果 |

---

## 四、数据校验与边界

- 所有 IPC 返回值以 `code===0 && data.success` 为成功判据，否则进入错误分支。
- `factorPct`/`fmtScore`/`titleText` 对 `null`/非数字/缺字段一律安全降级，不抛错、不显示 `NaN`/`undefined`。
- 字符串与对象双契约兼容（`titleText`），防止 orchestrator 与本地兜底返回结构差异导致空白。
- 区块渲染以「数据存在且非空」为前置（`v-if="result.factors && result.factors.length"`），无数据不占位。

---

## 五、验收标准

1. **功能**：未登录态下，输入主题点「爆款分析」→ 出潜力分+因子；点「生成文案」→ 出标题列表（CDP e2e 实测 `code:0`，本地兜底数据渲染）。✅
2. **错误可见**：任何失败路径展示友好横幅，不再静默。✅
3. **独立渲染**：只点生成（不点分析）也能展示生成结果。✅
4. **契约对齐**：`_localGenerate` 返回 `data.titles[{title,structure}]`，渲染层正确取值。✅
5. **测试**：ViralAnalysis / viral-engine / license-access-control / views-coverage2 / icon-usage 共 104 用例通过。✅
6. **i18n 门禁**：`check-locale-sync --cjk` 与 `--keys` 均 PASS（区块标题去 emoji 后迁入 locale）。✅
7. **视觉**：截图确认分数单位、本地徽章、图标化区块标题、卡片 hover 到位。✅

---

## 六、经验沉淀（Bug 反哺）

- **逃逸链**：单元层未覆盖「未登录 + orchestrator 不可用」组合场景；集成层未断言 viral 通道 PUBLIC；渲染层旧测试反向断言「吞错不提示」被当作预期行为固化。
- **系统性漏洞**：鉴权白名单与本地兜底能力缺乏一致性契约测试（门禁是否架空兜底无人守）。
- **预防措施**：新增 `license-access-control.test.js` viral public 回归；`ViralAnalysis.test.js` 反转吞错断言、新增独立渲染/错误横幅/契约容错用例；契约以概念文档 `data:{...}` 为准绳。详见 `01-docs/learnings.md`。
