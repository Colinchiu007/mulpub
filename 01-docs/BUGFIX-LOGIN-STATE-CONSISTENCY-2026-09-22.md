# BUGFIX: 自媒体账号登录态检测口径统一（首页横幅 vs 账号页）

> 日期: 2026-09-22 | 状态: 已修复 | 分支: `codex/login-state-consistency`（worktree 隔离，D 盘）
> 关联: PRD-ACCOUNT-LOGIN-STATUS-CHECK.md §11/§14（v2.2 同步更新）、BUGFIX-LOGIN-CHECK-FALSE-EXPIRED-2026-09-16.md（v2.1 抖音黑名单语义修复，本修复将其余平台收口到同一契约）

## 1. 用户报告的两个现象

**现象 A（两处计数不统一）**：主页「登录失效提醒」横幅显示 5 个账号失效；用户点【批量登录】登录了其中 1 个（头条号）后，切到账号管理页点【一键检测】，只检测出 2 个失效（公众号、今日头条号）。5 ≠ 2，两处数据不一致。

**现象 B（保存后仍判失效）**：用户在批量登录标签页中已完成头条号登录并点击【保存账号】，但账号页【一键检测】仍报头条号「已失效」；用户手动打开头条号确认实际已是登录态——账号页没有正确更新/反映账号的登录态。

## 2. 根因溯源（三层叠加）

### 根因 1：updateCapturedAccount 保存凭证不回写 status=active（现象 B 直接根因）

批量登录标签点【保存账号】→ `webview-manager.saveAccountTabCredentials` → `account-manager.updateCapturedAccount`。该函数只 PATCH 后端元数据（name/account_name/followers/avatar/last_validated），**不携带 `status`**。于是 DB 里账号仍是 `status=expired`，但 `last_validated` 被本次保存刷新为新时间戳。

`ipc-handlers/account.js` 的 `toPublicAccount` 有 `backendExpiredFresh` 逻辑：DB `status=expired` 且 `last_validated` 在 2 小时内 → 尊重 expired（本意是保护一键检测写回的结果不被凭证推导覆盖）。副作用：**保存凭证越"新鲜"，越会落入 2 小时窗口被压着 expired 不放**——用户刚保存，账号页却仍显示失效。

另有时序缺陷：PATCH 先于凭证落盘执行。若 `saveCredential` 失败抛错，DB 已被更新但凭证没存上，产生半成功状态。

### 根因 2：toutiao/bilibili/tencent_video/wechat_mp HTTP 检测白名单语义（现象 B 加重 + 现象 A 波动源）

`http-login-checker.js` 模块头声明黑名单语义契约（v2.1 只对 douyin 落地），其余四个平台仍是白名单判定：

| 平台 | 旧判定 | 假阳性场景 |
|------|--------|-----------|
| toutiao | `Boolean(code===0 && data.user.id)` | user 字段结构变更（如只有 user_id）、风控页、JSON 解析失败 → 一律判失效 |
| bilibili | `Boolean(code===0 && data.mid)` | 除 code 0+mid 外全判失效（风控 -352 等临时状态误判） |
| tencent_video | 兜底 `Boolean(data.finderUser)` | 无失效 errCode 但结构不符 → 判失效 |
| wechat_mp | `checkHtml`：无 token/uin → 一律 false | 空响应、风控页（无 token 也无登录特征）→ 判失效 |

HTTP 判失效会**直接短路**（`tryHttpLoginCheck` 返回非 null 即采用），新保存的有效 Cookie 也过不去——这就是"明明登录成功，一键检测仍报失效"的第二层根因；同时它让检测结果随平台风控抖动而**非确定**，是横幅 5 个 vs 账号页 2 个差异的波动来源。

### 根因 3：首页横幅只读不回写，两处检测无统一持久化事实来源（现象 A 结构性根因）

- 账号页 `batchCheckAllLogins()`：检测后逐账号 `accountUpdate(id, {status, last_validated})` 回写（v2.0 已实现）；
- 首页横幅 `useExpiredAccountsBanner.refresh()`：同样调 `accountBatchCheckLogin`，但**只更新组件内 ref，不回写**。

两处检测触发时间不同，HTTP 快路径结果又存在时变性（根因 2），横幅不回写导致其计数是"那一刻的瞬时值"，账号页计数是"另那一刻的瞬时值"，两者都不保证与 DB 一致 → 用户看到 5 vs 2。

