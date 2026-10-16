# 账号页列表路径零解密 —— 代理信息移出列表、改为弹窗按需读取

- **日期**：2026-10-15
- **分支 / PR**：`nav-perf-ux` / #3742
- **上一轮**：`01-docs/BUGFIX-SIDEBAR-ACCOUNTS-SLOW-2026-10-14.md`（#3591，把同步串行改成异步并行）
- **执行记录**：`openspec/records/nav-perf-ux.md`

---

## 1. 现象与用户原话

> 「应用点击左侧的菜单时，比如『账号』，反应特别慢，好几秒才加载。」
> （#3591 修完之后）「我觉得就把账号页中，账号卡片上的代理信息去掉吧。既然会影响页面打开速度的话。」

用户自带日志（`shared-user-data/logs/app-2026-10-15.log`）实测：

```
accounts:list ok :: count=8 ... 耗时=1579ms
accounts:list ok :: count=8 ... 耗时=1451ms
accounts:list ok :: count=8 ... 耗时=1569ms
```

同批日志里每个账号一行 `checkLocalCredentials: OK encrypted <platform>:<id>`，**8 行间隔约 100ms** —— 串行特征。

**关键事实：#3591 的修复当时并未进入用户的运行实例**（`git merge-base --is-ancestor b84e67e72 HEAD` 在共享根与用户运行的那个 worktree 上均为 rc=1）。所以「修完还是慢」这一观测，一部分是**没跑到新代码**。

---

## 2. 第一性原因

`listAccounts()` 为了让每个账号带上 `proxy` 字段，逐账号调用：

```
listAccounts()
  └─ getAccountProxyStatus(accountId, platform)
       └─ loadSavedCredentials()
            └─ credentialStore.loadCredential()
                 └─ decryptData()
                      └─ deriveKey()
                           └─ crypto.pbkdf2Sync(masterKey, salt, 100000, 32, 'sha512')   ← 同步阻塞事件循环
```

- 单次 `pbkdf2Sync` 实测 **约 125 ms**（10 万次迭代）
- N 个账号 = **N × 125 ms 串行**，且**阻塞主进程事件循环**（期间所有 IPC 一起卡）
- 8 账号 ≈ 1.0 s，与日志里的 1451–1579 ms 吻合

**#3591 做了什么、没做什么**：

| | #3591 | 本轮 |
|---|---|---|
| 手段 | 同步 `pbkdf2Sync` → 异步 `crypto.pbkdf2`（走 libuv 线程池）+ 批量并行 | 列表**不读代理** |
| wall-time | 降 3.5–3.7x（10 账号 1.4s → 370ms） | 归零（不做这件事） |
| **总 CPU** | **一字未减** | **消除** |
| 复发 | 每次进账号页都付 | 不付 |

> **教训**：#3591 的回归锁断言了「并行度合格」（`maxInFlight > 1`），却锁不住**目标**（总成本是否被消除）。**「手段合格」的锁必须配「目标达成」的锁。**

---

## 3. 为什么正解是「列表不读代理」而不是「再优化一次并行度」

代理配置存在**加密凭证文件**里（`setAccountProxy` 把它写进与 cookies / localStorage / indexedDB / accountInfo **同一份 payload**）。读取必须解密整份文件。

而列表要显示的代理字段**全部是非敏感的**：

| 字段 | 含义 | 敏感性 |
|---|---|---|
| `configured` | 是否已配置 | 非敏感 |
| `type` | `http` / `https` / `socks5` | 非敏感 |
| `hostMasked` | **掩码后**的主机名 | 非敏感 |
| `port` | 端口 | 非敏感 |
| `hasAuthentication` | 是否带认证 | 非敏感 |

`username` / `password` **永不外传**（由 `proxy-config.js:toPublicProxyConfig` 保证）。

⇒ **为了 5 个非敏感字段，付 N 次整份凭证解密（含 cookies 与 token）**。这是典型的「详情级数据进了列表路径」。

