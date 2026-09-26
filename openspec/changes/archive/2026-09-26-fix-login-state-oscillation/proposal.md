## Why

用户报告：新添加的账号在「一键检测」后又回到「未确认」。这不是 #2401 复发，而是登录态状态机的一条原则**只落实了一半**造成的振荡：

- `expired` 已经是粘滞态 —— `apps/desktop/electron/services/login-status-monitor.js:75` 注释明确写着「expired 属粘滞态，自动循环不擅自翻案，避免与手动一键检测结论互相拉扯」，因此监控循环跳过 `expired` 账号。
- 但 `active` **没有任何对等保护**。检测链路里有 7 个「无定论」出口（`apps/desktop/electron/publishers/account-manager.js:528/540/574/648/660`，另加 IPC 层 `account.js:67` 的 `checkError → 'unverified'`），任何一个都会把既有的正向结论**抹成 `unverified`**；`login-status-monitor.js:85` 的判据是 `next !== current` 就回写，于是 `active ↔ unverified` 可以每 30 分钟来回一次。

根因一句话：**「没有拿到新证据」被当成了「拿到反证」**。登录态真源只应被正向或负向证据改变。

放大这个不对称的是重复实现：同一个「三态 → 可持久化 status」映射存在三份拷贝 —— `AccountManager.loginStatusFromCheckResult`（`account-manager.js`）、IPC 层 `loginStatusFromCheck`（`account.js:66`）、监控层 `_loginStatusOf`（`login-status-monitor.js:126` 附近）。三处都把无定论映射成 `unverified`，所以任何一处的修正都不会自动传导到另外两处。

**必须同时改掉的既有契约（自我推翻，须显式记录）**：#2233 的 D3 决策把「检测不确定即降级为未确认」固化成了断言 —— `apps/desktop/tests/e2e/specs/account-login-state-tristate.js:121` 断言「检测后：视频号降级为『未确认』而非『已登录』」。当时的问题是「无证据却显示已登录」（假绿灯），修法却是「无证据即改写为更弱的主张」，副作用就是现在这条振荡。本 change 用「无证据不改写 + 超龄兜底」替换它，两侧风险都要覆盖，不能回到 D3 之前的假绿灯。

**运行态事实校正（避免夸大收益）**：本机视频号当前 HTTP 检测是**确定成功**的（`app-2026-09-26.log`：`http-check valid=true code=CHECK_LOGIN_SUCCESS_HTTP_API` → `persistLoginState 固化登录态 ... status=active`），所以日常不会每次都回跳；回跳只发生在接口抖动/风控/凭证仅存文件等无定论场景。另外已核实发布链路**不以 `status === 'active'` 作为门槛**（全仓仅首页计数 `account.js:336` 与失效横幅读它），因此本缺陷的危害是「徽章不可信 + 首页在线计数抖动」，不会阻断发布。

## What Changes

- **P0 单向证据规则（唯一口径）**：在 `AccountManager` 新增纯函数 `loginStatusTransition({ result, checkError, currentStatus, lastValidated, nowMs, graceMs })` 与写入封装 `persistCheckResult(...)`，返回 `{ ok, status | null, changed, reason }`，其中 `status === null` 表示**本轮不改写真源**。规则表：
  | 检测结论 | currentStatus | 结果 |
  |---|---|---|
  | `valid === true` | 任意 | 写 `active` |
  | `valid === false` | 任意 | 写 `expired` |
  | 无定论 / 检测自身异常 | `expired` | **不改写**（保持 expired，与监控既有粘滞一致） |
  | 无定论 / 检测自身异常 | `active` 且 `now - last_validated <= graceMs` | **不改写**（保持 active） |
  | 无定论 / 检测自身异常 | `active` 但已超龄（或 `last_validated` 缺失/非法） | 写 `unverified`（防僵尸绿灯） |
  | 无定论 / 检测自身异常 | 缺失 / 已是 `unverified` | 写 `unverified`（与现状一致，「从未有结论」仍诚实） |
  `graceMs` 由环境变量 `MP_LOGIN_STATE_GRACE_DAYS` 可调，默认 **7 天**。
