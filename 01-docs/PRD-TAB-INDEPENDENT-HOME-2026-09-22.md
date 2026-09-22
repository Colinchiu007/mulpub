# PRD：浏览器新标签页独立化（内嵌应用主页）

- 日期：2026-09-22
- 状态：已批准（方案 A + 移除归位守卫，用户确认）
- 关联分支：`tab-independent-home`（worktree `D:/Data/projects/mp-worktrees/mp-tab-independent-home`）
- 优先级：P1（核心交互缺陷修复 + 功能增强）

---

## 1. 背景与问题

### 1.1 现状架构

应用窗口为"**1 个 Vue SPA 渲染进程 + N 个 WebContentsView 浏览器标签**"混合体系：

| 实体 | 实现 | 内容来源 |
|------|------|----------|
| 第一个"首页"标签（固化） | 虚拟标签 `tabId='home'`，不创建任何视图 | 主窗口唯一的 Vue SPA `router-view`，所有内部模块（账号、发布、短剧等）均运行其上 |
| "+"新建标签 | 真实浏览器标签 `btab-N` | 独立 `WebContentsView`，独立 session 分区 |

### 1.2 缺陷根因（用户感知"新标签与第一标签同步"）

1. **标题误导**：`App.vue onCreateTab()` 硬编码 `{ url: 'about:blank', title: '首页' }`，标签栏出现两个"首页"，看似复制品。
2. **无独立内容**：新标签加载 `about:blank` 空白页；"应用主页"永远只在第一标签（唯一 SPA 实例）渲染。
3. **强制归位守卫**：`App.vue` 路由守卫（`router.beforeEach`）在任何 SPA 路由变化时自动把活动标签切回 `home`，导致新标签中发起的导航总是"弹回"第一标签；且第一标签的 SPA 状态全局共享，切换标签看到的模块页面始终一致——即用户所述"同步一样"。

### 1.3 目标

新标签默认显示**应用主页**，且与第一标签的内容与操作**完全独立**，支持同时在两个标签中操作不同模块。

## 2. 用户故事

- 作为运营人员，我点击"+"打开新标签，希望它显示应用主页（与首次启动一致），以便从头进入任意模块，而不是空白页。
- 作为运营人员，我希望在标签 A 看账号管理、在标签 B 操作短剧生成，两边互不打扰：切来切去各自停留在自己最后的页面。
- 作为运营人员，我希望在新标签的地址栏输入 URL 能浏览外部网站，该行为不影响其他标签和首页标签。
- 作为运营人员，我关闭新标签后，所有其他标签的状态（页面、滚动、历史）不受影响。

## 3. 功能需求（P0）

### F1 新标签默认内容为"内嵌应用主页"

- 点击"+"（无 URL 参数）时，主进程创建的 `WebContentsView` 加载**本应用自身的 SPA 入口**并附带壳态参数：
  - 打包态：`file://<appRoot>/dist/index.html?mp-home-shell=1`
  - 开发态：`<devServerUrl>/?mp-home-shell=1`（与主窗口同源，端口受 `DEV_SERVER_PORT` 精确约束）
- SPA 检测到 `mp-home-shell=1` 进入**内嵌主页壳态（home-shell 模式）**：
  - 渲染完整工作区：左侧 MpSidebar + MpModuleNav + 模块内容（router-view），路由默认归位 `/`（首页）；
  - **不渲染**外层 TabBar 与 NavBar（标签管理归外层窗口所有）；
  - 隐藏"返回首页 go-home"等与壳态冲突的控件。

### F2 双实例完全独立

- 内嵌实例是独立的 Vue 应用：自己的 vue-router 历史栈、自己的 pinia store 实例、自己的页面滚动位置。
- 在第一标签（home 虚拟标签）切换模块，不影响任何浏览器标签的内嵌主页；反之亦然。
- 内嵌实例中点击侧边栏/模块导航 → 只导航**本标签**内容，绝不切标签、绝不改变外层窗口活动标签。

