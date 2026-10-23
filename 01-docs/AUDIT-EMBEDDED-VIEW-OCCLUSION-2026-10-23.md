# 审计报告：内嵌原生视图遮挡 DOM 的全仓通查

- 日期：2026-10-23
- 类型：只读审计（audit）+ 缺陷清单
- 触发事件：用户报障「打开自媒体账号创作者中心等外部网页标签后，点击左下角头像菜单里的『会员中心』，界面没有反应」
- 配套修复与契约：`01-docs/PRD-APP-ROUTE-NAV-VISIBILITY-2026-10-23.md`
- 上游合同：`01-docs/PRD-OVERLAY-VIEW-SUSPENSION-2026-09-23.md`（浮层互斥）

---

## 0. 判据基础（审计的唯一依据）

### 0.1 两层结构与覆盖矩形

主窗口是「渲染进程 DOM + 主进程原生视图」两层：

- **渲染进程 DOM**（侧边栏 / 标签栏 / 导航栏 / 路由页面 / toast / 模态框）= **最底层**；
- **外部网页**（创作者中心 / 登录页 / 扫码页 / OAuth 授权页）由主进程 `WebContentsView` 承载
  = **永远压在 DOM 之上、且 CSS `z-index` 对其无效**的原生合成图层。

覆盖矩形（客户区坐标，唯一真源 `apps/desktop/electron/services/view-bounds.js` 的
`computeEmbeddedViewBounds`，`BROWSER_CHROME_TOP = 76`）：

| 边 | 取值 | 说明 |
|---|---|---|
| `x` | `collapsed ? 0 : normalizeSidebarWidth(sidebarWidth)` | 默认 200px；**全局折叠态为 0（横跨整窗宽）**；68px 是窄窗 CSS 轨道那一档，与原生视图 bounds 无关 |
| `y` | `76`（= TabBar 36px + NavBar 40px） | 固定常量，**主进程不读渲染进程实际 DOM 高度** |
| 底 | 窗口客户区底部 | |

> ⚠️ **两处常见口径错误，本报告已订正**：
> ①「折叠后 x=68」—— 错，源码是 `collapsed ? 0`；
> ②「原生视图会盖住侧边栏」—— 仅在**未折叠**时成立；折叠态下 x=0，侧边栏被完全盖住
> （这正是侧栏折叠按钮必须同步上报主进程的原因）。

### 0.2 两套互斥机制（判定「是否已受保护」只能用它们）

| 机制 | 作用对象 | 实现 | 触发 |
|---|---|---|---|
| **壳态互斥** | 让**应用内页面**可见 | `App.vue` `watch(isHomeTab)` → `setShellMode('workbench'\|'browser')` → 主进程隐藏/显示全部内嵌视图 | 活动标签是不是首页虚拟标签 |
| **浮层互斥** | 让**应用级模态浮层**在原生视图活动时可见 | `useEmbeddedViewSuspension` → IPC `page-manager:suspend-embedded-views` / `resume-embedded-views` → 主进程按 owner 引用计数隐藏内嵌视图 | 模态浮层开合 |

> **关键分野（本次审计最重要的认知）**：
> 「被原生图层挡住」有两种完全不同的解法 ——
> **模态浮层**要的是「原生图层让位」（挂起视图）；
> **路由页**要的是「活动标签回到首页虚拟标签」（切标签）。
> 只治理其一，另一半必然漏 —— 本次报障正是「路由页」那一半，而既有合同只治了「浮层」那一半。

### 0.3 审计范围与方法

三路并行只读审计：

| 轨道 | 范围 | 方法 |
|---|---|---|
| A · 全局壳层入口 | `App.vue` 及全部 App 级常驻组件、侧边栏、头像菜单、顶栏 | 逐入口判定「触发时活动标签可能是原生视图吗 / 结果渲染在哪 / 落在覆盖区吗 / 缺哪套机制」 |
| B · 浮层登记表完整性 | `apps/desktop/src` 下 **550 个非测试 `.vue`/`.js` 文件** | 枚举全部浮层形态（`el-dialog`/`el-drawer`/`el-popover`/`ElMessageBox`/`ElMessage`/`ElNotification`/自绘 `position: fixed`/手写 `role="dialog"` 遮罩），逐个读出真实 CSS 坐标；与登记表逐条对照 |
| C · 主进程原生视图族 | `apps/desktop/electron/**` | 枚举**全部 5 个会创建原生视图的 `WebContentsView` 家族**与 **10 处 `BrowserWindow` 创建点**，判定各自被两套开关覆盖与否 |

