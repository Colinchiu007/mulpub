# WebviewManager 模块拆分技术文档

> 文档版本：v1.0.0
> 创建日期：2026-09-24
> 类型：架构重构记录
> 关联 PR：#2360

## 一、背景与目标

`apps/desktop/electron/services/webview-manager.js` 在持续迭代中膨胀到 1735 行，单个文件承担了 8 个互不重叠的职责域：

1. 常量与工具函数（Cookie 格式转换、home-shell 地址解析、CDP 早期注入）
2. 浏览器标签页生命周期（创建 / 关闭 / 导航监听）
3. 标签页查询与导航（获取列表、切换、前进后退、URL 导航）
4. 虚拟登录标签（AuthViewManager / QrCodeLogin 托管的全屏登录）
5. 账号凭证保存（Cookie / localStorage 提取、自动保存、批量保存）
6. 布局与壳态（窗口 resize、侧边栏宽度、壳态互斥、弹窗互斥挂起）
7. 事件广播（向渲染进程订阅者推送标签页状态变化）
8. IPC 桥接（18 个 page-manager: IPC handler）

单体文件导致：职责边界模糊、单文件审查成本高、命名冲突风险、团队协作时频繁 merge 冲突。

## 二、拆分方案

### 2.1 目标结构

```
apps/desktop/electron/services/webview-manager/
├── index.js             # 主入口：构造器 + Object.assign 组合各模块（90 行）
├── constants.js         # 常量定义（30 行）
├── utils.js             # 纯工具函数（180 行）
├── event-bus.js         # 事件广播（40 行）
├── layout.js            # 布局 / 壳态 / 弹窗互斥（170 行）
├── tab-query.js         # 标签查询与导航（260 行）
├── auth-tab.js          # 虚拟登录标签生命周期（140 行）
├── credential-saver.js  # 账号凭证保存（250 行）
├── tab-lifecycle.js     # 标签创建 / 关闭 / 导航监听（350 行）
└── ipc-handlers.js      # IPC 桥接（180 行）
```

原 `webview-manager.js` 改为 re-export 入口（16 行），保持 `require('./webview-manager')` 路径兼容。

### 2.2 组合模式：Object.assign

每个子模块导出一个**方法对象**，通过 `Object.assign` 合并到 `WebviewManager.prototype`：

```javascript
Object.assign(WebviewManager.prototype, eventBus)
Object.assign(WebviewManager.prototype, layout)
Object.assign(WebviewManager.prototype, authTab)
Object.assign(WebviewManager.prototype, credentialSaver)
Object.assign(WebviewManager.prototype, tabQuery)
Object.assign(WebviewManager.prototype, tabLifecycle)
Object.assign(WebviewManager.prototype, ipcHandlers)
```

选型理由：

- **接口零变化**：方法仍在 prototype 上，通过 `this` 访问状态，外部调用方完全无感
- **无继承层级**：比 Mixin 嵌套类更直观，与项目既有代码风格一致
- **状态集中**：所有状态保留在基类 constructor，避免状态散落各模块

### 2.3 各模块职责

| 模块 | 方法 | 说明 |
|------|------|------|
| constants.js | `SIDEBAR_WIDTH_DEFAULT`, `SAFE_IDENTIFIER`, `AUTO_SAVE_DEBOUNCE_MS`, `HOME_TAB_ID`, `AUTH_TAB_ID`, `HOME_SHELL_PARAM` | 单一真源常量 |
| utils.js | `_getUserDataDir`, `_injectLocalStorageAtDocumentStart`, `normalizeElectronCookie`, `_homeShellUrl`, `_homeShellPreloadPath`, `_urlHasHomeShellParam`, `_parseHashRoute` | 纯函数，无状态 |
| event-bus.js | `_broadcast`, `_broadcastNav` | 向渲染进程订阅者广播 |
| layout.js | `resize`, `setShellMode`, `isWorkbenchShell`, `isEmbeddedViewsSuspended`, `suspendEmbeddedViewsForOverlay`, `releaseEmbeddedViewsForOverlay`, `setSidebarWidth`, `_repositionAll` | 布局与互斥 |
| tab-query.js | `getAllTabs`, `getActiveTab`, `getHomeTab`, `goBack`, `goForward`, `reload`, `navigateActiveHomeShell`, `navigateTab`, `searchOrNavigate`, `switchToTab`, `_getDomain` | 查询与导航 |
| auth-tab.js | `attachAuthViewManager`, `attachQrCodeLogin`, `_onAuthViewOpened`, `_onAuthViewClosed`, `_getAuthTab`, `_getActiveLoginViewManager`, `_hideActiveLoginView` | 虚拟登录标签 |
| credential-saver.js | `saveCookies`, `_extractTabCookies`, `saveAccountTabCredentials`, `_maybeScheduleAutoSave`, `_broadcastCredentialState`, `getAccountTabSaveState`, `saveAllUnsavedAccounts` | 凭证保存 |
| tab-lifecycle.js | `createNewTabPage`, `closeTab`, `closeAll`, `_hideAllTabs`, `_setupNav` | 生命周期 |
| ipc-handlers.js | `registerIpcHandlers` | 18 个 IPC handler |
| index.js | constructor + `setMainWindow` + `setAccountManager` + `_mainWindowAvailable` | 组合入口 |

## 三、数据校验与流程不变性

拆分是**纯结构重构**，不改变任何运行时行为。以下数据校验与流程保持原样：

1. **账号 ID 校验**：`SAFE_IDENTIFIER = /^[a-zA-Z0-9_-]+$/` 仍用于 accountId 合法性校验
2. **Cookie 格式转换**：`normalizeElectronCookie` 将 Playwright 的 expires/PascalCase sameSite 转为 Electron 的 expirationDate/小写 sameSite
3. **Cookie 提取 fail-closed**：`_extractTabCookies` 仍显式抛错（Electron 无 getAll API，误用会假成功）
4. **URL 协议白名单**：`navigateTab` 仍只放行 http:/https:/file:
5. **侧边栏宽度守卫**：`setSidebarWidth` 仍校验 `MIN_SIDEBAR_WIDTH ≤ width ≤ MAX_SIDEBAR_WIDTH`
6. **IPC 注入 fail-closed**：`registerIpcHandlers` 未注入受控 ipcMain 时仍抛错

## 四、测试调整

拆分后 4 个静态链路测试需适配子模块路径（断言目标与语义不变）：

- `ipc-injection-contract.test.js`：`listProdFiles` 递归扫描子目录
- `shell-mode-6b.test.js`：合并读取 layout/ipc-handlers/index
- `overlay-view-suspension.test.js`：合并读取 layout/tab-lifecycle/tab-query/index
- `js-eval-payload.test.js`：buildEvalScript 调用点改读 utils/tab-lifecycle
- `account-manager-profile.test.js`：采集器调用点改读 credential-saver

## 五、验收标准

- [x] 66 个 webview-manager 单元测试通过
- [x] 6 个 IPC 注入契约测试通过
- [x] 7 个壳态链路测试通过
- [x] 10 个弹窗互斥测试通过
- [x] 13 个 js-eval-payload 测试通过
- [x] 9 个 account-manager-profile 测试通过
- [x] 无单文件超过 500 行（最大 tab-lifecycle.js 350 行）
- [x] 接口不变：container.setup.js 等 11 处引用无需修改
- [x] 债务熔断检查通过（webview-manager.js 从债务登记中清账）