### F3 移除强制归位守卫

- 删除 `App.vue` 中"SPA 路由变化且当前非 home 标签 → 自动 `switchToTab('home')`"的 `router.beforeEach` 守卫。
- 替代交互：外层窗口侧边栏/模块导航只在 home 标签激活时才可触发（它们本来就是外层 SPA 的一部分）；从浏览器标签发起的外层导航（如 `api.onNavigate` 主进程推送）仍显式 `switchToTab(home)` 后路由，语义不变。

### F4 新标签标题

- 无 URL 创建：标题取 i18n `tabs.newTabTitle`（zh：`新标签页`；en：`New Tab`），不再硬编码"首页"。
- 标题锁定逻辑保留（调用方显式传 title 时 `titleLocked`，页面 `<title>` 不覆盖）。

### F5 地址栏行为（内嵌主页标签）

- 新标签激活时，外层 NavBar 显示：地址栏为空（或显示 `about:blank` 占位语义），placeholder 提示"搜索或输入网址"；后退/前进/刷新作用于该标签内嵌 SPA 的路由历史（WebContentsView 原生历史）。
- 用户在地址栏输入 URL/搜索词 → 本标签从"内嵌主页"导航为普通网页标签（home-shell 模式自然结束），此后标题跟随页面 `<title>`。
- 从内嵌主页导航去外部站点后，**不得**保留 electronAPI 暴露面（见安全约束 S2）。

### F6 标签生命周期

- 关闭内嵌主页标签：销毁该 WebContentsView 与其独立 session 分区（`persist:browse-btab-N`），不影响其他标签。
- 关闭活动标签后的回退逻辑不变（切相邻标签，全关则回 home 虚拟标签）。
- home 虚拟标签仍不可关闭、始终存在于标签栏第一位。

## 4. 数据校验与边界

| 项 | 规则 |
|----|------|
| 壳态参数识别 | 渲染层以 `new URLSearchParams(location.search).get('mp-home-shell') === '1'` 为唯一判据；hash 路由（createWebHashHistory）不影响 search 存续 |
| 内嵌 URL 构造 | 主进程以 `path.resolve(appRoot, 'dist', 'index.html')` + `pathToFileURL` 构造，禁止字符串拼接外部输入 |
| session 分区 | 内嵌主页标签使用与普通浏览标签相同的 `persist:browse-btab-N`（一次性的独立分区），不读写账号凭证、不挂登录网络诊断 |
| Cookie/localStorage | 内嵌主页标签不注入账号凭证（无 accountId 即跳过凭证恢复，既有逻辑天然满足） |
| 并发创建 | 连点"+"允许多个内嵌主页标签并存，各自独立 tabId/分区/实例 |
| 内嵌实例降级 | 非 Electron 环境（纯浏览器打开 Vite）无 pageManager API，home-shell 参数无消费者，正常按普通 SPA 渲染，不报错 |

## 5. 安全约束（CRITICAL，不可妥协）

- **S1 暴露面最小化**：完整 `electronAPI`（preload/index.bundle）只允许挂载到 URL 精确等于内嵌主页地址（主进程构造、含 `mp-home-shell=1`）的 WebContentsView。其他一切浏览器标签仍用受限 `monitor-preload`。判据必须是"构造时已知 URL 的精确匹配"，禁止目录级/协议级放宽。
- **S2 导航降级**：home-shell 视图 preload 首行校验 `location.href` 与期望地址一致（pathname 精确 + 查询参数存在）；不一致（被页面脚本重定向到外站）时**不暴露任何 API**，行为等同 monitor-preload 的保守子集。每个文档加载都会重新执行 preload，因此"地址栏导航到外站后 electronAPI 消失"是必然结果，需测试覆盖。
- **S3 sender 校验不受影响**：内嵌主页 view 的 senderFrame URL 仍在 `dist/` realpath canonical 边界内，`isTrustedSender` 既有白名单语义（file:// dist 边界 + DEV_SERVER_PORT 精确端口）不放宽、不修改。
- **S4 IPC 广播风暴防护**：内嵌实例不得调用 `page-manager:subscribe-events`（否则每次标签事件会对同一 mainWindow 重复广播 N 份）。
- **S5 单实例语义**：内嵌实例不注册全局快捷键类副作用、不启动后台管道轮询的重复副本；涉及全局副作用的 store 初始化（license 心跳、identity 监听）在内嵌模式下只读不写。开发期逐项验证，无法确认只读的一律在内嵌模式下禁用并记录。

