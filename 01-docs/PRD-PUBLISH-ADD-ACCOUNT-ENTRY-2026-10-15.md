# PRD：发布页「请先添加账号」增加「添加」按钮与「刷新」入口（publish-add-account-entry，2026-10-15）

> **立项日期**: 2026-10-15
> **需求来源**: 用户反馈 + 截图取证（发布目标区知乎平台无账号时的阻断态）
> **应用范围**: 图文发布页与视频发布页右侧「发布目标」操作区（两者共用同一组件 `PublishTargetSelector.vue`，故一处实现两处生效）
> **状态**: 待实现
> **上游**: `01-docs/PRD-PUBLISH-PAGE-OPTIMIZATION-2026-10-08.md`（发布页优化 roadmap）

---

## 一、目标与范围

### 1.1 一句话需求

发布页「发布目标」区里，当某个平台**没有任何账号**时，原来只有一句灰字「请先添加账号」（阻断态、无出口）。现在要在它右侧加一个**「添加」按钮**，点一下直接打开该平台的登录页（新标签），让用户不用先跳去账号页；同时补一条**「已经添加成功？点击刷新」**的操作链接，让用户在新标签里登录并保存账号、切回发布页后能一键刷新平台账号列表。

### 1.2 现状（代码取证）

| 层 | 位置 | 现状 |
|---|---|---|
| 组件 | `apps/desktop/src/features/publish/components/PublishTargetSelector.vue:64` | `<span v-else class="target-accounts__empty">请先添加账号</span>` —— 纯文本，无任何可点击出口 |
| 页面 | `apps/desktop/src/views/Publish.vue:522-533` | `<PublishTargetSelector :groups="groupedPlatforms" ... />`，组件保持哑组件（不碰 store） |
| 账号数据源 | `apps/desktop/src/stores/accounts.js:104-109` | `ensureLoaded()` 幂等 + in-flight 缓存，**已加载即 no-op** |
| 平台目录 | `apps/desktop/src/features/publish/usePublishPlatformCatalog.js:15-33` | `groupedPlatforms` 是 `computed`，依赖 `accountStore.byPlatform`，账号一变就自动重算 |
| 刷新触发源 | `apps/desktop/src/views/Publish.vue:1394-1420` | 只有 `onMounted → loadAccounts()`（→ `ensureLoaded()`）；`onActivated`（`:1427-1434`）**不重新加载账号** |
| 生命周期 | `apps/desktop/src/App.vue:72-76` | `<keep-alive :include="['Publish']"><component :is="Component" v-show="!isLoginTab" />` —— 切到账号/登录标签时 Publish 实例**不卸载**（行为锁 `publish-tab-state-keepalive.test.js`） |
| 新标签登录 | `apps/desktop/src/views/Accounts.vue:1182-1199` | `openLoginPage(account)`：`tabStore.createTab({ url: PLATFORM_LOGIN_URLS[platform], platform, accountId, cleanSession: needsCleanLoginSession(...), title })` |
| 保存凭证 | `apps/desktop/src/App.vue:175-214` | NavBar「保存账号」→ `pageManager.saveAccountTabCredentials(tabId)`（仅账号标签显示） |

**三条已核实的结论**（决定了实现形态）：

1. **切回发布页时内容不丢**：`isLoginTab` 只驱动 `v-show` 的 `display:none`，Publish 实例始终挂载，草稿/标题/正文/已选平台全在。本需求不要求新增任何持久化机制。
2. **账号新增后 `groupedPlatforms` 不会自动更新**：`ensureLoaded()` 幂等，且 `onActivated` 不含账号加载 ⇒ 必须有一个**显式 `accountStore.load()`** 的触发点。
3. **新标签必须是「账号标签」而非普通浏览标签**：只有带 `accountId` 的标签才走 `persist:account-<id>` 持久分区、才能被 NavBar「保存账号」写入凭证库（`webview-manager/tab-lifecycle.js:33-34`：`accountId` 不过 `SAFE_IDENTIFIER` 就落到 `persist:browse-<tabId>` 临时分区，**不恢复凭证也无法保存**）。

### 1.3 目标