产出：**71 条逐项判定记录**，展开覆盖 **92 个浮层实例**；
「已受保护」20+ 条、「疑似但已排除」19 条，均带 `file:line` 证据。

> **检索纪律**：本仓历史文档含 NUL 字节，`grep`/`rg` 默认判为二进制并静默跳过 ⇒
> 凡以「扫到 0 命中」作为结论，一律用 `grep -rna` / `rg -a` 并当场确认扫描器没把这些文件当二进制。

---

## 1. 缺陷清单

| # | 严重度 | 位置 | 症状 | 根因 | 处置 |
|---|---|---|---|---|---|
| **D1** | **P0** | `src/components/ProfileMenu.vue` `goMemberCenter()` | 头像菜单 →「会员中心」界面无反应 | 裸 `router.push`：路由变了、活动标签没变 ⇒ 页面渲染在原生图层背后 | **本次修复**：改为 `emit('navigate', ...)` 交回侧边栏既有的可见导航范式 `onNavClick` |
| **D2** | **P0** | `src/layouts/MpSidebar.vue` `@upgrade` | 头像菜单 →「升级 Pro」界面无反应 | 同上 | **本次修复**：改为 `onNavClick('/member-center')` |
| **D3** | **P0** | `src/App.vue` `api.onNavigate` 回调 | 9 个全局快捷键（`CmdOrCtrl+Alt+P/D/C/H/N/A/K/V`、`CmdOrCtrl+Comma`）在外部网页标签下全部无反应 | 同上 | **由 PR #4209 修复**（已全绿在飞；本 PR 不重复实现，避免主干出现两份同义范式） |
| **D4** | P1 | `src/views/ResultView.vue`「故事讲述」异步完成通知模态 | 生成完成信号丢失（模态被盖住） | 模态由**后台完成回调**打开（非用户点击）⇒ 触发时活动标签可能已是外部网页标签 | **本次修复**：接入浮层互斥（owner `story2video-notification-dialog`） |
| **D5** | P1 | `src/components/UpdateNotification.vue:52` | 「更新失败」告警被盖住，用户无从知晓 | App 级常驻浮层落在覆盖区；既有合同 §6 记为「瞬时非模态残余限制」 | 后续项（§2 F1） |
| **D6** | P1 | `src/components/PublishProgressPanel.vue:207` | 发布进度浮卡 + 最小化胶囊双双不可见（发布任务以分钟计，**高频**） | 同上；且 `PublishProgressPanel.test.js:579` 有**负向锁**断言源码不得出现 `suspendEmbeddedViewsForOverlay` | 后续项（§2 F2） |
| **D7** | P1 | `src/components/PipelineBackgroundToast.vue:36` | 「已在后台运行」居中 toast 被盖住 | 同上；且合同 §5 把它写成「右下 toast」与实现（居中）不符 | 后续项（§2 F3）+ **本次已订正文档表述** |
| **D8** | P1 | `src/components/OfflineIndicator.vue:22` | 断网时 NavBar 的地址栏输入框与「保存账号」按钮**点不动** | 横幅是 `.app-root` 流内 flex 子项（无 `position`），断网时把整个 `.mp-shell` 下推约 35px ⇒ **破坏 76px 坐标契约** ⇒ 原生视图（固定 y=76）盖住 NavBar | 后续项（§2 F4）—— 根因是坐标契约而非遮挡族 |
| **D9** | P1 | `electron/services/oauth-manager.js:146` + `webview-manager/layout.js:36-42,76-82` | OAuth 授权页开着时，**连已受保护**的设置弹窗 / 关标签确认框都被盖住 | `_hideAllTabs` 只隐藏 tabs/auth/qrcode，**不含 OAuth 视图**；而 OAuth 视图 bounds 与其它内嵌视图一致（x=200/y=76） | 后续项（§2 F5）—— 机制级盲区 |
| **D10** | P1 | `src/views/CreateView.vue:4952` / `:4954` | 「下载历史视频」的完成/失败提示**根本弹不出来** | 这两个方法**只在 `views/ResultView.vue` 定义**（`:927`/`:934`），`CreateView.vue` 无定义、无 mixin ⇒ 运行时 TypeError；catch 分支再调另一个不存在的方法 ⇒ 二次 TypeError 逃逸出 catch | 后续项（§2 F6）—— 与遮挡无关的独立缺陷 |
| **D11** | P2 | `src/components/SidebarServiceStatus.vue` `el-popover` | 宽 300px，右缘约 100px 落入覆盖区（部分遮挡） | popover 宽度 > 侧栏宽 | 低危，可选修（收窄宽度或 `teleported=false`） |

