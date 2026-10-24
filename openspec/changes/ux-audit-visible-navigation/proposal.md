# Proposal: ux-audit-visible-navigation

## Why

UX 审计阶段 1 的 1.5「键盘与鼠标导航等价」：同一件事（"去发布页"）在两种输入方式下结果不同。

- 鼠标点左侧边栏：`MpSidebar.onNavClick` 做三段式判断——聚焦内嵌主页实例（home-shell）时经 IPC
  定向让那个实例自己跳；聚焦普通网页标签时**先切回首页标签**再跳；聚焦首页标签时才直接推主窗口路由。
- 键盘按全局快捷键（`Ctrl+Alt+P` 等）：主进程 `hotkeys.js` 发 `app:navigate`，`App.vue` 的订阅回调
  只做裸 `router.push(route)`。

于是用户停在**网页标签**（原生 `WebContentsView` 盖在主窗口之上）时按快捷键，主窗口路由在覆盖层
背后变了，屏幕上什么都不会发生；聚焦内嵌主页实例时按快捷键，跳转落在那个实例看不见的另一条路由上，
并且两侧路由从此漂移。根因不是"漏了一个 if"，而是**同一段判断被抄了两遍，其中一遍没抄全**。

## What Changes

- 新增 `apps/desktop/src/composables/useVisibleNavigation.js`：可见导航的**唯一实现**，
  三段判断 + 三条降级纪律（无回执不算已处理、切标签失败仍继续跳转、宿主无桥时按主窗口路径走）。
- `App.vue` 的 `app:navigate` 订阅回调改为调用该实现（不再裸 `router.push`）。
- `MpSidebar.vue` 的 `onNavClick` 改为复用该实现（删除组件内那份复制的判断）。
- 新增契约锁：`useVisibleNavigation.test.js`（逻辑面）+ `App.visible-navigation.test.js`
  （壳层接线面 + "两处入口共用同一实现"的结构锁）。
- 新增反证驱动 `scripts/visible-navigation-contract-mutate.js`（10 条变异）。

不新增用户可见文案（无 locale 变更）、不改视觉呈现（不在像素判定域内）。

## Impact

- Affected specs: `desktop-ui-consistency`（ADDED：可见导航单一实现）
- Affected code: `apps/desktop/src/App.vue`、`apps/desktop/src/layouts/MpSidebar.vue`、
  `apps/desktop/src/composables/useVisibleNavigation.js`（新增）及其测试
- 风险面：所有导航入口的行为汇聚到一处；快捷键在"停在网页标签"这一态下从"看不见地跳"变为
  "先切回首页再跳"——这是本次要修的缺陷本身，也是用户可感知的唯一变化。
- 不改动主进程、不改 IPC 通道、不改 preload，因此不触发 QM-1 打包门禁。