| # | 目标 | 可验证判据 |
|---|---|---|
| G1 | 无账号平台出现「添加」按钮，点击直达该平台登录页 | 点击 → `tabStore.createTab` 被调用，`url === PLATFORM_LOGIN_URLS[platform]`，且是应用内新标签（非 `window.open` 外跳） |
| G2 | 同时出现「已经添加成功？点击刷新」链接 | 空态下渲染该链接，带 `data-testid` |
| G3 | 点击刷新 → 重新拉取账号列表 → 新账号出现在可选列表 | 点击 → `accountStore.load()` 被调用 → `groupedPlatforms` 重算 → 平台下出现账号复选框 |
| G4 | 刷新不破坏用户已在发布页编辑的内容 | 刷新路径**不触发** `Publish.vue` 重挂载、不清空 `article`/`batchMode` 草稿 |
| G5 | 图文与视频发布页都生效 | 两者共用 `PublishTargetSelector`，无分支差异 |
| G6 | 新增用户可见文案全部进 locales 且 zh/en 成对 | `check-locale-sync` 通过 |

### 1.4 不做（刻意的范围克制）

1. **不做扫码登录**：扫码走 `authOpenQrCodeLogin`（`useAccountActions.openLogin('qrcode', platform)`），承载方式与「打开登录页」不同，且 `PLATFORM_LOGIN_URLS` 覆盖 15 平台而 `QR_CODE_PLATFORMS` 只有少数。本刀只做「打开登录页」这一条最通用的路。
2. **不改账号页的添加账号流程**：账号页 `addAccount()`（`Accounts.vue:834-861`）继续走 `authOpenLogin` 全屏登录视图。发布页这一刀只开「登录页标签」，不开第二套登录视图——两套并存就会出现「同一个添加动作有两种行为」。
3. **不自动轮询/自动刷新账号列表**：自动刷新要么定时打 IPC（QM-2 高频路径纪律），要么靠事件广播（需要改主进程）。用户点一下刷新是零成本的，且语义明确（"我刚保存完"）。**明确的用户动作优于隐式的后台同步**。
4. **不改批量模式的逐条目选平台**（`BatchArticleFields.vue`）：批量态的目标选择是另一套组件（`BatchTargetPicker.vue`），本刀只覆盖 `PublishTargetSelector` 的消费者。
5. **不在刷新后自动勾选新账号**：`usePlatformSelection.reconcileSelectedAccounts()`（`usePlatformSelection.js:137-161`）在平台已有选中集时不会自动回填；但空选中集会回填**默认账号**（`:143-147`）。自动勾选会让「我只是刷新看看」变成「发布目标被改了」，属于静默改用户意图。

---

## 二、功能逻辑

### 2.1 空态的完整形态

原空态只有一句提示。改造后空态变成**一行两件套**（提示文字 + 添加按钮 + 刷新链接）：

```
[☑ 知乎]                          ← 平台复选框（已勾选，展开账号区）
   请先添加账号  [添加]            ← 提示文字 + 「添加」按钮（同一行）
   已经添加成功？点击刷新          ← 刷新链接（下一行，弱化样式）
```

- 「添加」按钮与「请先添加账号」**同一行**：用户视线不用移动就能找到出口。
- 「已经添加成功？点击刷新」**单独一行**：它是**条件性**入口（只在用户去过登录页之后才有意义），与「添加」并列会让两个动作看起来同等重要，而实际一个是主路径、一个是回补路径。
- 平台**未勾选**时账号区不展开（`v-if="selectedPlatforms.includes(platform.id)"`，`PublishTargetSelector.vue:32`），所以整套空态只在平台已勾选时可见——**这与截图行为一致**（截图中知乎已被勾选）。

### 2.2 「添加」按钮的行为

| 项 | 定义 |
|---|---|
| 动作 | 打开该平台的**登录页**（`PLATFORM_LOGIN_URLS[platform]`），以应用内新标签承载 |
| 承载 | `tabStore.createTab({ url, platform, accountId: <占位>, cleanSession: true, title })` |
| 为什么带 `accountId` | 主进程 `tab-lifecycle.js:33-34`：`accountId` 必须过 `SAFE_IDENTIFIER` 才启用 `persist:account-<id>` 持久分区；不带就落到 `persist:browse-<tabId>` 临时分区，**凭证无法保存**，登录完刷新也看不到账号 |
| 为什么 `cleanSession: true` | 与 `Accounts.vue:1196`、`Home.vue:304` 同口径：这是**新账号**的首次登录，不存在旧身份 Cookie；带 `cleanSession: true` 还顺带把 `credentialSaveState` 置为 `'unsaved'`（`tab-lifecycle.js:201`），NavBar 才会显示「保存账号」按钮（`App.vue:143-146`） |
| `accountId` 取值 | `mp-new-<platform>`（如 `mp-new-zhihu`）。理由见 §3.2 |
| 标题 | `t('publishPage.addAccount.loginTabTitle', { platform })`，与 `Accounts.vue:1197` 同族 |
| 成功后是否自动切标签 | **不切**。让用户主动看到新标签出现即可；自动 `switchToTab` 会把发布页当场遮掉，用户以为页面跳走了 |

