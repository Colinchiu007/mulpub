# BUGFIX：登录态判定收敛到 HTTP 单轨（隐藏窗口降级默认关闭）

- **日期**：2026-10-16
- **分支**：`fix-login-check-http-only`
- **影响面**：桌面端账号登录态检测（`apps/desktop/electron/publishers/account-manager.js` 的 `checkLoginStatus`）
- **同族先例**：`01-docs/BUGFIX-ZHIHU-LOGIN-CHECK-2026-10-16.md`（知乎那一次是"往白名单再加一个平台"，本篇是**停止打地鼠**）
- **用户可感知症状**：应用启动后 30–130 秒**窗口突然消失**（用户报"应用看不到／又关闭了"）

---

## 1. 一句话结论

`checkLoginStatus` 在 HTTP/本地证据不足以判定登录态时，会**开一个隐藏 sandbox 窗口**加载平台页面、抓 DOM 判状态。这条支路在 2026-09 至 2026-10 间按平台**逐个**触发原生渲染崩溃（日志戛然而止、crashpad 无法连接、主进程直接消失）。每一次的处置都是"把该平台加进白名单"——那是打地鼠：**崩的那一侧才是默认值**。本次把默认翻过来：**只有显式登记的平台才允许开隐藏窗口（默认空集）**，其余一律判"未确认"，不再拿整个应用的存活去赌一个账号的状态。

---

## 2. 现场与证据

### 2.1 现象判据（三条同时成立即可确诊本族崩溃）

| 判据 | 读数 |
|---|---|
| 应用日志**戛然而止** | 最后一行停在 `AccountManager checkLoginStatus: start <platform>:<accountId> url=…`，之后无任何行 |
| Crashpad 无法连接 | `[pid:tid:date:ERROR:third_party\crashpad\crashpad\client\crashpad_client_win.cc:867] not connected`（原生崩溃、**无 minidump**） |
| 主进程退出码 | dev 审计日志 `electron-exit code=4294930435`（`0xC0000135 STATUS_DLL_NOT_FOUND`）；历史同族还出现过 `0xFFFF7003` / `0xC0000409` / `0xC0000005` |
| 伴随现象 | 全部 electron 进程消失、窗口空白；dev.js 连带把 vite 停掉（`vite-exit signal=SIGTERM`） |

### 2.2 关键时间线（2026-10-16 实测）

| 时刻 | 事件 |
|---|---|
| 21:29:58 | `start kuaishou` → 日志终止，主进程死 |
| 21:52:04 | 修复 A+C 后**第一轮** kuaishou 检测**通过**（`valid=true code=CHECK_LOGIN_SUCCESS`），继续检测 bilibili |
| 22:20:58 | 同一实例 **30 分钟后第二轮**（`LoginMonitor` 周期）在同一处**崩溃** |
| 23:18:50 | kuaishou 纳入白名单后：`loginStatus→unverified code=CHECK_LOGIN_INCONCLUSIVE`，应用继续检测下一平台，**不再崩** |

### 2.3 与启动方式无关（排除法）

前台直启与 WMI 脱离两条路**都崩**。判定性实验：在 job 内启动后**保持 job 存活 180 秒**并每 10 秒采样——应用在 job **仍然活着**时自行消失（`t+60s electron=0`）⇒ 证伪了"agent job teardown 杀进程"这一当时的首要假设。

---

## 3. 根因

### 3.1 机制（触发点）

```
checkLoginStatus(platform, accountId)
  ├─ HTTP/本地证据充分            → 直接给结论（安全）
  ├─ 不确定 + 平台在白名单         → 判 INCONCLUSIVE，不开窗（安全）
  └─ 不确定 + 平台不在白名单       → playwrightManager.getContext({ show: false })
                                     → new BrowserWindow({ show:false, webPreferences:{ sandbox:true } })
                                     → win.loadURL(平台页面)   ← ★ 崩在这里
```

隐藏窗口的本质是"**一个永不显示、却仍创建合成表面**的窗口"，加载自媒体平台的前台页面（快手 `cp.kuaishou.com`、知乎 `www.zhihu.com/signin`、百家号、公众号后台等）。

### 3.2 成因（为什么一直复发）

`dev-launcher.buildElectronArgs` 的默认值是 `noSandbox=true` 且 `softwareGpu=true`，即**默认同时下发** `--no-sandbox` 与 swiftshader 三件套；而该文件 2026-10-06 的注释早已写明"该组合会让登录检测拉起的隐藏 BrowserWindow 触发原生渲染崩溃"。**默认配置就是崩溃配置**，于是同一个崩溃按平台逐个复发：toutiao（2026-09-16）→ wechat_mp（10-06）→ 知乎（10-14，PR #3726）→ kuaishou（10-16）。启动参数那半已在 `fix-hidden-window-render-crash` 里拆开（二者互斥），本篇处理**另一半**：那条支路本身。