- **P0 三处调用点收敛到单一入口**：`account:check-login`（`account.js:533`）、`accounts:batch-check-login`（`account.js:610`）、`login-status-monitor`（`:86`）全部改调 `persistCheckResult`，删除 IPC 层 `loginStatusFromCheck` 与监控层 `_loginStatusOf` 的本地映射（改为在缺方法时按同一规则兜底，不允许再各写一份）。批量与单账号的调用点当前不持有 `currentStatus`：无定论分支内按需 `GET /api/accounts/:id` 取真源（有明确结论时不额外读，避免每次检测多一跳）。
- **P1 渲染层语义区分**：批量结果项新增 `statusChanged: boolean`，汇总文案把「未确认」改为「**未取到定论（保持原状态）**」，`unconfirmed` 计数只统计「本轮无定论」，不再与 `status === 'unverified'` 混用；`batchCheckAllDone` 与新增文案键 **zh/en 成对**（CI Gate 7）。
- **P1 契约与回归同步**：`account-login-state-tristate.js` 的 D3 断言从「降级为未确认」改为「保持已登录 + 提示未取到定论」，并**新增**一条反向护栏（无定论不得把 `expired` 翻成 `unverified`）；PRD `01-docs/PRD-ACCOUNT-LOGIN-STATE-PERSISTENCE-2026-09-23.md` §5 写者架构、§7.1 批量、§7.5 定期检测、§8.1 徽章语义同步。

## Capabilities

### Modified Capabilities
- `desktop`: 登录态持久化从「每次检测都写结论」改为「只有正/负证据才改写真源」，无定论保持原状态并引入超龄兜底；`accounts:batch-check-login` 结果项新增 `statusChanged` 字段，汇总文案区分「本轮未取到定论」与「已失效」。

## Impact

- 修改：`apps/desktop/electron/publishers/account-manager.js`（新增 `loginStatusTransition` / `persistCheckResult` 并导出）、`apps/desktop/electron/ipc-handlers/account.js`（两个 handler + 删除本地映射）、`apps/desktop/electron/services/login-status-monitor.js`（回写条件 + 超龄降级）、`apps/desktop/src/views/Accounts.vue`（计数与提示）、`apps/desktop/src/locales/zh.js` + `en.js`（成对）、`01-docs/PRD-ACCOUNT-LOGIN-STATE-PERSISTENCE-2026-09-23.md`、`AGENTS.md` QM-2、`CHANGELOG.md`、`01-docs/learnings.md`。
- 测试：`account-manager.test.js`（规则表 6 行逐条 + 反证）、`account.test.js` / `account-batch-check.test.js`（无定论不发 PATCH、`statusChanged`）、`login-status-monitor.test.js`（无定论不回写、超龄降级、假时钟边界）、`Accounts.test.js`（文案计数）、e2e 三态规范反转。
- **风险与代价（必须写清）**：一个会话实际已失效、但检测长期拿不到定论的账号，会在 grace 窗口内继续显示「已登录」。缓解：① `valid === false` 仍立即 `expired`；② 7 天超龄自动降级并提示重登；③ 发布失败路径不受影响（本来就不读 status）。这与中国区第三方平台风控导致的「无定论」高发性是同一枚硬币的两面：宁要有限度的乐观 + 明确兜底，不要每 30 分钟改口的徽章。
- 不改后端 schema：`AccountUpdateRequest` 无 `status_reason` / `last_login_check_at` 字段，「为什么保持」本轮只进日志与检测结果，不落库（落库需 Python 侧字段与迁移语义，另案，见 tasks 6.3）。
- 单 PR 落地（P0 + P1 一起，拆开会让「规则已改但文案仍说未确认」的中间态进入 main）。