### 2.3 「已经添加成功？点击刷新」链接的行为

| 项 | 定义 |
|---|---|
| 动作 | 调 `accountStore.load()`（**不是** `ensureLoaded()`——后者幂等，已加载即 no-op，是本需求的核心坑） |
| 等待态 | 刷新期间链接置 loading（禁用重复点击 + 视觉反馈），避免连点打出并发 `load()` |
| 成功 | 账号列表更新 → `groupedPlatforms` 自动重算 → 空态消失、账号复选框出现。**无额外 toast**（界面自己变了就是反馈，再弹一条是噪声） |
| 失败 | 复用账号页口径：`notifyError('accountsPage.loadFailed')`（`Accounts.vue:828` 同键），并在原地保持空态（**不清空**——`accounts.js:76` 瞬时失败保留上一次列表，这里同样不得把"刷新失败"显示成"没有账号"） |
| 刷新后仍无账号 | 空态原样保留（含「添加」按钮与刷新链接）。**不加"还是没找到"的责备式文案**——用户可能只是还没保存 |

### 2.4 刷新与 keep-alive 的交互（G4 的判据）

刷新只动 `accountStore.accounts`，不碰：

- `article` / `articles`（批量条目）/ 各上传 file-list —— 发布页草稿
- `selectedPlatforms` / `selectedAccounts` —— 已选发布目标
- `showDiffPanel` / `diffEdits` —— 差异化面板

唯一被间接影响的是 `usePlatformSelection` 的 deep watch（`usePlatformSelection.js:163-167`）：`byPlatform` 变化会触发 `reconcileSelectedAccounts()`。这条 watch 的行为是**收敛**而非清空：

- 已选平台 & 已有选中账号 → 过滤掉不在 availableIds 里的（新账号不影响旧选中集）
- 已选平台 & 选中集为空 & 该平台现在有可用账号了 → 回填默认账号

第二条正好是我们要的：用户在知乎勾了平台但没账号（选中集为空、空态显示「请先添加账号」），刷新后新账号进来，`reconcileSelectedAccounts` 会**自动回填默认账号**——用户不必再手动勾一次。这是既有机制的红利，不需要新代码；但**必须在 PRD 里写清楚**，否则将来有人"顺手优化"这条 watch 时会不知道自己在改什么。

---

## 三、数据校验

### 3.1 逐条判据

| # | 情况 | 判据 | 用户看到 | 位置 |
|---|---|---|---|---|
| V1 | 平台已勾选 & `platform.accounts` 为空数组 | `platform.accounts.length === 0` | 空态：提示 + 「添加」+ 刷新链接 | 组件模板 |
| V2 | 平台已勾选 & `platform.accounts` 有元素 | `length > 0` | 账号复选框列表（既有行为，不变） | 组件模板 |
| V3 | 平台未勾选 | `!selectedPlatforms.includes(id)` | 账号区不渲染（既有行为，不变） | 组件模板 |
| V4 | 点击「添加」时 `PLATFORM_LOGIN_URLS[platform]` 不存在 | 查表为 `undefined` | `notifyWarning('publishPage.addAccount.loginUnsupported')`，**不调 createTab** | composable |
| V5 | 点击「添加」时 `platform` 为空/非字符串 | 入参校验失败 | 同 V4 的处理（同一函数入口） | composable |
| V6 | `createTab` 返回 `null`（IPC 失败/桥不可用） | 返回值为 falsy | `notifyError('publishPage.addAccount.openFailed')` | composable |
| V7 | 点击刷新时 `publishing === true`（发布进行中） | `props.disabled` | 按钮与链接均禁用，不吞点击也不发起请求 | 组件模板 |
| V8 | 刷新进行中重复点击 | `refreshing` 标志 | 忽略后续点击（loading 态） | 组件 |
| V9 | `accountStore.load()` 失败 | store 内 `error` 被置位 | `notifyError('accountsPage.loadFailed')` + 空态保留 | 页面 |
| V10 | 刷新后平台仍无账号 | `load()` 成功但 `byPlatform[platform]` 仍空 | 空态原样（V1 形态） | 组件自动 |