### 1.1 关于 D10 —— 审计结论被源码否证的实例

审计轨道 B 报告称「`CreateView.vue:4952/4954` 是与 `ResultView` 同型的通知模态」。**逐条复核后不成立**：
该两行调用的是 `this.showStory2VideoNotification(...)` 与 `this.showStory2VideoOperationFailure()`，
而这两个方法**只在 `ResultView.vue` 里定义**（`:927` / `:934`），`CreateView.vue` 既无定义也无 mixin
⇒ 那不是「模态被盖住」，而是「调用即 TypeError」的另一类缺陷（D10）。

同一条报告给出的「侧栏折叠 68px」也被源码订正为「全局折叠态原生视图 x=0」。

> **教训**：审计结论必须**回到源码逐条复核**才能落进修复。
> 「报告说是」不等于「代码是」—— 同一条报告里两处细节都错，而其中一处还牵出一个与遮挡无关的真缺陷。

---

## 2. 后续项（本次不做，含判定依据）

| # | 事项 | 为什么本次不做 | 方案 |
|---|---|---|---|
| F1 | `UpdateNotification` 告警被盖住 | 属既有合同 §6 明确记录的「瞬时非模态」残余限制；接入挂起会与合同口径冲突 | 告警迁到不被覆盖的 chrome 条（y<76），或主进程独立 alwaysOnTop 窗口 |
| F2 | `PublishProgressPanel` 进度被盖住 | **负向锁** `PublishProgressPanel.test.js:579` 断言源码不得出现 `suspendEmbeddedViewsForOverlay` —— 强行接入会让既有锁变红；且挂起会在用户正看着的标签上强制隐藏视图 | 保留负向锁，按 F1 方向治理并更新合同 §5 的用户可感知后果描述 |
| F3 | `PipelineBackgroundToast` 居中 toast 被盖住 | 同 F1；且合同 §6 的排除理由（「生命周期短、闪烁损失大于收益」）**对居中 toast 不成立**（居中被盖的观感损失远大于右下） | 登记 owner 或改位置；**本次已先订正合同 §5 的「右下」表述** |
| F4 | 离线横幅破坏 76px 坐标契约 | 根治需主进程按渲染进程上报的**实际 chrome 高度**重算内嵌视图 bounds（`computeEmbeddedViewBounds` 的 `topOffset` 参数已存在但未接线；可沿用 `setSidebarWidth` 的先例）⇒ 需改 preload 暴露面 + 重打包 bundle + 视觉基线重建，**与本缺陷不成比例** | 主进程感知实际 chrome 高度 |
| F5 | OAuth 视图不参与两套互斥 | 属主进程改动：`setShellMode` 与 `suspendEmbeddedViewsForOverlay` 两处都要纳入 OAuth 视图的 hide/show | 主进程侧统一纳管 |
| F6 | 下载历史视频的提示调了不存在的方法 | 与遮挡无关的独立缺陷；需先决定 CreateView 侧用「错误对话框」还是「toast」承接下载结果 | 另开 PR |

---

## 3. 已排查并排除（不复查）

