# PRD：账号卡片「登录」按钮与已登录态下的重登语义

- **slug**：account-card-login-button
- **日期**：2026-10-24
- **分支**：`account-card-login-button`
- **变更类型**：混合 PR（运行时代码 + locale + 测试 + 文档）
- **影响面**：`apps/desktop/src/features/accounts/components/AccountManagementCard.vue`、`apps/desktop/src/views/Accounts.vue`、`apps/desktop/src/utils/account-status.js`、`apps/desktop/src/locales/accounts-page/{zh,en}.js` 及其测试、`apps/desktop/tests/e2e/specs/account-login-state-tristate.js`

---

## 1. 需求

账号管理页（`/accounts`）的每张账号卡片底部操作条上，**常驻**一个「登录」按钮，位置在「验证」右侧。

同时必须回答并落定一个设计问题：

> **账号本身已是「已登录」状态时，点击「登录」按钮应该是什么逻辑？**

本 PRD 给出该问题的结论、依据与实现口径。

---

## 2. 现状取证（全部为亲自回源码核对，非推断）

### 2.1 卡片底部现有操作条

`apps/desktop/src/features/accounts/components/AccountManagementCard.vue:116-143`（改动前）：

| 顺序 | 按钮 | testid | 显示条件 | 触发事件 |
|---|---|---|---|---|
| 1 | 设置 | `proxy-${id}` | 常驻 | `configure-proxy` |
| 2 | 验证 | `verify-${id}` | 常驻 | `check-login` |
| 3 | 去登录 | `login-${id}` | **`v-if="checkedExpiredIds?.has?.(account.id)"`**（仅当本会话检测确认失效） | `open-login` |
| 4 | 删除 | `delete-${id}` | 常驻 | `remove` |

⇒ **仓库里已经存在一个「去登录」入口，但它只在「本会话内被验证判定为失效」时才出现。**
本次需求是「每个卡片都有」，因此这不是新增入口，而是**把条件入口改为常驻入口**。

### 2.2 「去登录」与「登录」是同一条链路

- 卡片 `open-login` → `Accounts.vue:282` `@open-login="reloginAccount"`
- `reloginAccount`（`Accounts.vue:901-919`）→ `accountActions.openLogin('browser', platform, account.id)`
- `useAccountActions.openLogin`（`apps/desktop/src/composables/useAccountActions.js:15-20`）→ `authOpenLogin(platform, accountId)`
- preload（`apps/desktop/electron/preload/account.js:56`）→ IPC `auth:open-login`
- 主进程（`apps/desktop/electron/ipc-handlers/account.js:390-455`）→ `authViewManager.openLogin(platform)`
  - 传了 `accountId` ⇒ 走 `AccountManager.updateCapturedAccount(platform, result, accountId)`（**覆盖**已有账号凭证，**不新建**账号）
  - 未传 `accountId` ⇒ `AccountManager.saveCapturedAccount`（新建账号）

⇒ **常驻「登录」按钮与原条件式「去登录」按钮触发的是同一个 `open-login` 事件、同一条 `reloginAccount` 链路。**
⇒ 两个按钮并存 = 同一张卡片上两个功能同构、位置相邻的按钮 ⇒ **必须二选一**（见 §3.6）。

### 2.3 重新登录用的是「干净会话」，且成功才覆盖

`apps/desktop/electron/services/auth-view-manager.js:377-460` `openLogin(platform, timeout = 300000)`：

- 登录页分区 = **按平台复用的登录槽位** `persist:auth-{platform}{SUFFIX}`（`auth-login-slot.js:51-54`）
- 导航前**先清掉槽位里的旧凭证**（`auth-login-slot.js:222-242` `navigateAfterSlotCleanup` → `wipeLoginSlotCredentials`）
- ⇒ **无论账号当前是否已登录，打开的永远是平台「未登录态」的登录页。**

`apps/desktop/electron/publishers/account-manager.js:1117-1180` `updateCapturedAccount`：

