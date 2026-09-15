# NavBar 浏览器操作区（后退/前进/首页）修复 — 2026-09-15

> 分支 `fix-navbar-navigation`（worktree `mp-fix-navbar-navigation`）
> 关联症状：应用所有页面中，TabBar 标签栏下方的 NavBar 浏览器操作区，「←」「→」左右箭头与「🏠」返回首页按钮点击均无反应。

---

## 1. 症状与根因

### 1.1 症状

- 左箭头（后退）：点击无反应
- 右箭头（前进）：点击无反应
- 🏠（返回首页）：点击无反应

### 1.2 根因（代码级证据链）

| # | 位置 | 事实 | 后果 |
|---|------|------|------|
| 1 | `electron/services/webview-manager.js` `getAllTabs()` / `getActiveTab()` / `getHomeTab()` | home 标签是**虚拟标签**（无 WebContentsView），`canGoBack`/`canGoForward` 三处均硬编码 `false` | 主进程对 home 标签永远上报「无历史」 |
| 2 | `src/stores/tab.js` `navigation` | 渲染端导航状态直接取自主进程上报 | home 标签激活时 `canGoBack/canGoForward` 恒为 `false` |
| 3 | `src/components/NavBar.vue` | 按钮 `:disabled="!canGoBack"` / `:disabled="!canGoForward"` | 左右箭头**永久禁用**，点击事件根本不触发 |
| 4 | `src/App.vue` `goHome()` | 仅 `switchToTab('home')`；用户已在首页标签时是 no-op，且不恢复 SPA 首页路由 | 🏠 点击无效 |

**关键架构事实**：所有 SPA 页面（侧边栏进入的 Vue 页面，如首页/账号页/发布页）都运行在 home 标签内（路由守卫会把非 home 标签的 SPA 导航自动切回 home 标签）。因此「所有页面都失效」= home 标签上的箭头永久禁用，与具体页面无关。

浏览器标签（真正的 WebContentsView，如账号登录页）的返回/前进走主进程 `webview-manager.goBack/goForward`，链路本身正常。

---

## 2. 修复方案

### 2.1 设计原则

- **按标签类型区分数据源**：home 标签（虚拟）用 vue-router 历史栈；浏览器标签用主进程 WebContentsView 历史。
- **零 IPC/preload 变更**：不新增桥方法，规避 4 处契约快照同步成本（preload.test.js 计数、ipc-handlers 断言、bundle 重打包）。
- **NavBar 组件零修改**：它本来就是 props 驱动的展示组件，禁用态由上层计算后传入。

### 2.2 新增 composable：`src/composables/useSpaNavHistory.js`

通过 `window.history.state.position`（vue-router 4 每次导航写入的单调递增栈索引）跟踪 SPA 历史栈：

| 状态 | 含义 |
|------|------|
| `canGoBack` | `position > 0`（栈首之前无历史） |
| `canGoForward` | `position < maxSeen`（前方还有可前进记录） |
| `maxSeen` | 本会话内见过的最大 position；**新导航（push）时收缩为当前 position**（前进历史被截断），**popstate（back/forward）时不收缩** |

防重入：`lastPos` 记录上次同步的 position，相同则跳过 —— 避免 popstate 已 sync 后、紧随的 afterEach 把历史移动误判为新导航而错误收缩前进栈。

### 2.3 `App.vue` 接线

```
navCanGoBack    = isHomeTab ? spaNav.canGoBack    : navigation.canGoBack
navCanGoForward = isHomeTab ? spaNav.canGoForward : navigation.canGoForward
```

`goHome()` 修复为「两步归位」：

1. 若不在首页标签：`switchToTab(homeTab.tabId)`（浏览器标签 → SPA 壳）；
2. 若当前 SPA 路由不是 `/`：`router.push('/')`（确保落在首页，覆盖「已在首页标签但停在子页面」与「从浏览器标签返回」两种场景）。

---

## 3. 功能逻辑与交互逻辑（修复后口径）

### 3.1 数据源矩阵

| 当前标签 | 左右箭头可用性数据源 | 点击行为 |
|----------|---------------------|----------|
| home 标签（虚拟，承载全部 SPA 页面） | `useSpaNavHistory`（vue-router 历史栈） | `router.back()` / `router.forward()` |
| 浏览器标签（WebContentsView） | 主进程 `canGoBack/canGoForward`（webview-manager 上报） | IPC `page-manager:go-back/go-forward` |
| 认证登录标签（虚拟全屏） | 同浏览器标签语义 | 同上 |

### 3.2 🏠 返回首页行为

| 场景 | 行为 |
|------|------|
| 在浏览器标签 | 切回首页标签 → SPA 路由归位 `/` |
| 在首页标签、子页面（如 /accounts） | SPA 路由 `router.push('/')` 回首页 |
| 在首页标签且已在 `/` | 无操作（无视觉跳变，无报错） |

### 3.3 显示项与提示文字（未变更，列作回归基准）

| 控件 | testid | title/aria | 禁用态 |
|------|--------|-----------|--------|
| ← | `nav-back` | 后退 | `opacity 0.35`，`cursor: default`，不触发 click |
| → | `nav-forward` | 前进 | 同上 |
| ⟳ | `nav-reload` | 刷新 | home 标签下不渲染（`v-if="!isHome"`） |
| 🏠 | `nav-home` | 返回首页 | 永不禁用 |

地址栏、复制按钮、「保存账号」按钮逻辑不变。

### 3.4 数据校验与边界

- `window.history.state` 为 null 或 `position` 非数字时：`sync()` 直接返回，保持上一次按钮态（不误禁用、不误启用）。
- `router.back()` 在栈首：浏览器不触发 popstate，状态不变（按钮本就禁用，防御一致）。
- `goHome` 每步独立 try/catch：`switchToTab` 失败不阻断 `router.push('/')`，失败仅 `console.warn`，不向用户弹错（返回首页是幂等轻操作）。
- 组件卸载：`spaNav.dispose()` 解绑 popstate 与 afterEach，无泄漏。

---

## 4. 测试

- 新增 `src/composables/useSpaNavHistory.test.js`：7 用例（初始态、push 后、back/forward 往返、栈首、截断、dispose）。全绿。
- 回归：`NavBar.test.js` + `stores/tab.test.js` 共 11 用例全绿。
- ESLint 对 3 个修改文件 0 error 0 warning。

> ⚠️ 单测基建坑（复用）：jsdom 不支持 history traversal（`back()` 是 no-op）；模拟遍历必须 ①`replaceState` 同时恢复 **URL 与 state**；②`PopStateEvent` 必须携带 `{ state }`（vue-router 依赖 `event.state`）；③旧 router 实例的 popstate 监听无法注销 → 全文件共用一个 router 实例顺序推进。

---

## 5. 影响面

| 项 | 变更 |
|----|------|
| `src/composables/useSpaNavHistory.js` | 新增（~100 行） |
| `src/composables/useSpaNavHistory.test.js` | 新增（7 用例） |
| `src/App.vue` | 导入 composable、`navCanGoBack/Forward` computed、`goHome` 两步归位、生命周期 attach/dispose（264 → ~290 行，低于 500 债务熔断线） |
| 主进程 / preload / IPC | **零变更** |
