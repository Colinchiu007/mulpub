# Tasks: 侧边栏底部用户菜单

## Task 1: `ProfileMenu` 支持向上展开并承载设置 / 升级入口

**Status**: completed
**Risk**: Medium
**Files**: `apps/desktop/src/components/ProfileMenu.vue` (MODIFY)

### Steps
1. 新增 `open-settings` / `upgrade` 两个 emit 与对应处理（先 `close()` 再 emit）
2. banner 增加头像状态点（`identityStatus` / `clientStatusLabel` 由侧边栏下沉）与展开指示 `⌃`
3. 面板增加分隔线 + 「设置」（`nav.settings`）+ 「⭐ 升级 Pro」（`memberCenter.upgradePro`，仅非 Pro）
4. 布局改为底部形态：banner 卡片化、面板向上展开（`bottom` 定位）且与 banner 等宽、`max-height` + 内部滚动
5. 菜单项统一 `.profile-menu-action` 版式；升级项仅加 `profile-menu-action-upgrade` 强调色

### Acceptance Criteria
- [x] 面板向上展开且左右铺满（源码级 CSS 契约断言），不溢出侧边栏
- [x] 未登录点击 banner 仍直接唤起登录（既有行为不回归）
- [x] 设置 / 升级菜单项复用统一版式（`.profile-menu-action`）
- [x] 非 Pro 显示升级项、Pro 隐藏但保留设置项
- [x] 面板在 `placement="top"` 下不溢出侧边栏宽度
- [x] `ProfileMenu.test.js` 12 用例全绿

---

## Task 2: 侧边栏结构重排（header 品牌区 / footer 顺序 / 主导航去设置）

**Status**: completed
**Risk**: Medium
**Files**: `apps/desktop/src/layouts/YixiaoerSidebar.vue` (MODIFY)

### Steps
1. header 改为品牌区（`MP` + `Multi-Publish` + `+` 新建发布），移除 `ProfileMenu`
2. 主导航删除「设置」按钮，移除 `Setting` 图标与 `useIdentityStore` / `useLicenseStore` 依赖
3. footer 顺序改为 [0] 服务连接信息（新增 `.yixiaoer-sidebar-service` 容器）→ [1] `ProfileMenu placement="top"`
4. 承接事件：`@open-settings` 透传、`@upgrade` 置 `showUpgradeModal`
5. 清理死样式（状态行 / 升级按钮 / 旧 header）并更新窄屏媒体查询

### Acceptance Criteria
- [x] 侧边栏顶部 header 不再含登录区
- [x] footer DOM 顺序为服务连接信息 → 用户 banner
- [x] 主导航无 `data-testid="yixiaoer-primary-settings"`
- [x] `open-settings` / `upgrade` 事件链路可用（透传 / 打开升级弹窗）
- [x] 窄屏 ≤900px 下 banner 保留（仅头像），服务连接信息隐藏
- [x] `YixiaoerSidebar.test.js` 9 用例全绿

---

## Task 3: 移除模块导航右上角占位工具入口

**Status**: completed
**Risk**: Low
**Files**: `apps/desktop/src/layouts/YixiaoerModuleNav.vue` (MODIFY)

### Steps
1. 删除 `.yixiaoer-module-tools` 工具区（4 个按钮）与 `#yixiaoer-tool-panel` 工具面板
2. 删除脚本状态（`activeTool` / `toolPanels` / `activeToolContent` / `toggleTool`）与 `ref` 依赖
3. 删除全部工具相关样式与媒体查询分支；模块导航改为单子元素左对齐

### Acceptance Criteria
- [x] `[data-testid="yixiaoer-module-tools"]` / `.yixiaoer-tool-button` / `[data-testid="yixiaoer-tool-panel"]` 均不渲染
- [x] 模块标签与激活态行为不变
- [x] `YixiaoerModuleNav.test.js` 5 用例全绿（含零渲染回归断言）

---

## Task 4: 回归保护测试（TDD）

**Status**: completed
**Risk**: Low
**Files**: `apps/desktop/src/layouts/YixiaoerSidebar.test.js` / `YixiaoerModuleNav.test.js` / `apps/desktop/src/components/ProfileMenu.test.js` (MODIFY)

### Steps
1. ModuleNav：把原工具面板用例改写为「零渲染」防回归断言
2. Sidebar：改写为 footer 顺序 / header 无登录区 / `placement="top"` / 主导航无设置 / 事件透传 / 升级弹窗
3. ProfileMenu：新增 placement 双向、状态点、设置与升级项可见性与事件用例
4. 本地跑 3 个文件直至全绿

### Acceptance Criteria
- [x] 3 文件 26 用例全绿（9 / 5 / 12）
- [x] 4 条硬契约被显式断言（footer 顺序、header 无登录区、主导航无设置、工具区零渲染）

---

## Task 5: 文档同步

**Status**: completed
**Risk**: Low
**Files**: `01-docs/PRD-SIDEBAR-BOTTOM-USER-MENU-2026-09-14.md` (CREATE)、`01-docs/PRD.md`、`docs/desktop-ui-layout-spec.md`、`docs/frontend-interaction-spec.md`、`CHANGELOG.md`、`.quality-gates.md`、`01-docs/learnings.md` (MODIFY)

### Steps
1. 新增专项 PRD（诉求映射 / 变更范围 / 交互状态机 / 契约 / 校验 / 显示项与 i18n / 视觉 / a11y / 降级 / 测试 / 验收 / 回滚）
2. 主 PRD 追加章节与头部功能文档索引
3. 布局规格 §2.3 / §2.5 / §3.3 / §8.1 / §9.2 / §11 + 变更历史 v1.4
4. 交互规范 §2 登记 + §6.3 更新 + 新增 §6.4 强制条款
5. CHANGELOG 头部条目 + 质量门禁执行记录 + learnings 沉淀

### Acceptance Criteria
- [x] 文档同步门禁（`check-docs-sync.sh`）可通过
- [x] learnings 记录"删除型变更需改写为防回归断言""DOM 顺序需求需顺序断言""querySelector 不匹配元素自身"三条教训

---

## Task 6: 验证与交付

**Status**: completed
**Risk**: Low
**Files**: —

### Steps
1. 本地：3 个目标测试文件 + eslint + i18n 门禁 + 债务熔断（全 PASS）
2. 提交（分支 `codex/sidebar-footer-user-menu`，commit `0aacc7f5`）并推送
3. 创建 PR [#1824](https://github.com/Colinchiu007/Multi-Publish/pull/1824)，等待 CI（含像素视觉门禁）
4. CI 全绿后合并，本 change 随该 PR 归档至 `openspec/changes/archive/2026-09-14-sidebar-bottom-user-banner/`

### Acceptance Criteria
- [x] `eslint --quiet` 0 error；`--cjk`（1461 < 基线 1689）/ `--keys`（958 全命中）PASS；`check-debt-budget` PASS
- [x] CI 像素视觉门禁（QG Visual，阈值 6%）通过 —— 局部布局改动落在容忍度内，无需重建基线
- [x] CI 其余必需门禁通过：QG Static / Browser E2E / Autonomous、gui-test / visual-test、build（ubuntu + windows）、债务熔断、文档同步、单元测试 + Lint
- [x] PR #1824 合并 + 本 change 归档（以合并前 CI 全绿为完成判据）
