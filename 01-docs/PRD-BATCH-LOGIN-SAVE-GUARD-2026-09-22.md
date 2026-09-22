# PRD：批量登录「保存账号」体验加固（自动保存 + 关闭护栏 + 主动提醒）

- 需求编号：BATCH-LOGIN-SAVE-GUARD
- 日期：2026-09-22
- 分支：codex/batch-login-save-guard
- 状态：待 CEO 签字 → 技术架构 → TDD 实现
- 类型：新增功能 + UX 加固（非破坏性，向后兼容）

## 1. 背景与问题

### 1.1 现状
首页「登录失效提醒」横幅支持「批量登录」：为每个失效账号在独立的浏览器标签
（`WebContentsView`，session 分区 `persist:account-{accountId}`，以 `cleanSession:true`
干净身份打开登录页）中打开平台登录页。用户在标签内完成登录（扫码/账密）后，
**必须手动点击导航栏右侧的「保存账号」按钮**，才会把该标签 session 分区里的
Cookie + localStorage 提取并经 `AccountManager.updateCapturedAccount` 回写加密凭证库。

### 1.2 问题
- 「保存账号」按钮提示不明显：登录成功后没有任何强引导，用户极易**忽略或忘记点击**。
- 不点击保存的后果：登录态只存在于浏览器标签的临时 session 分区，一旦关闭标签或
  重启应用，加密凭证库里仍是失效前的旧凭证 → 下次 `checkLoginStatus` 依旧判定「失效」，
  用户等于白登录一次。属于高频、高困惑度的体验陷阱。
- `closeTab` 目前无任何凭证回写逻辑（源码注释 L396-398「关闭标签时自动回写」是失实描述），
  关标签即静默丢失登录态，且无任何提示。

### 1.3 目标
让「登录成功」到「凭证持久化」之间不再依赖用户的手动点击，同时对手动路径补齐
可发现性与防丢失护栏。核心指标：
- 批量登录场景下，用户**无感**完成凭证保存（自动保存命中率目标 ≥ 主流平台）。
- 任何未保存的登录态在被关闭前，用户**至少被提示一次**，杜绝静默丢失。
- 三个方案互不冲突、可叠加，任一方案失效时其余方案仍能兜底。

## 2. 术语与关键概念

- **账号浏览器标签**：`_tabStates` 中带 `accountId` 且非 home 的普通浏览器标签（批量登录即用此路径）。
- **凭证保存态 credentialSaveState**：本需求新增的标签级状态，取值
  - `'unsaved'`：账号标签以 `cleanSession` 打开（重新登录语义），登录态尚未回写凭证库；
  - `'saved'`：本会话内已成功回写凭证库；
  - `null`：非「待保存」语义的标签（普通浏览标签、以已存凭证正常打开的账号标签、home），
    不参与角标/护栏。
- **登录成功 URL 判定**：复用 `@multi-publish/shared-utils/src/platform-definitions`
  的 `isPlatformLoginSuccessUrl(platform, url)`（在平台 auth 域、非登录页 URL、命中成功路径模式）。
- **初始重定向守卫 initialRedirectPhase**：登录页首帧加载完成前的自动跳转链不算登录成功，
  防止平台登录页自身重定向被误判（对齐 `auth-view-manager` 的同名守卫）。

## 3. 方案总览（三层防御，全部实现）

| 层级 | 方案 | 定位 | 触发点 |
|------|------|------|--------|
| 治本 | 方案一：自动保存 | 登录成功后主进程自动回写凭证库，取消手点 | 标签导航事件 |
| 护栏 | 方案二：关闭拦截 | 关闭未保存账号标签前弹三选一确认 | 用户点标签关闭按钮 |
| 提醒 | 方案三：主动提醒 | 角标 + 按钮脉冲 + 登录后横幅 + 批量「全部保存」 | TabBar / NavBar / Banner |

三者共享同一底层原语：**标签级 `credentialSaveState`**（主进程为单一事实源，
经 IPC 事件同步到渲染层 store）。

## 4. 数据模型与契约

