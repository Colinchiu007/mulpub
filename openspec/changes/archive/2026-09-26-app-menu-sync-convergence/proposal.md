# 应用菜单跨端同步收敛：目录供给 + 下发顺序 + 启动同步后自动刷新

## Why

用户报告：桌面应用侧边栏的菜单项与运营中心「应用菜单」页看到的数据不同步——顺序对不上，且在运营端改了显隐/排序后应用端毫无变化。

排查确认这不是偶发，而是三处结构性缺陷叠加：

1. **目录新增项永不落库**。运营中心页面列表读 DB 表 `app_menu_items`，而供给逻辑 `_seed_if_empty` 只在表**完全为空**时播种一次。`copy-library`（文案库）由 `bcd1b663`（2026-09-19）才加入 `CATALOG`，任何在此之前播种过的库都永久缺这一行——运营端看不到该项、也无法配置它。全仓没有 `app_menu` 的迁移或回填机制，只有人工点「恢复默认」才会补齐（而该操作会连带重置全部显隐与排序）。
2. **下发缺行兜底成 `sort_order = 0`**。`get_bootstrap_app_menu` 对 DB 缺行的项返回 0 而非目录序号。应用端按 `sort_order` 升序渲染，于是该项被顶到一级导航第 2 位（紧跟主页），与运营端页面显示的目录位置不一致。
3. **应用菜单被模型目录同步门控**。`_syncNowInner` 先拉模型目录，失败即 `return`，其后的 runtime bootstrap（含 `appMenu`）根本不会发起。叠加「仅启动后 3 秒同步一次、无服务端推送、无用户可见失败提示」，表现为运营端改完永远不生效。实测佐证：受影响机器的 profile SQLite 中 `opsCenterSync` 与 `opsCenterRuntime` 两个 settings 键均不存在，即从未同步成功过。

## What Changes

- **ops-center 后端**：`_seed_if_empty` → `_provision_from_catalog`，改为按 `CATALOG` **增量补齐**缺失行（只补欠账，不覆盖运营者已有的显隐/排序/分组）；`get_bootstrap_app_menu` 的缺行兜底由 `0` 改为目录序号。
- **桌面端主进程**：模型目录与运行时策略改为**并行且彼此独立**的两条通道，任一失败不再门控另一条；整体超时预算保持单请求 10s；新增 `setOnRuntimeUpdated` 通知器，`applyRuntime` 成功后广播 `ops-center:runtime-updated`。
- **桌面端渲染层**：`MpSidebar` 订阅该事件并重拉菜单配置（卸载时成对取消订阅）；重拉失败时保留上一份有效配置，不瞬时回退为本地默认菜单。
- **运营中心页面文案**：更新「应用菜单」页的生效时机说明与目录自动对齐说明（移除「需重启应用」和隐含的手工同步要求）。
- **不改用户界面**：曾加「部分成功」toast（`modelProviders.syncPartialSuccess` + composable 分支），QM-6 外部评审指出该反馈路径的 UI 已被产品有意隐藏（`ModelProviders.vue`「运营同步对用户透明：配置卡片已隐藏」），属 AGENTS.md 禁止的死键，**已撤销**；失败区分改由主进程日志承担。
- **生效模型（产品决策）**：应用端只在启动时同步一次，运营端改动在客户端下次启动生效；不引入周期性轮询、不引入服务端推送、不在应用端暴露任何同步入口。

**不做**：服务端主动推送（WebSocket/SSE）、运营端配置版本化与乐观锁、DB 脏 key 清理。理由见 design.md「Rejected」。

## 影响范围

| 层 | 文件 |
|----|------|
| ops-center 后端 | `backend/services/app_menu_service.py`、`backend/tests/test_app_menu_api.py` |
| ops-center 前端 | `frontend/src/views/AppMenu.vue`（提示文案） |
| 桌面端主进程 | `electron/services/ops-center-sync.js`（+ 测试）、`electron/bootstrap/phase3-services.js`（+ 测试）、`electron/preload/system.js`、`electron/preload/access-control.js`、`electron/preload/index.bundle.js`（重打包） |
| 桌面端渲染层 | `src/layouts/MpSidebar.vue`（+ `MpSidebar.appmenu.test.js`）、`src/api/ops-center-sync.js`、`src/composables/useOpsCenterSync.js`（+ 测试）、`src/locales/zh.js`、`src/locales/en.js` |
| 文档 | `01-docs/FEATURE-APP-MENU-2026-09-15.md`、`01-docs/PRD.md`、`CHANGELOG.md`、`01-docs/learnings.md`、`AGENTS.md` |

关联但未合并：`copy-library-primary-menu`（该 change 的 task 7「CATALOG 同步」被判为已完成，正是本次漂移的引入点——它把「代码里加 key」当成「运营端可配置」，缺少供给与部署环节的要求）。
