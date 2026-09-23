# PRD：账号昵称/头像真实获取与写回（account-profile-info）

- 日期：2026-09-23
- 分支：`codex/account-profile-info`（worktree `D:/Data/projects/mp-worktrees/mp-account-profile-info`）
- 关联：`PRD-ACCOUNT-IS-ACTIVE-BATCH-2026-09-23.md`（PR-1，is_active 与登录态正交解耦，已合并 #2282）
- 需求来源（用户逐字）：「账号的昵称/头像之前没有获取的问题，解决了吗」

## 1. 一句话需求

账号页的「昵称」与「头像」必须来自平台页面真实采集并能持久化；采集不到时必须保持上一次的真实值，
禁止用网页标题冒充昵称、禁止把未命中字段算成空串反向清空真源。

## 2. 根因取证（本次实测，按证据链排序）

| # | 取证点 | 事实 | 结论 |
|---|--------|------|------|
| 1 | `account-manager.js#extractAccountInfo` | 采集实现完整存在（昵称 4 层回退、头像 3 层回退、平台ID、粉丝折算） | 能力不是缺失 |
| 2 | 唯一调用点 | 只在 `captureCookies()` 内被调用，而 `captureCookies` 只被 IPC `account:add` 触发 | 装饰性链路 |
| 3 | 渲染层调用 `account:add` | 全仓零调用（登录走 auth-view-manager / qrcode-login / webview-manager 三条主进程入口） | 能力从未在真实路径生效 |
| 4 | 三条真实入口产出 | 只产出 `{cookies, name, localStorage, indexedDB}`，`name` 取 `document.title`/标签标题 | 昵称显示成「XX - 登录页」，头像无来源恒空 |
| 5 | `updateCapturedAccount` 更新路径 | 未命中字段算成 `''` / `null` 一并 PATCH | 反向清空真源（次生缺陷 A） |
| 6 | 后端 `AccountUpdateRequest` | 字段 `... \| None = None` + `is not None` 才赋值 | 缺席=不修改、空串=显式清空，语义本身正确 |
| 7 | 一键检测/单账号检测 | 判定有效后只回写 `status`/`last_validated`，不回填资料 | 存量账号永不修复（次生缺陷 B） |
| 8 | `AccountManagementCard.vue` / `PlatformAccountGroup.vue` | `<img v-if="account.avatar \|\| account.avatar_url">` 无 `@error` | 外链失效时留空白头像（次生缺陷 C） |
| 9 | 后端字段与渲染层读取 | `account_name`/`avatar` 后端已存、渲染层已读 | 后端与 UI 数据契约本就打通，无需改动 |

## 3. 决策（含被否方案）

| 编号 | 决策 | 理由 | 被否方案 |
|------|------|------|----------|
| D-1 | 采集实现收敛到 `packages/shared-utils/src/account-profile.js`，Playwright 与 Electron 双运行时共用 | 历史上 DOM 采集在两处各写一份导致口径漂移；Electron `executeJavaScript` 只接受字符串，必须可序列化为自求值表达式 | 在 account-manager 内继续内联（行数已 1209，且三入口各自复制） |
| D-2 | 三条真实登录入口在提取凭证时同时产出 `accountInfo` | 登录成功是唯一「有已登录 DOM + 有凭证」的时机 | 让渲染层重新调 `account:add`（渲染层不得接触凭证，违反现有安全边界） |
| D-3 | 更新路径改为「只下发命中且与真源不同的字段」（`buildProfilePatch`） | 后端空串=清空；缺席=不修改 | 下发空串（现状，会清空）；前端维护本地缓存兜底（真源仍是脏的） |
| D-4 | 登录态检测判定有效的两处 DOM 出口调用 `refreshProfileFromPage` 回填 | 存量账号不必重新登录即可修复 | 只做增量不管存量（用户投诉的正是存量账号） |
| D-5 | 头像 `<img>` 增加 `@error` 回落默认图标，不新增 locale 键 | 回落是纯展示态；alt 保持空串（头像旁已有昵称文本，非装饰信息缺失）；新增中文文案会触碰 Gate 7 成对要求 | 新增 `accountsPage.accountCardLabels.avatarPlaceholder`（无实际文案需求，徒增门禁面） |
| D-6 | 后端零改动，只补契约测试 | 语义正确，缺陷全在主进程 | 后端把空串当缺席（会让「显式清空」不可表达，且掩盖调用方错误） |

## 4. 数据模型与校验

真源 `accounts.json`（Python 后端）资料字段：