## 3. 修复方案（三处，TDD 先红后绿）

### Fix 1：http-login-checker 四平台收口黑名单语义

`apps/desktop/electron/publishers/http-login-checker.js`

三态判定契约（与 v2.1 douyin / 模块头声明一致）：
- 明确成功特征 → `true`（CHECK_LOGIN_SUCCESS_HTTP_API）
- 平台明确告知未登录（已知失效码/文案）→ `false`（CHECK_LOGIN_COOKIE_EXPIRED）
- 其余一切（风控页/结构变更/空响应/解析失败）→ `undefined`（CHECK_LOGIN_INCONCLUSIVE）→ 降级 Playwright 浏览器检测

各平台判定明细：

| 平台 | true（有效） | false（失效） | undefined（降级） |
|------|-------------|--------------|-------------------|
| toutiao | `code===0 && data.user && (user.id \|\| user.user_id)` | `message/msg/status_msg` 含 未登录/请先登录/登录过期/重新登录 | 其余一切 |
| bilibili | `code===0 && data.mid` | `code===-101`（明确未登录码） | 其他状态码（-352 风控等） |
| tencent_video | `errCode===0 && data.finderUser` | `errCode===300333/300334` | 其余结构 |
| wechat_mp（HTML） | token+uin 同时存在 | 无 token 且含登录页特征（扫码登录/请使用微信扫码/请登录/welcome_login） | 空响应、无 token 也无登录特征（风控页） |

实现细节：`checkLoginViaHttpApi` 的 HTML 分支新增 `valid===undefined → CHECK_LOGIN_INCONCLUSIVE` 处理（旧实现只支持 boolean）；`checkHtml` typedef 放宽为 `boolean|undefined`。

### Fix 2：updateCapturedAccount 凭证落盘后回写 status=active

`apps/desktop/electron/publishers/account-manager.js`

- **顺序调整**：PATCH 从「验证账号存在后、保存凭证前」移到「`saveCredential` 成功之后」。凭证未落盘抛错时 DB 不被触碰，消除半成功状态。
- **PATCH 体新增 `status: 'active'`**（与 `last_validated` 一同）：凭证保存成功 = 一次成功的主动重新登录，必须同步把 DB 状态改回 active，令 `backendExpiredFresh` 不再压制、所有读取方（账号页列表/首页横幅/login-status-monitor 周期检测）看到同一份最新状态。
- 返回对象携带 `status: 'active'`，供调用方（auth:open-login 重新登录链路 / 保存标签）直接复用，无需再查 DB。

### Fix 3：首页横幅检测结果统一回写（与账号页同口径）

`apps/desktop/src/composables/useExpiredAccountsBanner.js`

`refresh()` 在批量检测成功（`code===0` 且有 results）后，逐账号执行与账号页完全相同的回写：

```js
accountUpdate(item.accountId, {
  status: item.valid ? 'active' : 'expired',
  last_validated: checkedAt,
}).catch(() => {})
```

口径约定：
- `checkedAt` 取 `result.data.checkedAt`，缺失时前端 `new Date().toISOString()` 兜底（与账号页一致）；
- 检测响应失败（code≠0 / results 非数组）不回写、不清零，保留上次结果；
- 单账号回写失败静默吞掉（`.catch(()=>{})`），不阻断横幅其余状态更新，下次检测自然重试。

## 4. 修复后的数据流与一致性保证

```
批量登录标签【保存账号】
  → updateCapturedAccount
    → saveCredential 落盘（失败即抛错，DB 不动）
    → PATCH {status:'active', last_validated:now}   ← Fix 2
    → 广播 auth:completed
      → 横幅 subscribeAutoRefresh → refresh()
        → accountBatchCheckLogin（HTTP 黑名单语义，不确定→浏览器确认）← Fix 1
        → 逐账号 accountUpdate 回写 → 横幅计数与 DB 收敛               ← Fix 3

账号页【一键检测】 → 同一 IPC → 同一检测语义 → 同一回写口径（v2.0 既有）
```

一致性不变量：**任何一处批量检测或凭证保存完成后，DB 的 status + last_validated 都被刷新为最近一次真实结果；横幅与账号页都经 `toPublicAccount` 读同一份持久化状态**。两处仍可能因检测触发时刻不同而出现瞬时差异（平台会话本身在实时变化），但差异只能来自"两次真实检测"，不再来自"一处回写一处不回写"的口径分裂。