### 3.2 `accountId` 占位值的取值与风险

**取值**：`'mp-new-' + platform`（例：`mp-new-zhihu`、`mp-new-wechat_mp`）。

**为什么必须带一个合法占位值**：主进程 `tab-lifecycle.js:34`
```js
var useAccountSession = typeof accountId === 'string' && SAFE_IDENTIFIER.test(accountId)
```
`SAFE_IDENTIFIER` 来自 `webview-manager/constants.js`。带合法值 ⇒ `persist:account-mp-new-zhihu` 持久分区 + NavBar 可保存；不带 ⇒ `persist:browse-btab-N` 临时分区，**刷新后凭证随标签关闭而消失**，用户会以为"添加了但发布页看不到"。

**为什么用 `mp-new-<platform>` 而不是 `Date.now()` 之类**：

| 方案 | 问题 |
|---|---|
| 每次点击用新随机 id | 同一平台点两次开两个分区，两个登录态互不连通；用户在一个标签登录完、另一个标签还是未登录，会困惑 |
| 固定 `mp-new-<platform>`（本方案） | 同一平台的多次「添加」复用同一分区：第一次没登录完关掉，第二次打开还在同一登录页进度；登录保存后该分区即成为该平台的"新账号槽位" |

**已知限制（如实记录，不假装闭合）**：保存凭证时 `saveAccountTabCredentials` 会把这个占位 `accountId` 交给 `accountManager.updateCapturedAccount`（`webview-manager.test.js:862-866` 断言其第三参即 accountId）。也就是说**保存下来的账号 id 就是 `mp-new-<platform>`**，而不是账号页那套 `auth-open-login` 生成的 id。这在功能上成立（id 唯一、可被 `byPlatform` 索引、可作为发布目标），但**与账号页的账号 id 形态不一致**。本刀如实记录为残余风险，不在本刀内改 id 生成策略（那会牵动凭证库主键）。

> 评审要点：这一条必须有人明确看过并接受。若不能接受，替代方案是给主进程加 `page-manager:create-new-account-tab`（返回真正的新账号 id），代价是动 IPC 面 + 主进程测试，本刀不做。

---

## 四、流程

### 4.1 主流程（添加 → 登录 → 保存 → 刷新）

```
发布页（图文/视频）
  └─ 用户勾选「知乎」→ 账号区展开 → accounts.length === 0
       └─ 渲染空态：[请先添加账号] [添加] / 已经添加成功？点击刷新
            │
            ├─ 路径 A：点「添加」
            │    └─ usePublishAddAccount.openLoginForPlatform('zhihu')
            │         ├─ 校验：platform 非空 && PLATFORM_LOGIN_URLS['zhihu'] 存在
            │         ├─ tabStore.createTab({ url: 'https://www.zhihu.com/signin',
            │         │                        platform: 'zhihu',
            │         │                        accountId: 'mp-new-zhihu',
            │         │                        cleanSession: true,
            │         │                        title: '知乎登录页' })
            │         └─ 返回 null → notifyError(openFailed)
            │
            ├─ 用户在新标签完成登录
            │    └─ NavBar 出现「保存账号」（isLoginTab: accountId != null && !isHome，App.vue:143-146）
            │         └─ 用户点「保存账号」→ saveAccountTabCredentials(tabId)
            │              └─ 凭证入加密库 → 账号出现在 accounts 真源
            │
            └─ 路径 B：切回发布页标签 → 点「已经添加成功？点击刷新」
                 └─ usePublishAddAccount.refreshAccounts()
                      ├─ refreshing = true（禁用重复点击）
                      ├─ await accountStore.load()   ← 显式 load，不是 ensureLoaded
                      ├─ byPlatform 变化 → groupedPlatforms 重算
                      │    └─ usePlatformSelection deep watch → reconcileSelectedAccounts
                      │         └─ 知乎选中集为空 + 新账号可用 ⇒ 自动回填默认账号
                      ├─ 失败 → notifyError('accountsPage.loadFailed')，空态保留
                      └─ finally: refreshing = false
```

### 4.2 发布页内容不丢的机制（G4）

不需要新代码，既有两层保障：

1. `App.vue:72-76` 的 `v-show` + `keep-alive :include="['Publish']"`：切标签只是 `display:none`，实例不销毁（行为锁 `apps/desktop/src/publish-tab-state-keepalive.test.js:1-195`，真挂载流程含 `setupCalls===1` 反证）。
2. `accountStore.load()` 只写 `accounts.value`，不触发任何发布页状态重置。

