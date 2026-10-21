# PRD：导航必须「可见」—— 快捷键与鼠标共用一段实现（UX 审计 1.5）

- 变更名：`ux-audit-visible-navigation`
- 日期：2026-10-21
- 关联规格：`openspec/changes/ux-audit-visible-navigation/specs/desktop-ui-consistency/spec.md`
- 关联审计项：阶段 1 的 1.5（`01-docs/UX-AUDIT-2026-10-17.md`）

## 1. 问题与现场取证

### 1.1 现象

同一个"去发布页"动作，两种输入方式结果不同：

| 用户此刻聚焦在 | 鼠标点左侧边栏 | 按全局快捷键 `Ctrl+Alt+P` |
|---|---|---|
| 首页标签（主窗口 SPA） | 可见跳转 | 可见跳转 |
| 普通网页标签（原生 `WebContentsView` 覆盖层） | **先切回首页标签**再跳 → 可见 | 只推主窗口路由 → **屏幕上什么都没发生** |
| 内嵌主页实例（home-shell，独立 SPA 实例） | 经 IPC 定向让该实例自己跳 → 可见 | 只推主窗口路由 → 那个实例没动，且主窗口多出一条它看不见的路由（两侧从此漂移） |

第二、三行的用户侧描述就是审计报告里的"按了没反应"。它不是慢，不是失败，是**跳转发生在看不见的背后**，
因此没有任何错误提示可依赖，也没有日志痕迹。

### 1.2 链路取证（逐跳，可重跑）

```
主进程注册全局加速键      apps/desktop/electron/services/hotkeys.js:58
  → win.webContents.send('app:navigate', config.route)
渲染层订阅               apps/desktop/src/App.vue（onMounted 内）
  → unsubscribeNavigate = api.onNavigate((route) => router.push(route))   ← 缺陷落点
鼠标侧（正确实现）        apps/desktop/src/layouts/MpSidebar.vue:194-214（改造前）
  → onNavClick：三段式（定向 home-shell / 切回首页标签 / 才 push）
```

取证命令（判"两处判断各写一遍"）：

```bash
git grep -n "navigateActiveHomeShell" -- apps/desktop/src   # 改造前只命中 MpSidebar.vue
```

**根因判定**：不是"App.vue 漏了一个 if"，而是**同一段判断被抄了两遍**，其中一遍没抄全。
因此修法不是补 if，而是把判断收敛为单一实现，并锁住"不得有第二份"。

### 1.3 与阶段 3.2 的关系（不冲突声明）

审计 §5 的依赖定序写着"3.2（导航真源收敛到 `route-registry` 派生）先于 1.5，或让 1.5 直接消费派生结果"。
本单元**不产路由清单**——它收敛的是"该跳到哪一面"这条**决策**，路由字符串由调用方原样传入
（侧边栏来自 `SIDEBAR_MENU_DEFINITION`，快捷键来自 `hotkeys.js` 的 `config.route`）。
因此 3.2 落地后本实现无需改动即可继续作为唯一消费点；两条不重叠。

## 2. 方案

新增 `apps/desktop/src/composables/useVisibleNavigation.js`，导出
`useVisibleNavigation({ tabStore, router, apiGetter, warn }) → { navigateVisibly }`。
两个入口（`App.vue` 的 `app:navigate` 订阅、`MpSidebar.vue` 的 `onNavClick`）都调它，
组件内不再保留任何"该跳哪一面"的判断。

## 3. 交互逻辑（三段 + 三条降级纪律）

### 3.1 主流程

```
navigateVisibly(to)
  ├─ 入参校验：typeof to !== 'string' || !to → 直接不动作
  ├─ A 段 tryNavigateHomeShell(to)
  │    ├─ tabStore.activeTabIsHomeShell 为假 → 返回 false（不得误发定向 IPC）
  │    ├─ 取桥失败 / 无该方法 → 返回 false
  │    ├─ await pageManager.navigateActiveHomeShell(to)
  │    └─ 仅当回执 code===0 且 data.handled===true → 返回 true → 【到此收口，不再做任何跳转】
  ├─ B 段 ensureVisibleTab()
  │    ├─ tabStore.isHomeTab → 返回（已在首页标签，不发多余 IPC）
  │    ├─ tabs 里找不到 isHome 的标签 → 返回（不抛错，仍继续跳转）
  │    ├─ activeTabId === homeTab.tabId → 返回（已是那条标签，不重复切）
  │    └─ await tabStore.switchToTab(homeTab.tabId)；抛错 → warn 后继续
  └─ C 段 await router.push(to)；抛错 → warn，不外泄
```

