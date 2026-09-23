# PRD：账号「启用状态（is_active）」与「登录态（status）」正交解耦 —— 批量启用/停用真链路接通

- 日期：2026-09-23
- 类型：Bug 修复 + 功能接通（TDD）
- 关联：PR #2233（账号登录态持久化真源统一 + 三态收敛）遗留项；`.quality-gates.md`；`openspec/specs/openspec-integration/spec.md`
- 范围：`packages/python-backend`、`apps/desktop/electron`、`apps/desktop/src`（账号页 + 发布目标选择）

---

## 1. 背景与问题陈述

PR #2233 统一了「登录态」的真源与写者（后端 `accounts.json.status`，三态 `active|expired|unverified`，唯一写者 `AccountManager.persistLoginState()`），并把该结论沉淀为账号列表的展示口径。合并时登记了一条遗留缺陷，本 PRD 即其落地文档：

> 账号页「批量启用 / 停用」（`stores/accounts.batchSetStatus`）仍写 SQLite 且复用了登录态词表的 `status`，对展示实际无效。「启用状态」与「登录态」是两个正交概念，应改 `is_active` 并接入后端 PATCH。

用户视角的现象：在账号页勾选若干账号 → 点「批量禁用」→ 提示「已禁用 N 个账号」→ 刷新/重进账号页，界面**毫无变化**，账号照常出现在发布目标选择器里，也照常可被选为默认账号。即：**这是一个装饰性按钮，不是功能**。

### 1.1 根因清单（全部经代码级证据确证）

| # | 根因 | 证据 |
|---|---|---|
| RC-1 | **写错库（双库分裂）**：`batchSetStatus` → `accountUpdate` → preload `accountUpdate` → IPC `store:update-account` → Electron **SQLite**；而账号列表 `account:list` → `AccountManager.listAccounts()` → **后端 accounts.json**。两边 accountId 命名空间都不互通，写入的值永远读不到。 | `apps/desktop/electron/preload/account.js:39`、`apps/desktop/electron/ipc-handlers/store.js`（`rendererAccountUpdateFields`）、`apps/desktop/electron/publishers/account-manager.js:394` |
| RC-2 | **词表撞车污染登录态**：UI 用 `'active' \| 'inactive'` 表达启用/停用，与登录态三态词表的 `active` 同名，写进 `status` 字段等于把「启用/停用」当成登录态在写。 | `apps/desktop/src/views/Accounts.vue:90-91`（`handleBatchStatus('active'/'inactive')`）、`apps/desktop/src/stores/accounts.js:396-410` |
| RC-3 | **读侧反向泄漏**：`toPublicAccount` 在后端缺 `status` 时用 `is_active` 派生登录态，并产出第 4 个非法态值 `'inactive'`（`statusSource='derived-from-is-active'`），与 PR #2233 三态契约冲突。 | `apps/desktop/electron/ipc-handlers/account.js:280-281` |
| RC-4 | **后端不可写**：`AccountUpdateRequest` 为 `extra="forbid"` 且字段集里没有 `is_active`，`PATCH {is_active:false}` 恒 422；`create_account` 写死 `"is_active": True`，`patch_account` 从不改写。 | `packages/python-backend/src/server.py:275-288`、`495-509`、`525-551` |
| RC-5 | **`is_active` 全仓零消费者**：`git grep is_active -- apps/desktop/src packages/rpa-engine packages/api-publish-engine packages/shared-utils` = **0 命中**。只接通 PATCH 会得到一个「存得下、没人读」的死开关，与原 bug 同级。 | 全仓检索 |

### 1.2 逃逸链（为什么现有测试没拦住）

