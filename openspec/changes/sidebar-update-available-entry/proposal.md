## Why

用户已安装的应用在运行期间若官方发布了新版本，当前只有「启动 3 秒后弹出的更新模态框」一条告知路径：启动瞬间弹窗会打断正在进行的发布/创作操作；关掉后运行期间再无提醒，长时间不重启就永远看不到新版本；且入口不在应用导航壳内，用户不知道「去哪里看有没有新版本」。

用户诉求（原话）：运行时有新版本时，在**左下角菜单按钮的上方**显示一个「新版本」提示按钮，图标与文字参考截图（圆形底 + 向上箭头 +「新版本」），**配色按项目当前设计标准**；**点击后退出应用，安装新版本**。

## What Changes

- **新增侧边栏底部「新版本」入口** `apps/desktop/src/components/SidebarUpdateButton.vue`（`data-testid="yixiaoer-update"`）：仅在检测到新版本时渲染，位于登录菜单按钮正上方（footer 顺序 `[0] 服务连接信息 → [1]「新版本」入口（条件渲染）→ [2] 登录 banner`）；图标为圆形底（`var(--primary)`）+ 白色向上箭头，文字「新版本」。
- **四态入口**：`available`「新版本」/ `downloading`「下载中 N%」（禁用）/ `ready`「重启安装」/ `error`「重试安装」。
- **点击即退出并安装**：新增 IPC `update:install-now`（`withSenderCheck`）+ preload `updateInstallNow`；主进程 `auto-updater.installNow()`：已下载 → 直接 `quitAndInstall()`；未下载 → 下载 → `update-downloaded` 后自动退出安装；幂等（重复点击只下载一次）。
- **状态共享**：`useAutoUpdate` 由组件局部状态升级为应用壳共享单例（模块级状态 + `start()` 幂等 + `resetAutoUpdateState()` 供测试复位），引入 `badgeMode` 状态机。
- **更新模态框下线**：`UpdateNotification.vue` 移除 UiModal 三段式（下载按钮/进度条/立即重启安装），退化为结果提示宿主（右下角「当前已是最新版本」4s 提示条 + 「更新失败：<原因>」告警条），继续持有 `start()/cleanup()` 生命周期。
- **i18n**：新增 `update.*` 12 条（zh/en 成对）；带参数文案按 CSP 约束写成 Message Function。
- **保留兼容**：`update:check` / `update:download` / `update:install` 通道与 `publisher.js` 同 API 不删除。

## Capabilities

### New Capabilities
- `sidebar-update-entry`: 应用运行期间的新版本常驻入口与「点击即退出安装」链路（含 IPC、主进程安装调度、入口四态与文案、无障碍与响应式约定）。

### Modified Capabilities
- `auto-update-notification`: 由「检测到新版本即自动弹出模态框」改为「侧边栏常驻入口 + 结果提示宿主」，更新检查的静默降级与版本发布策略（`force_version`/`gray_ratio`/`min_version`）判定逻辑不变。

## Impact

- 运行时代码：`apps/desktop/src/components/SidebarUpdateButton.vue`（新增）、`UpdateNotification.vue`、`composables/useAutoUpdate.js`、`layouts/YixiaoerSidebar.vue`、`api/publisher.js`、`locales/{zh,en}.js`；`electron/services/auto-updater.js`、`electron/ipc-handlers/update.js`、`electron/ipc-handlers/license-access-control.js`、`electron/preload/system.js`、`electron/preload/access-control.js`、`electron/preload/index.bundle.js`（重建产物）。
- 测试：新增 `src/components/SidebarUpdateButton.test.js`；修订 `src/composables/useAutoUpdate.test.js`、`src/layouts/YixiaoerSidebar.test.js`、`src/api/publisher.test.js`、`electron/services/auto-updater.test.js`、`electron/ipc-handlers/update.test.js`、`electron/preload.test.js`、`tests/ipc-handlers.test.js`、`tests/e2e/helpers/ipc-mock.js`。
- 文档：`01-docs/PRD-SIDEBAR-UPDATE-ENTRY-2026-09-14.md`（新增）、`01-docs/PRD.md`、`01-docs/UI-INVENTORY.md`、`01-docs/user-manual.md`、`01-docs/ipc-manifest.md`、`01-docs/PRD-SIDEBAR-BOTTOM-USER-MENU-2026-09-14.md`、`CHANGELOG.md`、`01-docs/learnings.md`、`.quality-gates.md`。