---

## 五、技术方案

### 5.1 分层（沿用本项目「哑组件 + composable 接线」的既有纪律）

`PublishGroupPicker.vue` 与 `usePublishGroupTargets.js` 已立下这个范式（见 `PRD-PUBLISH-GROUP-PICKER-2026-10-03.md` §五），本刀照搬：

| 层 | 文件 | 职责 |
|---|---|---|
| 展示 | `features/publish/components/PublishTargetSelector.vue` | 空态渲染 + 两个出口；**只 emit 事件，不碰 store、不 import tabStore** |
| 判据 | `features/publish/usePublishAddAccount.js`（新增） | 校验 + `tabStore.createTab` + `accountStore.load()` + 播报；**可单测（依赖注入）** |
| 接线 | `composables/usePublishAddAccountTargets.js`（新增） | store ↔ 视图的桥：接 `tabStore`、注入 `platformLabel`、把 `loadAccounts` 一并收进来；返回 `addAccountBindings` 供 `v-bind` |
| 页面 | `views/Publish.vue` | **净零行**接入：1 行 import + 1 行调用 + 1 行 `v-bind`（详见 §5.5） |

### 5.2 组件 API（新增 props / emits，全部可选 ⇒ 向后兼容）

```js
// props
refreshingAccounts: { type: Boolean, default: false }   // 刷新中（禁用重复点击）
// emits
'add-account'   // (platformId) → 页面开登录页
'refresh-accounts'  // () → 页面重载账号列表
```

**为什么用事件而不是把 store 传进组件**：组件现有纪律是"不碰 accountStore，也不自己判 groupsStatus"（`PublishTargetSelector.vue:94-96` 注释）。传 store 会打破它，并使组件测试必须 mock 整个 pinia。事件让组件测试保持 `mount + trigger + assert emitted` 的形态（既有测试就是这么写的）。

### 5.3 composable API（判据层）

`features/publish/usePublishAddAccount.js`：

```js
usePublishAddAccount({ tabStore, accountStore, notifyError, notifyWarning, platformLabel })
// → { openLoginForPlatform(platformId, { busy }), refreshAccounts(), refreshing }
```

- `openLoginForPlatform`：同步校验（busy → 平台合法性 → 登录 URL 存在）+ `await createTab`；返回 `{ ok, reason }` 便于测试断言（不依赖 toast）。
- `refreshAccounts`：`refreshing` 守卫 + `await accountStore.load()`；失败播报 `accountsPage.loadFailed`。
  播报**只在 composable 一处**（页面零额外代码），不允许两处都播。
- `platformLabel` 由调用方注入（`(id) => platformStore.getLabel(id) || id`，与 `Accounts.vue:591-593` 同口径）；
  未注入时回落平台 id，不因可选依赖缺失而崩。

**接线层** `composables/usePublishAddAccountTargets.js`（§5.5 的产物）：

```js
usePublishAddAccountTargets({ accountStore, platformStore, isPublishing, notifyError, notifyWarning })
// → { addAccountBindings: { refreshingAccounts, onAddAccount, onRefreshAccounts }, loadAccounts }
```

- `isPublishing` 传**函数**而非 ref：本 composable 与 `usePublishGroupTargets` 同处（早于 `usePublishFlow`），
  那时 `publishing` 尚未初始化，闭包延迟求值可避开 TDZ；且 `busy` 判据要读**点击当时**的值。
- `addAccountBindings` 直接喂 `<PublishTargetSelector v-bind="…" />`；键名合同由组件测试的 v-bind 用例钉住（§5.5）。
- `loadAccounts`（原 `views/Publish.vue` 内联的 `ensureLoaded`）搬迁至此，是视图净零行的必要条件；
  调用点与语义未变（`onMounted` 与 `useHotTopicsDraftHandoff` 均照旧使用）。

### 5.4 视觉基线纪律（重要，且本刀的原始判断被实测推翻）

`apps/desktop/tests/visual-testing/scripts/run-pixel-tests.js:22` 的 `publish-form` 视图：
`{ name: 'publish-form', route: '/publish', waitFor: '.mp-workspace .target-selector [data-testid^="platform-"]' }`。

**本刀 PRD 初版在此处写错了一个前提**，实测已推翻，记录如下以免后人照抄：