**产品决策（用户确认）**：既然代价这么大而价值只是一个徽标，**把代理信息从账号页列表移出**；代理状态改在用户**真正要看/改**时读一次。

---

## 4. 功能逻辑（改了什么）

### 4.1 列表路径：不再读取代理

`electron/publishers/account-manager.js`：

```js
// 改造后：直返后端账号，一次 PBKDF2 也不跑
return accounts
```

被删除的死代码：`loadProxyStatusMap()`、`safeAccountProxyStatus()` 及其 `degraded` 降级分支。

### 4.2 新增按需读取入口

| 层 | 位置 | 契约 |
|---|---|---|
| 主进程 | `AccountManager.getAccountProxyStatusLazy(accountId, platform?, options?)` | **异步**（走 `credential-proxy-status.loadProxyStatuses`），单账号 |
| IPC | `electron/ipc-handlers/account-proxy.js` → 通道 `account:get-proxy` | `{ accountId, platform? }` → `{ code: 0, data: <公开态> }` |
| preload | `electron/preload/account.js` → `accountGetProxy(accountId, platform)` | 同时必须重生成 `index.bundle.js`（见 §7.2） |
| renderer API | `src/api/publisher.js` → `accountGetProxy()` | `invokeWithFallback`，无 electronAPI 时返回 `{ code: -1 }` |
| composable | `src/composables/useAccountProxyDialog.js` → `getProxy(account)` | 渲染端**唯一**能拿到「当前代理」的入口 |
| 组件 | `AccountProxyDialog.vue` | 由 `loading` / `loadError` 两个 prop 驱动三态 |

**为什么走异步而不是复用既有的同步 `getAccountProxyStatus`**：同步版内部是 `pbkdf2Sync`（125 ms），会阻塞主进程事件循环、拖慢同刻所有 IPC。异步版把密钥派生丢进 libuv 线程池，弹窗打开期间界面不卡。两者读同一份密文、同一套 KDF 参数，**结论逐字段一致**。

### 4.3 IPC 处理器为什么单独成文件

`ipc-handlers/account.js` **已在 `check-max-lines` 的行数挂账清单上**（登记值 571，实测 728），继续往里堆会撞膨胀容差。既有先例是 `account-active.js` / `account-rename.js`（读写分离），本次沿用。

---

## 5. 交互逻辑与显示项

### 5.1 账号页 —— 移除了什么

| 位置 | 移除内容 | 证据 |
|---|---|---|
| `AccountManagementCard.vue` | 卡片「代理」行（徽标 + 值，`data-testid="account-proxy-<id>"`）、`proxyLabel()` 函数、`.assignee-proxy` 样式 | 卡片归属区从 3 行变 2 行（负责人、运营人） |
| `PlatformAccountGroup.vue` | 列表行「代理」徽标（`v-if="account.proxy?.configured"`）+ `proxyStatusLabel()` tooltip（「已绑定 HTTP 代理 10.0.\*.\*:8080」）、`.account-proxy-status` 样式 | 状态区不再随 proxy 变化 |
| locale | `accountsPage.accountCardLabels.proxyLabel`（zh/en 成对） | 键已无消费者 |

**保留**：卡片与列表行的「设置」/「配置代理」按钮（`data-testid="proxy-<id>"`）——它是入口，用户仍需能进代理设置。

**代价（如实记录）**：列表不再一眼可见「哪些账号配了代理」。这是**有意的产品决策**。若将来要恢复，正解**不是**给列表加回解密，而是把 `configured` 布尔作为**明文元数据**存进后端 `accounts.json`（详情仍以解密为准），代价是引入第二个真源。

### 5.2 代理设置弹窗 —— 新增的三个态

惰性化**必然引入**这三个态。少了它们，用户会先看到「当前未配置代理」的**假象**，再被异步到达的数据填上。