| 字段 | 类型 | 语义 | 来源 | 校验 | 采集不到时 |
|------|------|------|------|------|------------|
| `name` | str | 显示名（平台名/标题，可能被登录入口覆盖） | 登录入口 `document.title` / 标签标题 | 非空字符串，否则回落 `getPlatformName(platform)` | 保持原值 |
| `account_name` | str | 昵称（账号页主标题） | 采集器 `nickName` | trim 后非空、og:title 回退限长 <50 | 键缺席 → 不修改 |
| `avatar` | str | 头像 URL | 采集器 `avatar`（img src → 背景图 url() → og:image） | trim 后非空；仅存 URL，不做可达性校验 | 键缺席 → 不修改 |
| `platform_account_id` | str | 平台侧用户 ID | 采集器 `platformAccountId` | trim 后非空 | 键缺席 → 不修改 |
| `followers` | int | 粉丝数 | 采集器文本 `/([\d.,]+)\s*(万|w|W)?/` | 必须为 `Number.isFinite` 且 `>= 0`，`Math.round` 后落盘；「1.2万」→ 12000 | 键缺席 → 不修改 |

写回校验纪律：

1. `accountId` / `platform` 必须过 `isSafePathSegment`，否则不采集、不写回（防路径注入）。
2. 采集结果必须是 plain object；`collectWith*` 任何异常一律降级 `{}`，不得抛出打断登录/检测主链路。
3. `buildProfilePatch` 三条过滤：值非 `null/undefined/''`；与真源当前值相同则跳过（避免无意义写盘）；只允许 `account_name/avatar/platform_account_id/followers` 四个键。
4. 资料 PATCH 与登录态 PATCH 不夹带：`refreshProfileFromPage` 的请求体不得出现 `status`/`last_validated`；`updateCapturedAccount` 的 `status=active` 仅在凭证成功落盘后下发。
5. 创建路径（POST）允许空值：新行没有旧值需要保护，昵称未命中回落 `name`。
6. 后端 `extra="forbid"`：任何凭证字段混入 PATCH 体一律 422。

## 5. 采集契约（单一实现）

`accountInfoCollector(arg)` 在页面上下文执行，`arg = { platformSelectors }`：

- 选择器优先级：平台专用表 `PLATFORM_ACCOUNT_INFO_SELECTORS[platform]` → 通用表，专用表未命中必须继续试通用（`withFallback`，只提供专用一行不覆盖全部 DOM 形态）。
- 昵称 4 层：DOM 选择器 → `og:title`（<50）→ `twitter:title`（<50）→ `document.title` 去平台后缀（`/\s*[-–—|·]\s*(.+)$/`）。
- 头像 3 层：`img[src|data-src|data-original]` → 元素背景图 `url()` → `og:image`。
- 输出契约：只产出命中键（全部未命中返回 `{}`）。
- 自包含约束：函数体禁止引用任何模块作用域标识符（`require`、`PLATFORM_ACCOUNT_INFO_SELECTORS`、`log`…）。Playwright 序列化函数体注入页面、Electron 只能拼成 `(<fn toString>)(<json arg>)` 字符串执行；泄漏即 `ReferenceError`，由回归测试用 `new Function('document', 'return (' + src + ')')` 在裸作用域求值钉死。

## 6. 流程

```
登录入口（三条，任一成功即产出资料）
  ① auth-view-manager._extractAuthData(view, platform)
       cookies + localStorage + indexedDB + name(标题) + accountInfo(采集器)
       → ipc-handlers/account.js → AccountManager.saveCapturedAccount / updateCapturedAccount
  ② qrcode-login._extractAuthData → _onLoginSuccess → saveCapturedAccount({cookies, localStorage, name, accountInfo})
  ③ webview-manager.saveAccountTabCredentials → updateCapturedAccount({cookies, localStorage, name, accountInfo})

保存/更新
  saveCapturedAccount(POST)   : profileForCreate(accountInfo, name) → 4 字段（可为空）
  updateCapturedAccount(PATCH): 凭证先落盘 → buildProfilePatch(accountInfo, account) 只下发差异字段
                                → 返回值 = {...真源, ...patch}（提取失败时调用方仍拿到旧真值）

登录态检测（存量账号回填路径）
  checkLoginStatus → DOM 选择器命中 / 仪表盘域名兜底 两条 valid 出口
    → refreshProfileFromPage(page, platform, accountId)
       安全段校验 → 采集 → 空即 false → GET 真源 → buildProfilePatch → 空即 false
       → PATCH（只含资料字段）→ true；任何异常只 warn 后 false
    → 登录态结论不因资料失败而改变（valid 出口照旧返回 CHECK_LOGIN_SUCCESS）
```

## 7. 显示项与交互