> 初版判断：「CI 跑空 profile ⇒ `accountStore.accounts` 为空 ⇒ 每个平台都是空态 ⇒ 新增 DOM 会稳定改变像素基线」。

**实测结论（2026-10-15，独立复跑两次一致）**：

| 探测量 | 默认态 | 勾选全部 15 个平台后 |
|---|---|---|
| `[data-testid^="add-account-"]` | **0** | **8** |
| `[data-testid^="refresh-accounts-"]` | **0** | **8** |
| `.target-accounts__empty` | **0** | **8** |
| `pageerror` | 0 | 0 |

成因是两条既有代码，与本刀无关：
1. `apps/desktop/tests/e2e/fixtures/accounts.json` 提供 **8 个账号**，经 `tests/e2e/helpers/ipc-mock.js` 接进 `state.accounts`，`listAccounts` 原样返回，**ipc-mock 没有任何清空账号的机制**；
2. `usePlatformSelection.js:54` 硬编码 `const selectedPlatforms = ref(['wechat_mp'])`，而 `wechat_mp` 恰好在这个 fixture 里有账号。

于是 `publish-form` 的默认截图态走的是 `platform.accounts.length > 0` 的**正常分支**，本刀新增的空态 DOM **一次都不渲染**。

**对门禁的影响**：`publish-form` 用例不会因本刀漂移。实测 `misMatchPercentage = 0.58%`（阈值 6%，`visual-test.yml` 与 `quality-gate.yml` Gate 7 同值），且网格分区统计显示变化像素均匀散布在标题/作者/素材/正文/封面等整个表单区（各块 0.5%–2.4%），**右侧「发布目标」面板为零** —— 那是字体抗锯齿噪声，不是空态布局变化。

**但必须同时说清楚这个 PASSED 的边界**：它只证明「有账号的正常态无回归」，**不构成空态无回归的证据**。空态分支在本仓现有视觉基建下**不可达**（要让它可达必须改 fixture 或给该视图加 prepare 交互，那会动测试基建，超出本刀范围）。空态的像素正确性由 `PublishTargetSelector.test.js` 的 DOM 断言（§八 L7–L10）承担，不由像素门禁承担。

**为什么把这条写进 PRD 而不是只写进质量记录**：它是一处**可复用的判据**——将来任何人改「账号区空态」的渲染，都会面临同一个"视觉门禁看不见我"的事实。若只记在本次执行记录里，下一个人会重新推导一遍（且很可能推出与初版相同的错误结论）。

---

### 5.5 逐文件行数棘轮（本刀的真实约束，决定了上面的分层）

`views/Publish.vue` 被 `check-max-lines` 的 **点名还账** `targets` 盯着：
`.github/scripts/max-lines-baseline.json` 里 `Publish.vue: 1773`，**容差 0**（超一行即 `TARGET_GREW` 阻断）。
`01-docs/learnings.md:17959` 已把处置写死：

> 被 targets 点名的文件一行都不能涨。新增功能硬写必红。正确姿势：接线逻辑抽独立 composable、
> 测试用例块拆独立 `.test.js`；**纯删注释是脆解，结构性拆分才是正解**。

同一族先例是 `hot-topics-publish-handoff`（`TARGET_GREW: Publish.vue 1896 > 1773`），当时的修法是
**真实拆分而非上调 targets**（抽出 `useHotTopicsDraftHandoff.js` / `BatchTargetsToolbar.vue` /
`BatchTargetPicker.vue` / `BatchArticleCard.vue`）。本刀沿用同一处置。

**本刀在 `Publish.vue` 的净变化 = 0 行**（`5 added / 5 removed`，实测门禁 rc=0），做法三步：

| 步骤 | 效果 |
|---|---|
| ① 把接线抽进 `composables/usePublishAddAccountTargets.js` | 内联需 13 行 → 视图只剩 1 行调用 |
| ② 三个模板属性（`:refreshing-accounts` + 两个 `@`）合并为 1 行 `v-bind="addAccountBindings"` | 3 行 → 1 行 |
| ③ 把既有 `loadAccounts()`（3 行 + 注释）搬进同一 composable | −4 行，抵消 ①②的增量 |

**②的风险与锁**：`v-bind` 的对象键必须是驼峰 `on*` 形态才能命中 kebab 事件名
（`emit('add-account')` → 归一化找 `onAddAccount`）。这不是"Vue 应该会转"的推断——
`PublishTargetSelector.test.js` 新增一条 **v-bind 合同用例**：把
`{ refreshingAccounts, onAddAccount, onRefreshAccounts }` 作为 props 传入并断言两个回调真的被调用。
键名漂移会让该用例直接变红，而不是让事件静默失效。

