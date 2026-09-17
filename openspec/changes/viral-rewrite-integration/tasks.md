# viral-rewrite-integration 变更任务

## 1. 引擎层（packages/rewrite-engine）

- [x] 1.1 `_sanitizeTitleHint`：非字符串 → null；`\s+` 折叠；trim；空 → null；>200 截断（V1-V3）
- [x] 1.2 `_buildPrompt` 第 6 参 titleHint，模板替换后追加软约束块（V1；防 `{placeholder}` 二次展开）
- [x] 1.3 构造函数可选 `viralScorer`；rewrite() 第 8.5 步并行评分 → `result.viral`（V4）
- [x] 1.4 fail-open：scorer 抛错/无效值/未注入/NaN/跨 mode → 无 viral 字段（V5-V9）
- [x] 1.5 单元测试 V1-V9（tests/rewrite-engine-core.test.js）

## 2. 主进程（apps/desktop/electron）

- [x] 2.1 `ViralEngine.scoreText(text)`：orchestrator 优先（独立 8s 超时）/本地启发式回退/0-100 clamp/NaN 防御/空输入 null（ST1-ST6）
- [x] 2.2 `_callApi` 增加可选 `timeoutMs`（默认 120s 不变）；scoreText 降级路径补 log.warn
- [x] 2.3 `RewriteEngineService.setViralScorer(fn)` + `_ensureEngine` 构造透传（setter 置 `_engine=null`）
- [x] 2.4 `container.setup.js` rewriteEngineService 工厂注入 `(text) => c.get("viralEngine").scoreText(text)`
- [x] 2.5 viral-engine.test.js 6 用例

## 3. 渲染端（apps/desktop/src）

- [x] 3.1 ViralAnalysis.vue：存入爆款库（守卫/saving/saved/错误消息 aria-live）+ analyzedTopic 快照 + doAnalyze 重置
- [x] 3.2 ViralAnalysis.vue：goRewrite（空/非法守卫 + 200 截断）+ 标题行级按钮
- [x] 3.3 RewriteView.vue：onMounted 读 query.titleHint（trim+截断）+ 可移除 chip（rewriting 期 disabled）
- [x] 3.4 RewriteView.vue：startRewrite params.titleHint；响应 viral 归一化（original/rewritten 有限数字校验，delta null 兜底）+ 质量报告展示行
- [x] 3.5 locales zh/en 成对新增（viralAnalysis.* 14 键 + rewritePage 6 键，纯静态键）

## 4. 质量门禁

- [x] 4.1 CJK 基线扫描 PASS（非 locale 文件零新增 CJK 字面量）
- [x] 4.2 locale zh/en 键成对；`--pair-base` 提交后由 CI 复核
- [x] 4.3 双模型外部评审（双子代理并行，后端/引擎 + 前端/集成视角）：0 Critical；Warning/Info 全部修复并回归
- [x] 4.4 `.quality-gates.md` 执行记录回写

## 5. 文档

- [x] 5.1 `01-docs/PRD-VIRAL-REWRITE-INTEGRATION.md`（数据校验/流程/交互/显示项/提示文字/P1-P2 规划/决策记录）
- [x] 5.2 CHANGELOG `# [未发布]` 条目
- [x] 5.3 openspec change（本目录）
- [x] 5.4 EverOS knowledge：`everos/data/knowledge/viral-rewrite-integration/index.md`

## 6. 交付

- [x] 6.1 显式列文件提交（禁 add -A）→ push → PR → `--auto --squash` → CI 通过自动合并