| 态 | 触发条件 | 显示项 | 提示文字（zh / en） |
|---|---|---|---|
| **读取中** | `loading === true` | 灰底状态条（`data-testid="proxy-loading"`） | 「正在读取当前代理配置...」/ "Loading current proxy settings..." |
| **读取失败** | `loadError` 非空 | 红底条 + 右侧「重试」按钮（`proxy-load-error` / `proxy-retry`） | 标题「读取当前代理配置失败」/ "Failed to load current proxy settings"；按钮「重试」/ "Retry" |
| **已配置** | `account.proxy.configured === true` | 绿底状态条「当前 HTTP 10.0.\*.\*:8080」 | —（复用既有 `proxyDescription`） |
| **未配置** | 读到但 `configured === false` | 不显示任何状态条 | — |

**按钮可用性**：

| 按钮 | 读取中 | 读取失败 | 已配置 | 未配置 |
|---|---|---|---|---|
| 取消 | 可点 | 可点 | 可点 | 可点 |
| 清除 | **不显示**（此时还没有可信的"当前已配置"结论） | 不显示 | 可点 | 不显示 |
| 保存 | **禁用**（`proxyAccount` 还是占位值） | **可点**（用户仍可填一份新代理直接保存） | 可点 | 可点 |

> 「读取失败不禁用保存」是有意的：读取失败不该让用户连"重新填一份"都做不到。

### 5.3 打开弹窗的完整流程

```
用户点「设置」/「配置代理」
  └─ openProxyDialog(account)
       ├─ proxyAccount = { ...account, proxy: { configured: false } }   ← 占位，避免下游读 undefined
       ├─ proxyLoadError = ''
       ├─ showProxyDialog = true                                        ← 弹窗先出现，不等数据
       └─ await loadProxyForDialog()
            ├─ proxyLoading = true                                      ← 显示「正在读取当前代理配置...」
            ├─ accountActions.getProxy(account)                         ← IPC account:get-proxy
            │    ├─ code !== 0 → proxyLoadError = 格式化后的错误        ← 显示错误 + 重试
            │    └─ code === 0 → proxyAccount = { ...account, proxy: data }  ← 预填
            └─ finally: proxyLoading = false
```

「重试」按钮 → 再调一次 `loadProxyForDialog()`（同一个 `proxyAccount`，不重新打开弹窗）。

### 5.4 一个必须记住的 watch 陷阱

弹窗里预填「当前代理」的 watch：

```js
// ✅ 正确：原始值拼成的字符串键
watch(() => `${props.visible}|${props.account?.id || ''}`, () => { prefilled.value = false; resetForm() })

// ⛔ 错误：数组 getter
watch(() => [props.visible, props.account?.id], resetForm)
```

**为什么数组 getter 会炸**：每次依赖失效，getter 都返回一个**新数组**，watch 内部用 `Object.is` 比较 → 必然不相等 → 触发。而惰性读取正是**换上一个带 `proxy` 的新 account 对象**（`id` 并未变），于是 `resetForm()` 被误触发，**把用户在读取窗口里已经敲进去的内容清掉**。

配套的第二个 watch 只做「预填一次」，并用 `prefilled` 闸区分「数据到达」与「用户输入」，避免覆盖用户已改的字段。

回归锁：`AccountProxyDialog.test.js`
- 「惰性读到的当前代理只预填一次，不覆盖用户已输入的内容」
- 「读取中显示加载态并禁用保存」
- 「读取失败显示错误并给出重试，且**不**禁用保存」

---

## 6. 数据校验

### 6.1 IPC 入参

| 检查 | 失败返回 |
|---|---|
| 已识别当前用户（`getOwnerSubject() !== null`） | `{ code: AUTH_ERROR, message: '无法识别当前用户' }` |
| `arg` 是对象 | `{ code: VALIDATION_ERROR, message: '缺少参数对象' }` |
| `accountId` 通过 `isSafePathSegment` | `{ code: VALIDATION_ERROR, message: '缺少或非法 accountId 参数' }` |
| `platform` 若提供则须通过 `isSafePathSegment` | `{ code: VALIDATION_ERROR, message: '非法 platform 参数' }` |
| `getAccountProxyStatusLazy` 可调用 | `{ code: REQUEST_ERROR, message: '代理状态读取不可用' }` |
| 返回值是对象 | `{ code: REQUEST_ERROR, message: '代理状态无效' }` |