| 位置 | 显示项 | 规则 |
|------|--------|------|
| 账号卡片 `AccountManagementCard` 头像区 | 有 `avatar`/`avatar_url` → `<img>`；否则 `<UserFilled>` 图标 | 图片加载失败（`@error`）→ 该账号回落 `<UserFilled>`，不留空白 |
| 平台分组行 `PlatformAccountGroup` 头像区 | 同上 | 按 `account.id` 逐个记录失效，**不影响同组其他账号** |
| 账号卡片昵称行 | `account_name` → `name` → 平台显示名 | 与 PR-1 的「已停用」徽章、登录态徽章互不影响 |
| 发布选择器 / 其他消费方 | 读取同一 `account.avatar` | 头像失效回落逻辑同样生效（同一 `<img>` 契约） |

提示文字：本次不新增文案。既有文案不变：
`accountsPage.accountCardLabels.accountLoginStatus`（`账号登录状态：{status}`）、
`selectAccount`（`选择 {name}`）、`favoriteAdd/favoriteRemove`、`已停用`/`启用`（PR-1 引入）。

## 8. 测试矩阵

| 用例 | 文件 | 断言要点 |
|------|------|----------|
| T1 | `electron/tests/account-profile-collector.test.js` | 昵称 4 层回退；平台专用优先于通用；专用未命中继续兜底；og:title 超 50 字不采纳 |
| T2 | 同上 | 头像 3 层回退（src/data-src/背景图/og:image） |
| T3 | 同上 | 粉丝「1.2万」→ 12000、千分位、非数字不产出键 |
| T4 | 同上 | `buildCollectorExpression` 可在裸作用域独立求值、不含 `require(`（自包含守卫） |
| T5 | 同上 | `collectWithPlaywright` 保持 `evaluate(fn, {platformSelectors})` 形状；抛错降级 `{}` |
| T6 | 同上 | `buildProfilePatch` 缺席语义 + 与真源相同则跳过；`profileForCreate` 回落显示名 |
| T7 | `electron/publishers/account-manager-profile.test.js` | 三条真实入口源码必须调采集器并随凭证落库（接线守卫，防装饰性链路第四次复发） |
| T8 | 同上 | `updateCapturedAccount`：提取全失败 → 四个资料键全部缺席、无空串下发；命中 → 只下发差异；返回值沿用真源旧值 |
| T9 | 同上 | `refreshProfileFromPage`：命中只 PATCH 差异资料字段且不夹带 `status`/`last_validated`；提取失败/无差异 → 不发 PATCH、不抛错 |
| T10 | `src/features/accounts/components/*.test.js` | 头像 `@error` 回落默认图标；分组内单账号失效不影响其他账号 |
| T11 | `electron/services/auth-view-manager.test.js` | `_extractAuthData` 产出 `accountInfo`；`completeLogin`/自动完成三条会话结算断言含 `accountInfo` |
| T12 | `packages/python-backend/tests/test_server_account_profile_patch.py` | 缺席=不修改、单字段下发不牵连其他字段、空串=显式清空（对端契约） |

## 9. 验收标准

1. 新登录（三条入口任一）成功后，账号页昵称显示平台真实昵称而非网页标题；有头像选择器的平台显示头像。
2. 存量账号执行「一键检测/单账号检测」且判定已登录后，缺失的昵称/头像被补齐；检测耗时增加不影响判定结果（资料失败仅 warn）。
3. 提取失败时重新登录不会清空已有昵称/头像（PATCH 请求体中对应键缺席）。
4. 头像外链失效时回落默认图标，不出现空白框；同组其他账号头像不受影响。
5. 上述测试全绿；`check-max-lines`、`check-debt-budget`、Gate 7（`--pair-base`/`--keys`/`--cjk`）、ESLint 0 error；桌面应用可打包启动。

## 10. 非目标

- 不改后端数据模型与写语义；不加数据库。
- 不为 `avatar` 新增平台专用选择器（沿用 `platform-definitions` 现有表；缺失平台走通用回退）。
- 不动 `name` 被网页标题覆盖这一相邻问题（属显示名语义，改动面波及重命名功能，另案）。
- 不做单账号「刷新资料」手动入口（现有登录/检测两条自动路径已覆盖；若需要再加）。

## 11. 行数与债务门禁策略

`account-manager.js` 登记值 1061、合并 PR-1 后 1209 行，逼近 `limit+allowance`。本次把全部新逻辑外置到
`shared-utils/src/account-profile.js`（229 行，<500 不触发挂账），主进程只保留薄委托，
`account-manager.js` 由 1209 降至 1147 行（净还债 62 行）。三个登录服务各 +3~6 行，均在存量增长预算内。

## 12. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 平台 DOM 变更导致昵称/头像采不到 | 只影响「不更新」，不会清空；四层/三层回退 + 通用兜底 |
| 采集拖慢登录/检测主链路 | 单次 `executeJavaScript`/`evaluate`，失败即降级；检测路径仅在两条 valid 出口各一次 |
| 昵称被页面噪声（如公告标题）命中 | 限长 <50 的 meta 回退置于 DOM 选择器之后；DOM 选择器命中优先，噪声问题按平台表迭代 |
| 回滚 | 单 PR 单分支，revert 即回到「不采集、按空串下发」旧行为；后端无改动，无迁移回滚成本 |

