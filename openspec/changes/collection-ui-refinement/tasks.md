# Tasks: collection-ui-refinement

## 1. 规格与 PRD
- [x] 1.1 专项 PRD `01-docs/PRD-COLLECTION-UI-REFINEMENT-2026-10-12.md`（数据校验/流程/功能逻辑/交互逻辑/显示项/提示文字全量）
- [x] 1.2 spec delta `openspec/changes/collection-ui-refinement/specs/collection-ui/spec.md`

## 2. TDD（先红后绿）
- [x] 2.1 `features/collection/batch-collect-panel.test.js`：折叠互斥（默认展开 rss/一次仅一组）、aria-expanded、进度统一渲染（两种批量共用 ColProgressBlock 结构）、testid 契约（zhihu-fav-* 原样）、emit 契约（collected/error）
- [x] 2.2 `features/collection/collected-results-list.test.js`：props 渲染、操作按钮主次分级（primary/secondary/danger class）、空态、批量操作条 emit、testid 契约（batch-select-all/batch-item-check-*/batch-action-bar）
- [x] 2.3 `styles/collection-tokens.test.js`：Collection.vue/新组件不得出现亮色硬编码 hex（白名单为空或仅测试文件）；新增语义槽在 tokens.css 亮/暗两档均有定义且暗色真覆盖
- [x] 2.4 既有测试回归：Collection.test.js 全量（迁移后 testid/DOM 角色/交互行为不变）

## 3. 实施
- [x] 3.1 新增 `features/collection/ColProgressBlock.vue`
- [x] 3.2 新增 `features/collection/BatchCollectPanel.vue`（模板 135–309 行 + zhihu/batch script 状态迁出，内联样式类化）
- [x] 3.3 新增 `features/collection/CollectedResultsList.vue`（模板 311–393 行 + 卡片层级重排）
- [x] 3.4 Collection.vue 接线（import + props/emit），模板替换为组件标签
- [x] 3.5 style 块 token 收编 + 暗色 `[data-theme="dark"]` 覆盖
- [x] 3.6 locales zh/en 成对新增（折叠组 aria 标签、结果空态文案、进度标题）

## 4. 门禁与验证
- [x] 4.1 定向单测全绿 + Collection.test.js 全量
- [x] 4.2 eslint 0 error；check-locale-sync PASS；CJK 基线无新增
- [x] 4.3 check-max-lines PASS（Collection.vue 净降）
- [x] 4.4 视觉基线：归因（差异带 = 本次改动区）→ --update 重建 → 前后截图入档
- [x] 4.5 QM-1 electron-builder --win --dir 打包 + 启动 8s stderr 干净

## 5. 交付收口
- [x] 5.1 PRD/CHANGELOG 前插；openspec/records/collection-ui-refinement.md
- [x] 5.2 .quality-gates.md 执行记录 + ledger 登记
- [x] 5.3 PR 创建；CI 全绿 → 自动 squash 合并 → 回填销账（同一次提交）
- [x] 5.4 worktree 按 R1-R5 清理
- [x] 5.5 记忆三路沉淀（内置/.agent_context、learnings.md、EverOS add+flush+落盘 grep）+ 回读验证
