# PRD：应用级浮层与内嵌 WebContentsView 弹窗互斥（Overlay View Suspension）

- 日期：2026-09-23
- 类型：Bug 修复 + 交互契约固化
- 分支：`settings-modal-webview-occlusion`（worktree `mp-settings-modal-webview-occlusion`）
- 关联现象：活动标签为外部网页（自媒体登录页/创作者中心）时，点击左下角「设置」，屏幕闪一下但弹窗不显示

---

## 1. 背景与根因

### 1.1 现象复述

用户在账号页点击账号打开对应的自媒体网页（内嵌浏览器标签，由主进程 `WebContentsView` 承载）。当该外部网页标签处于活动状态时，点击侧边栏左下角「设置」链接，SettingsDialog 弹窗 DOM 正常挂载并瞬间渲染（用户感知为"屏幕闪一下"），但随即被外部网页整块盖住，弹窗不可见、不可交互。

### 1.2 第一性根因

`WebContentsView` 是 Electron 主进程管理的**原生合成图层**，永远压在主窗口渲染进程的 DOM 之上；CSS `z-index`、`position: fixed` 对渲染层弹窗均无法跨越该原生边界。因此任何应用级模态浮层（DOM 实现）打开期间，只要活动内嵌视图可见，浮层必然被遮挡。

代码追溯：内嵌视图可见性此前仅由两条链路驱动——
1. 标签切换（`switchToTab` / `createNewTabPage` → `setVisible(true)`）；
2. T0-6b 壳态互斥（`setShellMode('workbench')` 隐藏全部内嵌视图）。

两条链路都不覆盖「渲染层弹出应用级模态浮层」这一场景，属于**流程缺失**类系统性漏洞。

### 1.3 逃逸链分析

| 测试层级 | 为什么没拦住 |
|---|---|
| 单元测试 | 弹窗组件测试不带真实原生图层，DOM 层级断言全部通过 |
| 集成测试 | 无「内嵌视图 + 浮层叠加」的组合场景 |
| E2E | WebContentsView 内容不在渲染层 DOM 树内，选择器看不到遮挡 |
| 视觉回归 | 截图基线均为首页/工作台壳态，无外部网页活动+弹窗场景 |

回归保护：本次新增 `apps/desktop/src/overlay-view-suspension.test.js`（静态链路断言 ×7 + 主进程行为 mock 测试 ×3，共 10 用例），任何一环断裂（方法删除、通道改名、bundle 未重打包、渲染层未接入）都会红。

## 2. 功能逻辑（修复方案）

采用与 T0-6b 壳态互斥同构的**弹窗互斥（ref-count 挂起/恢复）**机制：

- 主进程 `WebviewManager` 维护 `Set<string> _overlaySuspensions`（活跃浮层 owner 集合）。
- **挂起**（浮层打开）：owner 加入集合；若是第一个（0→1），执行 `_hideAllTabs()` + 登录视图 `hide()` + 扫码视图 `hide()`。
- **释放**（浮层关闭）：owner 移出集合；若计数归零且当前处于浏览器壳（`_shellMode !== 'workbench'`），恢复登录标签视图（活动标签为虚拟登录标签时单独 `loginViewManager.show()`，因 `_repositionAll` 不接管登录视图可见性）并 `_repositionAll()` 归位浏览器标签。
- **挂起期间守卫**：
  - `_repositionAll()`（窗口 resize / 侧边栏宽度变化触发）顶部检测挂起态 → 只隐藏不恢复，防止把视图重新拉起盖住浮层；
  - `createNewTabPage()`：新标签以 `setVisible(!suspended)` 隐藏态挂载；
  - `switchToTab()`：切换目标标签同样尊重挂起态。

### 2.1 数据校验与边界合同

| 输入 | 校验规则 | 结果 |
|---|---|---|
| `owner` 非字符串 / 空串 | `typeof owner !== 'string' \|\| !owner` | 拒绝挂起，返回 `false`，写 WARN 日志 |
| 重复挂起同一 owner | `Set.has(owner)` | 幂等，返回 `true` 但不重复隐藏 |
| 释放未知 owner | `!Set.has(owner)` | 无效，返回 `false`（防计数漂移），写 WARN 日志 |
| 释放后计数仍 >0 | `size > 0` | 不恢复（返回值 `false` = 未真正恢复） |
| workbench 壳态下释放 | `_shellMode === 'workbench'` | 只清计数不恢复（可见性仍由 `setShellMode` 驱动） |
| IPC sender 校验 | `withSenderCheck` | 非受信渲染进程调用被拒 |
| 渲染层 composable 异常 | try-catch | 静默降级返回 `false`，console.warn，绝不抛错阻断浮层本身 |
| 非 Electron 环境（Vite 浏览器 / 单测） | `invokePageManager` fallback | 同上静默降级 |
| 渲染层模块级去重 | `activeOwners` Set | 同一 owner 重复 suspend 不重复发 IPC |

## 3. IPC 契约

| 通道 | 方向 | 参数 | 返回 |
|---|---|---|---|
| `page-manager:suspend-embedded-views` | renderer → main（handle） | `owner: string` | `{ code: 0, data: { suspended: boolean } }`；异常 `{ code: EC.REQUEST_ERROR, message }` |
| `page-manager:resume-embedded-views` | renderer → main（handle） | `owner: string` | `{ code: 0, data: { resumed: boolean } }`；同上 |

preload 暴露（`electron/preload/page-manager.js`，改动后必须 `node scripts/build-preload.js` 重打包 `index.bundle.js`，bundle 内容纳入测试断言）：

```js
suspendEmbeddedViews: (owner) => ipcRenderer.invoke('page-manager:suspend-embedded-views', owner),
resumeEmbeddedViews: (owner) => ipcRenderer.invoke('page-manager:resume-embedded-views', owner),
```