| 层级 | 为什么没拦住 |
|---|---|
| 单元测试 | `accounts.test.js` 只断言 `accountUpdate` **被调用且参数为 `{status:'inactive'}`** —— 断言的是「写错了的东西」本身，等于把 bug 固化成契约。 |
| 集成测试 | 渲染层与主进程之间全部 mock，`store:update-account` 与 `account:list` 读的是两个不同数据源这一事实从未在同一测试中被同时观察。 |
| E2E | 无「批量禁用 → 重新加载 → 界面/发布选择变化」的往返用例。 |
| 视觉回归 | 停用账号在视觉上与启用账号完全一致，无基线可差异。 |
| 代码审查 | 按钮文案（启用/禁用）与字段名（status）分属中英两套词表，审查时按 UI 文案读代码会误判为「已登录/未登录切换」。 |

**回归保护（本 PRD 强制要求）**：见 §9 测试矩阵 T1-T16，其中 T3/T8/T11/T16 四层同时覆盖「写入真源」「读侧不再泄漏」「停用账号在发布选择中不可用」。

---

## 2. 目标与非目标

### 2.1 目标（P0）

1. **概念正交**：`is_active`（是否启用发布）与 `status`（登录态）在数据模型、写者、读侧、UI 四层全部解耦，互不派生、互不覆写。
2. **真源写入**：批量启用/停用经主进程唯一写者落到后端 `accounts.json.is_active`，重启/刷新后保持。
3. **全链路生效**（用户已确认的口径）：
   - 账号页显示「已停用」状态标记，停用账号卡片整体降饱和（视觉可区分）；
   - 发布目标选择器中**停用账号不可勾选**，且**不作为默认账号自动回填**；
   - 已选中的账号若被停用，自动从选择结果中剔除（复用 `reconcileSelectedAccounts`）。
4. **消除第 4 个非法态值**：删除 `toPublicAccount` 的 `is_active` 派生分支，后端无 `status` 一律回落 `unverified`。

### 2.2 非目标（明确不做，避免范围蔓延）

- **不改发布引擎的硬拦截**：`packages/rpa-engine` / `packages/api-publish-engine` 不新增 `is_active` 校验。收口点只在「前置选择」（用户确认口径）。定时任务等绕过选择器的入口沿用现状，另案评估。
- **不加单账号行内启用/停用开关**：仅保留批量入口（用户确认口径）。
- **不新增账号页筛选页签**：现有 `全部/已登录/未登录/收藏` 属登录态维度，语义正确，不得与启用态混用。
- **不改 `renameAccount` 走 `accountUpdate`→SQLite 的历史问题**：另案（本 PR 不扩大写侧改动面）。
- **不做 is_active 的批量导出/导入/权限控制**。

---

## 3. 数据模型

### 3.1 字段定义（后端 `accounts.json`，唯一真源）

| 字段 | 类型 | 取值 | 默认 | 写者 | 语义 |
|---|---|---|---|---|---|
| `status` | string | `active` \| `expired` \| `unverified` | `unverified` | **登录态唯一写者** `AccountManager.persistLoginState()` | 平台登录凭证是否有效 |
| `is_active` | boolean | `true` \| `false` | `true` | **启用态唯一写者** `AccountManager.setAccountActive()`（本次新增） | 该账号是否允许被用于发布 |
| `last_validated` | string(ISO) | — | 创建时间 | 随 `status` 一并写入 | 最近一次登录态判定时间 |

约束：

- `status` 与 `is_active` **互不派生、互不写入对方字段**；`PATCH` 中同时出现两者时各自独立生效。
- 读侧对 `is_active` 做 **fail-safe 归一化**：仅「明确为假」（`false`、字符串 `"false"`、数字 `0`）视为停用；缺失、`null`、其他非法类型一律视为启用（`true`），与 `_account_to_dict` 既有默认一致，避免脏数据把账号"静默停用"。
- 登录态读取端**不得**再产出 `inactive` / `offline` / `logged_in` 等三态之外的值。

### 3.2 正交判定矩阵（`status` × `is_active`）

