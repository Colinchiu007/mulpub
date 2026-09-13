# BUGFIX：内嵌浏览器视口越界 —— 右侧滚动条缺失 / 底部内容显示不全

> **日期**：2026-09-13
> **类型**：Bug 修复（视觉/布局）+ 顺带崩溃修复（OAuth 内嵌链路）
> **影响模块**：`apps/desktop/electron/services/view-bounds.js`（新增）、`webview-manager.js`、`auth-view-manager.js`、`qrcode-login.js`、`oauth-manager.js`
> **用户入口**：账号管理（Accounts）→ 点击账号卡片 → 打开自媒体平台网页（内嵌浏览器标签）
> **分支**：`codex/fix-embedded-browser-viewport`
> **关联 PRD**：`01-docs/PRD-ACCOUNT-LOGIN-WINDOW.md`（§2.1 曾记录 76px 补丁像素问题，本文为其续篇）

---

## 一、问题现象

在账号管理页点击**账号卡片本体**（非「去登录」按钮），应用以浏览器式标签页在主窗口内打开该平台的创作者中心网页（如微信公众号平台 `mp.weixin.qq.com`）。页面可以显示，但：

1. **右侧没有整个网页的滚动条** —— 网页内容明显超长，却看不到 Chrome/Electron 应有的右侧垂直滚动条；
2. **底部内容显示不全** —— 页面最底部的一部分内容被截断（如公众号编辑页的「平台推荐」「原文链接」等设置项只露出上半截），且**无论怎么滚动都无法看到被截断的部分**。

复现路径：账号管理 → 单击任一已保存账号的卡片 → 观察打开的平台网页标签。

## 二、影响范围（同一根因的 4 条链路）

| 链路 | 入口 | 布局代码 | 是否受影响 |
|---|---|---|---|
| 平台创作者中心标签（本次截图链路） | 账号卡片点击 → `tabStore.createTab` → `page-manager:create-new-tab-page` | `webview-manager.js` `_repositionAll()` | ✅ 主症状 |
| 扫码登录视图 | 卡片「去登录」→ 二维码平台 | `qrcode-login.js` `_positionView()` | ✅ 同样越界 |
| 账号登录视图 | 卡片「去登录」→ 账密平台 | `auth-view-manager.js` `_positionView()` | ✅ 同样越界 |
| OAuth 授权视图 | OAuth 平台授权 | `oauth-manager.js` `startAuth()` | ✅ **更严重：`_positionView` 方法缺失，一进入即抛 `TypeError`，链路完全不可用** |

不受影响：独立扫码/OAuth 窗口（`auth-window.js`，已正确使用 `getContentBounds()`）；外部浏览器打开（`window.open` 链路）。

## 三、根因分析

### 3.1 直接原因：坐标系统不匹配（外框尺寸 vs 客户区坐标系）

主窗口是带系统标题栏、菜单栏与边框的原生 `BrowserWindow`。Electron 提供两套尺寸：

| API | 语义 | 1280×800 窗口在 Windows 100% DPI 下的典型值 |
|---|---|---|
| `win.getBounds()` | **外框**（含标题栏 ~31px、菜单栏、左右边框各 ~8px、底边框 ~8px） | width/height = 整个窗口 |
| `win.getContentBounds()` | **客户区**（真正可绘制区域，扣除上述所有部分） | width ≈ 外框 − 16、height ≈ 外框 − 39 |

而 `mainWindow.contentView.addChildView(view)` 后 `view.setBounds({x,y,width,height})` 使用的是**客户区坐标系**（(0,0) = 客户区左上角，与渲染进程 DOM 原点一致）。

历史实现却用 `mainWindow.getBounds()` 的**外框宽高**去填充客户区坐标系的视图：

```js
// 修复前（webview-manager.js _repositionAll）
var bounds = this.mainWindow.getBounds()          // ← 外框尺寸
activeView.setBounds({
  x: sidebarWidth, y: 76,
  width: bounds.width - sidebarWidth,             // ← 比可用宽度大 ~16px
  height: bounds.height - 76,                     // ← 比可用高度大 ~39px
})
```

### 3.2 现象逐条对号

