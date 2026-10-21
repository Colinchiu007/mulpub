# PRD：账号资料采集兜底 —— SPA 平台昵称/头像回落（fix-account-profile-fallback）

- 日期：2026-10-21
- 变更类型：Bug 修复（逻辑缺陷，采集时机）
- 优先级：P1（不阻断功能，但新账号显示信息错误，用户无法区分同平台多账号）
- 影响面：`apps/desktop/electron/publishers/account-profile-refresh.js`（新增）、
  `apps/desktop/electron/publishers/account-manager.js`（`saveCapturedAccount` 接线）

---

## 一、问题陈述

### 1.1 用户实测

上一个修复（`fix-multi-account-same-platform`，PR #4149）让同平台第 2 个账号能入库后，
用户复查账号页发现：**新加的账号名字和头像没有刷新为真实信息**。

### 1.2 数据实况

`<仓库根>/shared-user-data/backend-data/accounts.json`（2026-10-21 16:35 写入）：

| key | 平台 | name | account_name | avatar | platform_account_id | followers |
|---|---|---|---|---|---|---|
| `7ae99805` | toutiao | 今日头条 | 观四方 | 平台默认 logo | 1342958645023752 | null |
| `45261bb5` | toutiao | 今日头条 | **今日头条** | **''** | **''** | null |

第 2 个账号（`45261bb5`，created `2026-10-21T16:35:39`）的 `account_name` 回落成了平台名、
头像与平台 ID 全空。

### 1.3 定性

不是采集选择器写错，而是**采集时机早于 SPA 渲染完成**。同类平台（头条号/百家号等
创作者后台）都会命中。

---

## 二、根因分析

### 2.1 日志时间线（UTC，本地 +8）

```
08:35:36.010  AuthView URL pattern detected login success: toutiao
              https://mp.toutiao.com/profile_v4/?is_new_connect=0&is_new_user=0
08:35:36.362  AuthView login page finished after 56295ms platform=toutiao
08:35:39.029  AuthView pending session-marker evidence for toutiao: cookies=32 names=...
08:35:39.029  AccountManager Saved credential store for account 45261bb5
08:35:39.236  AccountManager  账号添加成功: 今日头条 (toutiao)
```

### 2.2 机制

`auth-view-manager.js` 的 `_scheduleAutoCompletion` 在登录成功判据（URL pattern 或 CDP）
命中后，用 `setTimeout(..., 3000)` 触发：

```javascript
const authData = await this._extractAuthData(attempt.view, attempt.platform)
```

`_extractAuthData` 里：

```javascript
const accountInfo = await accountProfile.collectWithWebContents(view.webContents, platform)
```

而头条号后台 `profile_v4` 是 SPA——日志「login page finished after **56295ms**」说明
页面渲染持续了 56 秒。**3 秒时昵称节点根本还没出现**，`collectWithWebContents`
（即 `accountInfoCollector`）跑在一个几乎空的 DOM 上，`trySelectors` 全部未命中，
返回 `{}`（未命中不产出键）。

### 2.3 下游后果

`saveCapturedAccount`：

```javascript
const profile = profileUtils.profileForCreate(accountInfo, name)
```

`profileForCreate`（`packages/shared-utils/src/account-profile.js:179`）：

```javascript
function profileForCreate (accountInfo, fallbackName) {
  const nick = trimText(src.nickName)
  const cleanNick = nick && !isNoiseAccountName(nick) ? nick : ''
  return {
    account_name: cleanNick || trimText(fallbackName),   // ← 回落 name
    platform_account_id: trimText(src.platformAccountId) || '',
    followers: ...,
    avatar: trimText(src.avatar) || '',
  }
}
```

`accountInfo = {}` ⇒ `account_name` = `fallbackName` = `resolveCapturedDisplayName(...)`
的结果。而 `captureCookies`/`_extractAuthData` 传下来的 `name` 是 `document.title`，
过 `resolveCapturedDisplayName` 的噪声守卫后回落成 `getPlatformName('toutiao')`
= **「今日头条」**。