| `status` | `is_active` | 登录徽章 | 启用标记 | 卡片样式 | 发布选择器 |
|---|---|---|---|---|---|
| `active` | `true` | 已登录 | 无 | 正常 | 可选、可默认 |
| `active` | `false` | 已登录 | 已停用 | 灰化 | **不可选、不默认** |
| `expired` | `true` | 已过期 | 无 | 正常 | 可选（现状不变，引擎侧不硬拦） |
| `expired` | `false` | 已过期 | 已停用 | 灰化 | **不可选、不默认** |
| `unverified` | `true` | 未确认 | 无 | 正常 | 可选 |
| `unverified` | `false` | 未确认 | 已停用 | 灰化 | **不可选、不默认** |
| 缺失/脏值 | 任意 | 归一化为 `unverified` | 按 `is_active` | 按 `is_active` | 按 `is_active` |

> 关键不变式：**启用态不影响登录徽章文案与色彩；登录态不影响启用标记。** 任一维度的测试断言都必须在另一维度取值不同时成立（正交性断言）。

### 3.3 `statusSource` 枚举（主进程 → 渲染层诊断字段）

| 值 | 触发条件 | 本 PR 变化 |
|---|---|---|
| `no-local-credential` | 本地无加密凭证 | 不变 |
| `backend` | 后端 `status` ∈ 三态 | 不变 |
| `absent-fallback` | 后端 `status` 缺失/非三态（含上游异常透传） | **新增**，取值收敛为 `unverified` |
| ~~`derived-from-is-active`~~ | 原第 3 分支 | **删除**（RC-3） |

---

## 4. 架构与数据流

### 4.1 写路径（批量启用/停用）

```
[渲染层] Accounts.vue handleBatchSetActive(isActive, ids)
   → stores/accounts.batchSetActive(isActive, ids)
   → store 侧按 id 从 accounts 解析 platform（IPC 校验必需段；解析不出即诚实计为 failed）
   → api/publisher.accountSetActive(accountId, platform, isActive)
   → window.electronAPI.accountSetActive(accountId, platform, isActive)
[主进程] preload/account.js: ipcRenderer.invoke('account:set-active', { accountId, platform, isActive })
   → ipc-handlers/account.js  handler 'account:set-active'
       · withSenderCheck（/ 边界）
       · getOwnerSubject() 未登录 → EC.AUTH_ERROR
       · _isSafePathSegment(accountId) 与 _isSafePathSegment(platform) → EC.VALIDATION_ERROR
       · isActive 必须 typeof === 'boolean'，否则 EC.VALIDATION_ERROR
       · 委托 AccountManager.setAccountActive(accountId, platform, isActive)   ← 启用态唯一写者
[后端] pythonBridge.requestBackend('PATCH', '/api/accounts/{id}', { is_active })
   → server.patch_account → 写 accounts.json（原子写）
[读回] 渲染层 load() → account:list → listAccounts() → toPublicAccount → is_active 透传
```

**设计要点**

1. **不复用 `persistLoginState`**：两者词表、校验规则、副作用字段完全不同；复用会让「点启用」意外写 `last_validated`，重新制造口径分裂。
2. **失败必须可见**：写者返回 `{ok, reason}`，IPC 层转成 `{code:-1, message}`，渲染层计入 `failed` 并提示「已启用 x 个，y 个失败」。**禁止** `.catch(() => {})`。
3. **逐账号提交**：后端无批量端点；与 `batchDelete` 一致保持 N 次 PATCH，单次失败不影响其余（部分成功语义）。
4. **SQLite 通路保持不变**：本 PR 不删除 `store:update-account`（`renameAccount` 仍在用），只是让 `batchSetStatus` 不再走它。
5. **纵深防御（实现期补加，超出原契约）**：`ipc-handlers/store.js` 的 `rendererAccountUpdateFields` 白名单**移除 `'status'`**，让渲染层从通道层面就再也写不进登录态；本地库缺 `status` 时同样诚实回落 `unverified`，不由 `is_active` 派生。
6. **platform 参数为实现与初稿的差异点**：后端 `PATCH /api/accounts/{id}` 只需 `accountId`，但 IPC 层为与 `account:set-proxy` 保持同一入参口径（并对两个路径段都做 `_isSafePathSegment` 校验），签名定为 `(accountId, platform, isActive)`；`platform` 在主进程仅用于日志定位。渲染层据此必须解析平台，解析不出来按失败计数而不是跳过。

