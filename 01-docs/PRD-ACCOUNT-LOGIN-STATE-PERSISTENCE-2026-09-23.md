# PRD: 账号登录态持久化真源与三态判定统一

> 版本: 1.0 | 日期: 2026-09-23 | 状态: 已实现
> 类型: Bug 修复 + 契约收敛（非新增功能）
> 关联文档: `PRD-ACCOUNT-LOGIN-STATUS-CHECK.md` §16（本文件是其口径修订）、`BUGFIX-LOGIN-STATE-CONSISTENCY-2026-09-22.md`（前一次口径统一）
> 分支: `codex/account-login-state-persist`（worktree 隔离，D 盘）

---

## 1. 缺陷现象（用户报告原文拆解）

| 编号 | 现象 | 期望 |
|------|------|------|
| **D1** | 账号页「一键检测」后显示部分账号登录态已失效；退出再进入账号页，仍显示「已登录」 | 检测结论必须固化到数据库，跨页面、跨重启保持一致 |
| **D2** | 今日头条号实际已失效，但已登录并保存过凭证的它仍被显示为「已失效」（保存凭证后依旧不翻案） | 有正向证据（Cookie 有效）时不得停留在失效态；无法判定时不得断言失效 |
| **D3** | 视频号经一键检测显示「已登录」，实际已失效 | 没有正向证据时不得断言「已登录」 |

三条现象指向同一个体系问题：**登录态没有单一真源，且"降级路径"的语义方向是反的**。

---

## 2. 根因链（root cause，均已取得运行时铁证）

| ID | 根因 | 证据 | 修复 | 回归保护 |
|----|------|------|------|----------|
| **RC-A** | 读侧真源是 Python 后端 `accounts.json`（`GET /api/accounts`），但三处写侧（`Accounts.vue` 一键检测、`useExpiredAccountsBanner` 首页横幅、`login-status-monitor` 定期检测）全部写 Electron 本地 SQLite（`store:update-account` / `store.updateAccount`）。两库 accountId 不互通（本地仅剩 2 条陈旧孤儿行），写入永不生效；渲染层写入还统一 `.catch(() => {})` 静默 | 日志 `account:status-derive ... backendStatus=absent`；`multi-publish.db` accounts 表 id 与后端 id 集合不相交 | 建立**登录态唯一写者** `AccountManager.persistLoginState()`（后端 PATCH），删除渲染层与 monitor 的本地写入 | `login-status-monitor.test.js`（10 例）、`Accounts.test.js`、`useExpiredAccountsBanner.test.js` 断言 `accountUpdate` **绝不被调用** |
| **RC-B** | 保存凭证时 `updateCapturedAccount` 的 PATCH 携带 `status:'active'`，而后端 `AccountUpdateRequest` 是 `ConfigDict(extra="forbid")` 且无 `status` 字段 → 422，登录成功也无法清除失效标记 | `PATCH /api/accounts/e72848c6 status=422` | 后端 `AccountUpdateRequest` 增加 `status`，`_account_to_dict` 输出 `status`，创建时初始化 `unverified` | `test_server_account_lifecycle.py` 新增 8 例 |
| **RC-C** | `webview-manager` 保存登录态时调用 `session.cookies.getAll({})`，**Electron 的 `Session.cookies` 只有 `get/set/remove/flush`，不存在 `getAll`** → TypeError 被 catch 吞掉，保存的凭证 `cookies` 恒为空数组 | 日志 `保存凭证 ... cookies=0 lsKeys=13`；`electron.d.ts` 全文零命中 `cookies.getAll` | 抽出 `_extractTabCookies()`，用 `cookies.get({})`，并**不再静默**：提取失败 → 返回 `{ ok:false, reason:'cookie-extract-failed' }`，不落一份空 Cookie 的"成功"凭证 | `webview-manager.test.js` 新增 2 例（测试替身补回真实 Electron session 契约） |
| **RC-D** | 检测降级路径语义方向反了：<br>① `toutiao`/`baijiahao` 在无 Cookie 时走 fast-path 硬判 `CHECK_LOGIN_COOKIE_EXPIRED`（→ D2 假阴性）<br>② `tencent_video` 无 Cookie 时降级到"本地凭证文件存在"即 `CHECK_LOGIN_SUCCESS_LOCAL_ONLY valid:true`（→ D3 假阳性）<br>③ 任意浏览器检测异常 → `valid:true`<br>④ 兜底分支 → `valid:true` | `checkLoginStatus` 代码路径 + 两账号实测 | 引入**三态契约**：正向证据只能来自「后端/HTTP/浏览器真实校验通过」；「凭证文件存在」「localStorage 存在」「Cookie 存在」都**只是否定失效的必要条件，不是有效性的充分条件**；一切无法判定的分支返回 `valid: undefined` + `CHECK_LOGIN_INCONCLUSIVE` | `account-manager.test.js`（64 例，含旧契约断言改写）、`http-login-checker-blacklist.test.js` |
| **RC-E** | `toPublicAccount` 读取时用「`last_validated` 在 2 小时内」判定后端 expired 是否可信，超窗后又被「本地存在凭证文件」推翻为 active → 检测结果最长 2 小时后自动蒸发 | `account.js` L166-175 | 删除时间窗与凭证推翻，改为 **expired 粘滞** | `account.test.js`「expired 粘滞」用例 |
| **RC-F** | `http-login-checker` 视频号 POST 的 `body` 写在模块级常量里，`Date.now()` 只在 require 时求值一次，进程存活越久 timestamp 越陈旧 | `http-login-checker.js` L98 | `body` 支持函数形态，每次请求重新求值 | `http-login-checker.test.js` timestamp 新鲜度用例 |