### 4.1 主进程 `_tabStates`（新增字段）
在账号标签的 state 对象上新增：
- `credentialSaveState: 'unsaved' | 'saved' | null`
  - 初值规则（createNewTabPage）：
    `useAccountSession && cleanSession === true` → `'unsaved'`；否则 `null`。
- `initialRedirectPhase: boolean`（仅账号标签有意义）
  - createNewTabPage 时对 `useAccountSession` 标签置 `true`，`did-finish-load` 首次触发置 `false`。
- `_autoSaveTimer`（挂在 state 上的去抖计时器句柄，非序列化字段，不进 IPC payload）。

### 4.2 IPC 输出（getAllTabs / getActiveTab 每个 tab 对象新增）
- `credentialSaveState`：直接透传 4.1 值。渲染层据此判断角标/护栏。

### 4.3 新增 IPC：查询保存态（护栏用）
- 通道：`page-manager:account-tab-save-state`（invoke）
- 入参：`tabId: string`（非空字符串，否则返回 `EC.VALIDATION_ERROR`）
- 返回：`{ code, data: { isAccountTab: boolean, credentialSaveState, accountId, platform } }`
  - 非账号标签 / 标签不存在：`code:0, data:{ isAccountTab:false }`。

### 4.4 新增 IPC：批量保存全部未保存标签
- 通道：`page-manager:save-all-unsaved-accounts`（invoke）
- 入参：无
- 行为：遍历 `_tabStates`，对 `credentialSaveState === 'unsaved'` 且有 accountId/platform 的标签
  逐个调用 `saveAccountTabCredentials`。
- 返回：`{ code:0, data:{ attempted, saved, failed:[{accountId, platform, reason}] } }`

### 4.5 新增事件广播（主进程 → 渲染层）
- `page-manager:tab-credential-state-changed`，payload `{ tabId, credentialSaveState, accountId, platform }`
- 复用现有 `_broadcast('...')`，事件名 `tab-credential-state-changed`。
- 自动保存成功、手动保存成功、批量保存成功均广播，使角标实时熄灭。

### 4.6 IPC 参数序列化安全
所有新增 IPC 传参均为纯 JSON（tabId 字符串 / 无参）。渲染层从 pinia ref 取出的对象
传给 IPC 前一律 `JSON.parse(JSON.stringify(...))` 脱壳（本需求实际只传标量，天然满足）。

## 5. 方案一：自动保存（治本，路线 1b）

### 5.1 为什么是 1b 而非 1a
- 1a（reroute 到 auth-view 全屏登录 + CDP 捕获）：`auth-view-manager.openLogin` 使用
  **丢弃式分区** `auth-{platform}-{ts}`，语义是「新建账号」，无法把登录态回写到
  **既有的失效账号** accountId 上；且会回归 cleanSession 二维码防呆修复。故放弃。
- 1b（在既有账号浏览器标签上复用登录成功检测 + 自动保存）：直接复用已验证的
  `isPlatformLoginSuccessUrl` 与既有 `saveAccountTabCredentials` 回写链路，风险最小。

### 5.2 流程
1. 账号标签（`credentialSaveState==='unsaved'`）触发 `did-navigate` / `did-navigate-in-page`。
2. 若 `initialRedirectPhase === true` → 忽略（登录页自身重定向）。
3. 计算 `isPlatformLoginSuccessUrl(state.platform, url)`：
   - 命中 → 安排去抖自动保存（`_scheduleAutoSave`）；
   - 未命中 → 取消已安排的计时器（用户在登录页反复横跳时只在稳定后保存一次）。
4. `did-finish-load` 首次触发：置 `initialRedirectPhase=false`；若此时当前 URL 已是成功 URL，
   同样安排自动保存（覆盖「首帧即已登录」情形）。
5. 去抖窗口 **1500ms**：到期调用 `saveAccountTabCredentials(tabId)`。
   - 成功：`credentialSaveState='saved'`，广播 `tab-credential-state-changed` + `auth:completed`；
   - 失败（如 `未捕获到有效登录凭证`）：保持 `'unsaved'`，**不清除守卫**，等待下一次导航重试，
     并广播当前态（角标仍在）。