### 4.2 读路径

- `toPublicAccount`：`is_active` 经字段白名单原样透传（已在 `publicAccountFields`）；登录态判定删除 `is_active` 派生分支。
- 渲染层暴露**单一**判定函数 `isAccountActive(account)`（供发布选择与卡片共用），禁止各处重复实现 `=== false` 判断。
  实现落点：`apps/desktop/src/utils/account-active.js` 定义纯函数，`stores/accounts.js` 原样导出到 store 表面。
  之所以不直接放在 store 里：`AccountManagementCard.vue` 与 `usePlatformSelection.js` 都是无 store 依赖的
  展示/组合层，从 store 取判定会把它们变成状态容器消费者；纯函数模块可让「单一实现」与「零耦合」同时成立。

---

## 5. 后端 API 契约

`PATCH /api/accounts/{account_id}`（`AccountUpdateRequest`，`extra="forbid"`）

```python
is_active: StrictBool | None = None   # 新增：账号是否启用发布；None 表示不修改
```

必须用 `StrictBool` 而不是 `bool`：pydantic v2 的宽松 bool 会把 `"no"` → `False`、`"yes"`/`1` → `True`
静默转换并返回 200，等于让一个脏调用直接改写账号的发布能力，而且调用方传错了也会看到「成功」。
严格模式下非布尔直接 422，不落盘。

行为矩阵：

| 请求体 | 结果 |
|---|---|
| `{is_active: false}` | 200，`is_active=false`，`status` **不变** |
| `{is_active: true}` | 200，`is_active=true`，`status` **不变** |
| `{is_active: "no"}` | pydantic 422（严格 bool，不做隐式真值收敛） |
| `{status: "inactive"}` | 400 `ACCOUNT_STATUS_INVALID` |
| `{status: "active", is_active: false}` | 200，两者各自生效（正交写） |
| `{}` | 200，无字段变更（幂等） |
| 账号不存在 / 非本人 | 404 |

校验顺序要求：`status` 非法必须在**任何写盘之前**返回 400（沿用现状），`is_active` 由 pydantic 在进入函数前拦截，因此不会造成半更新脏源。

读侧：`GET /api/accounts` 与 `GET /api/accounts/{id}` 的 `_account_to_dict` 输出 `is_active`，
取值经 `_normalize_account_active()` 归一化 —— 只有明确为假（`False`、字符串 `"false"`、数字 `0`）算停用，
缺失 / `null` / 其他脏值一律按启用，保证升级前写入的历史数据不会把账号静默摘掉发布能力。
该函数与 `_normalize_account_status` 同级、互不引用：写其一不影响另一，读侧同样不得由一维推另一维。

---

## 6. 主进程 IPC / preload 契约

| 项 | 值 |
|---|---|
| IPC 通道 | `account:set-active` |
| preload 方法 | `accountSetActive(accountId: string, platform: string, isActive: boolean)` |
| 入参校验 | `accountId`、`platform` 均须通过 `_isSafePathSegment`；`isActive` 必须 `typeof === 'boolean'` |
| 成功返回 | `{ code: 0, data: { accountId, is_active }, message }` |
| 未登录 | `{ code: EC.AUTH_ERROR, message: '无法识别当前用户' }` |
| 参数非法 | `{ code: EC.VALIDATION_ERROR, message: '缺少或非法 accountId/platform/isActive 参数' }` |
| 写者失败 | `{ code: EC.REQUEST_ERROR, message, ...ipcFailureDetail(e) }` |
| 日志 | `ipcLog('info'\|'warn'\|'error', 'account:set-active', 'enter'\|'ok'\|'...')` 含耗时 |