- 必须先捕获到有效凭证（cookies / localStorage / indexedDB 三者全空 ⇒ 抛「未捕获到有效登录凭证」）
- 凭证落盘（`saveCredential`，原子覆盖）成功后才 PATCH 后端
- PATCH 同步回写 `status=active` + `last_validated`（`:1168-1171` 注释明写「否则『已登录并保存的账号仍显示失效』」）
- 资料字段走 `guardProfilePatchBySource`，不覆盖用户手改过的名称

⇒ **关键结论：取消 / 超时 / 捕获失败时，旧凭证完好无损；只有登录成功才覆盖。**
⇒ 因此重新登录的代价是「用户多扫一次码」，不是「账号坏掉」。

### 2.4 登录态的单一真源

`apps/desktop/src/utils/account-status.js:24-38` `accountStatusKind(account)` 归一化出 5 态：

| 归一化态 | 原始 status | 徽章文案（zh） |
|---|---|---|
| `online` | `active` / `online` | 已登录 |
| `expired` | `expired` | 已失效 |
| `unverified` | `unverified` | 未确认 |
| `error` | `error` / `failed` / `failure` | 异常 |
| `unknown` | 其他/空 | 暂无检查记录 |

⚠️ 刻意**不含** `inactive` / `offline`（历史脏值，见该文件 `:33-35` 注释）。

`apps/desktop/src/utils/account-status.js:57-63` `needsCleanLoginSession(account, confirmedExpiredIds)`：
「以账号身份打开平台页时是否必须走干净会话」= `confirmedExpiredIds.has(id)` **或** `statusKind === 'expired'`。

### 2.5 干净会话守卫为什么重要（历史事故）

`apps/desktop/src/utils/account-status.js:41-55` 记着 2026-09-16 的公众号事故：
旧身份 Cookie（有效期可到 2027）被服务端判定为「身份 Cookie ↔ 登录态」不符，
`scanloginqrcode?action=getqrcode` 返回 200 空体（真码 ~7.6KB）⇒ 页面显示**「二维码加载失败」**。
⇒ **对失效账号，「恢复凭证免登录」恰好堵死了它自己唯一的自救路径。**

---

## 3. 核心设计结论：「已登录」时点「登录」是什么逻辑

### 3.1 一句话结论

> **「登录」= 重建会话，不是「查看会话」。**
> 账号已是「已登录」时点击「登录」，**先弹一次二次确认**告知会覆盖现有凭证，用户确认后才走重新登录；
> 其余登录态（已失效 / 未确认 / 异常 / 无检查记录）**直接进入重新登录**，不打扰。

### 3.2 为什么这样定（逐条排除其他方案）

| 方案 | 结论 | 理由 |
|---|---|---|
| **A. 无脑重登**（点了就重登，不看状态） | ❌ 否决 | 账号明明还在线，却要求用户重扫一次码 —— **没有信息增量的打扰**。用户点「登录」的典型动机是「我怀疑这个号掉登录了」，此时把他扔进一个干净的登录页、让他重登，体感就是「这个功能坏了」 |
| **B. 已登录时禁用/隐藏按钮** | ❌ 否决 | `status` 是**可能陈旧**的（上次检测可能是 30 天前）。一旦实际已失效而 status 仍为 `active`，禁用态会把**唯一的自救入口**一起堵死 —— 账号从此既不能验证也不能登录。用陈旧状态当权威是典型错误 |
| **C. 点「登录」先自动跑一次检测** | ❌ 否决 | ①检测本身对多数平台**取不到定论**（2026-10-16 起 DOM 检测默认关闭、只走 HTTP 单轨），大量平台会返回「未确认」，加一轮等待却拿不到决策；②用户已经有一个专职的「验证」按钮，再造一个隐式检测入口是职责重叠；③检测与登录之间的状态漂移会引入新的竞态 |
| **D. 状态感知 + 二次确认** | ✅ **采纳** | 只在**有确凿证据表明会话可用**（`statusKind === 'online'`）时才打扰一次；其余状态零摩擦直达；确认框把「不可逆的一步」变成用户的显式决定；且对陈旧 `status` 免疫——`status=online` 但实际已失效时，用户在确认框点「继续登录」照样能修好 |

### 3.3 状态分派表（实现口径）

设 `kind = accountStatusKind(account)`：