`isSafePathSegment` 校验是**路径安全**要求（账号 id 会参与凭证文件路径拼接），不是格式偏好。

### 6.2 主进程侧降级口径

`getAccountProxyStatusLazy` 的返回契约与既有同步 `getAccountProxyStatus` **完全一致**，避免两条路径给出不同答案：

| 情形 | 返回 |
|---|---|
| 账号不存在 / 未配置代理 | `{ configured: false }` |
| `accountId` 或 `platform` 非法 | `{ configured: false }` |
| 密文损坏 / 主密钥不可用 / 抛错 | `{ configured: false }`（旁路降级，只记 warn，**不抛给弹窗**） |
| 代理字段存在但格式非法 | `{ configured: true, invalid: true }` |

**为什么旁路失败也返回 `code: 0`**：弹窗必须能打开。把"读取失败"说成"打不开设置"是更差的选择——用户至少还能重新保存一份代理。（残余限制：`configured: false` 无法区分「确实没配」与「读取失败」，UI 上表现为显示「未配置」+ 错误条并存。）

### 6.3 渲染端

- 传给 IPC 的必须是纯 JSON 对象；`useAccountProxyDialog.getProxy()` 只取 `account.id` / `account.platform` 两个原始值构造入参，不传 reactive 对象。
- `openProxyDialog` 收到的 `account` 来自列表，**已不含 `proxy`**，因此先铺一份 `{ configured: false }` 占位再异步替换。

---

## 7. 本轮实测修到的两个实现缺陷

### 7.1 数组 getter 的 watch 误触发重置（渲染端）

见 §5.4。由回归锁当场抓出（先用数组 getter 复现变红，再改字符串键转绿）。

### 7.2 漏带 preload IIFE bundle（**打包版才会暴露的功能性缺陷**）

`preload/account.js` 新增 `accountGetProxy` 后，打包会重生成 `electron/preload/index.bundle.js`。前两次提交**漏带了该产物**（3 行）。

**后果**：**打包版**（非 dev）的 preload 里没有这个 API ⇒ `invokeWithFallback` 静默返回 `code = -1` ⇒ 代理设置弹窗**永远显示「读取当前代理配置失败」**。

**为什么五层测试都没拦住**：

| 层 | 为什么没拦住 |
|---|---|
| 单元测试 | 全部 mock 掉 `window.electronAPI`，只能验渲染端分支 |
| 集成测试 | 同上 |
| 功能 E2E | 跑在 dev 态，Vite 直接走源文件、**不经过该 bundle** |
| 视觉回归 | 弹窗错误态不在像素基线覆盖面上 |
| 代码审查 | 单看 `preload/account.js` 的 diff 看不出"还有个产物要重生成" |

**只有真实打包产物里才暴露** —— 这正是 QM-1「单元测试不能替代完整打包验证」要拦的形状。而且它**确实被 QM-1 拦到了**（打包重生成后工作区出现该文件改动），是**我第一轮漏看了工作区变化**。

> **可复用判据**：凡改 `electron/preload/*.js`，**必须检查 `git status` 里 `index.bundle.js` 是否被重新生成**，是则一并提交。仅跑打包不够——还要看产物是否"脏"。

---

## 8. 验证与门禁

| 项 | 命令 / 判据 | 结果 |
|---|---|---|
| 前端测试 | `vitest run`（Accounts 119 + AccountManagementCard 42 + AccountProxyDialog 6） | **166 通过 / 1 skipped** |
| 主进程测试 | `vitest run`（account-manager 89 + account.test 77） | **166 通过** |
| 逐文件行数门禁 | `node .github/scripts/check-max-lines.js` | **exit 0** |
| ESLint | `eslint --quiet`（17 个改动文件） | **exit 0** |
| QM-1 打包 | `electron-builder --win --dir --publish never` | **exit 0** |
| QM-1 ① 存活断言 | 8000 ms 窗口期内仍存活 | **OK** |
| QM-1 ② 子进程 env | `buildChildEnv()` 剔除 `ELECTRON_RUN_AS_NODE` | **已剔除 = true** |
| QM-1 ③ stderr 三层 | 为空 ⇒ PASS | **PASS（第③层）** |
| QM-4 视觉 | 重采 4 张账号页基线（详见 §9） | **0 失败（漂移 → 0）** |
| 执行记录判据 | `check-pr-exec-record --mode=enforce` | **OK** |
| 载体冻结判据 | `check-gate-record-debt` | **OK**（含「旧载体与冻结基线一致」） |