渲染层统一经 `src/composables/useEmbeddedViewSuspension.js` 调用，禁止各浮层组件直接调 `window.electronAPI`。

## 4. 交互逻辑与显示项

### 4.1 纳入本次修复的三个浮层（owner 登记）

| 浮层 | owner | 触发点 | 接入位置 | 挂起时机 | 释放时机 |
|---|---|---|---|---|---|
| 设置弹窗 SettingsDialog | `settings-dialog` | 侧边栏左下角「设置」 | `App.vue` `watch(showSettingsDialog)` | 打开即挂起 | 关闭恢复 |
| 升级 Pro 弹窗 UpgradeModal | `upgrade-modal` | 侧边栏「升级 Pro」 | `MpSidebar.vue` `watch(showUpgradeModal)` | 打开即挂起（`fixed inset:0` 全屏遮罩会被整页盖住） | 关闭恢复 |
| 关闭未保存标签确认框 | `tab-close-confirm` | 关闭有未保存草稿的标签 | `App.vue` `onCloseTab` | `ElMessageBox.confirm` 前 `await` 挂起 | `finally` 中 `await` 释放（确认/取消/异常路径全覆盖） |

### 4.2 用户可感知行为

- 外部网页标签活动时打开上述任一浮层：网页区域暂时隐藏（露出窗口底色），浮层完整可见可交互；关闭浮层后网页立即归位（约 1 帧），滚动位置与页面状态不受影响（视图仅 hide 不销毁）。
- 多个浮层叠加（如设置未关又触发升级弹窗）：全部关闭后才恢复网页显示。
- 浮层打开期间窗口 resize / 侧边栏拖宽：网页保持隐藏，浮层关闭后按新布局归位。
- 浮层打开期间新标签页创建或 `switchToTab`（如快捷键触发）：新视图以隐藏态挂载，不遮挡浮层。

### 4.3 提示文字

本修复不新增用户可见文案；所有日志为开发者可见：
- 主进程 INFO：`Embedded views suspended for overlay: <owner>` / `Embedded views resumed after overlay: <owner>`
- 主进程 WARN：`Invalid overlay suspend owner ignored` / `Unknown overlay release ignored: <owner>`
- 渲染层 WARN：`[embedded-view-suspension] suspend failed <owner>` / `release failed <owner>`

## 5. 通查清单（全应用浮层盘点）

| 组件 | 形态 | 是否遮挡风险 | 处置 |
|---|---|---|---|
| SettingsDialog | 居中模态 | ✅ 已复现 | 本次修复（owner `settings-dialog`） |
| UpgradeModal | `fixed inset:0` 全屏遮罩 | ✅ 同类 | 本次修复（owner `upgrade-modal`） |
| onCloseTab ElMessageBox | 居中模态确认框 | ✅ 同类 | 本次修复（owner `tab-close-confirm`） |
| ProfileMenu | 侧边栏容器内下拉 | ❌ 不越过内嵌视图区域（x≥sidebarWidth 之外） | 无需处理 |
| BackToTop | 右下角瞬时按钮 | ⚠️ 会被盖住 | 残余限制（见 §6） |
| PipelineBackgroundToast | 右下 toast | ⚠️ 会被盖住 | 残余限制（见 §6） |
| UpdateNotification | 浮层通知 | ⚠️ 会被盖住 | 残余限制（见 §6） |
| ElMessage / ElNotification（全局） | 顶部/角落短暂浮层 | ⚠️ 会被盖住 | 残余限制（见 §6） |

## 6. 已知残余限制（显式记录）

瞬时/非模态浮层（toast、回到顶部、更新通知、ElMessage）在内嵌视图可见时仍可能被原生图层遮挡。不纳入本次挂起机制的理由：

1. 生命周期短（2-5 秒自动消失），挂起/恢复会造成网页区域明显闪烁，体验损失大于收益；
2. 高频触发若走 ref-count 会与模态浮层竞争恢复时机；
3. 它们不承担必须完成的交互闭环（无表单、无决策按钮）。

后续如需治理，方向是主进程侧把 toast 改为独立 `BrowserWindow`（frameless alwaysOnTop）或 Electron `Overlay` API，而非扩展挂起机制。

## 7. 验收标准

- [x] TDD 红：实现前 `overlay-view-suspension.test.js` 10/10 失败（功能缺失）
- [x] TDD 绿：实现后 10/10 通过
- [x] 相关回归：`shell-mode-6b.test.js`、`ipc-contract.test.js`、`build-preload.test.js` 16/16 通过
- [x] MpSidebar / UpgradeModal / SettingsDialog 既有渲染测试 42/42 通过
- [x] desktop 全量 vitest：627 文件 / 11240 用例通过（1 skipped 文件、2 skipped 用例为既有基线）
- [x] QM-1 打包：`electron-builder --win --dir` exit 0，asar integrity 更新成功
- [ ] 人工验证：外部网页标签活动时点设置/升级/关标签确认，弹窗完整可见可交互，关闭后网页归位

## 8. 防复发措施

1. **审查清单**（已并入 `.quality-gates.md` QM-2 检查项）：新增应用级模态浮层（DOM `position: fixed` 遮罩/居中弹窗、ElMessageBox.confirm 阻塞交互的）时，必须接入 `useEmbeddedViewSuspension` 并在 `overlay-view-suspension.test.js` 登记 owner；
2. 修改 `WebviewManager` 可见性链路（`setVisible` / `_repositionAll` / `setShellMode`）时必须跑 `overlay-view-suspension.test.js` + `shell-mode-6b.test.js` 全量；
3. 修改 `electron/preload/page-manager.js` 后必须重打包 `index.bundle.js`（bundle 断言会拦截遗漏）。