| `kind` | 徽章 | 「登录」点击行为 | 理由 |
|---|---|---|---|
| `expired` | 已失效 | **直接**进入重新登录 | 已无「可用会话」需要保护；这正是唯一自救路径，必须最短 |
| `online` | 已登录 | **二次确认**后进入重新登录 | 会覆盖现有凭证 ⇒ 不可逆一步 ⇒ 显式确认 |
| `unverified` | 未确认 | **直接**进入重新登录 | 从未拿到结论 ⇒ 无「已知可用会话」；重登即修复手段 |
| `error` | 异常 | **直接**进入重新登录 | 检测异常 ≠ 会话可用；重登可顺带修复 |
| `unknown` | 暂无检查记录 | **直接**进入重新登录 | 同 `unverified` |

判据落点：`apps/desktop/src/utils/account-status.js` 新增 `needsReloginConfirmation(account)`。
**单一真源**（与 `accountStatusKind` 同文件），并配结构锁：全仓只允许一处实现（`account-status.test.js`）。

### 3.4 二次确认必须携带的信息

1. 账号名（`resolveAccountDisplayName`）+ 平台名；
2. **该账号当前显示「已登录」**这一事实（陈述的是**界面事实**，不是对真实状态的事实断言 —— 因为该结论可能陈旧）；
3. **最近一次检测时间**（若已知）—— 让用户自己判断这条结论有多新，避免「上个月的结论卡住今天的修复」；
4. **重新登录会发生什么**：打开平台登录页（干净会话，需重新扫码/输入密码），**成功后覆盖现有凭证**；
5. 取消 = 什么都不做，账号维持现状。

### 3.5 与既有语义的边界（必须写死）

| 用户动作 | 语义 | 会话来源 | 是否改写凭证 |
|---|---|---|---|
| 点击卡片主体 | 「用现有会话去平台」 | 账号分区 `persist:account-{id}`（失效时走干净会话） | 否 |
| 「验证」 | 「查状态」 | 只读探测（HTTP / DOM） | 否（只写 `status` + `last_validated`） |
| 「登录」 | 「重建会话」 | 平台登录槽位（**开局必清**） | 是（**仅在登录成功后**覆盖） |

⇒ 「验证」与「登录」正交且相邻，符合「先查后修」的自然顺序。
⇒ 「登录」**不是**「打开已登录的页面」——想打开后台请点卡片主体。

### 3.6 为什么移除原条件式「去登录」按钮

两者触发同一个 `open-login` 事件、跑同一条 `reloginAccount` 链路（§2.2），功能完全同构。
并存的后果：

- 账号失效时卡片底部出现 **5 个按钮**，其中两个（「登录」「去登录」）语义同构、位置相邻 ⇒ 用户困惑；
- `.account-actions button` 是 `flex: 1 1 0` 均分（`AccountManagementCard.vue:597-612`），多一个按钮会整体压缩四个；
- 常驻「登录」**完全覆盖**了条件式按钮的场景（失效账号照样能点登录）。

⇒ **移除条件式「去登录」，由常驻「登录」取代。** 移除后操作条恒为 4 个按钮：设置 / 验证 / 登录 / 删除。
⇒ 卡片侧随之移除 `checkedExpiredIds` prop（卡片内已无使用方）；`checkedExpiredIds` 在 `Accounts.vue` 内**继续保留**（`needsCleanLoginSession` 仍要用）。

---

## 4. 连带缺陷修正（本次必须一并处理）

### 4.1 D-A：重新登录成功后未清 `checkedExpiredIds` ⇒ 刚登录成功却打不开后台

**现象**：账号被判定失效 → 用户点「登录」重新登录成功 → 凭证与 `status=active` 都已落库，
但 `checkedExpiredIds` 仍持有该 id ⇒ `needsCleanLoginSession()` 返回 `true`
⇒ 点卡片打开创作者中心会走**干净会话** ⇒ 平台把用户当未登录 ⇒ **用户刚登录成功却看到登录页**。

**根因**：`Accounts.vue:517-523` 的 `onCompleted` 只 `await refresh()`，没有清理会话级失效集合。

**为何本次必须修**：条件式「去登录」按钮下，重新登录是**低频**动作；
本次把「登录」变成**每张卡片常驻**的第一类入口 ⇒ 该缺陷的触发频率从「偶发」变成「高频」。
⇒ 属于「本次改动直接放大的既有缺陷」，按完整性原则（Boil the lake）一并修。