**为什么不选择"上调 targets"**：机制文本确实给了这条路（"或在 review 中说明理由后一并上调 targets"），
但同仓先例与 learnings 都把它排在"结构性拆分"之后；且上调等于给这个文件再送 13 行免涨额度，
与 `targets` 的立项目的（谁被点名谁从今天起一行都不能涨）直接冲突。**本刀不做**。

**顺带的解读修正**：`usePublishGroupTargets.js:4-6` 的注释写"行数预算只剩约 30 行"——
那是**相对 500+200 的登记口径**；在 `targets` 点名之后真实预算是 **0 行**。本 PR 已在该注释
与本节同步这一事实，避免下一个人按 30 行的余量规划。

## 六、显示项

| 位置 | 元素 | 内容 | 样式基调 |
|---|---|---|---|
| 平台账号区（空态） | 提示文字 | `请先添加账号`（既有文案，**不改**） | 沿用 `.target-accounts__empty`（灰、xs） |
| 同上，同行右侧 | 「添加」按钮 | `添加` | 小号文字按钮（`target-accounts__add`），主色文字 + 细边框，**不用实心大按钮**（避免在列表里抢焦点） |
| 同上，下一行 | 刷新链接 | `已经添加成功？点击刷新` | 文字链接样式（`target-accounts__refresh`），弱化色；刷新中显示 `刷新中...` 并禁用 |
| 刷新中 | 按钮/链接 | 均 `disabled` | `cursor: not-allowed` + `opacity: .6` |

**可达性**：按钮与链接都用原生 `<button type="button">`（不用 `<span @click>`），带 `data-testid` 与 `aria-label`（走 locale）；刷新链接在 loading 时加 `aria-busy="true"`。

---

## 七、提示文字（locale 键，zh/en 成对）

新增键挂在 `publishPage` 命名空间（`locales/publish-page/zh.js` / `en.js`），与 `groupPicker` 同级：

| key | zh | en | 触发 |
|---|---|---|---|
| `publishPage.addAccount.label` | 添加 | Add | 「添加」按钮文案 |
| `publishPage.addAccount.ariaLabel` | 为{platform}添加账号 | Add an account for {platform} | 按钮 aria-label |
| `publishPage.addAccount.refreshLabel` | 已经添加成功？点击刷新 | Already added? Click to refresh | 刷新链接文案 |
| `publishPage.addAccount.refreshing` | 刷新中... | Refreshing... | 刷新中 |
| `publishPage.addAccount.loginTabTitle` | {platform}登录页 | {platform} login | 新标签标题 |
| `publishPage.addAccount.loginUnsupported` | {platform}暂不支持在应用内打开登录页 | {platform} cannot open its login page in the app | V4/V5 |
| `publishPage.addAccount.openFailed` | 打开登录页失败，请重试 | Failed to open the login page, please retry | V6 |

- 复用既有键（不新建）：`accountsPage.loadFailed`（V9）、`accountsPage.saveAccountTabNoCredential`（保存侧，已存在于 `locales/accounts-page/zh.js:46`）。
- **禁止**在 `src/` 非 locales 文件里新增中文字符串字面量（CI 基线扫描拦截）。

---

## 八、测试矩阵与反证

| 层 | 文件 | 锁 | 反证（须变红） |
|---|---|---|---|
| L1 | `usePublishAddAccount.test.js`（新增） | 空 platform / 未知平台 ⇒ 不调 createTab，返回非 ok | 去掉校验 ⇒ 红 |
| L2 | 同上 | `createTab` 入参精确等于 `{url, platform, accountId:'mp-new-<p>', cleanSession:true, title}` | 漏 `cleanSession` 或换随机 id ⇒ 红 |
| L3 | 同上 | `createTab` 返回 null ⇒ 返回非 ok 且**不**抛未捕获异常 | — |
| L4 | 同上 | `refreshAccounts` 调 `load()` 而**不是** `ensureLoaded()` | 改成 `ensureLoaded` ⇒ 红（这条是本刀的核心坑） |
| L5 | 同上 | 刷新中重复调用第二次被忽略（`load` 只调一次） | 去掉 `refreshing` 守卫 ⇒ 红 |
| L6 | 同上 | `load()` reject ⇒ 不外溢未捕获异常，`refreshing` 复位 | 去掉 try/finally ⇒ 红 |
| L7 | `PublishTargetSelector.test.js` | 空态渲染「添加」按钮 + 刷新链接，且 emit `add-account` / `refresh-accounts` 带正确 platformId | 摘掉模板 ⇒ 红 |
| L8 | 同上 | 有账号时**不**渲染这两个出口 | 无条件渲染 ⇒ 红 |
| L9 | 同上 | `disabled`（发布中）时按钮与链接均 disabled | 去掉 `:disabled` ⇒ 红 |
| L10 | 同上 | `refreshingAccounts=true` 时链接 disabled 且文案切 `刷新中...` | 去掉 ⇒ 红 |
| L11 | `Publish.vue` 既有测试（`Publish.test.js` / `views-deep2.test.js`） | 既有断言零回归（组件 props 全部可选 ⇒ 既有 mount 不受影响） | — |
| L12 | `locales/structure-lock.test.js` + `check-locale-sync` | zh/en 成对 + key existence | 删 en 侧任一键 ⇒ 红 |