- 视图比客户区**宽出左右边框（~16px）** → 网页自身的垂直滚动条渲染在视图右边缘，正好落在窗口边框之外被裁掉 → **「右侧没有滚动条」**；
- 视图比客户区**高出标题栏+底边框（~39px）** → 视图底边超出窗口下边界，页面按「外框高度」布局视口，页面自身认为已滚到底 → **「底部内容缺一块且滚不出来」**。

注意这解释了为什么用户「滚动无效」：不是滚动条坏了，而是页面视口比可视区域大，内容尾部被窗口物理裁掉。

### 3.3 y=76 的来源（保持不变，但需一并说清）

- 渲染进程 DOM 固定头：`TabBar` 36px + `NavBar` 40px = 76px；
- `WebContentsView` 是原生图层，无法用 CSS 与 DOM 对齐，只能用常量下移。`y=76` 本身是正确的（两者同处客户区坐标系）；历史遗留问题只是**宽高来源**用错了 API。
- 分屏监控布局用 `NAV_HEIGHT=56`（其上方 DOM 头更矮），与 76 不一致属历史事实，本次不改动其语义，仅改尺寸来源。

## 四、修复方案

### 4.1 新增唯一来源 `view-bounds.js`

新增 `apps/desktop/electron/services/view-bounds.js`，收敛全部内嵌视图定位逻辑：

- `getContentSize(win)`：读取**客户区**尺寸。降级顺序 `getContentBounds()` → `getContentSize()` → `getBounds()`（最后一步仅为兼容极简 mock，任何一步抛错都不中断调用方，最终兜底 `{0,0}`）；
- `computeEmbeddedViewBounds(win, sidebarWidth, topOffset)`：`{ x: 侧栏宽, y: 76, width: 客户区宽−侧栏, height: 客户区高−76 }`，宽高下限 0；
- `normalizeSidebarWidth(width)`：非数字/NaN/越界（<0 或 >600）回落默认 200，与各 manager `setSidebarWidth` 的入参校验一致；
- 常量：`BROWSER_CHROME_TOP = 76`（TabBar 36 + NavBar 40）、`SIDEBAR_WIDTH_DEFAULT = 200`。

### 4.2 四个 manager 接入

| 文件 | 变更 |
|---|---|
| `webview-manager.js` | `_repositionAll()` 改用 `getContentSize(mainWindow)`；浏览器标签 `setBounds(computeEmbeddedViewBounds(...))`；`_calculatePositions` 改收客户区尺寸 |
| `auth-view-manager.js` | `_positionView()` 改为无参（内部取 `mainWindow` 客户区）；4 处调用点同步；删除本文件 `AUTH_VIEW_TOP` 魔数 |
| `qrcode-login.js` | `_positionView()` 同上；修正 217 行过时注释（该注释声称 `_positionView` 已删除，实际仍存在） |
| `oauth-manager.js` | **补上缺失的 `_positionView()`** —— 修复 `startAuth` 一进入就 `TypeError: this._positionView is not a function` 的崩溃 |

不改动：`y=76` 语义、侧栏 200/68 动态同步机制（`YixiaoerSidebar` ResizeObserver → `setSidebarWidth` IPC）、`auth-window.js`（本来就正确）。

### 4.3 布局契约（修复后的唯一正确写法）

```
内嵌视图 bounds = {
  x:      sidebarWidth          // 左侧导航栏（渲染进程动态同步，默认 200 / 窄屏 68）
  y:      76                    // TabBar(36) + NavBar(40)
  width:  客户区宽 − sidebarWidth
  height: 客户区高 − 76
}
尺寸来源：必须 mainWindow.getContentBounds()（客户区），禁止 getBounds()（外框）
坐标系：  contentView 子视图 setBounds = 客户区坐标系（与渲染进程 DOM 原点一致）
```

## 五、Bug 反思（SOP 5 步）

### ① 第一性原因溯源