### 5.3 数据校验与边界
- 仅对 `credentialSaveState==='unsaved'` 的账号标签生效；已保存/普通标签/no-op。
- `saveAccountTabCredentials` 内部已有 fail-closed：`!accountId||!platform` → `not-account-tab`；
  accountManager 不可用 → `account-manager-unavailable`；空凭证由 `updateCapturedAccount` 抛错。
- 去抖计时器在 `closeTab` 时必须 `clearTimeout`，避免对已销毁 view 执行。
- 计时器 `unref()`，不阻塞进程退出（对齐 auth-view-manager）。
- 幂等：`_autoSaveTimer` 存在时先 clear 再重设；保存中（saved）不再重复触发。
- 多标签并发：每个标签独立 state/timer，互不影响。

### 5.4 可观测
- `log.info('WebviewManager', 'auto-save triggered ...')`
- `log.info('WebviewManager', 'auto-save saved ... cookies=N')`
- 失败 `log.warn`，含 platform/accountId/reason。

## 6. 方案二：关闭护栏（防静默丢失）

### 6.1 交互流程（App.vue onCloseTab）
1. 用户点击某标签关闭按钮 → `close-tab` 事件 → `onCloseTab(tabId)`。
2. 先调用 `pageManager.getAccountTabSaveState(tabId)` 查询。
3. 若 `isAccountTab && credentialSaveState==='unsaved'` → 弹 `ElMessageBox`（三态）：
   - 标题：`关闭未保存的登录`
   - 正文：`该账号登录凭证尚未保存，直接关闭将丢失本次登录。是否保存后关闭？`
   - 按钮：
     - 确认（主）：`保存并关闭` → 调 `saveAccountTabCredentials` → 无论成功失败都 `closeTab`
       （失败给一次 `ElMessage.warning` 说明未保存成功但仍关闭，避免困住用户）。
     - 次要/取消按钮文案 `直接关闭` → 不保存直接 `closeTab`（用 distinguishCancelAndClose）。
     - 关闭(X)/`取消` → 什么都不做，留在页面。
4. 其余情况（非账号标签 / 已保存 / 查询失败）→ 直接 `closeTab`（保持原行为）。

### 6.2 边界
- 自动保存已生效时 `credentialSaveState==='saved'`，护栏静默放行，不打扰用户。
- ElMessageBox 三按钮：`confirmButtonText=保存并关闭`、`cancelButtonText=直接关闭`、
  `closeButtonText=取消` + `distinguishCancelAndClose:true`，用 catch 区分 cancel/close。

## 7. 方案三：主动提醒（可发现性）

### 7.1 TabBar 未保存角标
- `TabBar.vue`：当 `tab.credentialSaveState === 'unsaved'` 时，在标签标题右侧、关闭按钮左侧
  渲染一个醒目圆点角标（橙色 `#f59e0b`，`data-testid="tab-unsaved-{tabId}"`，`aria-label` 提示
  「登录未保存」）。`credentialSaveState==='saved'` 可短暂显示一个 ✓（可选，弱化）。

### 7.2 NavBar 保存按钮脉冲
- `NavBar.vue`：`isLoginTab` 且当前活动标签 `credentialSaveState==='unsaved'` 时，
  「保存账号」按钮加脉冲动画类 `pulse`（呼吸缩放 + 高亮描边），提升注意度。
  - 新增 prop：`accountUnsaved: Boolean`（由 App.vue 传入 `activeTab.credentialSaveState==='unsaved'`）。
  - `prefers-reduced-motion: reduce` 时禁用动画（无障碍）。

### 7.3 登录后横幅 + 批量「全部保存」
- `LoginExpiredBanner.vue` 增加一个「全部保存」次按钮（`data-testid="banner-save-all"`），
  仅当存在未保存账号标签（`unsavedCount > 0`）时显示，文案：`全部保存（{count}）`。
  - 点击 emit `save-all` → Home.vue 调 `saveAllUnsavedAccounts()` → 成功后 `ElMessage.success`
    汇总保存数量；`showExpiredBanner` 不自动关闭（让用户继续核对）。
- 自动保存成功时，Home 侧仍会收到 `auth:completed`（既有链路），刷新失效列表。