**修法**：`onCompleted` 收到 `data.accountId` 时，从 `checkedExpiredIds` 中删除该 id
（主进程 `auth:completed` 回传 `{ platform, accountId }`，见 `ipc-handlers/account.js:435-437`）。

### 4.2 D-B：取消重新登录时误清 `checkedExpiredIds` ⇒ 失效账号失去干净会话保护

**现象**：`Accounts.vue:905-908` 在 `result.cancelled` 分支执行 `checkedExpiredIds.value.delete(account.id)`。

**问题**：取消重新登录 **不等于** 账号恢复登录 —— 账号**仍然是失效的**。
清掉它之后：
- 单条「验证」的失效结论只写 `checkedExpiredIds`（本次会话内），而**本地** `account.status` 不会立刻刷新
  （`checkLogin` 失效分支只 `checkedExpiredIds.add(id)`，不写本地 status、不 `refresh()`）
- ⇒ `needsCleanLoginSession()` 两个判据都为 false ⇒ 点卡片带**旧凭证**进平台
  ⇒ 命中 §2.5 的「二维码加载失败」事故路径。

**为什么当初这么写**：条件式「去登录」按钮以 `checkedExpiredIds` 为显示条件，
取消时删掉是为了**让按钮消失**。⇒ **按钮可见性逻辑污染了状态语义。**
本次移除条件式按钮后，这个删除**不再有任何界面用途**，只剩破坏性。

**修法**：取消分支**不再删除**该 id（账号确实仍失效）；只在「重新登录成功」时删除（见 D-A）。

**语义收口（写死）**：

> `checkedExpiredIds` 的唯一语义 = 「本会话内已确认该账号登录态失效」。
> 增：检测确认失效时。删：**重新登录成功**时。除此之外任何路径都不得增删。

---

## 5. 变更清单

### 5.1 `AccountManagementCard.vue`

- **删除**条件式「去登录」按钮（`v-if="checkedExpiredIds?.has?.(account.id)"`）。
- **新增**常驻「登录」按钮，位置在「验证」右侧、「删除」左侧：

  ```html
  <button
    :data-testid="`login-${account.id}`"
    data-e2e-scan="manual"
    type="button"
    class="login-button"
    :title="t('accountsPage.accountCardLabels.loginTitle')"
    @click.stop="$emit('open-login', account)"
  >
    <Monitor />{{ t('accountsPage.accountCardLabels.login') }}
  </button>
  ```

- **移除** `checkedExpiredIds` prop（卡片内已无使用方）与 `Accounts.vue` 侧的绑定。
- 卡片内的「最近检测」时间解析**下沉**到 `utils/account-status.js` 的 `lastLoginCheckAt`（单一真源）；
  卡片与账号页的二次确认框读同一份字段名清单，避免第二份漂移
  （与 `account-status.js` 头注释记着的 2026-09-30 事故同型）。

### 5.2 `utils/account-status.js`（登录态判定的单一真源）

新增两个导出：

| 函数 | 作用 |
|---|---|
| `lastLoginCheckAt(account)` | 取最近一次检测时间（`Date` 或 `null`）；字段名清单 `LAST_CHECK_KEYS` 收口到本文件 |
| `needsReloginConfirmation(account)` | 重新登录是否需要二次确认（= `accountStatusKind(account) === 'online'`） |

### 5.3 `features/accounts/composables/useReloginGuard.js`（新增）

**「重新登录」这件事整体收进独立 composable**，而不是散在 `Accounts.vue` 里：

| 导出 | 职责 |
|---|---|
| `confirmRelogin(account)` | 已登录态弹二次确认，其余登录态直接放行（`true`）。文案拼装、i18n 取值、检测时间格式化都在这里 |
| `reloginAccount(account)` | 确认 → 打开登录页 → 失败提示 → 取消/失败时收 `pendingAuthAction` |