### 2.4 为什么用户点「保存账号」也救不回来

`completeLogin()`：

```javascript
const attempt = this._getLoginAttempt()
if (!attempt) return true        // ← CDP 已自动完成并 close()，attempt 为 null
```

自动完成链路早已 `_settleLogin(attempt, authData)` → `close()`，所以用户点的那一下
**根本没有重新采集**，静默返回 true。

### 2.5 一级引入点

不是某次 commit 引入的回归，而是**设计缺口**：`saveCapturedAccount` 从上线起就只有
DOM 采集一条路，从未有过「DOM 采不到时的第二来源」。`refreshProfileFromHttpApi`
（HTTP API 回填）只挂在**登录态检测**路径上，用户不点「检测」就不会触发。

---

## 三、修复方案

### 3.1 核心

在 `account-profile-refresh.js` 新增 `fillProfileFromHttpApi(platform, cookies, profile, name)`，
由 `saveCapturedAccount` 在 `profileForCreate` 之后调用。

**为什么放 account-profile-refresh 而不是 account-manager**：那里已是「资料采集与写回」
的归口模块（`extractAccountInfo` / `refreshProfileFromPage` / `refreshProfileFromHttpApi`
三个同族函数都在），且它已持有 `httpLoginChecker` 模块对象。

### 3.2 触发判据

```javascript
if (profile.account_name !== name) return { profile, used: false }
```

即「没有真昵称（回落成了 name）」。**只此一条**，不附加「头像也为空」。

> 首版曾写成 `account_name === name && !avatar`，被自己的第 3 个测试当场否证：
> 「采到头像但没采到昵称」是真实形态，附加条件会让它漏掉兜底。请求成本由
> 「逐个判空补位」保证——即便 DOM 已拿到部分字段，HTTP 结果也只填空位。

### 3.3 字段补位规则

| 字段 | 条件 | 来源 |
|---|---|---|
| `account_name` | 当前值等于 name（或无值） | `info.nickname`（trim 后非空） |
| `platform_account_id` | 当前为空 | `info.platformAccountId` |
| `followers` | 当前为 `null` | `info.followers`（number） |
| `avatar` | 当前为空 | `info.avatar`（当前 8 平台 extract 均不返回，预留） |

**不得覆盖 DOM 已命中的值**，**不得改变 `name`**。

### 3.4 失败路径

- `fetchAccountInfoViaHttpApi` 抛错 → catch，返回原 profile
- `info.supported !== true`（平台未注册 extract / Cookie 头为空 / precheck 不过）→ 返回原 profile
- `cookies` 为空数组 → 不发请求
- 全部只 `log.warn`，**绝不 throw**，**绝不阻断账号创建**

---

## 四、数据校验

| 项 | 规则 |
|---|---|
| `platform_account_id` | HTTP 结果只接受非空字符串；空串不进 |
| `followers` | 只接受 `number`；NaN/字符串/负值由 `shapeInfoResult` 上游已挡 |
| `account_name` | 只接受 trim 后非空字符串；不再过 `isNoiseAccountName`（HTTP 返回的是平台结构化昵称，不是网页标题） |
| `avatar` | 只接受非空字符串 |
| `name` | **兜底不得修改** |

### 4.1 与既有写回路径的差异

| 路径 | 是否过 `isNoiseAccountName` | 是否过 `guardProfilePatchBySource` |
|---|---|---|
| `fillProfileFromHttpApi`（本次，创建路径） | 否（HTTP 结构化数据） | 否（创建路径无旧值可保护） |
| `refreshProfileFromHttpApi`（检测路径） | 否 | **是**（读真源判 `name_source`） |
| `refreshProfileFromPage`（检测路径，DOM） | 否（采集端已限长度） | **是** |

---

## 五、流程