顺序不可反：**先切标签，后推路由**。反序会先改主窗口路由再换可见面，用户在覆盖层背后完成跳转，
与缺陷形态同构。

### 3.2 数据校验与入参契约

| 输入 | 判据 | 行为 | 理由 |
|---|---|---|---|
| `'/publish'` | 非空字符串 | 走完三段 | 正常目标 |
| `'/'` | 非空字符串 | 走完三段 | **回首页是合法目标**，且它是真实流量：`hotkeys.js:24` 注册了 `CmdOrCtrl+Alt+H → route: '/'`。真值判空会让这一格静默失效 |
| `''` / `null` / `undefined` | 非字符串或空 | 不动作 | 主进程 payload 破坏时不得"跳到空路径" |
| `42` / `{}` | 非字符串 | 不动作 | 只做 `!to` 判空会放它们过 `router.push` |

| 回执形态 | 判定 | 后续 |
|---|---|---|
| `{ code: 0, data: { handled: true } }` | 已接管 | 收口，不再切标签、不再 push |
| `{ code: 0, data: { handled: false } }` | 未接管（主进程判活动标签非 home-shell） | 回落 B+C |
| `{ code: 0, data: {} }` / `{ code: 0 }` / `{ code: -3 }` / `null` | 无有效回执 | 回落 B+C |
| 抛异常 | 桥断开 | `warn('[sidebar] navigate home-shell failed')` 后回落 B+C |
| 无 `pageManager` / 无该方法 | 宿主不支持（纯浏览器 dev、旧 preload） | 直接 B+C，不抛错 |

**口径**：「没拿到回执」绝不等于「已处理」。把它读成已处理会让快捷键导航静默失效（用户按了没反应、
日志零痕迹）——这正是本单元要消灭的形态，不得在修复里再造一个。

**上游取值面事实**（决定入参契约的边界）：`hotkeys.js` 的 10 组注册里只有
`CmdOrCtrl+Alt+Q → route: '__quit__'` 不是路由，它在主进程内就被 `win.destroy()` 拦下
（`hotkeys.js:46-49`），**永不下发给渲染层**；因此 `navigateVisibly` 不需要为哨兵值特判，
也不得为此加一层"猜测式白名单"（那会把新增真实路由变成需要两处同步的欠账）。

### 3.3 提示文字与显示项

本单元**不新增任何用户可见文案**（无 locale 变更、无新节点、无新样式），因此：

- 不在像素判定域内（无新基线、无需刷基线）；
- 不新增可聚焦元素，阶段 3.6/4.4 的键盘可达与焦点环基线不变；
- 唯一的"可观测变化"是行为本身：停在网页标签按快捷键时，TabBar 会先高亮首页标签，随后主窗口显示目标页。

诊断痕迹（非用户可见，走 `console.warn`）三条，措辞沿用改造前 `MpSidebar` 的同款前缀，
以便历史日志检索不断链：
`[sidebar] navigate home-shell failed` / `[sidebar] switch home failed` / `[sidebar] navigate failed`。

## 4. 依赖注入口径（实现约束，非偏好）

组合式不 import `@/api/electron-bridge`，桥由调用点以 `apiGetter: () => getApi()` 注入。两条实测理由：

1. Vite 的 `vi.mock` 工厂缺具名导出时，**访问期**抛
   `No "getApi" export is defined on the "@/api/electron-bridge" mock`。
   若在组合式里 import，则每个 mock 桥接层的既有夹具（实测 3 个文件、26 条用例）整片变红。
2. 在 setup 期取 `getApi` 这个函数本身（`apiGetter: getApi`）同样是访问——实测红的那 26 条
   就是这么来的。因此必须是惰性箭头 `() => getApi()`，把访问推迟到真正需要定向的那一刻。

代价是"调用点漏传"不会编译失败，只会让定向分支恒不生效 ⇒ 用装配锁补：
逐个生产调用点断言参数面含 `apiGetter` 与 `getApi`，并对**全仓调用点集合**做等值断言
（新增入口未登记即红）。

## 5. 验收标准

