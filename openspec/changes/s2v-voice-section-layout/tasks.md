# 声音区子分区布局 + 折叠区默认收缩 — 任务清单

## 1. 实现（运行时代码）

- [ ] 1.1 `S2vConfigPanels.vue`：声音区拆为 `voiceNarration` / `voiceBgm` / `voiceClone` 三个子分区容器，各带独立 `.s2v-field-grid` 与 `data-testid`
- [ ] 1.2 `S2vConfigPanels.vue`：`s2vVoiceCapability` 三分支（`provider_personal_slot` / `user_clone+enabled` / `user_clone+未启用）全部归入克隆子分区
- [ ] 1.3 `create-view.css`：`.s2v-subgroup` 卡片样式（background/border/radius/padding）+ 标题间距 + 卡片内栅格去 padding + 窄屏收紧
- [ ] 1.4 `CreateView.vue`：`s2vSubgroupLabel` 补 `voiceNarration` / `voiceBgm` / `voiceClone` 三键（fallback + english 两份映射）
- [ ] 1.5 `CreateView.vue`：`s2vOpenSections` 默认值注释显式化（仅 basic 展开）
- [ ] 1.6 `CreateView.vue`：快照恢复改为「先显式复位默认态，再只打开 expandedGroups 列出的分组」
- [ ] 1.7 locale：`zh.js` / `en.js` 各新增 3 键（成对）

## 2. 测试（TDD：先红后绿）

- [ ] 2.1 `S2vConfigPanels.test.js`：三个子分区顺序 + testid 断言（RED → GREEN）
- [ ] 2.2 `S2vConfigPanels.test.js`：语音生成器/音色ID 归属旁白设置分区
- [ ] 2.3 `S2vConfigPanels.test.js`：BGM 三件套归属背景音乐分区
- [ ] 2.4 `S2vConfigPanels.test.js`：克隆分区内**不得**出现 `s2v-bgm-volume`（本次用户报告直接症状）
- [ ] 2.5 `S2vConfigPanels.test.js`：克隆分区三分支归属（未启用提示 / 个人音色槽位）
- [ ] 2.6 `S2vConfigPanels.test.js`：声音区默认收缩（无 open 属性）
- [ ] 2.7 `S2vConfigPanels.test.js`：`makeBoundVm` 补 `s2vSubgroupLabel` 桩（与真实父级同形）
- [ ] 2.8 `CreateView.test.js`：「高级区两个子组」标题断言限定在 `s2v-section-advanced` 内（跨文件影响）
- [ ] 2.9 全量回归：`S2vConfigPanels` 22/22、`CreateView` 307/307、`video-creation/` 目录 + ue-contract + autosave 全绿

## 3. 门禁

- [ ] 3.1 `check-locale-sync --cjk` rc=0（无新增中文字面量）
- [ ] 3.2 `eslint`（改动 5 文件）rc=0
- [ ] 3.3 `build:vue` rc=0
- [ ] 3.4 像素（浅色）20/20 通过，含 `create-story2video-detail`
- [ ] 3.5 像素（暗色）20/20 通过
- [ ] 3.6 `all-views` 视觉套件 rc=0
- [ ] 3.7 一次性探针：展开声音区实测三个子分区满宽 + 卡片底 + 无横向溢出（用完即删，走 safe-delete）

## 4. 文档

- [ ] 4.1 `01-docs/PRD-S2V-VOICE-SECTION-LAYOUT-2026-10-18.md`（详版：背景/根因/方案对比/功能逻辑/交互逻辑/显示项/提示文字/数据校验/视觉规格/测试/影响面/验收/决策记录）
- [ ] 4.2 `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` 新增 §13 实现合同（8 小节）
- [ ] 4.3 `01-docs/learnings.md` 置顶条目
- [ ] 4.4 `CHANGELOG.md` 前置条目
- [ ] 4.5 `openspec/changes/s2v-voice-section-layout/`：proposal + tasks + spec delta

## 5. 记忆三路

- [ ] 5.1 内置记忆：`.agent_context/memory-s2v-voice-section-layout.md`
- [ ] 5.2 外部记忆：`01-docs/learnings.md` + `openspec/records/s2v-voice-section-layout.md`
- [ ] 5.3 EverOS：`everos/data/knowledge/css-span-n-is-not-fullwidth-in-autofit-grid/index.md`

## 6. 交付

- [ ] 6.1 commit（pre-commit 自动声明分支）+ push
- [ ] 6.2 开 PR，PR 侧 required checks 全绿
- [ ] 6.3 CI 通过后 squash 自动合并 + 删远端分支
- [ ] 6.4 worktree 按 R1-R5 清理（`safe-worktree-remove.ps1 -WhatIf` 先干跑）