```
用户在标签页完成平台登录
  │
  ▼
登录成功判据命中（URL pattern 或 CDP）
  │
  ├─ 3 秒后 _scheduleAutoCompletion → _extractAuthData
  │    ├─ cookies（按平台域过滤）
  │    ├─ name = document.title
  │    └─ accountInfo = collectWithWebContents(...)   ← SPA 未渲染完时返回 {}
  │
  ▼
saveCapturedAccount(platform, captured)
  ├─ name = resolveCapturedDisplayName(captured.name, platform)
  ├─ profile = profileForCreate(accountInfo, name)
  ├─ 【本次新增】filled = fillProfileFromHttpApi(platform, cookies, profile, name)
  │    ├─ profile.account_name === name ?（无真昵称）
  │    │    ├─ 否 → 直接用 DOM 结果，不发请求
  │    │    └─ 是 → fetchAccountInfoViaHttpApi(platform, cookies)
  │    │         ├─ supported !== true / 抛错 → 原样返回
  │    │         └─ 逐个判空补位（不覆盖 DOM 已命中值）
  ├─ POST /api/accounts { name, account_name, platform_account_id, followers, avatar }
  ├─ credentialStore.saveCredential(...)
  └─ persistLoginState(status=active)
```

---

## 六、交互逻辑与显示项

### 6.1 用户可见变化

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 同平台第 2 个账号保存完 | 卡片名 = 平台名（如「今日头条」）、头像空 | 卡片名 = 平台返回的真实昵称 |
| 同平台第 3、第 N 个账号 | 同上 | 同上（每个都各自补） |
| DOM 采集本就成功的账号 | 真实昵称 | 不变（不发 HTTP 请求） |
| 平台未注册 extract（如微博） | 回落平台名 | 不变（`supported:false`，不报错） |
| 网络异常 / Cookie 失效 | 回落平台名 | 不变（catch，账号仍创建成功） |

### 6.2 头像的特殊性

当前 8 个平台的 `extract` 都**不返回 avatar**（只返回 nickname/followers/platformAccountId）。
所以修复后昵称与平台 ID 能补上，**头像仍可能为空**。头像回填依赖：

1. 用户点账号卡片「检测」→ `refreshProfileFromPage`（DOM 路径，此刻页面已渲染完）
2. 或 `refreshProfileFromHttpApi`（若未来给 extract 补 avatar 字段）

这是已知限制，不是本次缺陷。PRD §9 列为后续项。

### 6.3 提示文字

**零改动**。本次不新增、不修改任何 i18n 键：
- 保存成功仍走 `accounts.saved`
- 保存失败仍走 `accountsPage.saveAccountTabFailed` 等既有键

---

## 七、回归保护

### 7.1 测试坐标

`apps/desktop/electron/publishers/account-manager.test.js`（新增 4 例，位于
`describe('account-manager — 捕获凭证持久化')` 内）：

| 用例 | 锁定性质 |
|---|---|
| `DOM 采集失败（昵称回落平台名 + 头像空）时用 HTTP API 补真实昵称/ID/粉丝` | 主场景：`accountInfo={}` → POST 体带 HTTP 昵称/ID/粉丝 |
| `DOM 采集成功时不调 HTTP API（不为已拿到的字段多发一次网络请求）` | `expect(fetch).not.toHaveBeenCalled()` |
| `HTTP 兜底只补 DOM 没拿到的字段，不覆盖已命中的昵称` | DOM 有头像、无昵称 → 兜底补 ID/粉丝，头像不被清空 |
| `HTTP 兜底失败（supported:false / 抛错）时不阻断账号创建` | 两种失败都仍返回 `{id}`，凭证仍落盘 |

### 7.2 变异反证（2026-10-21 实跑）

把 `saveCapturedAccount` 里的 `fillProfileFromHttpApi` 调用换成 `const filled = { profile, used: false }`：

```
× DOM 采集失败（昵称回落平台名 + 头像空）时用 HTTP API 补真实昵称/ID/粉丝
✓ DOM 采集成功时不调 HTTP API
× HTTP 兜底只补 DOM 没拿到的字段，不覆盖已命中的昵称
✓ HTTP 兜底失败（supported:false / 抛错）时不阻断账号创建
Tests  2 failed | 6 passed | 85 skipped
```