内嵌 `WebContentsView` 布局代码在「登录视图内嵌迁移」（PRD-ACCOUNT-LOGIN-WINDOW.md 记录的 2026-09-08 前后重构，内嵌 → 独立窗口 → 再回内嵌）多轮往返中被反复搬运。搬运过程中：
- `auth-view-manager` 的 `AUTH_VIEW_TOP=76` 被复制到 `webview-manager`（1187 行内联魔数）与 `qrcode-login`（内联 76）各一份；
- **尺寸来源 `mainWindow.getBounds()` 从最初实现起就是错的** —— 作者把「窗口宽度」当成了「内容区宽度」。`git blame` 不可考初始提交（多次重构 squash），但 `auth-window.js` 中同期的 `getContentBounds()` 正确用法证明团队内已有正确知识，只是没有沉淀成契约。

### ② 测试逃逸链

| 层级 | 为什么没拦住 |
|---|---|
| 单元测试 | `auth-view-manager.test.js` 有布局断言，但断言的是 **`{width:1240, height:824}`——基于外框 1440×900 计算的错误值**。mock 只提供 `getBounds`，测试与实现共享同一错误假设，把 Bug 钉死成了「正确行为」（断言不精确类漏洞） |
| E2E / 视觉回归 | Electron 原生 `WebContentsView` 裁切只发生在真实窗口合成阶段；E2E 走 jsdom/mock，视觉回归只截渲染进程 DOM，**原生图层完全不在覆盖范围** |
| 代码审查 | PRD §2.1 审查过 76px 纵向偏移，但没有人质疑「尺寸从哪个 API 来」；`auth-window.js` 的正确写法未被反向推广 |

### ③ 系统性漏洞定位

- **契约缺失**：`contentView` 子视图 = 客户区坐标系、必须用 `getContentBounds()` 这一契约从未被文档化，也没有唯一实现，导致 4 个 manager 各写一份、其中 3 份沿用错误 API、1 份直接缺失方法。
- **测试假设污染**：窗口 mock 只有 `getBounds`，无法区分外框/客户区 → 测试无法表达该契约。

### ④ 修复 + 回归保护测试

- 新增 `view-bounds.test.js`（客户区优先/降级/异常兜底/布局数学/边界值）；
- `webview-manager.test.js` 新增「客户区 vs 外框」回归断言（`{x:200,y:76,width:1224,height:785}`，外框值 1240×824 会使断言失败）；
- `auth-view-manager.test.js` / `qrcode-login.test.js` 的窗口 mock 补 `getContentBounds` 并更新断言为真实客户区口径；
- `oauth-manager.test.js` 新增 `_positionView` 存在性与客户区定位回归。

### ⑤ 预防措施

- **R94（新增规则）**：`contentView.addChildView()` 的子视图 `setBounds` 必须使用 `view-bounds.js` 的 `computeEmbeddedViewBounds()` / `getContentSize()`，全仓禁止再出现 `mainWindow.getBounds()` 参与内嵌视图布局（`auth-window.js` 的 `getContentBounds()` 写法为既有正确先例）；
- 布局契约写入本文 §4.3 与 PRD 补充章节，后续新增内嵌视图（如弹窗式面板）一律复用。

## 六、验证

- 单元/回归测试：`view-bounds.test.js`（新）、`webview-manager.test.js`、`auth-view-manager.test.js`、`qrcode-login.test.js`、`oauth-manager.test.js` —— 5 文件 95 用例全绿；
- QM-1 本地打包验证：`pnpm exec electron-builder --win --dir --publish never` 通过（见 PR 记录）；
- 人工验收路径：账号管理 → 点击账号卡片 → 平台网页右侧出现完整垂直滚动条、底部设置项完整可见；拖动窗口大小后布局保持正确（`window.js resize → webviewManager.resize()` 链路沿用）。

## 七、遗留项（不在本次范围）

- 分屏监控 `NAV_HEIGHT=56` 与浏览器标签 `TOP=76` 双常量并存，属两套历史 DOM 头高度，建议后续统一到 `view-bounds.js` 并复核分屏页 DOM 结构；
- `webview-manager.js` 内仍保留 `SIDEBAR_WIDTH_DEFAULT` 本地常量（与 `view-bounds.js` 同值），可后续收敛为单一导入；
- 原生 `WebContentsView` 无法被 jsdom/视觉回归覆盖，长期可在 E2E 中加「真实窗口 setBounds 快照」用例（需有头环境）。