## 6. 交互逻辑明细

1. 点击"+" → 新标签出现在标签栏末位、立即激活（activeTabId 切至新 tabId）→ 内容区渲染内嵌主页（与首次启动的首页视觉一致，仅无 TabBar/NavBar 外层）。
2. 点击第一"首页"标签 → 切回外层 SPA（行为不变，仍显示其自身最后停留的模块页）。
3. 标签间来回切换 → 各自保留内容与路由历史（内嵌标签靠 WebContentsView 天然保活；home 标签靠外层 SPA 天然保活）。
4. 内嵌标签内点击侧边栏 → 本标签内导航到目标模块，外层活动标签不变。
5. 内嵌标签地址栏输入 URL → 本标签变普通网页标签； NavBar 显示该 URL；此后再点"+"仍是独立主页。
6. 登录/扫码等全屏登录标签（AUTH_TAB）逻辑不变；内嵌主页中触发的"添加账号"流程按现有链路在外层打开登录标签（跨标签服务归外层管理）。

## 7. 显示项与提示文字（i18n，zh/en 成对）

| key | zh | en | 位置 |
|-----|----|----|------|
| `tabs.newTabTitle` | 新标签页 | New Tab | 新标签初始标题 |
| `tabs.newTabAria` | 新建标签页 | New tab | "+"按钮 aria/tooltip（已有硬编码中文迁入 locales） |
| `navBar.searchPlaceholder`（如缺） | 搜索或输入网址 | Search or enter URL | 新标签地址栏 placeholder |

- 新增用户可见文案一律写入 `src/locales/zh.js` + `en.js`（CI Gate 7 locale 成对检查）；渲染层不再新增中文字符串字面量。

## 8. 验收标准

1. 点击"+"，新标签显示应用主页（sidebar + 模块导航 + 首页内容），标题为"新标签页"（英文环境"New Tab"）。
2. 在第一标签进入"账号管理"，在新标签进入"热门选题"；两标签往返切换，各自页面保持不变。
3. 新标签内点击侧边栏任意模块，活动标签不发生切换，第一标签内容不受影响。
4. 新标签地址栏输入 https 站点，本标签导航为网页；此时在该页面控制台访问 `window.electronAPI` 为 undefined；第一标签与其他标签不受影响。
5. 关闭新标签，其 session 分区视图被销毁；其余标签状态无变化。
6. `node_modules` 全量单测通过；新增回归测试覆盖：默认主页 URL 构造、preload 选择矩阵（home-shell vs 普通 vs 外站重定向）、归位守卫移除、标题 i18n。
7. QM-1 打包验证通过（electron-builder --win --dir + asar 清单 + require 链 + 8 秒启动无 stderr 报错）。
8. CI 全绿并合并。

## 9. 非目标（Out of Scope）

- 多窗口（BrowserWindow 级）主页；
- 新标签"快捷方式/最近打开"个性化启动页（后续迭代）；
- 内嵌主页标签间的 store 实时同步（两实例数据一致性依赖后端落盘，UI 层不互相同步——这正是"独立"的定义）。

## 10. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| preload 暴露面放宽被外站利用 | 高 | S1 精确 URL 判据 + S2 导航降级 + 负向测试（外站无 electronAPI） |
| 双 SPA 实例全局副作用重复（心跳/管道/通知） | 中 | S5 清单化禁用项；dogfooding 观察日志重复计数 |
| 移除归位守卫后旧操作路径失联（浏览器标签点侧边栏期望弹回） | 低 | F3 替代交互：外层侧边栏仅 home 标签可见时才可点；行为变更写入 CHANGELOG |
| 内嵌实例内存开销（双 SPA） | 低 | 每标签独立分区已有先例；主页标签数不做限制，用户关闭即释放 |