### 7.4 显示项汇总
| 位置 | 元素 | 条件 | testid |
|------|------|------|--------|
| TabBar 标签 | 橙色未保存角标 | credentialSaveState==='unsaved' | tab-unsaved-{tabId} |
| NavBar | 保存按钮脉冲动画 | 活动标签 unsaved | nav-save-account（加 .pulse 类） |
| Banner | 「全部保存（n）」按钮 | unsavedCount>0 | banner-save-all |

## 8. 提示文字（locale，zh/en 成对）

新增键（`nav` / `home.loginExpiredBanner` / `tabBar` 命名空间）：

zh：
- `nav.saveAccountPulseHint` = `登录完成，记得保存账号`
- `tabBar.unsavedBadge` = `登录未保存`
- `home.loginExpiredBanner.saveAllBtn` = `全部保存`
- `home.loginExpiredBanner.saveAllBtnCount` = (n) => `全部保存（${n}）`
- `home.loginExpiredBanner.saveAllSuccess` = (n) => `已保存 ${n} 个账号`
- `home.loginExpiredBanner.saveAllPartial` = (n) => `有 ${n} 个账号保存失败，请检查`
- `home.loginExpiredBanner.saveAllNone` = `没有待保存的登录`
- `tabBar.closeUnsavedTitle` = `关闭未保存的登录`
- `tabBar.closeUnsavedMessage` = `该账号登录凭证尚未保存，直接关闭将丢失本次登录。是否保存后关闭？`
- `tabBar.closeUnsavedSaveAndClose` = `保存并关闭`
- `tabBar.closeUnsavedDiscard` = `直接关闭`
- `tabBar.closeUnsavedCancel` = `取消`
- `tabBar.closeUnsavedDiscardedWarn` = `未保存，已关闭该登录标签`

en：对应英文（saveAccountPulseHint / unsavedBadge / saveAllBtn / ... ）。

约束：`apps/desktop/src/locales/zh.js` 与 `en.js` 必须**成对提交**（CI Gate 7）；
新增用户可见文案一律走 locales，渲染层 `src/` 非 locales 文件不得新增中文字面量。

## 9. 验收标准

1. 批量登录 → 在任一受支持平台标签完成登录 → **不点任何按钮**，标签角标在 1.5s 内
   自动熄灭为 saved，重启应用后该账号 `checkLoginStatus` 为有效。（方案一）
2. 对无法自动判定的平台（URL 不命中成功模式）：登录完成后标签仍显示未保存角标 +
   保存按钮脉冲；点击关闭按钮弹出三选一确认，选「保存并关闭」后凭证成功回写。（方案二/三兜底）
3. Banner 有未保存标签时显示「全部保存（n）」，点击后逐个保存并汇总提示。
4. 非账号标签、已保存标签、home 标签关闭时不弹任何确认（零打扰回归）。
5. `prefers-reduced-motion` 下无脉冲动画；角标有 aria-label。
6. 全量 `webview-manager.test.js` / `tab.test.js` / `LoginExpiredBanner.test.js` /
   新增关闭护栏测试通过；locale 成对检查通过；QM-1 打包通过。

## 10. 非功能需求
- 不引入新第三方依赖。
- 不改变 cleanSession 二维码防呆与既有 auth-view 登录链路。
- 自动保存为尽力而为（best-effort），失败必须可被方案二/三兜底，绝不静默损坏凭证库。
- 向后兼容：老账号标签无 credentialSaveState 字段时，渲染层按 `null` 处理（不显示角标）。

## 11. 影响文件清单
- 主进程：`electron/services/webview-manager.js`（状态字段、_setupNav 自动保存、
  getAccountTabSaveState、saveAllUnsaved、saveAccountTabCredentials 置 saved + 广播、
  closeTab 清计时器）、`electron/preload/page-manager.js`（暴露两个新方法）。
- preload 产物：`electron/preload/index.bundle.js`（`pnpm run build:preload` 重新生成）。
- 渲染层：`src/stores/tab.js`（credentialSaveState 透传 + 事件订阅）、`src/App.vue`
  （onCloseTab 护栏 + 传 accountUnsaved）、`src/components/TabBar.vue`（角标）、
  `src/components/NavBar.vue`（脉冲）、`src/components/LoginExpiredBanner.vue`（全部保存）、
  `src/views/Home.vue`（save-all 处理）。