---

## 3. 数据模型与真源

### 3.1 唯一真源

登录态**只**存于 Python 后端 `DATA_DIR/accounts.json` 的 `status` 字段。Electron 本地 SQLite 的 `accounts` 表不再是登录态读写方（保留给其它本地设置用途）。

### 3.2 字段定义

| 字段 | 类型 | 取值 | 默认 | 语义 |
|------|------|------|------|------|
| `status` | string | `active` \| `expired` \| `unverified` | `unverified` | 登录态。`active`=最近一次真实校验确认有效；`expired`=最近一次真实校验确认失效；`unverified`=从未检测或检测无法判定 |
| `last_validated` | string(ISO8601) | — | — | 最近一次**主动检测/凭证保存**的时间戳，仅作展示与排期参考，**不参与判定** |
| `is_active` | boolean | true/false | true | 账号「启用/停用」，与登录态**正交**（见 §12 已知边界） |

后端读侧归一化（`_normalize_account_status`）：缺失、非字符串、大小写异常、历史脏值（如 `LOGIN_OK`）一律降级为 `unverified`。**读侧必须 fail-safe：绝不允许把未知值当成「已登录」。**

### 3.3 API 契约

| 方法 | 路径 | 变更 |
|------|------|------|
| `POST` | `/api/accounts` | 创建时初始化 `status="unverified"` |
| `GET` | `/api/accounts`、`/api/accounts/{id}` | 响应恒含 `status`（三态之一） |
| `PATCH` | `/api/accounts/{id}` | `AccountUpdateRequest` 新增可选 `status`；写入前校验，非法值返回 `400 {"detail":"ACCOUNT_STATUS_INVALID"}` 且**不落盘**（不污染已存值） |

校验顺序：路径段合法性 → 请求体白名单（`extra="forbid"`，多余字段 422）→ `status` 枚举校验（400）→ 写盘。`status` 与 `is_active` 互不影响（有专项用例锁定：写 `status` 后 `is_active` 必须保持原值）。

---

## 4. 登录态判定矩阵（`checkLoginStatus` 三态契约）

返回 `{ valid: true | false | undefined, code: string, reason?: string }`。

| 证据 | valid | code | 说明 |
|------|-------|------|------|
| HTTP/浏览器真实校验通过 | `true` | `CHECK_LOGIN_SUCCESS*` | 唯一「已登录」来源 |
| 平台明确返回未登录（errCode 300333/300334、code -101、401/403、重定向到登录页、HTML 含登录文案） | `false` | `CHECK_LOGIN_COOKIE_EXPIRED` | 唯一「已失效」来源 |
| 完全没有任何凭证（无加密 Cookie、无分区 Cookie、无 localStorage、无本地凭证文件） | `false` | `CHECK_LOGIN_NO_CREDENTIAL` | 无法使用 = 事实上的失效 |
| 有凭证但接口返回不可解读（风控、结构变更、超时、网络异常、DOM 检测被禁用） | `undefined` | `CHECK_LOGIN_INCONCLUSIVE` | **未确认**：不冒充任何一侧 |

### 4.1 铁律

1. **「凭证文件存在」永远不构成正向证据。** 这是 D3（视频号假阳性）的直接根因：历史上"读不到 Cookie 就 fallback 到本地凭证存在 → valid:true"。
2. **「Cookie 数量为 0」不再单独判失效。** 判定必须基于**合并后**的 Cookie 集合（见 §4.2）。历史上 `toutiao` 无加密 Cookie 即 fast-path 判失效，是 D2（今日头条假阴性）的根因。
3. **任何 `catch` 分支不得返回 `valid:true`。**
4. **渲染崩溃保护平台**（`RENDER_CRASH_PRONE_PLATFORMS = {tencent_video}`）禁止走浏览器 DOM 检测，只能走 HTTP；无 Cookie 或 HTTP 不可解读时一律 `undefined`。

### 4.2 Cookie 合并（正向证据的输入）

```
merged = mergeCookies(
  loadSavedCredentials(accountId, platform).cookies,        # 加密凭证库
  session.fromPartition('persist:account-{accountId}')       # 账号级 session 分区
        .cookies.get({}) → 按平台域名过滤
)
```
- 去重键：`name + domain`，**加密凭证优先**（它是"用户显式保存"的快照）。
- 分区 ID 必须通过白名单校验（`^[a-zA-Z0-9_-]+$`），非法直接拒绝，不拼进 partition 名。
- `getAccountPartitionCookies` 失败只记日志、返回空数组（降级不阻断），但**不降级为 valid:true**。

---

## 5. 单一写者架构

```
                 ┌──────────────── 读 ────────────────┐
渲染层 accounts:list ── toPublicAccount ── GET /api/accounts ── accounts.json
                 │                                          ▲
                 └── 派生 has_cookies（本地加密凭证是否存在）  │
                                                            │ PATCH {status,last_validated}
   检测链路（只有主进程能写）：                                │
   accounts:batch-check-login / account:check-login ──► AccountManager.persistLoginState()
   login-status-monitor（30 分钟定期）  ──────────────► 同上
   重新登录保存凭证 updateCapturedAccount ────────────► status=active（同一次 PATCH）
```