### 8.1 行数门禁的两处打红与修法

| 文件 | 问题 | 修法 |
|---|---|---|
| `ipc-handlers/publish.js` | 508 行 ≥ 500（我加的 `history:list` 耗时日志 +11 行） | **回退该改动**，登记为遗留项（正确修法是先按范式拆出 history 处理器再补日志） |
| `src/views/Accounts.vue` | 1624 行 > 点名目标 1578（**零增长容差**） | 按门禁提示的 **composable 范式**把代理弹窗整体下沉到 `useAccountProxyDialog.js` → **1624 → 1538 行** |

---

## 9. 视觉门禁：为什么必须重采基线

**首轮我把 QM-4 判成 `N/A`，理由是「被删元素没有任何像素基线」——这个判断是错的。**
`apps/desktop/tests/visual-testing/base-screenshots/` 里**有**账号页基线（`accounts-list[-flag-on][-dark].png`），删元素必然改变它。**我把「我没查」写成了「不适用」。**

CI 随后以 **`Gate 7b - Baseline freshness`** 打红（**不是** `Gate 7 - Visual regression`，后者 6% 阈值下通过了）。

### 9.1 归因证据（四条）

| # | 证据 |
|---|---|
| ① | **两轮独立重采数值逐位相同**：round1 == round2 == light `34481px / 1.663%`、dark `62878px / 3.032%` ⇒ 经 two-round verdict 判定为**确定性真实漂移、非抖动** |
| ② | **43 个受管视图只有这 4 个漂移**，其余 **39 个零漂移** ⇒ 无附带损伤 |
| ③ | 本地独立复现数值与 CI **一致**（1.66% / 3.03%），差异图红带正落在**被删的代理行处**，其下为整片垂直重排（删掉一行后内容上移的机械必然后果） |
| ④ | **闭环**：换用新基线、去掉 `UPDATE_BASELINE` 重跑，浅/暗均 **0 失败**（漂移 → 0） |

### 9.2 为什么是「重新取证」而不是「抬预算」

判据脚本原文对此有明确规定：

> 变这么多说明该处行为已改，**须重新取证而非抬预算**

抬 `DYNAMIC_ALLOWED` 预算会把「我删的」与「别的什么坏了」**一起盖住**，正是该判据要拦的形状。

### 9.3 手法（范围受控）

- 用脚本自带的 **`PIXEL_ONLY`** 限定范围 —— 其注释明确：全量 `UPDATE_BASELINE` 会把与本任务无关的环境差（字体/滚动条等）一并烘进基线，反而抬高 CI 误报风险。
- `UPDATE_BASELINE=1` 在 `test-runner.js:561` **只在基线缺失分支生效** ⇒ 先 `git rm` 4 张受管基线（**受管文件的正规删除路径**）、并先备份到 `%TEMP%`。
- dev server 用**独占端口 5179** —— 脚本 L214 警告：`TEST_URL` 若指向并发会话在跑的 server，会**拿到别人构建的截图当自己的证据**。
- 4 张基线：`accounts-list.png` / `accounts-list-flag-on.png` / 两者 `-dark`，各缩小约 2.5–2.7 KB（与删掉一行文字+图标的量级相符）。

---

## 10. 附带排查结论：菜单「发布」的 1–2 秒是**不同因**

用户同时报「点左侧菜单『发布链接』慢 1–2 秒」。只读排查（全链路静态追踪 + 被动 CDP 观察 + 真实数据基准）结论：