- locale：`src/locales/zh.js`、`src/locales/en.js`。
- 测试：`electron/services/webview-manager.test.js`（新增）、`src/stores/tab.test.js`、
  `src/components/LoginExpiredBanner.test.js`、`src/App` 关闭护栏测试（新增）。

## 12. 风险与缓解（v1 原稿）
- 误判登录成功 URL 提前保存空/半凭证 → 去抖 1.5s + `updateCapturedAccount` 空凭证 fail-closed，
  不会写入损坏数据；失败保持 unsaved 可重试。
- 自动保存与手动保存竞态 → 以 credentialSaveState 为准，saved 后自动/手动均短路。
- 关闭计时器泄漏 → closeTab/dispose 清理。

## 13. 修订记录 v2（2026-09-22 热修）：账号标签「假保存成功」缺陷（getAll 吞错）

### 13.1 用户可见症状
账号页点击已失效视频号 → 打开登录标签扫码确认 → 页面闪动后**未跳转创作者中心**；
关闭再打开该账号标签仍停在登录页（需再次扫码）。若改用全屏登录视图（AuthViewManager）
重登则正常——缺陷仅存在于**账号浏览器标签（btab）保存链路**。

### 13.2 根因（第一性原因）
`webview-manager.js` 的 `saveAccountTabCredentials` 与 `saveCookies` 调用了
`session.cookies.getAll({})`——**Electron 的 cookies API 只有 `get([filter])`，不存在
`getAll`**。TypeError 被外层 `catch` 吞掉后以 `cookies=[]` 继续执行保存：
- `updateCapturedAccount` 的「三空拒绝」校验（cookies+localStorage+indexedDB 全空才抛错）
  被残留的旧 localStorage（13 键）绕过 → 凭证库写入 **0 Cookie 的假凭证** 并置 `saved`、
  广播 `auth:completed`（假成功）；
- 再开创作者中心标签时凭证恢复 0 Cookie → 服务端无会话 → 弹回 login.html。
决定性日志证据：`saveAccountTabCredentials: cookies.getAll failed ... getAll is not a
function` 紧跟 `saved tencent_video:xxx cookies=0 lsKeys=13`。
（git log -S 追溯：该误用自 graft 初始提交即存在，属历史代码；本 PRD 方案一上线后
自动保存路径同样踩中，属本功能数据流上的既有缺陷点。）

### 13.3 修复契约（v2 生效）
1. **API 契约**：主进程提取分区 Cookie 一律用 `session.cookies.get({})`（与
   auth-view-manager/qrcode-login 对齐），禁止发明不存在的 API。
2. **fail-closed 数据校验**：`saveAccountTabCredentials` 中 Cookie 提取**抛错即中止**——
   返回 `{ok:false, reason:'cookie-extract-failed', accountId, platform}`，不得落盘、
   保持 `credentialSaveState==='unsaved'`、不广播 `saved`、不发 `auth:completed`。
   自动保存路径失败等下一次导航重试；手动保存路径渲染层弹
   `accountsPage.saveAccountTabFailed`（「保存账号凭证失败，请重试」）。
3. **不做「空 Cookie 一律拒绝」**：存在 localStorage-only 的合法平台（如知乎 token 型），
   空凭证判定维持 `updateCapturedAccount` 三空校验口径；本修复只堵住「提取失败被吞」。

### 13.4 回归保护测试（逃逸点封堵）
- **mock 契约镜像**：`webview-manager.test.js` 的 WebContentsView mock 挂接
  `webContents.session`（= 构造传入分区 session 同物），cookies 对象**只实现
  get/set/remove/flushStore，不实现 getAll**——再犯同类错误将直接红。
- **断言强化**：保存成功用例从 `cookies: expect.any(Array)`（对空数组恒真）改为断言
  真实 Cookie 数组内容；新增 3 例：get 提取真实 Cookie、提取抛错 fail-closed、
  saveCookies 事件源用 get。