**禁止项（有测试强制）：**
- 渲染层任何模块不得调用 `accountUpdate(id, { status })` 写登录态。
- `login-status-monitor` 不得读写 Electron 本地 SQLite 的账号列表（`store.listAccounts` / `store.updateAccount`）。

**失败可见性：** `persistLoginState` 返回 `{ ok, reason, code }`；IPC 结果里逐账号带 `persisted`；渲染层检测到 `persisted.ok === false` 必须报错提示，不再 `.catch(() => {})`。

---

## 6. 读取与展示口径（`toPublicAccount`）

```
if (!hasCred)                      → status = 'expired'    ，status_source = 'no-local-credential'
else if (后端 status ∈ 三态)        → status = 后端 status   ，status_source = 'backend'
else /* 历史数据缺 status */        → is_active===false ? 'inactive' : 'active'，status_source = 'derived-from-is-active'
```

- **expired 粘滞**：只被两类事件清除 —— ① 一次返回 `valid:true` 的检测；② 重新登录并成功保存凭证（`updateCapturedAccount` 写 `active`）。
- 不再有「2 小时窗口」，不再有「本地存在凭证文件即翻案为 active」。
- `status_source` 随账号下发到渲染层，用于排障（"这条状态是哪儿来的"），同时写入 `account:status-derive` 日志。

---

## 7. 交互逻辑

### 7.1 账号页「一键检测」

1. 无账号 → warning `batchCheckAllNoAccounts`，不发 IPC。
2. 点击后：按钮文案切为 `batchCheckAllProgress`（`检测中 X/N：平台名`，由 `accounts:batch-check-progress` 事件驱动），所有卡片进入 verifying 骨架态；提示 `batchCheckAllStarted`。
3. 主进程逐账号检测 → 三态结果 → 逐账号 `persistLoginState`（**同一次 IPC 调用内完成持久化**）→ 返回 `results[]`，每项含 `{ platform, accountId, valid, code, loginStatus, last_validated, persisted, error? }`。
4. 渲染层按 `valid` 三态分别计数：`validCount` / `invalidIds` / `unconfirmedCount`；只有 `valid === false` 才进 `checkedExpiredIds`（决定卡片是否显示「去登录」按钮）。
5. 汇总提示：
   - 无失效且无未确认 → success `batchCheckAllAllValid`
   - 否则 → warning `batchCheckAllDone`（含「X 个未确认」后缀，`unconfirmed` 为 0 时不显示该段）
   - 存在 `persisted.ok === false` → 额外 error `batchCheckAllPersistFailed`
6. 本地 `account.status` 做乐观更新（仅本次会话展示）；下次 `load()` 以后端为准。

### 7.2 单账号「验证」
`account:check-login` 同样在返回前完成固化（与批量同口径），返回体保持 `{ code:0, data: status }` 向后兼容。

### 7.3 重新登录 / 保存凭证
`auth:login-silent`、登录页保存 → `updateCapturedAccount` PATCH 带 `status:'active' + last_validated`；Cookie 提取失败时**不保存**并返回 `reason:'cookie-extract-failed'`（避免落一份"看起来成功、实则无 Cookie"的凭证）。

### 7.4 首页失效横幅
`refresh()` 调 `accountBatchCheckLogin`，仅 `valid === false` 计入 `expiredAccounts` / `expiredAccountCount`；持久化失败通过 `reportError` 暴露；横幅不再回写 status。

### 7.5 定期检测（30 分钟）
- 只遍历 `status ∈ {active, online, unverified}` 的账号（已 expired 不自动翻案）。
- 结论与后端一致时不回写（避免每轮无意义 PATCH、避免刷 `updated_at`）。
- 有变化才广播 `account:status-changed`（含 `changedCount`，恢复为 active 也通知）。

---

## 8. 显示项与提示文字

### 8.1 状态徽章（`AccountManagementCard.vue`）

| 后端 status | kind | 中文文案 | 英文文案 | 徽章配色 | 语义 |
|-------------|------|----------|----------|----------|------|
| `active` / `online` | `online` | 已登录 | Logged in | 绿 `#e7f7ef / #18794e` | 有正向证据 |
| `expired` | `expired` | 已失效 | Invalid | 红 `#fff1f0 / #b42318` | 有负向证据；卡片显示「去登录」 |
| `unverified` | `unverified` | **未确认** | **Unconfirmed** | 琥珀 `#fffaf0 / #974706` | 检测发生过但无法判定；**不计入失效数量、不显示「去登录」** |
| 无 status（从未检测） | `unknown` | 暂无检查记录 | No check record | 灰 `#f7f7f8 / #777985` | 与「未确认」刻意区分 |
| `inactive` / `offline`（历史脏值） | `unknown` | 暂无检查记录 | No check record | 灰 | 2026-09-24 校正：与 `accountStatusKind` 实测一致，脏值不再映射「已登录」，统一落兜底（见 §12） |

徽章节点：`data-testid="account-status-{id}"`、`role="status"`、`aria-label="账号登录状态：{文案}"`。