1. **「发布链接」这个字面标签在渲染端不存在**（全仓 grep + `git log -S` 双证）。本仓自用术语把它指向 `/publish/history`（菜单「发布」，i18n 键 `sidebar.nav.publish`）→ `PublishHistory.vue`。
2. 该页**完全不碰凭证层、零 `pbkdf2`**。唯一同步阻塞原语是 `publish-history.js:60` 的全量 `readFileSync`，用**用户真实数据实测仅 4 ms**（71 行 / 178,720 B）⇒ **不足以解释 1–2 秒，也不同因**。
3. ⚠️ **但账号页那条根因当时在用户运行实例里仍然活着**（日志实测 1451–1579 ms），且可从 **`Publish.vue:816`（发布编辑器 `/publish`，由侧边栏顶部「+ 新建发布」进入）**、`Collection.vue:793`、`Home.vue:355` 触达 ⇒ **若用户指的是发布编辑器，则答案是"同因"，本 PR 已覆盖**。
4. **1–2 秒未能完整归因**：`history:list` 日志**不打印耗时**（对比 `accounts:list` 有 `耗时=`），拿不出主进程读数 ⇒ 只能推理不能证实。未证伪的候选（无证据指向，仅登记）：dev 态懒加载路由首次模块图加载（打包态为独立 chunk，不适用）、每 5 s 整库 `export()` 的间歇争用（`multi-publish.db` 5.5 MB）、LoginMonitor 巡检窗口（日志可见单次占用 40–90 s）。

---

## 11. 遗留（不假装已闭合）

1. **`history:list` 仍无耗时读数**：补日志时撞上行数闸（`publish.js` 497 → 508 ≥ 500），故回退。**正解是先把 `publish.js` 按向例拆出 history 相关处理器，再补 `耗时=` 与 `>300 ms` 阈值告警。** 打通这条是证实/证伪 §10 第 4 点那三个候选的**前提**。
2. **`loadProxyStatuses` 的"批量"语义已名不副实**：现在只被「单个 id」的按需路径调用。改名属独立切片（要同步改测试与注释）。
3. **`configured: false` 无法区分「确实没配」与「读取失败」**（见 §6.2 残余限制）。
4. **列表失去「哪些账号配了代理」的一眼可见性** —— 有意的产品决策。恢复的正解见 §5.1 末尾。
5. **PBKDF2 迭代数 100000 < openspec 基线 ≥200000**（上一轮 #3591 起即挂账，本轮未动）。
6. **`accounts:list` 无慢日志阈值告警**（上一轮起即挂账）。

---

## 12. 相关文件索引

| 类别 | 路径 |
|---|---|
| 主进程 | `apps/desktop/electron/publishers/account-manager.js`（`listAccounts` / `getAccountProxyStatusLazy`） |
| 主进程 | `apps/desktop/electron/ipc-handlers/account-proxy.js`（**新增**，通道 `account:get-proxy`） |
| 主进程 | `apps/desktop/electron/services/credential-proxy-status.js`（异步批量入口，上一轮拆出） |
| preload | `apps/desktop/electron/preload/account.js` + `index.bundle.js`（**必须同改**） |
| renderer | `apps/desktop/src/api/publisher.js`、`src/composables/useAccountActions.js`、`src/composables/useAccountProxyDialog.js`（**新增**） |
| 组件 | `src/features/accounts/components/AccountProxyDialog.vue`、`AccountManagementCard.vue`、`PlatformAccountGroup.vue` |
| 视图 | `apps/desktop/src/views/Accounts.vue` |
| 文案 | `src/locales/accounts-page/{zh,en}.js` |
| 测试 | `electron/publishers/account-manager.test.js`（L1–L6）、`src/features/accounts/components/AccountManagementCard.test.js`、`AccountProxyDialog.test.js`（三态 + 预填闸） |
| 基线 | `apps/desktop/tests/visual-testing/base-screenshots/accounts-list*.png`（4 张，本轮重采） |
