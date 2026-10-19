# Tasks: collection-page-ui-ue-refine

## 1. 规格与 PRD
- [ ] 1.1 专项 PRD `01-docs/PRD-COLLECTION-PAGE-UI-UE-REFINE-2026-10-17.md`（15 项问题逐条 file:line + 控件规范 + 数据校验不变声明 + 提示文字逐条登记）
- [ ] 1.2 spec delta `openspec/changes/collection-page-ui-ue-refine/specs/collection-ui/spec.md`

## 2. TDD（先红后绿）
- [ ] 2.1 `features/collection/collection-page-css-contract.test.js`：新槽亮暗两档 / 6 文件无 hex / **消费⇒有定义** / 死类 0 消费（先 RED）
- [ ] 2.2 `features/collection/collection-page.test.js`：页签 5 个不变、tabpanel aria、快捷卡三组、角标 99+（先 RED）
- [ ] 2.3 改 `styles/collection-tokens.test.js`：SCOPE_FILES 扩 3 文件 + 死类锁
- [ ] 2.4 改 `CollectedResultsList.test.js`：`is-primary` → `col-btn--primary` + CSS 有定义断言

## 3. 实施
- [ ] 3.1 `features/collection/collection-page.css`：变量组 + 类族（按钮三档/输入一档/卡片两档/徽标一档/横幅一档/页签）
- [ ] 3.2 `styles/tokens.css`：9 个新槽亮暗两档
- [ ] 3.3 死类清零：`is-primary`/`primary` → `col-btn--primary`；`collection-tab-badge` 补定义
- [ ] 3.4 `Collection.vue`：页头同底、页签 aria、快捷卡三组去 emoji、chip 行分档、类名统一、style 块收编
- [ ] 3.5 `QuickCollectPanel.vue` 11 处 hex 收编 + `WordCountRangeInput.vue` 1 处 + 兜底 hex 清理
- [ ] 3.6 `BatchCollectPanel.vue` / `CollectedResultsList.vue` / `ColProgressBlock.vue` / `CollectionDraftsPanel.vue` / `QuickCollectCommandDialog.vue`：控件/徽标/圆角/间距统一
- [ ] 3.7 删 `views/Collection.polish.css`（`git rm` 评审）
- [ ] 3.8 locales `collection/{zh,en}.js` 成对新增 7 组 key；CJK 基线同步迁移

## 4. 门禁与验证
- [ ] 4.1 定向单测全绿 + `src/features/collection/` + `Collection.test.js` + `src/styles/` 全集
- [ ] 4.2 `pnpm run lint`（apps/desktop）rc=0；`check-locale-sync --pair-base origin/main` / `--keys` / `--cjk` 三项 PASS
- [ ] 4.3 `node .github/scripts/check-max-lines.js` PASS（Collection.vue 净增 ≤0）
- [ ] 4.4 视觉：`collection` light/dark 归因 + 重建（CI `QG Visual` 取证；本机无 Chromium 则如实登记）
- [ ] 4.5 QM-1 `electron-builder --win --dir` + 8s 启动三层判据（存活断言 + `buildChildEnv()` 剔除 `ELECTRON_RUN_AS_NODE` + stderr 分层）
- [ ] 4.6 品牌残留 `node scripts/check-no-brand-residue.js`

## 5. 交付收口
- [ ] 5.1 PRD/CHANGELOG 前插；`openspec/records/collection-page-ui-ue-refine.md`（表行 + bullet 两形态）
- [ ] 5.2 PR 创建；CI 全绿 → 按 AGENTS「PR 自动合并」判据自动 squash 合并 → 同一次提交回填 `远程同步 PASS` + merge SHA
- [ ] 5.3 worktree 按 R1-R5 清理（`safe-worktree-remove.ps1 -WhatIf` 先干跑；`check-branch-merged.js` 退出码 0 才删）
- [ ] 5.4 记忆三路沉淀：内置 `.agent_context/collection-page-ui-ue-refine.md`、外部 `01-docs/learnings.md` 置顶、EverOS add+flush+**落盘 episode grep 哨兵词**