> **2026-09-24 显示载体变更（`PRD-AVATAR-EXPIRED-MASK-2026-09-24.md`）**：上表**判定口径不变**，仅「已失效」的文字载体从头像旁徽章改为**头像图片上的半透明遮罩带**（白字「已失效」，随圆形头像裁切），且失效态不再渲染头像旁徽章；「已登录」等其余四态载体不变。上表 `expired` 行的「红徽章」描述按此理解。

#### 8.1.1 状态载体分流（2026-09-24 起）

| kind | 载体 | 节点 | 互斥保证 |
|------|------|------|----------|
| `expired` | **头像遮罩** | `<span class="avatar-status-mask expired">` 位于 `.account-avatar` 内 | 模板 `v-if="showAvatarMask"` 与徽章 `v-if="!showAvatarMask"` 互斥且穷尽，同一卡片内 `account-status-{id}` 节点数恒为 1 |
| `online` / `unverified` / `error` / `unknown` | 头像旁徽章 | `<span class="login-badge {kind}">` | 同上 |

两个载体共用 `data-testid="account-status-{id}"`、`role="status"`、`aria-label="账号登录状态：{文案}"`，因此既有按 testid 取文案的 E2E/单测对载体切换保持透明。

### 8.2 新增/变更 i18n key（zh / en 成对，CI Gate 7 校验）

| key | zh | en |
|-----|----|----|
| `accountsPage.accountCardLabels.statusUnverified` | 未确认 | Unconfirmed |
| `accountsPage.batchCheckAllDone` | 检测完成：{valid} 个正常，{invalid} 个失效[，{unconfirmed} 个未确认] | Check complete: {valid} valid, {invalid} expired[, {unconfirmed} unconfirmed] |
| `accountsPage.batchCheckAllPersistFailed` | 检测完成，但有 {count} 个账号的登录状态未能保存到服务端，请重试或检查后端服务 | Check finished, but login status of {count} account(s) could not be saved. … |

---

## 9. 数据校验与安全

| 层 | 校验 |
|----|------|
| IPC 入口 | `withSenderCheck` 校验 `senderFrame.url` 白名单；`getOwnerSubject()` 为空一律 fail-closed |
| `platform` / `accountId` | `_isSafePathSegment`（`^[a-zA-Z0-9_-]+$`），拒绝 `/ ? # ..`，用于 URL 拼接与 partition 名 |
| 下发字段 | `publicAccountFields` 白名单（新增 `status_source`）；`login_check_error` / `status_reason` 经 `toPublicErrorValue` 脱敏（token/密钥/密码 → `***`，截断 240 字符） |
| 后端写入 | `extra="forbid"` + `status` 枚举白名单；非法值 400 且不落盘 |
| Cookie 提取 | session 不可用即抛错并中止保存（不再静默写空凭证） |

---

## 10. 测试矩阵

| 文件 | 用例 | 锁定的契约 |
|------|------|------------|
| `packages/python-backend/tests/test_server_account_lifecycle.py` | +8 | status 初始化 / 持久化 / 三态回显 / 非法值 400 不污染 / 与 is_active 正交 / legacy 读侧归一化 |
| `electron/services/webview-manager.test.js` | +2（共 51） | 用 `cookies.get` 提取；session 缺失 fail-loud 且不落空凭证；测试替身暴露 `getAll` 不存在 |
| `electron/publishers/account-manager.test.js` | +9（共 64） | 三态判定、分区 Cookie 合并、`persistLoginState` 唯一写者、非法 status 不发请求、后端失败可见 |
| `electron/ipc-handlers/account.test.js` | +7（共 47） | expired 粘滞、unverified 透传、脏值降级派生、无凭证强制 expired、批量三态透传 + 逐账号固化、异常记 unverified、固化失败可见、单账号检测也固化 |
| `electron/services/login-status-monitor.test.js` | 新建 10 | 读后端真源、写唯一写者、不写 SQLite、三态、无变化不回写、expired 跳过、失败可见、变更才广播 |
| `electron/publishers/http-login-checker.test.js` | +1 | 视频号 POST body timestamp 每次请求重新求值 |
| `src/views/Accounts.test.js` | +2（改 1） | 未确认不计失效；固化失败必须报错；渲染层不再 `accountUpdate` |
| `src/composables/useExpiredAccountsBanner.test.js` | 重写 5 | 三态、绝不回写、固化失败上报 |
| `src/features/accounts/components/AccountManagementCard.test.js` | +1 | `unverified` 显示「未确认」，与 `unknown` 区分，不显示「去登录」 |

TDD 执行记录：每一层先落测试并**用 `git checkout HEAD -- <实现文件>` 复现红灯**（account.js 10 failed / account-manager 2 failed / login-status-monitor 全红），再打实现转绿，避免"测试与实现共谋"。

---

## 11. 验证清单（发布前）

1. `pnpm -w vitest run`（desktop 全量）+ `pytest`（后端全量）零新增失败。
2. QM-1 打包产物启动：账号页 → 一键检测 → **退出账号页再进入**，状态与检测结果一致（D1）。
3. 构造 Cookie 过期场景（手动清 session 分区）：今日头条不得被无证据判失效（D2）；视频号无 Cookie 时必须显示「未确认」而非「已登录」（D3）。
4. 日志检查：`account:status-derive` 的 `status_source` 与 `accounts:batch-check-login` 的 `persisted=` 计数符合预期；无 `PATCH ... status=422`。