| 条目 | 排除依据 |
|---|---|
| 头像菜单面板本身 | 在侧边栏内（x < 侧栏宽），不越出原生图层覆盖区 |
| 标签栏（y ∈ [0,36)）与导航栏（y ∈ [36,76)）内的一切 | 恒 y < 76，原生视图永不覆盖（**例外见 D8**） |
| 顶部 toast（`ElMessage` / `ElNotification`） | Element Plus 默认 `position: fixed; top: 16px` ⇒ y ∈ [16,56) < 76；本仓未覆写该定位（`premium-design-system.css` 只改 `.el-message-box`） |
| `App.vue` 的 `goHome()` | **先 `switchToTab(home)` 再 `router.push('/')`** —— 已核对源码，属正确范式，不冤枉 |
| `App.vue` 的 `retryRouteLoad()` / `refreshRouteLoad()` | 按钮在工作区内（`margin: 48px auto` ⇒ y ≥ 124），外部网页活动时本就点不到；不构成「点了没反应」 |
| `App.vue` 的 `home-shell-navigate` 回调 | 目标就是该 home-shell 实例自身的 router，页面在它内部渲染 ⇒ 可见 |
| `App.vue` 的设置弹窗 / 关标签确认框 | 已接入浮层互斥（`settings-dialog` / `tab-close-confirm`），suspend/release 成对、release 走 finally |
| `App.vue` 的「保存账号」结果 toast、定时派发失败 toast | 顶部 toast（y<76） |
| 页面内浮层（`ResultView` 的 `sceneMaterialPreview` / `unsavedLeaveDialog` / `scriptModalVisible`；`CreateView` 的 13 个 BGM 等） | 打开它们的唯一入口就在该页面内 ⇒ 能打开即说明当前显示的是该页面 ⇒ 活动标签是首页虚拟标签 ⇒ 原生视图不可见 |
| `main.js` 的全局风控确认框 | 触发点在首页工作区内的视图（`RiskSuspendedBanner`）⇒ 当前不可达；**若将来提到壳层/外部事件触发，必须补 suspend** |
| `Accounts.vue:1363` `.login-state` / `:1369` `.login-qr-preview` | 几何上必落覆盖区，但模板与 `:class` 绑定**零使用** ⇒ 死 CSS，不报 |
| 浮层登记表的 11 个 owner | 逐条复核：**无漏登、无重名、suspend/release 成对率 100%** |
| `useNotify` 的 `notifyConfirm` | 页面内触发路径（`RiskSuspendedBanner`），当前不可达 |

---

## 4. 登记表本身的缺陷（轨道 B 实证）

| # | 缺陷 | 影响 |
|---|---|---|
| R1 | 登记表是**硬编码 allow-list、零目录扫描** | 新增任何未登记的浮层，**登记表不会产生任何变红** —— 「登记表完整」这件事测试本身无法证伪 |
| R2 | 9 处断言**可被 `//` 注释里的散文满足** | 源码正则不剥注释 ⇒ 「注释写了解释、代码没写」也能过 |
| R3 | 跨函数的**懒惰正则匹配** | 实现被拆开时锁会失配或假绿（仓库已有先例说明「结构锁不剥注释 = 幽灵通道」） |
| R4 | 不断言「`watch` 真的调用了 suspend」 | 挂起函数被改名/摘掉时可能仍然通过 |
| R5 | 规则①（owner 须用命名常量）与规则③（释放穷尽）在 `App.vue` 的两个 owner 上不合规 | 与登记表自身声明的规则自相矛盾 |

> R1–R5 已登记为后续治理项（补一个「目录扫描 + 断言表自洽」的检查），
> **本次不处理** —— 它是登记表机制自身的演进，与本次缺陷修复正交。

---

## 5. 结论

- **本次修复 3 处**（D1、D2、D4），根因统一为「应用内页面/模态必须对原生图层可见」：
  路由页交回**唯一可见导航范式**（侧边栏 `onNavClick`；PR #4209 正在把它收敛成 composable），
  模态接入**浮层互斥**，各配行为锁与结构锁。
- **D3（快捷键）由 PR #4209 负责**（已全绿在飞，2026-10-21 最后提交，两轮评审全处置）。
  本 PR 刻意不重复实现同一范式 —— 否则主干会出现两份「同一段判断」，正是 #4209 立项要消灭的形态。
- **后续 6 项**（D5–D10）逐条给出判定依据与方案，不假装已闭合。
- **已排除 13 类条目**，覆盖侧栏、顶栏、标签栏、顶部 toast、页面内浮层、既有 11 个 owner。
- **机制级结论**：本仓关于「原生图层遮挡」的治理此前**只覆盖了浮层一半**。
  路由页那一半由壳态互斥（活动标签）保证，两份合同无交叉引用 ⇒ 「跳转到应用内页面」的入口全部逃逸。
  本次补齐这一半，并在两份合同之间建立显式交叉引用。