### 3.3 逃逸链

| 层 | 为什么没拦住 |
|---|---|
| 单元测试 | 既有契约锁把"默认带 `--no-sandbox`"写成**期望**；白名单机制也没有"默认不允许开窗"这条不变量 |
| 集成测试 | 崩溃需要**真实平台页面 + 真实账号 Cookie**，CI 两者都没有，等价于永不覆盖 |
| 观测 | 崩溃不留 minidump、crashpad 连不上、日志戛然而止 ⇒ 现场没有"谁崩的"，只能人肉比对 |
| 对策 | 每次处置都是"白名单再加一个平台"（第 1→4 例），**默认值始终留在崩的那一侧** |

---

## 4. 决策：判定收敛到 HTTP 单轨

新增**允许集**与既有**否决集**，语义明确、互不重叠：

| 集合 | 默认 | 语义 |
|---|---|---|
| `DOM_LOGIN_CHECK_ALLOWED_PLATFORMS`（新增） | **空集** | **只有**登记在册的平台才允许开隐藏窗口做 DOM 判定。默认空集 ⇒ 一切"不确定"都判未确认，不冒应用级崩溃风险 |
| `RENDER_CRASH_PRONE_OPEN_PLATFORMS`（保留） | toutiao / wechat_mp / baijiahao / zhihu | **硬否决**：即使有人把某平台加进允许集，它仍不会开窗（纵深防御） |
| 判定顺序 | 先否决、后允许 | 保证"否决永远赢"，允不允许不会把否决覆盖掉 |

产品权衡（明说）：代价是**更多账号会长期显示「未确认」**——因为不再尝试浏览器兜底；收益是**应用不会因为某个平台的页面而整体消失**。考虑到"账号状态显示未确认"用户可刷新/手动登录恢复，而"应用突然消失"是不可恢复的体验事故，这个交换是划算的。

### 4.1 参考产品实证（本地逆向，2026-10-16）

| 判据 | 参考产品A（Electron 版）（Electron v4.14.20，`app.asar` 9.5 MB） | 参考产品B（`参考产品B 主程序`） |
|---|---|---|
| `--no-sandbox` 命中 | **0** | CEF 壳，未见 Electron 开关概念 |
| `swiftshader` 命中 | **0** | — |
| `disable-gpu` / `disableHardwareAcceleration` | **0** | — |
| 登录态判定标识符（`loginStatus`/`isLogin`/`loginState`） | **全 0**（只有 5 处 `checkLogin` 是压缩产物的巧合匹配） | 账号逻辑在 JS 侧（`Asset\sign2\*.js`，按平台分文件），未深入 |
| 浏览器用途 | 可见 `BrowserView`/`WebContentsView` 承载交互式登录 + 抽 Cookie | CEF 内嵌 |
| 判定与发布 | **HTTP API**（axios/fetch 命中 472） | JS 侧直连平台 |
| 渲染进程崩溃 | 2 处 `render-process-gone`，都挂在**普通 UI 窗口**上，处理是 `browserWindow.reload()`（**可恢复**，不升级为应用级） | — |

**结论**：参考产品A**根本没有"隐藏窗口抓 DOM 判登录"这条路**，所以这一整族崩溃对它不存在；它的登录态判定天然是 HTTP 单轨。本变更就是把这个架构结论落到我们的代码里。

---

## 5. 数据校验

### 5.1 输入

| 输入 | 来源 | 校验/清洗 |
|---|---|---|
| `cookies` | 加密凭证 ∪ 账号 session 分区 Cookie，按 `name + domain` 去重（前者优先） | 只保留 `isPlatformCookieDomain(platform, cookie.domain)` 命中的项；注入前统一 `sameSite` 归一（`no_restriction` / `strict` / `lax`），`expires` 归一为秒 |
| `localStorage` | 凭证快照 | 仅当非空时注入恢复脚本；key 非法/为空则忽略该项 |
| 平台配置 | `PLATFORM_LOGIN_URLS` / `PLATFORM_LOGIN_SUCCESS_SELECTORS` / `PLATFORM_DASHBOARD_URLS` / `HTTP_CHECK_APIS` | 缺失即视为"无此能力"，走"不确定"分支，**不得**因此开隐藏窗口 |
| `successSelector` | 平台选择器数组 | 数组形态逐个尝试；为空 ⇒ 不做选择器判定 |

### 5.2 判定与优先级（自高到低）