---

## 12. 已知边界与后续项

| 项 | 说明 | 处置 |
|----|------|------|
| 「启用/停用」与登录态词表冲突 | `stores/accounts.batchSetStatus('active'/'inactive')` 仍走 `accountUpdate` → Electron SQLite，且用的是登录态词表；该功能当前对展示无影响（读端是后端） | 本次不改动（不在用户报告范围）；需单独 PR 改为 `is_active` 字段并接入后端 PATCH。**已在 CHANGELOG 标注为遗留问题** |
| `unverified` 不计入失效数量 | 用户可能误以为"没问题"；但把它计入失效会造成 D2 类误报回归 | 通过琥珀色徽章 + 「未确认」文案 + 汇总提示中的未确认计数来消歧 |
| 历史数据无 `status` | 不做数据迁移脚本，改由读侧 `_normalize_account_status` 归一化为 `unverified` | 一次性语义：老账号首次进入显示「未确认」，直到下一次检测/登录 |
| 视频号只能 HTTP 检测 | 渲染崩溃保护，不能走 DOM | Cookie 缺失/风控时统一「未确认」，引导用户手动重新登录 |


---

## 13. 验证执行记录（2026-09-23，本 PR 合入前实测）

### 13.1 新增的真实渲染层 E2E（本 PR 一并落库）

| 文件 | 形态 | 说明 |
|------|------|------|
| `apps/desktop/tests/e2e/specs/account-login-state-tristate.js` | `node tests/e2e/specs/account-login-state-tristate.js`（需 dev server 在 `TEST_URL`，默认 `http://127.0.0.1:5174`） | 在**真实运行的 Vue 渲染层**上跑 15 项硬断言：注入 `electronAPI` 覆写，让「后端固化值 → accountList 读取 → 卡片徽章」走完整链路；覆盖三态徽章文案、一键检测后三态收敛、汇总文案区分失效/未确认、`accountUpdate` 调用数必须为 0（单一写者）、未确认账号不得出现「去登录」按钮、以及 **D1 回归：`resetToRoute('/accounts')` 重进后三态显示仍与检测结论一致**。截图落 `tests/e2e/reports/screenshots/account-login-state-tristate/`（01-tristate-from-backend / 02-after-batch-check / 03-reentered-accounts） |

执行结果：**`TRISTATE_STATUS=passed total=15 failed=0`**（含「无 console error」断言）。

关键断言实测值：
- 汇总提示：`检测完成：1 个正常，1 个失效，1 个未确认`
- 单一写者：`{"updateCalls":0,"batchCalls":1}`
- 三态徽章：`已失效` / `已登录` / `未确认`（分别对应 `expired` / `active` / `unverified`）

### 13.2 全量测试与门禁

| 门禁 | 命令 | 结果 | 结论 |
|------|------|------|------|
| 桌面全量单测 | `npx vitest run`（apps/desktop） | `Test Files 1 failed / 596 passed / 1 skipped (598)`；`Tests 1 failed / 10767 passed / 2 skipped` | 本 PR 触及文件相关的失败：`electron/services/story2video-manual-assets.test.js`（视频流水线模块，与账号链路无导入/fixture 交集），**单文件重跑 `Test Files 1 passed`** → 判定为全量并发下的顺序依赖抖动，非本 PR 回归；已列为遗留观察项 |
| 本次改动定向单测 | `npx vitest run electron/ipc-handlers/account.test.js electron/services/login-status-monitor.test.js electron/publishers/*.test.js src/views/Accounts.test.js src/features/accounts/components/*.test.js src/composables/useExpiredAccountsBanner.test.js` | 全部通过（account 47 / monitor 10（新建）/ publishers 109 / Accounts 82 / Card 18 / banner 5） | 绿 |
| 后端全量 | `python -m pytest -q`（packages/python-backend） | `4 failed, 2669 passed` | 与**基线全量一致**（见 13.3）→ 无回归 |
| 后端定向 | `python -m pytest tests/test_server_account_lifecycle.py -q` | `17 passed` | 绿（含新增 8 条 status 真源契约） |
| ESLint（CI Gate 11，`--quiet` 只卡 error） | `pnpm exec eslint electron/ src/ --quiet` | `0 errors`（13 warnings，均为存量） | 绿 |
| 打包就绪（QM-1） | `pnpm run build:vue`（= build:preload + vite build，CI 各 workflow 同口径） | `✓ built` `DONE exit=0` | 绿 |
| 类型体检（非 CI 门禁） | `npx tsc -p tsconfig.check.json --noEmit` | 主仓基线 **1203** 个 `error TS` → 本 worktree **1202** 个（**-1**） | **存量红色，不作为合入门禁**（该脚本不在任何 CI workflow 中）。本 PR **零新增类型错误、净减 1 条**：唯一由本 PR 引入的 `electron/publishers/account-manager.js TS2353`（`persistLoginState` 的 `@returns` 未声明它实际返回的 `code`/`error`）已修正。本 PR 触及的两个文件在基线即有 31 条存量报错（`ipc-handlers/account.js` 11 条、`account-manager.js` 20 条，多为 `allowJs` 下对未标注类型的 deps 透传对象取属性），修复后为 30 条且集合同构（仅行号因新增代码而位移） |

### 13.3 后端 4 条失败的基线对照（逃逸分析）