## 5. 显示项与提示文字（不变项确认）

本次为纯逻辑修复，**无任何 i18n 文案/显示项变更**：
- 横幅标题「登录失效提醒」、描述「X 个账号待处理」、说明与【批量登录】按钮文案均不变（`home.loginExpiredBanner.*`）；
- 账号页【一键检测】按钮、进度遮罩「正在检测账号登录状态 / 检测中 X/N：平台」、结果汇总提示（`accountsPage.batchCheckAll*`）均不变；
- 账号卡片状态标签（已登录/已失效/异常）口径不变，仅其数据源变得一致。

用户可感知的行为变化：
1. 保存账号成功后，账号页/横幅在自动刷新后显示「已登录」（此前持续显示「已失效」直至 2 小时窗口过期或再次检测）；
2. 平台风控抖动时，横幅计数不再随机虚高（不确定响应走浏览器确认而非直接判失效）；
3. 代价：不确定场景单账号检测从 <1s 变为 4-8s（浏览器降级），进度遮罩照常展示，无额外用户操作。

## 6. 数据校验

- `accountUpdate` 回写字段仍经 `rendererAccountUpdateFields` 白名单（status/last_validated）与 `sanitizeUpdateFields` 过滤（沿用 v2.0 校验链，Fix 3 复用同一 API 封装，不新增通道）；
- `updateCapturedAccount` 的 PATCH 体新增 status 仅限常量 `'active'`（不接收渲染层传入的任意 status，防越权改状态）；
- 批量检测 results 中 `accountId` 缺失的条目跳过回写；横幅回写前校验 `results.length > 0`，空结果不产生写放大。

## 7. 回归保护测试（TDD 红灯 → 绿灯）

| 测试文件 | 用例数 | 覆盖契约 |
|---------|-------|---------|
| `electron/publishers/http-login-checker-blacklist.test.js`（新增） | 14 | 四平台三态判定矩阵：正向回归（true 路径不变）+ 明确失效特征仍判 false + 结构变更/风控/空响应/解析失败全部 inconclusive |
| `electron/publishers/account-manager-relogin-status.test.js`（新增） | 2 | PATCH 携带 status=active + last_validated + 返回值含 active；saveCredential 失败 → 抛错且 PATCH 不得含 active（顺序契约） |
| `src/composables/useExpiredAccountsBanner.test.js`（新增） | 3 | 检测后逐账号回写（active/expired + checkedAt）；code≠0 不回写；单账号回写失败不阻断横幅更新 |
| `electron/publishers/http-login-checker.test.js`（更新 1 例） | — | 公众号 expired 用例 fixture 补明确登录页特征（旧白名单语义下"任意无 token HTML"即失效，新语义需命中登录页特征正则） |

### 逃逸分析（为什么原有测试没拦住）

1. 单元测试层：v2.1 只为 douyin 写了黑名单三态用例，其余平台测试只覆盖"完全符合预期结构"的正向样本与"明确失效码"样本，没有"结构偏差/风控/空响应"的负向样本位（测试场景缺失）；
2. 集成测试层：`updateCapturedAccount` 既有测试只断言元数据与凭证落盘，未断言"保存后账号对读取方呈现 active"的端到端语义（契约缺失）；
3. 审查盲区：横幅"只读不回写"在 PR #1677（移除 checkLogin 写 DB）时被有意为之，但账号页 v2.0 恢复回写时未同步横幅侧，两处口径分裂无人对账（跨模块一致性盲区）。

## 8. 预防措施

- PRD-ACCOUNT-LOGIN-STATUS-CHECK.md 升级 v2.2，§14 已知债条目（toutiao 白名单）销账，新增 §15 记录三处修复与一致性不变量；
- 质量节拍 learnings 沉淀两条：①"多入口读取同一状态时，任何一处实时检测都必须回写持久化，否则计数口径分裂"；②"平台 HTTP 登录检测必须用黑名单三态语义，新增平台注册时负向样本（结构偏差/风控/空响应）必须进测试矩阵"；
- 后续平台新增 HTTP 检测时，以 `http-login-checker-blacklist.test.js` 的三态用例模板为登记门禁（true/false/undefined 三类样本齐备才算完成）。