## 11. 测试计划（TDD，先红后绿）

| 层 | 文件 | 场景 |
|----|------|------|
| 主进程单测 | `electron/services/webview-manager.test.js` | 无 URL 创建 → loadURL 收到 home-shell 地址；有 URL 创建 → 行为不变；preload 选择：home-shell 用 index.bundle，其余用 monitor-preload；打包/未打包两种 isPackaged 状态 |
| preload 单测 | `electron/home-shell-preload.test.js`（新） | 期望地址一致 → 暴露 electronAPI；pathname 不符/缺参数/外站 → 不暴露 |
| 渲染层单测 | `src/App.test.js`（新/扩展） | home-shell 模式判定；归位守卫已移除（浏览器标签路由变化不触发 switchToTab）；"+" 创建参数（标题 i18n、无 about:blank 硬编码） |
| store 单测 | `src/stores/tab.test.js` | createTab 默认参数不含 title:'首页' |
| locale 门禁 | CI Gate 7 | zh/en 成对 |
| 视觉回归 | 现有 `test:visual:pixel` 集 | 新标签主页截图基线 |

## 12. 文档与追溯

- 本 PRD 随 PR 提交至 `01-docs/PRD-TAB-INDEPENDENT-HOME-2026-09-22.md`；
- CHANGELOG 记录：行为变更（归位守卫移除）+ 新功能（独立主页标签）；
- 实现决策（preload 双判据、S5 副作用清单）落地后回写本文档 §5/§10。

## 13. 实现决策回写（落地后，2026-09-22）

### 13.1 preload 双判据最终形态（收口 §5 S1/S2）

`electron/home-shell-preload.js` 采用两个相互独立的判据，**同时成立**才 `require('./preload/index.js')` 暴露完整 `electronAPI`：

1. **主进程注入信任锚**：创建内嵌主页 `WebContentsView` 时经 `webPreferences.additionalArguments` 注入 `--mp-home-shell-url=<expected>`。`expected` 由主进程以 `pathToFileURL(path.resolve(appRoot,'dist','index.html')) + '?mp-home-shell=1'`（打包）或 `getUrl(devServer) + '/?mp-home-shell=1'`（开发）构造，禁止拼接任何外部输入。渲染端脚本无法伪造该 argv（它来自进程启动参数，非页面可控）。
2. **文档同源 + 参数存续**：`new URL(location.href).origin === new URL(expected).origin`，且 `location.search` 与 `expected` 的 search **都**严格命中 `mp-home-shell=1`。判据解析 `hasHomeShellParam` **先去前导 `?` 再按 `#` 切分**取 query 段，`URLSearchParams.get('mp-home-shell') === '1'`（字符串严格比较，`=0`/缺失/被污染均不通过）。

无论判据是否通过，`multiPublishMonitor` 受限监控桥始终暴露（与 `monitor-preload` 同级能力）。

- **降级必然性**：Electron 每个文档加载都会重新执行 preload，故内嵌主页地址栏导航到外站、或页面脚本 `location.replace` 跳外站时，判据 2 失败 → 新文档不再暴露 `electronAPI`，行为等同 `monitor-preload`。`home-shell-preload.test.js` 以「外站重定向 / 同目录参数剥离 / `=0` / 未注入 argv」四类负向用例锁定。
- **S3 sender 校验未放宽**：内嵌主页 view 的 `senderFrame.url` 仍在受信 `dist/` realpath canonical 边界（打包）/ `DEV_SERVER_PORT` 精确端口（开发）内，`isTrustedSender` 白名单语义零改动。

### 13.2 S5 全局副作用清单（内嵌模式下逐项禁用）

内嵌主页实例是独立 Vue 应用，以下全局副作用在 `isHomeShell === true` 时的处置：

