# Tasks — sidebar-update-entry

## 1. 主进程：点击即退出安装
- [x] `electron/services/auto-updater.js`：新增 `_availableUpdate` / `_updateDownloaded` / `_installRequested`；`installNow()`（已下载直接安装 / 未下载先下载 / 无更新回落 `not-available` / 幂等）；`update-downloaded` 时按 `_installRequested` 自动退出安装；`error` 时区分「用户点击后」与「后台静默」两种语义
- [x] `electron/ipc-handlers/update.js`：新增 `update:install-now`（`withSenderCheck` + 统一错误 envelope）
- [x] `electron/ipc-handlers/license-access-control.js`：`PUBLIC_CHANNELS` 加入 `update:install-now`
- [x] `electron/preload/system.js`：暴露 `updateInstallNow`
- [x] `electron/preload/access-control.js`：`PUBLIC_METHODS` 加入 `updateInstallNow`
- [x] 重建 `electron/preload/index.bundle.js`（`pnpm run build:preload`）

## 2. 渲染层
- [x] `src/api/publisher.js`：新增 `updateInstallNow()`
- [x] `src/composables/useAutoUpdate.js`：升级为应用壳共享单例；`badgeMode` 状态机 + `showUpdateBadge` + `handleInstallNow()` + `start()` 幂等 + `resetAutoUpdateState()`
- [x] `src/components/SidebarUpdateButton.vue`（新增）：四态入口 + 点击退出安装 + 无障碍 + 响应式 + 设计标准配色
- [x] `src/layouts/YixiaoerSidebar.vue`：footer 中在登录 banner 上方插入入口
- [x] `src/components/UpdateNotification.vue`：移除 UiModal，退化为结果提示宿主
- [x] `src/locales/{zh,en}.js`：新增 `update.*` 12 条（插值文案用 Message Function）

## 3. 测试（TDD）
- [x] `src/components/SidebarUpdateButton.test.js`（新增 11 用例：显隐 / 点击 / 四态 / 样式契约）
- [x] `src/composables/useAutoUpdate.test.js`（重写 29 用例：状态机 / 点击即安装 / 幂等 / 生命周期）
- [x] `src/layouts/YixiaoerSidebar.test.js`：footer 顺序契约扩展（无更新顺序不变 + 有更新插入位置）
- [x] `electron/services/auto-updater.test.js`：新增 9 用例覆盖安装链路
- [x] `electron/ipc-handlers/update.test.js`：新增 4 用例（sender 校验 / 受理 / data=false / 异常 envelope）
- [x] `electron/preload.test.js` / `tests/ipc-handlers.test.js` / `src/api/publisher.test.js` / `tests/e2e/helpers/ipc-mock.js` 同步暴露面

## 4. 门禁与验证
- [x] `eslint electron/ src/ --quiet` → 0 error；`tsc --noEmit` → 0 error
- [x] `check-ipc-bridge.js` / `check-locale-sync --cjk --keys` / `check-frontend-consistency.js` 全 PASS
- [x] `check-debt-budget.js`：publisher.js 越 500 行触发 FAIL → 压缩行数修复（未抬基线）
- [ ] 桌面端全量单测 + CI 全绿后合并

## 5. 文档与归档
- [x] `01-docs/PRD-SIDEBAR-UPDATE-ENTRY-2026-09-14.md`（新增完整规格）
- [x] `01-docs/PRD.md`（头部索引 / F8 / §7.4.6.2 / 末尾增量章节）
- [x] `01-docs/UI-INVENTORY.md`、`user-manual.md`、`ipc-manifest.md`、`PRD-SIDEBAR-BOTTOM-USER-MENU-2026-09-14.md`
- [x] `CHANGELOG.md`、`01-docs/learnings.md`、`.quality-gates.md`
- [ ] PR 合并后归档至 `openspec/changes/archive/2026-09-14-sidebar-update-available-entry/`