2 个核心用例当场变红；另 2 个仍绿是**正确的**（它们断言「不调用」与「不阻断」，
摘掉调用反而满足）。修复已还原并复跑 `93/93`。

### 7.3 测试陷阱记录（写进测试注释）

`stubHttpInfo` 不能用 `mockResolvedValue(Promise.reject(...))`：那个 promise 对象在
**参数求值时**就已 reject，`mockImplementation` 只是延迟返回它，unhandled rejection
照样发生，vitest 会报 false positive。正解是 `mockRejectedValue(new Error(...))`。

---

## 八、风险与取舍

### 8.1 接受的代价

- **多发一次网络请求**：仅当 DOM 没采到真昵称时。8 平台都注册了 extract 的端点，
  与登录态检测共用同一批 URL，不新增端点。
- **`account_name` 可能仍是平台名**：HTTP 也没拿到昵称时（平台未注册 extract、
  或 API 结构变更），保持 `name` 回落值。这与修复前一致，不是退化。

### 8.2 明确不做

- **不改 `_scheduleAutoCompletion` 的 3000ms 延时**：把它调大会拖慢每一个平台的
  登录完成感知（用户点完登录要等更久才见「保存成功」），而 HTTP 兜底已经能拿到
  结构化数据，不需要等 DOM。两害相权取兜底。
- **不给 extract 补 avatar**：需要逐个平台找头像字段，属独立调研任务。
- **不做存量账号迁移**：历史账号在用户点「检测」时自然回填。

### 8.3 兼容性

- `saveCapturedAccount` 签名不变，返回结构不变。
- POST `/api/accounts` 请求体字段不变（只是值更可能非空）。
- 前端、IPC、`accounts.json` schema 零改动。

---

## 九、验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | 头条号第 2 个账号保存后 `account_name` 是真实昵称 | 新用例 1 |
| 2 | 同平台第 3 个账号同样生效 | 同用例 1（可叠加） |
| 3 | DOM 采集成功时不发 HTTP 请求 | 新用例 2 |
| 4 | 兜底不覆盖 DOM 已命中的字段 | 新用例 3 |
| 5 | 兜底失败不阻断账号创建 | 新用例 4 |
| 6 | `account-manager.test.js` 全绿 | 93/93 |
| 7 | 相关 4 个测试文件全绿 | 78/78 |
| 8 | 全量 electron 套件无新增失败 | 见执行记录 |
| 9 | 变异反证：摘掉修复核心用例变红 | §7.2 |

---

## 十、变更清单

| 文件 | 变更 |
|---|---|
| `apps/desktop/electron/publishers/account-profile-refresh.js` | 新增 `fillProfileFromHttpApi()`（+60 行含注释）并导出 |
| `apps/desktop/electron/publishers/account-manager.js` | `saveCapturedAccount` 接线（+5/-1） |
| `apps/desktop/electron/publishers/account-manager.test.js` | 新增 4 例 + `stubHttpInfo` 辅助 |
| `01-docs/PRD.md` | 新增 §「账号资料采集兜底：SPA 平台昵称/头像回落」 |
| `01-docs/PRD-ACCOUNT-PROFILE-FALLBACK-2026-10-21.md` | 本文件 |
| `openspec/records/fix-account-profile-fallback.md` | 执行记录 |

---

## 十一、后续项（不阻塞本次）

1. **给 extract 补 avatar**：逐个平台找头像字段（头条号 `get_media_info` 的
   `user.avatar_url` 之类），补进 `shapeInfoResult`。
2. **`_scheduleAutoCompletion` 的延时与 DOM 采集解耦**：可考虑「先 HTTP 兜底、
   页面稳定后再补一次 DOM」，但需要评估是否值得（HTTP 已覆盖昵称/ID/粉丝）。
3. **用户可手动触发资料刷新**：账号卡片加「刷新资料」入口，调
   `refreshProfileFromHttpApi`（当前只能靠「检测登录态」顺带触发）。