在**未合入本 PR 的主仓工作区**（`packages/python-backend` 干净 HEAD）跑同一套全量：

```
4 failed, 2676 passed, 10 warnings, 10 subtests passed in 206.12s
FAILED tests/test_aggregation_video.py::test_engine_ensure_model_download_failure
FAILED tests/test_frame_html.py::TestTemplatesDir::test_templates_dir_resolves_to_python_backend
FAILED tests/test_llm_service.py::TestLLMServiceConfig::test_create_client_dummy_key_for_ollama
FAILED tests/test_pipeline_loader.py::TestPipelineLoader::test_story2video_manifest_declares_text_only_versioned_contract
```

与 worktree 结果逐条同名同集 → 判定为**存量失败**，不属于本 PR 引入。补充：`test_frame_html` / `test_llm_service` 两条在 worktree 内**单文件重跑 11 passed**，属全量运行时的用例间环境污染（模块级路径/环境变量），亦与账号链路无关。

### 13.4 未执行项与原因

| 项 | 原因 |
|----|------|
| 打包产物 `electron-builder --dir` 冒烟 | `build:vue` 已通过（CI 各 workflow 的打包前置同此口径）；`--dir` 需在本机下载 winCodeSign/NSIS 缓存，属 `build.yml` 的 runner 职责，本地跑不具备等价环境 |
| 「真实用户账号 + 真实平台」一键检测实测 | 需在**已登录身份（Logto）且已保存真实平台凭证**的 profile 上执行；`account:list` 对未登录一律 fail-closed（`AUTH_ERROR`），不得用隔离的空 profile 冒充。因此本 PR 的真实应用验证以「真实渲染层 + 契约化 electronAPI 替身」（13.1）+「真实后端 accounts.json」（13.2 后端行）两段闭合，跨段契约（`PATCH {status,last_validated}`）由后端 pytest 与主进程单测双侧锁定。合入后需在用户实际环境跑一次 `pnpm run build:dir` + 手工一键检测做最终 dogfooding |

### 13.5 与 main 的四次合并（契约收敛，实测记录）

推送后 `origin/main` 多次前进，**前两次合并**均为**语义重叠**而非纯文本冲突：

**合并 ①（4 个提交，含 #2229）**——关键事实：**main 上的 #2229 已独立修复本 PR 的 RC-C**
（`webview-manager` 误用 `session.cookies.getAll`），且实现口径为 fail-closed 提前返回
`{ok:false, reason:'cookie-extract-failed'}`，并把 mock 升级为「忠实镜像 Electron cookies API」
（只实现 `get/set/remove/flushStore`，**不提供** `getAll`）。本 PR 采取**并集**解法而非二选一：

- `webview-manager.js`：保留本 PR 的集中守卫 `_extractTabCookies()`（`cookies.get` 不可用即抛
  `session-cookies-unavailable`，并把非数组归一为 `[]`），同时采纳 main 的**提前 fail-closed**
  位置（在提取 localStorage 之前就中止，避免无谓工作），并保留本 PR 的 `detail` 字段用于排障。
  删除因此变为死代码的后置 `if (cookieExtractError)` 分支。
- `webview-manager.test.js`：以 main 版本为主体（其 mock 保真度与断言更强：断言真实 Cookie 内容、
  `unsaved` 状态、不广播 `saved`），另补本 PR 独有负例「`session` 整体不可用时同样 fail-closed」
  （覆盖本 PR 新引入的守卫，main 用例未触及）。
- `account-manager.test.js`：两个互不相干的 `describe` 块取并集（本 PR `persistLoginState`
  唯一写者 vs main `listAccounts` 错误透传）。
- `CHANGELOG.md`：本 PR 条目置顶、main 条目顺延。

合并后复验（非沿用合并前数字）：electron 定向 **186/186**、渲染层 **188 passed + 1 skipped**、
后端 `test_server_account_lifecycle.py` + Logto 认证 **73 passed**、ESLint `--quiet` **0 error**。

**合并 ②（#2230）**——仅 `CHANGELOG.md` 顶部 prepend 竞争。解法固化为可复用规则：
从 `HEAD:` / `MERGE_HEAD:` 两个 blob 取「本 PR 首个非本条目标题之前的片段」+ 对方全文，
写出前按原文件 EOL（CRLF）还原；提交后校验**暂存区 blob 零冲突标记**且增量为 **+38 / -0**
（不重写任何历史条目）。

> **并发教训**：多 PR 同时向 `CHANGELOG.md` 顶部追加是仓库已知事故模式（见 2026-09-21 条目）。
> 任何采用「顶部追加」约定的文件，冲突解法必须幂等、且以 blob 为输入而非工作区文本，
> 否则极易在解冲突时把别人的条目挤掉或把整文件换行符翻转。

**第三次同步 origin/main（`#2226` P1 审计第二批，merge 提交 `56e992d5d`）**

合并后仅剩一处冲突：`CHANGELOG.md`（仍是多会话并发 prepend 竞争），沿用同一套
blob 级并集解法（`HEAD:` / `MERGE_HEAD:` 取两侧 blob、本条目置顶、按原 EOL 写回、
校验暂存区零冲突标记）。`locales/zh.js`、`en.js` 自动融合无冲突。

合并后复验（均在合并后的工作树上实跑）：