| 顺序 | 证据 | 结论 | 状态码 |
|---|---|---|---|
| 1 | 加密凭证与分区 Cookie **均无** | 确定失效 | `NO_COOKIE_NO_STORAGE` → `expired` |
| 2 | HTTP 登录检测给出确定结论（API 返回 / `checkHtml` 黑名单语义） | 采纳 | 平台各自的 `CHECK_LOGIN_*` |
| 3 | 本地凭证存在但 HTTP 明确 302 到登录页 / Cookie 过期 | 失效 | `CHECK_LOGIN_COOKIE_EXPIRED` 等 → `expired` |
| 4 | HTTP 不确定 + 平台**不在允许集**（或**在否决集**） | **未确认**（本次核心变更） | `CHECK_LOGIN_INCONCLUSIVE`，`reason=hidden-browser-disabled-default`（否决集为 `render-crash-prone-http-inconclusive`） |
| 5 | HTTP 不确定 + 平台**在允许集且不在否决集** | 才允许开隐藏窗口做 DOM 判定（默认无人命中） | 窗口判定结果 |

### 5.3 不接受项（fail closed）

- 判定器抛错、平台配置缺失、Cookie 形状异常 ⇒ 一律按"不确定"处理，**绝不**按"已登录"处理；
- 不得用"选择器超时 + 域名像仪表盘"单独作为**唯一**证据（本变更后该兜底分支仅在允许集内可达）；
- `reason` 必须写入结构化返回对象，便于事后统计"有多少次因为策略而放弃兜底"。

---

## 6. 流程

### 6.1 启动时批量检测（账号页进入 / 应用启动）

```
渲染端 Accounts → ipc: accounts:batch-check-login（并发 MP_BATCH_CHECK_CONCURRENCY，默认 3）
  → 主进程逐账号 checkLoginStatus（per-account 串行锁）
      → 凭证读取 → 平台域名过滤 → HTTP 快路径
          → 确定：返回结论并持久化
          → 不确定：命中 5.2 表第 4 行 → 直接 unverified（不开窗）
  → 渲染端按结论更新徽章，并对 expired 触发「失效提醒横幅」数据源
```

### 6.2 周期检测（`LoginMonitor`，默认 **30 分钟**一轮）

`start()` 立即跑一轮，随后 `setInterval(30min)`；整段（读凭证→检测→写结论）在 per-account 锁内。**注意**：验证任何"崩溃已修"的结论时，观测窗口**必须覆盖至少两轮**（≥60 分钟）——本轮事故正是"只看 240 秒就宣布修好"导致的误判。

### 6.3 手动单账号检测 / 重新登录

账号卡片「检测」→ 同上单账号路径 → 未确认时用户可点「登录」走可见窗口登录（`AuthViewManager`，交互式、非隐藏窗口），登录后重新检测即可拿到确定结论。

---

## 7. 功能逻辑

- **收敛条件**：`platform ∈ 否决集` **或** `platform ∉ 允许集` ⇒ 判定路径**不经过** `playwrightManager.getContext`（可用门面 spy 断言"零调用"，这是本变更的安全不变量）。
- **幂等**：同一账号重复检测不改变结论集合，只更新时间戳。
- **持久化**：结论经 `account:persist-outcome` 固化；`unverified` 表示"检测发生过但无法判定"，与 `unknown`（从未检测）**必须保持区分**。
- **可观测**：每次放弃兜底都写一条 `WARN`，含 `platform:accountId`、`cookies=N`、`lsKeys=N`、是否在允许集——这条日志是"策略生效了多少次"的唯一凭据。
- **回退通道**：需要临时恢复某平台的 DOM 判定时，把它加入 `DOM_LOGIN_CHECK_ALLOWED_PLATFORMS` 并附上"为什么它不会崩"的证据（真机复测记录）；**不得**用环境变量临时打开，避免线上出现无留痕的崩溃面。

---

## 8. 交互逻辑

| 场景 | 行为 |
|---|---|
| 检测结果 = 已登录 | 徽章「已登录」，账号可用于发布 |
| 检测结果 = 已失效 | 徽章「已失效」+ 主页失效提醒横幅（可一键重新登录） |
| 检测结果 = **未确认**（本变更后会变多） | 徽章「**未确认**」，**不进入**失效横幅（避免误报），账号仍保留上次有效状态；用户可点「检测」重试或「登录」重登 |
| 从未检测 | 徽章与「未确认」**区分**显示，避免把"没测过"读成"测了没结论" |
| 批量检测进行中 | 卡片进入检测中态，按钮禁用，完成后按上述四态刷新 |

交互层面**不新增任何控件、不改布局**：本变更是"结论分布变化"，不是"界面变化"。

---