## 13. 交付与遗留观察（合并后追加，docs-followup-profile）

### 13.1 合并事实

| 项 | 值 |
| --- | --- |
| PR | #2290（分支 `codex/account-profile-info`，worktree `D:/Data/projects/mp-worktrees/mp-account-profile-info`） |
| 合并方式 | squash（推送即开 `gh pr merge 2290 --auto --squash`） |
| 合并结果 | `state=MERGED`，`mergedAt=2026-09-23T12:10:43Z`，`mergeCommit=852ae22c2c` |
| 合入文件数 | 17（代码 7 / 测试 6 / 文档 4），+915 / -143（首个功能提交） |
| 冲突轮次 | 连撞 5 轮 `CONFLICTING`，main 依次前进 `e925df7973` `a49531d203` `24c1d59eba` `ff999aa4ea` `abc307cfa6`；冲突面每轮仅 `CHANGELOG.md`（第 3、4 轮 `01-docs/learnings.md` 可自动合并） |

### 13.2 合并后复验口径（校正版，以此为准）

- **定向前端测试（按 `git ls-files` 核准真实路径）**：`electron/tests/account-profile-collector.test.js`、`electron/publishers/account-manager-profile.test.js`、`electron/services/auth-view-manager.test.js`、`electron/services/qrcode-login.test.js`、`electron/services/webview-manager.test.js`、`electron/ipc-handlers/account.test.js`、`electron/preload.test.js`、`src/features/accounts`、`src/views/accounts` = **16 个测试文件，692 passed | 1 skipped（694）**。
- **路径校正说明（不做静默覆盖）**：本 PR 的 CHANGELOG 条目里「12 文件 / 575 passed」是按记忆手敲路径的结果，其中 2 个路径在仓库中不存在，vitest **不报错、只静默少跑**，等价于低覆盖。教训已入 `01-docs/learnings.md`。
- **后端**：`packages/python-backend` 内 `python -m pytest tests/test_server_account_profile_patch.py tests/test_server_account_lifecycle.py -q` = **28 passed**。
- **门禁 5 项全 rc0**：`check-max-lines`（超限 99 / 挂账 99 / 墓碑 1，无新增超限，`account-manager.js` 1209 到 1146 净还债 63）、`check-debt-budget`（全指标在基线内，circularDeps 0）、`check-locale-sync --pair-base origin/main`（zh/en 均无变更）、`--cjk`（基线 1581 / 当前 1363，无新增硬编码）、`--keys`（1139 键全部存在）。
- **隔离复核**：`accounts-compile.test.js` 的大批次并行跑中因单例耗时（隔离态 8.7 秒）出现过一次超时失败，单独运行 **6 passed**；该测试文件与 `Accounts.vue`、`src/composables` 在我方分支相对 `origin/main` 为**零 diff**，不构成本 PR 回归。

### 13.3 遗留观察（登记，不在本 PR 处置）

| 编号 | 观察项 | 证据 | 处置建议 |
| --- | --- | --- | --- |
| O-1 | `QG Browser E2E` 的 `/dashboard` 单点检查失败（303/304 通过，0 console errors、0 page errors） | 本 PR `gh pr diff --name-only` 零触碰 dashboard；同 job 在上一轮本分支 run 上为绿 | 独立复现并按"数据看板 14 项中 1 项"定位断言；勿夹带进功能 PR |
| O-2 | main 自身 post-merge run 的 `QG Desktop Shards (2/2)` 失败（run `35852634922` @ `ff999aa4ea`） | 同 run 其余 8 个 job 全绿，含 `QG Unit Tests` | 桌面分片 flake 观察；后续 PR 遇同类红按归属判定处理 |
| O-3 | 单账号级「启用/停用」入口仍未提供 | 用户在 PR-1 明确选择「暂不加单账号开关」 | 需求出现时以 `is_active` 单行 PATCH 接入，不新增词表 |
| O-4 | 头像为带签名临时 CDN 链接，过期后仅前端回落默认图标，库内 URL 不刷新 | PRD §5 采集契约：头像 3 层回退只在登录/检测有效时回填 | 若需彻底修复，加"头像失效计数 + 下次检测强制重采"，属独立需求 |

### 13.4 本 PR 未做的动作（边界声明）

- 未新增任何用户可见文案（因此不触碰 Gate 7 的 zh/en 成对与 CJK 基线）。
- 未改动数据模型、接口契约、显示项与交互逻辑；§4 到 §7 的口径在本节中仅被复验、未被修订。
- 未做磁盘清理、未删除任何 worktree 或分支。