| 副作用 | 处置 | 落点 |
|--------|------|------|
| `tabStore.init()`（含 `subscribeEvents` 订阅 `page-manager:*` 广播） | **禁用** | `App.vue onMounted`：`if (!isHomeShell) tabStore.init()` |
| `setShellMode` 壳态互斥上报 | **禁用** | `App.vue` `watch(isHomeShell)` 早返回：内嵌实例是「被管理者」，上报 workbench 会令主进程隐藏含自身在内全部视图 |
| `api.onNavigate` 主进程路由推送订阅 | **禁用** | `App.vue onMounted`：`if (api && api.onNavigate && !isHomeShell)` |
| `tabStore.dispose()` 卸载清理 | **禁用** | `App.vue onBeforeUnmount`：`if (!isHomeShell) tabStore.dispose()` |
| `licenseStore.load()` / `identityStore.load()` | **保留（只读加载）** | 内嵌实例需展示登录态/许可，二者为幂等只读拉取，不写全局、不注册心跳 |
| 账号凭证注入 / 登录网络诊断 | **天然不涉及** | 主进程 `createNewTabPage` home-shell 分支 `accountId = null`，凭证恢复与诊断挂载均以 `accountId` 为前提，自动跳过 |
| session 分区 | 独立一次性分区 | 复用 `persist:browse-btab-N`，与首标签（外层 SPA，无独立分区）及账号标签互不读写 |

**开发期验证方式**：`home-shell-preload.test.js` 的 `exposedWorlds` 负向断言 + `webview-manager.test.js` 的 home-shell describe（loadURL 收地址 / preload 选择 / `additionalArguments` / 广播 `url=''` / 账号分区 `cookies.setCalls=0`）。残留风险（如某 store 隐藏写入）在 dogfooding 阶段按日志重复计数逐项排查，无判据一律禁用。

### 13.3 F1 模板分支与内容矩形对齐

内嵌主页是 `WebContentsView`，主进程仅将其定位在**内容矩形**（x>sidebarWidth、y>TAB+NAV=76px）。若 `App.vue` 在内嵌实例内仍渲染 `MpSidebar`/`TabBar`/`NavBar`，会在内容矩形里重复画出一份外层 chrome（双份侧栏 + 双份标签栏），故新增 `v-else-if="isHomeShell"` **独立模板分支**：仅 `MpModuleNav` + `.mp-workspace`（`router-view`），外层 chrome 一律不渲染。`tab-independent-home.test.js` 以源码契约锁定该分支不含 `<MpSidebar`/`<TabBar`/`<NavBar`。

### 13.4 测试基础设施修正（非功能，随本次一并落地）

- `electron/home-shell-preload.test.js` 的 `exposedWorlds` 参照既有 `electron/preload.test.js` 模式，临时把 `contextBridge.exposeInMainWorld` 替换为 `vi.fn()` 记录暴露世界名（`test-setup` 的默认为无记录空函数），测后 `afterEach` 还原。
- 因 `home-shell-preload.js` 用**裸 `require('./preload/index.js')`**（Node CJS 缓存，`vi.resetModules()` 清不掉），单次测试进程内第二次正向加载会命中缓存而不再执行 `exposeInMainWorld('electronAPI')`。测试侧以 `createRequire` 逐次 `delete _req.cache[...]` 规避；**生产环境每个 `WebContentsView` 都是 fresh 渲染进程，无此问题**，纯属单测隔离。
- 将该测试文件显式加入 `vitest.config.js` include（与 `electron/preload.test.{js,ts}` 同级），否则默认 include 不覆盖 `electron/` 根目录散测文件，安全负向用例不会在 CI 执行。
- `shell-mode-6b.test.js` 的 App.vue watch 正则放宽为 `[\s\S]*?`，以容忍 watch 体内为 S4 新增的 `if (isHomeShell) return` 前置守卫行，同时仍断言 `setShellMode` 上报调用存在（不削弱原契约意图）。