**为什么必须抽出来（不是「为了好看」）**：
`Accounts.vue` 在逐文件行数门禁的**点名还账清单**里（`targets` = 1578 行，**零增长容差**）。
把确认逻辑留在 `Accounts.vue` 里 ⇒ 本次改动净增 32 行 ⇒ 门禁报
`TARGET_GREW: apps/desktop/src/views/Accounts.vue 现 1610 行已超过点名目标 1578 行（超 32）`。
⇒ 抽出来之后本文件**净减 12 行**（1577 → 1565），且新逻辑有独立的归属与单测。
⇒ **这条纪律是「降债优于抬基线」的直接体现**：不调 `targets`（那是「改谁来守门」，须人工过目），改把自己的代码放到放得下的地方。

### 5.4 `Accounts.vue`

- 删除本地 `reloginAccount` 实现，改为 `const { reloginAccount } = useReloginGuard({ pendingAuthAction, loginMode, checkedExpiredIds, platformLabel })`。
- `onCompleted`：收到 `data.accountId` 时 `checkedExpiredIds.value.delete(data.accountId)`（D-A）。
- 卡片绑定：移除 `:checked-expired-ids="checkedExpiredIds"`。
- `checkedExpiredIds` 的**取消分支删除**随 `reloginAccount` 一起移出（D-B）。

### 5.5 locale（`locales/accounts-page/zh.js` + `en.js`）

| key | zh | en |
|---|---|---|
| `accountCardLabels.login` | `登录` | `Log in` |
| `accountCardLabels.loginTitle` | `重新登录该账号：会打开平台登录页，登录成功后覆盖该账号现有凭证` | `Log in again: opens the platform login page and replaces this account's stored credentials on success` |
| `accountCardLabels.goLogin` | **删除**（条件式按钮已移除） | 删除 |
| `accountsPage.reloginConfirmTitle` | `重新登录` | `Log in again` |
| `accountsPage.reloginConfirmMessage` | 函数：账号名 / 平台名 / 「已登录」事实 / 最近检测时间（可空）/ 覆盖后果 | 同结构英文版 |
| `accountsPage.reloginConfirmAction` | `继续登录` | `Continue` |

`accountsPage.goLogin`（**顶层**那个）**保留** —— 它是「验证判定失效」确认框的按钮文案，与卡片按钮无关。

> 注：确认框文案里的「已登录」是**状态值**而非按钮名，不进 `scripts/check-locale-button-name-sync.js` 的登记表（该门禁只管引导文案里引用的**按钮名**）。

### 5.6 测试

| 文件 | 变更 |
|---|---|
| `features/accounts/composables/useReloginGuard.test.js`（新增，8 例） | 非「已登录」态不弹框 / 已登录态弹框且文案带账号名·平台·最近检测时间 / 无检测记录时**不编造**时间 / 登录页被关闭时账号仍留在失效集合 / 已登录态取消不进链路 / 确认后进链路 / 失效态不打扰 / 平台缺失不发起请求 |
| `features/accounts/components/AccountManagementCard.test.js` | 改写「去登录按钮出现/消失」断言为「登录按钮常驻」；新增「登录按钮排在验证右侧、删除左侧」的位置契约锁；移除 `checkedExpiredIds` prop 传参 |
| `utils/account-status.test.js` | 新增 `needsReloginConfirmation` 的 5 态用例 + 结构锁；新增 `lastLoginCheckAt` 的取值/非法值用例 |
| `views/Accounts.test.js` | 新增 5 例：online 弹确认+取消不进链路 / online 确认进链路 / expired 不弹确认直接进 / 重登成功后清 `checkedExpiredIds` / 取消重登后**保留** `checkedExpiredIds` |
| `tests/e2e/specs/account-login-state-tristate.js` | 改写「未确认账号不提供『登录』入口」断言为「按钮常驻 + 徽章仍是未确认（按钮出现 ≠ 判为失效）」 |

---

## 6. 验收标准

### 6.1 功能