## 9. 显示项与提示文字

- **状态徽章（既有文案，无需新增）**：`AccountManagementCard.vue:270` 的 `kind === 'unverified'` → i18n `accountsPage.accountCardLabels.statusUnverified`（zh「未确认」/ en `Unconfirmed`，琥珀底 `#fffaf0` + 字 `#974706`；PRD `PRD-ACCOUNT-LOGIN-STATUS-CHECK.md` §17.4 已定义）。
- **三态视觉可辨**：`unverified`（未确认）与 `unknown`（暂无检查记录，灰底）**刻意区分**，且都不与「已登录/已失效」混淆；既有测试断言 `status.classes()` 含 `unverified`。
- **行为边界**：`unverified` **不计入**失效数量、**不显示**「去登录」按钮、**不触发**主页失效横幅。
- **一键检测汇总**：`检测完成：X 个正常，Y 个失效，Z 个未确认`（Z=0 时省略该段）——本变更后 Z 会上升，属预期。
- **颜色语义**：`unverified` 使用独立样式类（既有测试断言 `status.classes()` 含 `unverified`），与"已登录/已失效"在视觉上三者可辨。
- **失效横幅**：由 `useExpiredAccountsBanner` 依 `code` 过滤，`CHECK_LOGIN_INCONCLUSIVE` **不**计入失效清单（既有测试 `useExpiredAccountsBanner.test.js:77` 已锁定该行为）。
- **本 PR 不新增任何用户可见字符串**，因此不需要改动 `apps/desktop/src/locales/zh.js` 与 `en.js`（若后续要加"未确认原因"提示，必须 zh/en **成对**提交，否则 CI Gate 7 `check-locale-sync.js` 判红）。
- **日志文案（面向排查，非用户可见）**：`checkLoginStatus: INCONCLUSIVE hidden-browser-disabled-default <platform>:<id> cookies=N lsKeys=N allowed=false`。

---

## 10. 边界与已知风险（不假装闭合）

1. **本变更不修 Chromium 缺陷**：它把"会崩的那条支路"默认关掉，而不是让平台页面在隐藏窗口里不崩。因此允许集一旦被人填上平台，风险立刻回来——故需在评审时对允许集的**每一行**要求真机复测证据。
2. **「未确认」会变多**：这是有意的代价。若某平台因此长期不可判定，正解是给它补 **HTTP 侧能力**（`HTTP_CHECK_APIS[platform].checkHtml`，参照知乎 PR #3726 的第二半），而不是重新打开隐藏窗口。
3. **崩溃根因仍在原生层**：现场无 minidump，未做栈级归因；本篇的判据都是行为级（日志终止 + crashpad + 退出码 + 进程消失）。
4. **隔离未做**：把 DOM 判定搬进独立进程（崩溃不回传主进程）是更彻底的解法，列为后续工作；本变更不声称已消除该类崩溃，只声称**默认路径不再触碰它**。
5. **观测样本有限**：kuaishou 的两轮实测 + 同族四例历史记录；未对每个平台逐一复测（也不该——那正是打地鼠）。

---

## 11. 验证与回归

| 类别 | 内容 |
|---|---|
| 单元（行为锁） | 非允许集平台 + HTTP 不确定 ⇒ `getContext` **零调用**、返回 `CHECK_LOGIN_INCONCLUSIVE`；允许集默认**空**；否决集仍优先；判定顺序（先否决后允许） |
| 单元（结构锁） | 允许集与否决集的声明存在、允许集默认空集、`reason` 文案落地 |
| 既有回归 | `account-manager.test.js` 全量、四个 `*-render-crash.test.js` 同族用例、`playwright-manager.test.js` |
| 打包（QM-1） | `electron-builder --win --x64` rc=0；asar 清单含改动模块；启动验证 = **存活断言 + stderr 三层判据** |
| 真机 | 启动应用观察至少**两轮** `LoginMonitor`（≥60 分钟）不再出现"日志戛然而止"；账号页批量检测后 `unverified` 数符合预期 |

---

## 12. 关联文件

- 代码：`apps/desktop/electron/publishers/account-manager.js`
- 测试：`apps/desktop/electron/publishers/account-manager-http-only-policy.test.js`（新增）
- 启动参数侧（另一半，已在另一 PR）：`apps/desktop/scripts/dev-launcher.js`
- 需求侧：`01-docs/PRD.md`（§"三种认证模式"）、`01-docs/PRD-ACCOUNT-LOGIN-STATUS-CHECK.md`
- 执行记录：`openspec/records/fix-login-check-http-only.md`
- 同族先例：`01-docs/BUGFIX-ZHIHU-LOGIN-CHECK-2026-10-16.md`