`preload.test.js` 的 `ACCOUNT_METHODS` 白名单需同步新增 `accountSetActive`，并断言映射到 `account:set-active` 且参数为 `{ accountId, platform, isActive }` 纯 JSON。

> 该文件同时锁有三处计数（`ACCOUNT_METHODS` 长度、account 模块导出数、合并后 api 总键数），新增方法必须三处同步，否则 `preload.test.js` 直接变红。`electron/preload/index.bundle.js` 与 `home-shell-preload.bundle.js` 是**纳入版本管理的构建产物**，改完 `preload/*.js` 必须重跑 `node scripts/build-preload.js`。

---

## 7. 渲染层交互逻辑

### 7.1 批量启用/停用（账号页）

**前置**：`accountTab !== 'groups' && accountTab !== 'favorites'`、批量模式开启、`selectedCount > 0`。

1. 用户勾选账号 → 工具栏出现「批量启用 / 批量禁用 / 批量删除 / 取消选择」。
2. 点击「批量禁用」→ `batchStatusBusy = true`，按钮文案切「处理中」，两按钮 disabled（防重复提交）。
3. `store.batchSetActive(false, ids)` 逐账号 PATCH；**只接受与当前可见且仍被选中的 id 交集**（防止切筛选后误改隐藏账号 —— 沿用 `batchDelete` 既有约束）。`isActive` 非布尔或 `platform` 解析不出的账号单独计为 `failed`，不静默跳过。
4. 全部完成后 `clearSelection()` + `load()` 拉取真源，保证界面与后端一致（**不乐观更新**，写失败不能显示成功）。
5. 结果提示（见 §8）。
6. 成功停用的账号：卡片立即出现「已停用」标记并灰化；同批登录徽章文案不变。
7. `finally` 复位 `batchStatusBusy`，异常不得让按钮永久 disabled。

**确认弹窗**：沿用现状，启用/停用不加二次确认（可逆、无数据损失）。

### 7.2 账号卡片显示项（`AccountManagementCard.vue`）

| 显示项 | 规则 | i18n key |
|---|---|---|
| 登录徽章 | **仅**由 `status` 决定（三态 + unknown 兜底）；`is_active` 不参与 | 既有 `statusLoggedIn/statusExpired/statusUnverified/statusNoCheck` |
| 停用标记 | `isAccountActive(account) === false` 时新增 `data-testid="account-disabled-flag"`，文案「已停用」 | **新增** `accountCardLabels.disabledFlag` |
| 卡片样式 | 停用时 `.account-card` 加 `is-disabled`（降饱和 + 边框弱化），不改布局尺寸 | — |
| aria | 徽章 `aria-label` 不变；停用标记 `role="status"`，保证读屏能感知 | **新增** `disabledFlagAria` |

> **必须一并收敛的历史错误语义（未决点定案）**：`accountStatusKind` 的 `inactive|offline → 'offline'` 分支，其 `statusLabel` 返回「已登录」，而 `offline` 语义是「未检测」。RC-3 删除派生后，`status` 不可能再取到 `inactive`；`offline` 仅可能来自历史脏数据，此时应按「未确认/未检测」处理而非谎称「已登录」。定案：**删除 `inactive|offline` 分支**，历史脏值统一走既有兜底，并同步修改断言「inactive 状态保持显示『已登录』」的既有用例（该断言本身是把概念混用固化为契约，属逃逸链中的"审查盲区"）。

### 7.3 发布目标选择器（`PublishTargetSelector.vue` + `usePlatformSelection` + `usePublishPlatformCatalog`）

收口三处，缺一不可：