| # | 验收 | 落点 |
|---|---|---|
| A1 | 每张账号卡片的操作条恒有「登录」按钮，位置在「验证」右侧、「删除」左侧 | `AccountManagementCard.test.js` 位置契约锁 |
| A2 | 卡片上**不再**存在第二个「去登录」按钮（任何状态下都只有一个登录入口） | 同上（按钮清单精确等于 4 个） |
| A3 | `status=active` 的账号点「登录」⇒ 弹二次确认；取消 ⇒ 不打开登录页、不改任何状态 | `useReloginGuard.test.js` + `Accounts.test.js` 用例 1 |
| A4 | `status=active` 的账号点「登录」⇒ 确认 ⇒ 打开平台登录页（干净会话） | `useReloginGuard.test.js` + `Accounts.test.js` 用例 2 |
| A5 | `status=expired` / `unverified` / `error` / 无 status 的账号点「登录」⇒ **无确认框**，直接打开平台登录页 | `useReloginGuard.test.js` + `Accounts.test.js` 用例 3 + `account-status.test.js` 5 态矩阵 |
| A6 | 重新登录成功 ⇒ 账号凭证被覆盖、`status` 回写 `active`、卡片徽章变「已登录」 | 主进程既有链路（`updateCapturedAccount`），本次不改 |
| A7 | 重新登录成功 ⇒ 该 id 从 `checkedExpiredIds` 移除 ⇒ 随后点卡片打开创作者中心**带现有会话** | `Accounts.test.js` 用例 4 |
| A8 | 重新登录被取消 ⇒ 该 id **仍保留**在 `checkedExpiredIds` ⇒ 随后点卡片走**干净会话** | `Accounts.test.js` 用例 5 |
| A9 | 卡片上「登录」按钮在批量模式下不触发选中切换（`@click.stop`） | 既有 `@click.stop` + 卡片事件测试 |
| A10 | 「登录」按钮在账号已停用（`is_active=false`）时仍可点击（停用只影响发布资格，不影响登录态维护） | 卡片不按 `is_active` 禁用按钮（设计口径，见 §8） |

### 6.2 文案

| # | 验收 |
|---|---|
| B1 | zh / en 两份 locale 的 key 集合完全一致 |
| B2 | 确认框文案包含：账号名、平台名、「已登录」事实、最近检测时间（若已知）、「覆盖现有凭证」的后果 |
| B3 | 按钮文案与卡片上其它按钮名不冲突（「设置」「验证」「登录」「删除」四个互不混淆） |
| B4 | en 文案零 CJK（locale-CJK 门禁） |

### 6.3 非功能

| # | 验收 |
|---|---|
| C1 | `AccountManagementCard.vue` 行数 ≤ 768（挂账基线 568 + 增长上限 200） |
| C2 | `Accounts.vue` 行数 ≤ 1672（挂账基线 1472 + 增长上限 200） |
| C3 | 不新增任何 preload API / IPC 通道（纯前端改动 ⇒ 不触发 preload 契约测试三处同步） |
| C4 | 不触碰 `CHANGELOG.md`（聚合器专属写面，按 `changelog-record-carrier` 合同零改动） |
| C5 | `01-docs/PRD.md` 补充对应章节并指向本 PRD |

---

## 7. 不做什么（明确排除）

1. **不改**登录链路的底层实现（`authViewManager` / 登录槽位 / 凭证捕获）—— 本次只改「谁在什么状态下可以触发它」。
2. **不删**「验证」按钮，也不合并两个按钮 —— 两者语义正交。
3. **不实现**「批量登录」「一键重新登录」—— 与「一键检测」是不同动作，未在本次需求内。
4. **不实现**登录成功后自动重跑「验证」—— `updateCapturedAccount` 已把 `status=active` 写回真源，再跑一次是多余的一轮网络往返。
5. **不改** `needsCleanLoginSession` 的判据口径 —— 只修 `checkedExpiredIds` 的增删纪律。
6. **不新增**登录方式（扫码 / 密码 / 短信）—— 沿用 `openLogin('browser', ...)` 既有链路。
7. **不把**失效账号点「登录」也做成二次确认 —— 失效账号没有可保护的有效会话，多一道确认只会钝化判断力。

---

## 8. 风险与取舍

