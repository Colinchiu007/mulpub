## Why

爆款分析页与改写引擎是两条平行链路：分析/生成结果一次性展示不落库，改写引擎的爆款库检索拿不到它们；改写质量评估只有防抄袭三维（充分度/语义保持/原创性），无法衡量"改写后是否更有爆款相"。用户要在两个页面间手动复制粘贴，闭环断裂。

## What Changes

- **分析结果落库**：爆款分析成功后可一键经既有 `knowledge-library:add-viral` IPC 存入爆款库（title=analyzedTopic 快照、content=分析报告 Markdown、tags=平台+角度+关键词去重、source='manual'、likes/comments=0），使改写引擎「结合爆款库」可检索。
- **生成标题一键去改写**：标题列表行级「去改写」按钮 → `/rewrite?titleHint=<标题>` → RewriteView 可移除 chip → `ai:rewrite` params 携带 `titleHint` → 引擎 `_sanitizeTitleHint`（空白折叠/200 截断/非字符串忽略）后作为软约束追加 userPrompt（模板替换后追加）。
- **评估第 4 维爆款潜力**：`RewriteEngine` 可选 `viralScorer` 注入，改写前后并行评分产出 `result.viral={original,rewritten,delta,mode}`；`Number.isFinite` + 跨 mode 一致性校验，任一失败 fail-open。主进程 `ViralEngine.scoreText`（orchestrator 优先/本地回退/独立 8s 超时/0-100 clamp）经 container 注入。渲染端质量报告新增爆款潜力对比行。
- **零新增 IPC 通道**：复用 `ai:rewrite`（params 透传）与 `knowledge-library:add-viral`，preload bundle 无需重打包。
- **i18n**：`viralAnalysis.*` 14 键 + `rewritePage` 6 键，zh/en 成对，纯静态键（项目语料不支持 `{param}` 插值）。

## Capabilities

### New Capabilities

- `viral-rewrite-integration`: 爆款分析/文案生成与改写引擎/质量评估的双向集成——分析落库反哺检索、生成标题软约束改写、改写结果爆款潜力对比评估。

### Modified Capabilities

<!-- 无：复用既有 viral-analysis 与 rewrite-engine 能力的接口，未修改其对外契约 -->

## Impact

- 代码：`packages/rewrite-engine/src/rewrite-engine-core.js`、`apps/desktop/electron/services/{viral-engine,rewrite-engine}.js`、`apps/desktop/electron/core/container.setup.js`、`apps/desktop/src/views/{ViralAnalysis,RewriteView}.vue`、locales zh/en。
- 兼容性：全部新增字段为可选；未注入 scorer / 无 titleHint 的调用方行为不变（回归测试锁定）。
- 测试：rewrite-engine 21 例、渲染端+electron 75 例、契约与覆盖 23 例全绿。