1. **可选集合**：`usePlatformSelection.getAccounts()` 过滤掉停用账号。`getAvailableAccountIds` / `isAccountAvailable` / `reconcileSelectedAccounts` 全部经由该集合，因此已选中的账号一旦被停用，会被自动剔除。
2. **默认回填**：`getDefault(platform)` 与 `reconcileSelectedAccounts` 的兜底不得落在停用账号上（否则停用的账号会因"默认"重新进入发布目标，等于没停用）。
3. **渲染禁用态**：`usePublishPlatformCatalog.groupedPlatforms` 的 `accounts` 条目携带 `disabled: !isAccountActive(account)`（原始字段透传，仅追加 `disabled`）；`PublishTargetSelector.vue` 的 checkbox `:disabled` 取 `disabled || account.disabled`，`label` 加 `is-disabled`（降透明度 + `cursor: not-allowed`），并在账号名旁渲染 `data-testid="target-account-disabled-flag"` 的「已停用」小标记。

   该组件此前完全不依赖 i18n（既有文案为硬编码中文基线），新增文案以 `i18n.global.t('accountsPage.accountCardLabels.disabledFlag')` 取键（仓库既有同模式：`components/UiSkeleton.vue`），**不新增中文字面量**，Gate 7 `--cjk` 实测无新增。

4. **实现期核对**：`src/composables/usePlatformAccounts.js` 也读 `accountStore.byPlatform`，但全仓**无任何消费者**（死模块），故不加收口以免扩大改动面；`PlatformAccountGroup.vue` 的本地 `isActive(account)` 是**登录态**语义（读 `status`），与本 PR 的启用态判定无关，刻意不复用同名函数，避免第三次概念混用。

**一致性要求**：可选集合与渲染禁用必须来自同一判定函数（store 暴露的 `isAccountActive`），禁止两处各写一次 `=== false` 判断导致漂移。

### 7.4 边界与异常

| 场景 | 期望 |
|---|---|
| 未登录（`getOwnerSubject() === null`） | IPC 返回 `AUTH_ERROR`，全部计入 `failed`，提示批量失败 |
| 后端不可用 / 5xx | 每个 PATCH 失败计入 `failed`；界面不改状态、不显示成功 |
| `isActive` 非布尔 | IPC `VALIDATION_ERROR`，不触达后端 |
| `accountId` 含路径操纵字符 | IPC `VALIDATION_ERROR`（`_isSafePathSegment`） |
| 部分成功 | 警告「已启用 x 个账号，y 个失败」 |
| 选中集为空 | 直接 return，不发请求、不提示 |
| `is_active` 为脏值（`"no"`/`{}` 等） | 按启用处理（fail-safe 不误停） |
| 同一账号重复点击（busy 中） | 按钮 disabled，无并发写 |
| 快速连点启用→禁用 | `batchStatusBusy` 串行化；最终态以最后一次完成的写 + `load()` 真源为准 |
| 停用后重进账号页 / 重启应用 | 仍显示「已停用」（真源持久化） |

---

## 8. 提示文字（i18n，zh/en 必须成对 —— Gate 7）

复用既有键（语义已正确，不改文案）：`batchEnable`、`batchDisable`、`processing`、`enabledCount`、`disabledCount`、`statusPartial`、`statusFailed`。

新增键（`accountsPage.accountCardLabels.*`）：

| key | zh | en |
|---|---|---|
| `disabledFlag` | 已停用 | Disabled |
| `disabledFlagAria` | 该账号已停用，不可用于发布 | This account is disabled and cannot be used for publishing |

发布选择器复用 `disabledFlag` 文案。**新增用户可见文案一律写入 locales**，`src/` 非 locales 文件不得新增中文字符串字面量（CI 基线扫描拦截）。

提示语义（与 `batchDelete` 的三分支保持同构）：