| 风险 | 影响 | 缓解 |
|---|---|---|
| 卡片操作条恒为 4 个按钮 | 窄卡片下按钮更挤 | 与原来「失效时」的样子完全一致（原本失效时也是 4 个）；移动端 `max-width:600px` 已有 `flex-basis:50%` 换行规则 |
| 确认框在「状态陈旧」时挡住用户 | 用户多点一次 | 确认框内**显示最近检测时间**，用户可自行判断；且确认后必然能走完重登，不存在死路 |
| `online` 态其实是误判（实际已失效） | 用户被多问一次 | 确认框文案写的是「当前显示为已登录」，陈述的是**界面事实**而非事实断言，不误导 |
| 移除「去登录」按钮影响存量用户肌肉记忆 | 短期内找不到入口 | 「登录」按钮位置不变（仍在「验证」右侧），且文案更短更醒目；原按钮本来就是条件显示，多数用户从未见过 |
| `checkedExpiredIds` 语义收紧后，若仍有其他写入方 | 干净会话保护被绕过 | 本次已全仓 grep 确认写入方只有 3 处（`checkLogin` / `batchCheckAllLogins` / `reloginAccount`），逐一落到 §4.2 的纪律上（见 §9） |
| 账号已停用（`is_active=false`）时点登录 | 停用账号被重建会话 | 停用只影响**发布资格**，不影响登录态维护；且重新登录不改变 `is_active`。设计上刻意不禁用 |

---

## 9. 附：全仓写入方核查（`checkedExpiredIds`）

| 位置 | 现有动作 | 本次处置 |
|---|---|---|
| `Accounts.vue` `checkLogin` 失效分支 | `add(id)` | 保留（检测确认失效 ⇒ 增） |
| `Accounts.vue` `batchCheckAllLogins` | `valid ⇒ delete` / `invalid ⇒ add` / `unconfirmed ⇒ delete` | **保留不动**。该路径的 unconfirmed 分支删集合项时，兜底由**本地 `account.status`** 承担（该分支会把主进程回传的 `item.loginStatus`（keptStatus）写回本地 status，失效账号因此仍走干净会话）。本次不改动这条路径 |
| `Accounts.vue` `reloginAccount` 取消分支 | `delete(id)` | **移除**（D-B：取消 ≠ 恢复登录） |
| `Accounts.vue` `onCompleted` | 无 | **新增** `delete(id)`（D-A：重登成功 ⇒ 失效结论作废） |

---

## 10. 附：变异验证（本次新增用例的「有牙齿」证据）

绿灯不等于有保护。逐条把修复撤掉，确认对应用例**指名变红**：

| 变异 | 撤掉的东西 | 变红的用例（实测条数） |
|---|---|---|
| 1 | `needsReloginConfirmation` 恒返回 `false` | **5 条**（`Accounts.test.js` 2 + `useReloginGuard.test.js` 3） |
| 2 | 删掉 `onCompleted` 里的 `checkedExpiredIds` 删除（D-A 修复） | **1 条**（D-A 用例） |
| 3 | 在 composable 的「登录页被关闭」分支加回删除（D-B 修复回退） | **2 条**（`Accounts.test.js` 1 + `useReloginGuard.test.js` 1） |
| 4 | 卡片「登录」按钮加回 `v-if="false"` | **5 条**（卡片用例，含位置契约锁） |

⇒ 4 处修复都有指名变红的用例守着，不存在「测试全绿但没守住任何东西」的空转。
⇒ 全部还原后复跑：`187 passed | 1 skipped (188)`。

---

## 11. 附：过程中被门禁抓到的两件事（写给下一个改账号页的人）

1. **`Accounts.vue` 在点名还账清单里，零增长容差。** 本次第一次实现把确认逻辑直接写进
   `Accounts.vue`（净增 32 行），`node .github/scripts/check-max-lines.js` 当场报
   `TARGET_GREW: 现 1610 行已超过点名目标 1578 行（超 32）`。
   正解不是上调 `targets`（那是「改谁来守门」，须人工过目），而是**把自己的代码放到放得下的地方**
   —— 抽成 `useReloginGuard.js`，本文件反而净减 12 行。
2. **`pnpm config set --location project` 会重写 `pnpm-workspace.yaml`。**
   pnpm 重新序列化该 YAML，注释缩进都被改了；那份改动会混进提交。
   ⇒ 需要改 store 路径时用 `--store-dir` 参数或 `PNPM_HOME`，**不要**用 `--location project`；
   提交前用 `git diff -- pnpm-workspace.yaml` 确认零改动。