**不做的测试**：真机 E2E（会牵动共享 userData 与真实平台登录），以单测为准并在质量记录中如实标注——与 `PRD-PUBLISH-GROUP-PICKER-2026-10-03.md` §十一 同口径。

---

## 九、验收

- [ ] 新增测试文件全绿；`PublishTargetSelector.test.js` / `Publish.test.js` / `views-deep2.test.js` 合跑全绿
- [ ] `node scripts/check-locale-sync.js`（或 CI Gate 7 等价命令）通过，CJK 基线扫描不上升
- [ ] `npm run test:visual:pixel` 与 CI 同源基线对账；若 `publish-form` 漂移则重建并自证 0 px（§5.4）
- [ ] QM-1：改到 `apps/desktop/src` 下的 electron 主进程代码才需要打包；本刀只改 renderer，**不触发 QM-1**（如实记录判定依据）
- [ ] 质量节拍 `.quality-gates.md` 记录本次执行

### 九.1 视觉门禁的实测取证（§5.4 的展开）

- **实测方式**：以本 worktree 独占端口的 vite dev server + Playwright + 同一套 `fixture-loader`/`ipc-mock`，DOM 探针两次独立复跑，结果一致。
- **实测数据**：默认态 `add-account-*` / `refresh-accounts-*` / `.target-accounts__empty` 计数均为 **0**；勾选全部 15 个平台后三者均为 **8**（fixture 只给 7 个平台配了账号，`15 - 7 = 8`）。`pageerror` 为 0（新增 DOM 无运行时错误）。
- **像素对账**：`PIXEL_THRESHOLD=0.06`（与 `visual-test.yml:35`、`quality-gate.yml` Gate 7 同值）下 `publish-form` **PASSED**，`misMatchPercentage = 0.58%`；网格分区统计证实变化像素全在表单输入区、右侧目标面板为 0。
- **结论的边界（不得过度解读）**：这个 PASSED 证明的是「有账号的正常态无回归」，**不是**「空态无回归」。空态在现有视觉基建下不可达（§5.4），其正确性由 §八 L7–L10 的 DOM 断言承担。
- **基线与产物未被改动**：`base-screenshots/publish-form.png` 与 `publish-form-dark.png` 与 HEAD 字节级一致（`git diff HEAD -- base-screenshots/` 为空）；未运行 `UPDATE_BASELINE`。

---

## 十、残余（明确不在本刀）

1. **保存后的账号 id 是占位值 `mp-new-<platform>`**（§3.2）：功能成立但与账号页 id 形态不一致。要统一需主进程新增 IPC 返回真实新账号 id。
2. **扫码登录入口**：未提供（§1.4 第 1 条）。
3. **刷新失败的具体原因分级**：统一走 `accountsPage.loadFailed`，不区分"网络"与"未登录"（账号页也未分级，不建第二份口径）。
4. **多平台同时无账号时的批量添加**：用户需逐个平台点「添加」。批量开多个登录标签会让用户在多标签间迷失，不做。
5. **「保存账号」按钮的引导**：用户在新标签登录后未必注意到 NavBar 的「保存账号」。本刀靠「已经添加成功？点击刷新」这句反向兜底（没保存 ⇒ 刷新后还是没有 ⇒ 空态仍在）。更强的引导（如检测到登录成功就脉冲提示）属 `PRD-BATCH-LOGIN-SAVE-GUARD` 一族，不在本刀。