| 条件 | 类型 | 文案 |
|---|---|---|
| `failed === 0` | success | 启用→「已启用 {count} 个账号」；停用→「已禁用 {count} 个账号」 |
| `failed > 0 && success > 0` | warning | 「已{启用\|禁用} {success} 个账号，{failed} 个失败」 |
| `success === 0 && failed > 0` | error | 「批量{启用\|禁用}失败」 |
| IPC 抛错 | error | 「批量{启用\|禁用}失败」+ `formatUserError` 详情 |

---

## 9. 测试矩阵（TDD：先红后绿）

| # | 层 | 文件 | 用例 | 断言要点 |
|---|---|---|---|---|
| T1 | 后端 | `tests/test_server_account_lifecycle.py` | `PATCH is_active=false` 持久化 | 200；再次 GET 得 `is_active False`；落盘 JSON 同步 |
| T2 | 后端 | 同上 | 正交性：只写 `is_active` 不改 `status` | 前后 `status` 相同 |
| T3 | 后端 | 同上 | 正交性：只写 `status` 不改 `is_active` | 前后 `is_active` 相同（扩展现有 `test_patch_account_status_is_orthogonal_to_is_active`） |
| T4 | 后端 | 同上 | 非法 `is_active`（非布尔） | 422 |
| T5 | 后端 | 同上 | 同时传 `status` 非法 + `is_active` 合法 | 400 `ACCOUNT_STATUS_INVALID`，且 `is_active` 未被半更新 |
| T6 | 主进程 | `electron/publishers/account-manager.test.js` | `setAccountActive('acc-1','douyin',false)` 只 PATCH `{is_active:false}` | `requestBackend` 参数**不含** `status`/`last_validated` |
| T7 | 主进程 | 同上 | 后端返回非 0 / 抛异常 | `{ok:false, reason}`，不抛到调用方 |
| T8 | 主进程 | `electron/ipc-handlers/account.test.js` | `is_active:false` 且后端无 `status` → 不再产出 `inactive` | `status === 'unverified'`，`status_source !== 'derived-from-is-active'`（**反转既有断言**） |
| T9 | 主进程 | 同上 | `account:set-active` 未登录 / accountId 非法 / isActive 非布尔 | 对应错误码，且不调用写者 |
| T10 | 主进程 | `electron/preload.test.js` | `ACCOUNT_METHODS` 含 `accountSetActive` | 映射 `account:set-active`，参数为纯 JSON `{accountId, isActive}` |
| T11 | 渲染层 store | `src/stores/accounts.test.js` | `batchSetActive(false, ids)` 调 `accountSetActive` 而非 `accountUpdate` | 反转既有 `accountUpdate(id,{status:'inactive'})` 断言；部分成功计数正确 |
| T12 | 渲染层 store | 同上 | `isAccountActive` 单一判定；停用账号不进入可选集合 | 与 T13/T16 共用同一函数 |
| T13 | 渲染层 组件 | `AccountManagementCard.test.js` | `is_active:false` → 出现 `account-disabled-flag`、卡片含 `is-disabled`；登录徽章文案不受影响 | 正交性双断言 |
| T14 | 渲染层 组件 | `AccountManagementCard.test.js` | 收敛 `offline` 分支 | 反转「inactive 显示已登录」断言 |
| T15 | 渲染层 视图 | `src/views/Accounts.test.js` | 批量禁用按钮 → 走 `batchSetActive(false, 可见选中集)` + 成功/部分/失败三提示 | 切筛选后不误改隐藏账号 |
| T16 | 发布选择 | `usePlatformSelection` / `PublishTargetSelector` 测试 | 停用账号不出现在 available 集合、不可勾选、不被默认回填、已选中的被剔除 | 四个收口点各一条 |

**必跑的既有门禁**（不得因本改动变红）：`pnpm -C apps/desktop test`（vitest）、`cd packages/python-backend && pytest`、`electron/preload.test.js`、Gate 7 locale 成对检查、ESLint。