| # | 判据 | 取证方式 | 结果 |
|---|---|---|---|
| V1 | 停在网页标签按快捷键 ⇒ 顺序恒为 `switch:home` → `push` | `App.visible-navigation.test.js`（真 tab store + 假桥 + 顺序账本） | ✅ |
| V2 | 聚焦内嵌主页实例且回执 `handled:true` ⇒ 只定向，不切标签、不 push | 同上 | ✅ |
| V3 | 无有效回执的 4 种形态 + 抛错 + 缺桥 ⇒ 一律完成主窗口跳转 | `useVisibleNavigation.test.js` | ✅ |
| V4 | 已在首页标签 ⇒ 不多发一次切标签 IPC | 两层各一条 | ✅ |
| V5 | `'/'` 是合法目标；`''`/`null`/`42`/`{}` 不动作 | 同上 | ✅ |
| V6 | 卸载后不得有幽灵跳转（`onNavigate` 的 stop 被调用且回调不再触发） | `App.visible-navigation.test.js` | ✅ |
| V7 | 两条入口共用同一实现；任一处再自带一份判断即红 | 3 条结构锁（扫描域排除注释行） | ✅ |
| V8 | 10 道变异逐条指名变红 | `node scripts/visible-navigation-contract-mutate.js` | ✅ `CAUGHT=10 其余=0` |
| V9 | 既有侧边栏/壳层用例不回归 | `vitest run src` 全量：**Test Files 405 ⇒ 2 failed / 403 passed；Tests 6421 ⇒ 2 failed / 6417 passed / 2 skipped** | ✅（两条红是 `preload index.bundle.js 已重打包`×2，读的是**非受管构建产物**，本 worktree 未跑打包步骤；归因与取证见执行记录 §二） |
| V10 | 本批新增面自身 | 三个文件单跑：**34 passed**（组合式 19 + App 9 + 侧边栏既有 4），rc=0 且无 `Errors` 行 | ✅ |

## 6. 反证（10 道，全部实跑）

| # | 注入的被禁形态 | 落点 | 红条数 |
|---|---|---|---|
| M1 | App.vue 回退为裸 `router.push` | `App.vue` | 4 |
| M2 | 侧边栏不再复用共享实现 | `MpSidebar.vue` | 5 |
| M3 | 调用点漏传 `apiGetter` | `App.vue` | 3 |
| M4 | 无视 home-shell（恒不定向） | composable | 6 |
| M5 | 「调用过 IPC」当成「已处理」 | composable | 6 |
| M6 | 摘掉「已是 home 标签就不重复切」的 id 比较 | composable | 1 |
| M7 | 顺序反转（先 push 再切标签，整函数体替换） | composable | 3 |
| M8 | 入参判据退化为真值判空 | composable | 2 |
| M9 | 定向成功后不收口 | composable | 3 |
| M10 | IPC 抛错被读成「已处理」 | composable | 1 |

两条**关于反证本身**的实测更正（不写下来就会被下一个会话重抄）：

1. **M6 的第一版零条红**。它摘的是 `if (tabStore.isHomeTab) return`，而后面那道
   `activeTabId === homeTab.tabId` 比较把同一种状态又挡了一遍 —— 前者是冗余防御，
   **有牙的是 id 比较**。变异必须打在生效的那一格里，否则这条 M 是恒真的装饰。
2. **M7 的第一版是 `PROBE_BLIND`**。多行片段替换留下了悬空的 `} catch {}`，vitest 在解析期就失败，
   汇总行缺失 ⇒ 既不能判 CAUGHT 也不能判 MISSED。改为**整函数体替换**保证可编译。

驱动另有两条不可省的口径：基线不干净（`rc≠0` / 有 failed / `Errors>0`）一律拒跑（退出码 2）；
还原动作放 `finally`，但**自报不作数**——跑完逐文件 md5 回读比对，不等即退出码 4。

## 7. 遗留（不假装已闭合）

1. 反证驱动目前仍是**手动跑**（与 `publish-staleness-contract-mutate.js` 等三条同批欠账，任务 #23）：
   它接进 CI 需要一条不吃 30 分钟预算的落点，本批不擅自决定。
2. `MpSidebar.onNavClick` 与快捷键现在同源，但**第三个入口**（命令面板 / 托盘菜单 / `TabBar` 的
   「新标签」按钮里那些直接 `router.push` 的分支）尚未收敛。调用点集合锁会在有人新增
   `useVisibleNavigation(` 而未登记时红，但**不会**把仍在裸 push 的旧入口拉进来——
   那需要一条"裸 router.push 的导航入口"清点，属阶段 3.2/5.x 的域。
3. 键盘路径的**可见性**只能由行为锁证明（顺序账本 + 定向不回落）。真实 Electron 里"覆盖层背后
   跳转看不见"这一现象需要人眼或像素级观测；本批未做真机验证，故不声称"已在真机确认"。