| 门禁 | 结果 |
| --- | --- |
| Gate 7 `check-locale-sync.js --cjk` | PASS（基线 1581 / 当前 1386） |
| Gate 7 `--pair-base origin/main` | PASS（zh / en 键集合一致） |
| Gate 7 `--py-cjk` | PASS（baseline 79，无新增硬编码消息） |
| Gate 7 自检 `node --test check-locale-sync.test.js` | 6 tests / 6 pass / 0 fail |
| ESLint `--quiet`（本 PR 触及的 19 个 js/vue 文件） | exit 0，零问题 |
| 定向 vitest（8 个测试文件：ipc-handlers/account、account-manager、http-login-checker、webview-manager、login-status-monitor、useExpiredAccountsBanner、AccountManagementCard、Accounts） | Test Files 8 passed |

`CHANGELOG.md` 相对两个父提交分别为 **42+/0−**（相对本分支，纯拿到 main 的条目）与
**36+/4−**（相对 main，本条目），证明本次冲突解决未发生整文件重写。

> **一条判据纠偏（实测教训）**：合并后看到 `.github/scripts/locale-py-cjk-baseline.json`
> 在两个父提交间呈 19+/19−，容易误判为「main 也重锚过这个基线」。实际方向搞反了：
> `git diff --numstat HEAD^1 HEAD -- <file>` 为空、`git diff --numstat HEAD^2 HEAD -- <file>` 为
> 19+/19−，说明合并结果取的是**本 PR 的锚点**，main 并未改动 `.github`。
> 判据必须用「合并结果 vs 各自父提交」，而不是「两个父提交互比」。

**第四次同步 origin/main（`#2231` 一键检测并发加速与进度双边界广播）**

本轮首次出现**同一段代码体被双方各自改写**的冲突（前三次要么只是追加型文件竞争，要么是
互不重叠的语义重叠）：`#2231` 把 `accounts:batch-check-login`
改成「有限并发 3 + 单账号 60s 硬超时 + `start`/`done` 双边界进度广播」，本 PR 把同一段改成
「三态映射 + 单一写者回写」。解法：**保留 `#2231` 的并发池、硬超时与进度骨架，在其 worker 内
套用本 PR 的三态映射与 `persistLoginStatus()`**；`done` 事件在原有字段上追加
`loginStatus` 与 `persisted`，渲染层无需改动即可继续消费。

- **契约收敛决策（两者语义互斥，必须择一）**：`#2231` 的口径是「超时计入失效」，本 PR 的契约是
  「无正向证据不得判失效」。以本 PR 契约为准：**超时属「无法判定」**，记
  `code: CHECK_LOGIN_TIMEOUT`、`valid: undefined`、`status: unverified`；并发与超时预算完整保留
  （单个挂死账号仍不会拖住整批）。同时补上 `#2231` 缺失的 IPC 层回归测试
  `accounts:batch-check-login 单账号硬超时记为 unverified（非 expired）`——实测该测试第一次
  就跑出了融合漏洞（`code` 分支被写成 `CHECK_LOGIN_ERROR`），说明这条护栏是必要的而非装饰。
- **追加型文件**：`CHANGELOG.md`（顶部 prepend）与 `01-docs/learnings.md`（尾部 append）仍是
  keep-both；`PRD-ACCOUNT-LOGIN-STATUS-CHECK.md` 出现 **§16 撞号**（双方各自新增一节），
  处理是把本 PR 的章节整体改号为 §17（含 `### 16.x` 与「本文 §16」自引用），并在文档 L4
  的关联版本行追加 v2.4 指引；本 PR 的 `CHANGELOG.md` 条目内指向该节的那处引用同步改为 §17，
  避免留下悬空章节号。
- **合并后复验**：定向 vitest 8 个测试文件全绿；ESLint `--quiet` 覆盖本 PR 触及的 19 个
  js/vue 文件零问题；Gate 7 三项（`--cjk` / `--pair-base origin/main` / `--py-cjk`）全 PASS，
  gate 自检 `check-locale-sync.test.js` 6/6。

> **工具层事故记录（必须传承）**：改 `account.test.js` 时脚本先 `open(p,'wb')` 打开写句柄、
> 随后在 `b'\r\n'.join(lines)` 处抛异常，导致该文件被**截断为 0 字节**；靠索引中已暂存的合并
> 版本 `git checkout -- <file>` 完整恢复（41103 字节）。教训两条：① 必须先在内存里构造出最终
> bytes 并完成长度/内容断言，之后才允许打开写句柄；② `01-docs/learnings.md` 是**混合换行文件**
> （15239 行中仅 141 行为 CRLF），任何「探测到 CRLF 就整体转换」的写法都会制造 15k 行假变更，
> 这类文件只能做字节级拼接。另：`bytes` 列表与 `str` 字面量比较恒不等，行级替换必须先编码。


**第四次同步的 CI 逃逸（第二轮 checks，实测记录）**

第四次合并推送后（head `39b51ca68`），`QG Static` / `QG Visual` / `QG Browser E2E` /
`QG Autonomous` / `build` / `electron-tests` / `gui-test` 全部通过，但
`QG Unit Tests`、`QG Desktop Shards (1/2)`、`(2/2)`、`QG Coverage` 四项同时红，
汇总为 `Test Files 1 failed | 601 passed | 1 skipped (603)`、`Tests 2 failed | 10841 passed`，
失败文件唯一：`electron/ipc-handlers/account-batch-check.test.js`（`#2231` 自带的新测试文件）。