### 9.1 实施结果（TDD 逐层红→绿）

| 层 | 红灯 | 绿灯 | 备注 |
|---|---|---|---|
| 后端 | 4 failed | `test_server_account_lifecycle.py` 25 passed | `is_active` 用 `StrictBool`：pydantic v2 宽松 bool 会把 `"no"`→`False`、`1`→`True` 静默转换（返回 200 而非 422），必须严格 |
| 主进程 | 30 failed | 4 文件 / 555 passed | 反转 6 处 `derived-from-is-active` 断言 + `store.test.js` 1 处；`preload.test.js` 三处计数锁同步 |
| 渲染层 | 17 failed | 45 文件 / 1006 passed（定向集合） | T11–T16 全部覆盖 |

### 9.2 编写测试时的两处自纠错（断言错、实现对）

1. **`usePlatformSelection`「默认账号被停用」**：初版期望自动回填下一个可用账号，实测应为 `[]`。既有实现只在「存在默认账号且可用」时回填（与既有「无默认账号时不设置」用例同构），自动挑一个非默认账号属于新增策略，不在本 PR 范围。
2. **`usePublishPlatformCatalog`「accounts 携带 disabled」**：初版 `toEqual([{ id, disabled }])` 漏了 spread 透传的原始字段（`is_active` 等）。改为先 `map` 出 `{id, disabled}` 再断言，并单独断言原始字段确实透传 —— 精确表达「只追加 `disabled`，不改写账号」。

两处均为**先改断言、后确认实现**，未为了让断言通过而放宽实现，也未为了让实现通过而删除护栏。

---

## 10. 验收标准（可手动验证）

1. 勾选 2 个账号点「批量禁用」→ 提示「已禁用 2 个账号」→ 两张卡片立即出现「已停用」并灰化，登录徽章不变。
2. 关闭并重启应用（或刷新账号页）→ 仍为「已停用」；`accounts.json` 中对应账号 `is_active: false`。
3. 打开发布页目标选择器 → 该两账号置灰不可点、名字旁显示「已停用」，且不会被自动选为默认。
4. 若该账号原本已被勾选 → 回到发布页后自动取消勾选。
5. 点「批量启用」→ 上述全部反向恢复。
6. 停掉后端（或断网）后点批量禁用 → 提示失败，界面状态不变（不出现"假成功"）。
7. 全仓检索 `status_source === 'derived-from-is-active'` 与登录态取 `'inactive'` 的展示逻辑 → 不再存在。

---

## 11. 兼容性与数据迁移

- **历史脏数据**：老 `accounts.json` 可能已有 `status: "inactive"`（RC-2 写坏的）。后端读侧 `_normalize_account_status` 已把非三态值归一化为 `unverified`；主进程侧本 PR 补齐同样的 fail-safe。用户可见影响：这类账号从显示「已登录」变为「未确认」，需重新点一次检测 —— 这是**修正**而非回归，PRD 明确接受（用户已确认）。
- **`is_active` 缺失**：一律按启用处理，保证升级后不会有任何账号被静默停用。
- **Electron SQLite 中残留的 `status` 值**：不主动清理（该库本就不参与账号列表读取），避免引入破坏性迁移。
- **回滚**：后端新增字段为可选、无 schema 迁移；回滚只需还原代码，数据文件保持可读。

---

## 12. 变更记录归属

- `CHANGELOG.md`：Added（`is_active` 可写 + 账号页停用显示 + 发布选择排除）、Fixed（批量启用/停用写错库、`is_active` 泄漏登录态、`offline` 误标「已登录」）。
- `01-docs/UI-INVENTORY.md`：账号卡片新增停用标记、发布目标选择器新增禁用态。
- 经验沉淀（三套记忆）：「双库分裂导致按钮装饰化」「词表撞车污染状态字段」「零消费者字段 = 死开关，接通写侧必须同时接通读侧」。
