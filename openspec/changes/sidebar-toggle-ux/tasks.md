# 任务：折叠按钮可发现性（sidebar-toggle-ux）

## 1. 规格与设计

- [x] 1.1 `proposal.md`：动机 + 三条实测数据修正 + 范围 + 为什么单独开 PR
- [x] 1.2 `design.md`：图标几何 / 样式层次 / 被否决备选 / 测试策略 / 风险
- [x] 1.3 `specs/sidebar-toggle-ux/spec.md`：1 条 MODIFIED + 2 条 ADDED Requirement，7 个 Scenario
- [ ] 1.4 核对 `sidebar-collapse-toggle` 的 8 条既有 Requirement 均未被本变更破坏

## 2. TDD —— 先红

- [ ] 2.1 `SidebarToggleIcon.test.js`（新增）：两态图形集合不相等 / 默认展开态 / `aria-hidden` + `focusable=false`
- [ ] 2.2 `SidebarToggleButton.test.js`（增补）：`collapsed` 透传 / 常态 border 与 background 非 transparent / 常态 color 为 `--color-text-primary` / 收起态挂 `is-collapsed` 且竖条声明存在
- [ ] 2.3 跑测试确认**先红**，并记录红的原因（不是「文件不存在」而是「断言不满足」）

## 3. 实现

- [ ] 3.1 `icons/SidebarToggleIcon.vue`：重绘「侧栏面板 + 方向箭头」，新增 `collapsed` prop（默认 `false`），视觉 18px
- [ ] 3.2 `SidebarToggleButton.vue`：透传 `collapsed`；`.sidebar-toggle` 加 `position: relative`、宽 32px、品牌倾向描边、`--color-bg-card` 底色、`--color-text-primary` 图标色
- [ ] 3.3 `SidebarToggleButton.vue`：hover 态（底色加深 + primary 图标色 + 描边加深）、focus-visible 焦点环、`prefers-reduced-motion` 保留
- [ ] 3.4 `SidebarToggleButton.vue`：`.is-collapsed::before` 2px 品牌色竖条（`position: absolute`，不占布局）
- [ ] 3.5 跑测试转绿

## 4. 视觉与行为验证

- [ ] 4.1 `pnpm exec tsc --noEmit` rc=0
- [ ] 4.2 `eslint` 0 error（存量 warning 不计）
- [ ] 4.3 跑受影响的单测全部绿（`SidebarToggleButton` / `SidebarToggleIcon` / `TabBar.sidebar-toggle` / `App.sidebar-collapse`）
- [ ] 4.4 **视觉基线重建**：`PIXEL_THRESHOLD` 按仓内约定，重建 43 张含 TabBar 的基线
- [ ] 4.5 明暗两主题各出一组「改前/改后」局部裁图，落到 PR 描述
- [ ] 4.6 手工核对：收起态竖条可见、展开态无残留、hover/focus 反馈正常、36px 行高未变

## 5. 质量节拍门禁

- [ ] 5.1 QM-4 视觉：基线变更**必须**在本 PR 内体现并说明（不是「N/A」——本 PR 正是视觉变更）
- [ ] 5.2 QM-6 CCG：若 diff > 200 行或命中敏感域 ⇒ `mode=dual`，跑 `ccg-deep-review.js` 并逐条裁决
- [ ] 5.3 债务熔断：`check-max-lines.js` 无新增超大文件
- [ ] 5.4 行尾/编码：`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 一致；`check-text-encoding-integrity` rc=0
- [ ] 5.5 doc-abs-paths：新写文件不得含本机绝对路径（`check-doc-abs-paths --all` rc=0）

## 6. 收口

- [ ] 6.1 `openspec/records/sidebar-toggle-ux.md` 执行记录（QM-1~6 + 视觉基线证据 + 遗留）
- [ ] 6.2 `CHANGELOG.md` 追加一行
- [ ] 6.3 `01-docs/learnings.md` 沉淀「估算对比度会夸大/缩小问题」这条
- [ ] 6.4 `check-pr-exec-record.js --mode=enforce` rc=0
- [ ] 6.5 开 PR（描述含实测对比度表 + 裁图 + 基线变更清单）
- [ ] 6.6 等 CI 全绿 → squash 合并 → 回读 main push run