| # | 失败用例 | 断言差值 | 判定 |
| --- | --- | --- | --- |
| 1 | 超过硬超时**计入失效**并标记 `CHECK_LOGIN_TIMEOUT`，不阻断其余账号 | `expected valid: undefined` 但 `toMatchObject({valid: false})` | 契约互斥，按第四次同步的择一结果改测试（超时 = 未确认） |
| 2 | 超时后原检测迟到的 reject 不产生 unhandledRejection | 同上（`valid: false`） | 该用例真正守护的是「无 unhandledRejection」，与失效/未确认无关，仅放宽 valid 断言 |

修复方式**不是把断言改松**，而是把 `#2231` 的测试口径收敛到已择一的契约，并**加强**它：

- 用例标题从「超过硬超时计入失效」改为「超过硬超时记为未确认（`valid undefined` +
  `CHECK_LOGIN_TIMEOUT`）」——标题本身携带错误语义时必须一起改，否则下个读者会被误导。
- 文件头「契约 4」同步改写为「超时记为无法判定，不得折叠成失效」，并写明理由：
  判失效会把已登录账号踢去重新登录（正是 PR #2233 消灭的那类假阴性）。
- `createMockDeps` 的 `AccountManager` 补上 `persistLoginState`（此前该文件从未断言过固化，
  `results[].persisted` 恒为失败），新增断言：`loginStatus === 'unverified'`、
  `persisted.ok === true`、`persistLoginState('a1','douyin','unverified',<ts>)` 被调用，
  `done` 进度事件同步带上 `loginStatus` / `persisted`。
- 「不阻断其余账号」「峰值并发不超上限」「results 顺序稳定」「无 unhandledRejection」
  四条 `#2231` 原有护栏一字未动，仍然全部断言。

> **一条必须传承的验证范围教训（本 PR 迄今唯一一次由「复验口径」本身造成的 CI 失败）**：
> 合并后的本地复验清单是「本 PR 触及的 8 个测试文件」，这是**错的选取口径**——
> 合并引入的**对方新增测试文件**同样会被本 PR 的语义改动打到。正确做法：合并后
> 至少跑一次全量（或按 `git diff --name-only <ours> <merge>` 选出**两侧并集**的测试文件 +
> 所有状态为 `A`（新增）的测试文件）。本次教训的可执行判据：
> 「定向复验」的文件集合必须由 *合并 diff* 推出，而不是由 *本 PR 的工作清单* 推出。

### 13.6 CI 逃逸分析：Gate 7（locale 同步）抓出的本 PR 自引入缺陷

首轮 CI 中 `QG Static` 失败（其余 QG Unit/Coverage/Desktop Shards/Visual/Browser E2E 与 build、
electron-tests、gui-test、agent-judge 全绿），`check-locale-sync.test.js` 6 项中 2 项红：

1. **`--cjk` 渲染端硬编码中文扫描**——**本 PR 真实引入的缺陷**：
   `useExpiredAccountsBanner.js` 的持久化失败上报把标题写成
   `'登录态固化失败（' + n + ' 个账号）'` 的字面量拼接，绕开了 zh/en 成对约定，
   在 en 界面会弹出中文。修复：新增成对键
   `accountsPage.persistFailedTitle`（zh `登录态固化失败（{count} 个账号）` /
   en `Failed to persist login status ({count} account(s))`），改由
   `i18n.global.t(...)` 取文案（沿用 `stores/accounts.js` 的 `i18n.global.t` 惯用法）。
   对应回归护栏现状：`useExpiredAccountsBanner.test.js` 对该上报的断言本就是语言无关的
   （只断言标题含数量、detail 含 `accountId:reason`），因此本地单测**抓不到**这个 i18n 违规——
   它只能由 Gate 7 兜住。因此已将“i18n/一致性类门禁必须本地预跑”写进本 PR 流程：
   （`node .github/scripts/check-locale-sync.js --cjk` 与 `--pair-base origin/main`、
   `node --test .github/scripts/check-locale-sync.test.js`）。
2. **`--py-cjk` 后端基线扫描**——**基线锚点漂移，非新增缺陷**。
   `locale-py-cjk-baseline.json` 的条目格式是 `path:LINE`（与 `--cjk` 已在 2026-09-12
   改为 `file||content` 不同），因此本 PR 在 `server.py` 上部插入代码后，其后 19 条基线
   整体下移而被判「新增」。按仓库既有做法（#2212 同类处理）以 `--update-py-baseline` 重锚，
   并逐条对账证明是纯漂移：条数 79 → 79 不变、**逐文件计数完全一致**、重锚后复扫 PASS、
   基线文件 diff 恰为 19 增 19 删（与报告的 19 条一一对应）、本 PR 在 python 侧新增的
   28 行含中文内容全部是注释与 docstring（无用户可见消息字面量）。
   修复后本地 `node --test .github/scripts/check-locale-sync.test.js` = **6 tests / 6 pass / 0 fail**。

> 遗留改进（另案）：`--py-cjk` 基线应迁到与 `--cjk` 相同的 `file||content` 格式，
> 从根上对行号漂移免疫，避免每个触碰 `server.py` 上半部的 PR 都要重锚一次。
