## 1. 前置确认（不动代码）

- [x] 1.1 确认基线含 `1f77a4a9`（#2401 新建账号固化 active）；不含则以该提交为基线重开 —— 本 change 的「无定论不改写」必须与「凭证落盘即固化」同时成立，缺一侧都会留下新漏洞
- [ ] 1.2 取改动前红名单：`cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run`（本机 `feedback.test.js` symlink EPERM 为既有基线）；`cd packages/python-backend && pytest -q` 同理。留存供后续判定「是否本 PR 引入」
- [x] 1.3 只读核实全仓「三态 → status」映射只有三处（`account-manager.loginStatusFromCheckResult`、`ipc-handlers/account.js:loginStatusFromCheck`、`login-status-monitor.js:_loginStatusOf`），把 grep 结果写进本目录备注；若发现第四处，纳入 2.x 一起收敛

## 2. 单向证据规则：纯函数（TDD）

- [x] 2.1 RED：新建规则表回归（QM-6 收口时从 `account-manager-login-state-transition.test.js` 迁至唯一真源 `packages/shared-utils/src/__tests__/login-state.test.js`，并按 `loginStatusFromCheckResult` 实测反证变红），按 proposal 规则表逐条断言（6 行全覆盖），关键三条必须精确：① 无定论 + `currentStatus='active'` 且 `lastValidated` 在 grace 内 → 返回 `null`；② 无定论 + `active` 且 `now - lastValidated > graceMs` → 返回 `'unverified'`；③ 无定论 + `currentStatus='expired'` → 返回 `null`（不得翻案）。另加 `lastValidated` 缺失/非法字符串、`graceMs` 边界（恰好等于）、`checkError` 与 `valid===undefined` 两条入口等价 四类边界。实测确认全部变红
- [x] 2.2 GREEN：实现 `loginStatusTransition({ result, checkError, currentStatus, lastValidated, nowMs, graceMs })`，`DEFAULT_GRACE_DAYS = 7`，`graceMs` 支持 `MP_LOGIN_STATE_GRACE_DAYS` 覆盖（非正数回落默认）。**函数内不得读环境变量以外的全局状态、不得有 I/O**（保证可测）
- [x] 2.3 反证（断言必须有鉴别力）：临时把 `active + 无定论` 分支改成恒返回 `'unverified'` → 2.1 ①必须立刻变红；再改成恒返回 `null` → 2.1 ②必须变红。两次反证结果与红线截图/日志记入 `.quality-gates.md`
- [x] 2.4 实现 `persistCheckResult({ accountId, platform, result, checkError, currentStatus, lastValidated })`：内部复用 `loginStatusTransition` → 需要读真源时按需 `GET /api/accounts/:id`（**仅无定论分支**）→ 需要写时才 `PATCH`；返回 `{ ok, status|null, changed, reason }`。异常不外抛（与 `persistLoginState` 同口径）

## 3. 三处调用点收敛（TDD）

- [x] 3.1 RED：`ipc-handlers/account.test.js` 新增 —— ① `account:check-login` 返回无定论且真源为 `active`（在 grace 内）时**不发 PATCH**，结果 `statusChanged === false`；② 返回 `valid === false` 时照旧发 `expired`；③ 检测抛异常（`checkError`）不再无条件写 `unverified`。`account-batch-check.test.js` 同步：硬超时账号（`CHECK_LOGIN_TIMEOUT`）在真源为 `active` 时保持原状并把「超时」如实记入 `code`
- [x] 3.2 GREEN：改造 `account.js:533` / `:610` 两处改调 `persistCheckResult`；删除 `loginStatusFromCheck` 本地映射，改为「`AccountManager.persistCheckResult` 缺失时」的兜底路径，且兜底必须与规则表逐条一致（防止再长出第二份口径）
- [x] 3.3 `login-status-monitor.test.js` RED→GREEN：① 无定论 + `active`（grace 内）→ 不回写、不广播、`last_validated` 不变；② 无定论 + `active` 超龄 → 回写 `unverified` 并广播；③ 无定论 + `expired` → 不回写（与 `:75` 既有注释一致）；④ 假时钟推进到 grace 边界**一次**并断言每个端点各被请求一次（防退化为串行/重复写）
- [x] 3.4 核对 `saveCapturedAccount` / `updateCapturedAccount` 的 `active` 固化**不受本规则影响**（那是正向证据 + 主动登录，直写 `persistLoginState`，不经 `loginStatusTransition`），补一条断言锁死这条边界，避免日后把「登录」也接进规则函数造成双门

## 4. 渲染层与文案（locale 成对）

- [x] 4.1 `Accounts.vue`：`batchCheckAll` 计数区分 `失效(valid===false)` / `本轮未定论(valid===undefined)`；`checkedExpiredIds` 口径不变（无定论不进失效集合，不显示「去登录」）；对 `statusChanged === false` 的账号**不得**用返回结果覆盖本地已展示状态（避免闪烁）
- [x] 4.2 `src/locales/zh.js` 与 `en.js` 成对新增/改写 `batchCheckAllDone` 的未定论段文案（「N 个未取到定论（保持原状态）」/ "N unresolved (status kept)"），跑 `node .github/scripts/check-locale-sync.js --pair-base HEAD` 必须 PASS
- [x] 4.3 `Accounts.test.js`：断言汇总提示在三态混合下的完整字符串（用 `toBe` 精确断言整句，不允许只用 `toContain` —— AGENTS.md 文本结构断言 MUST）

## 5. 既有契约反转与护栏

- [x] 5.1 `apps/desktop/tests/e2e/specs/account-login-state-tristate.js`：把「检测后：视频号降级为『未确认』而非『已登录』」改为「视频号保持『已登录』，且汇总提示含『未取到定论』」；文件头注释同步改写并注明**本条是 #2233 D3 的有意反转**及理由，避免后来者以为是被改坏的断言
- [x] 5.2 新增反向护栏（防回到假绿灯）：「从未有结论」（真源缺 status）且本轮无定论 → 仍显示「未确认」；「valid===false」→ 立即「已失效」。本机无 Playwright 浏览器时该规范由 CI 跑，本地须在 PR 说明里标注未实跑
- [ ] 5.3 `useExpiredAccountsBanner.test.js`：确认无定论不被计入失效横幅（既有契约保持）

## 6. 文档与门禁

- [x] 6.1 `01-docs/PRD-ACCOUNT-LOGIN-STATE-PERSISTENCE-2026-09-23.md`：§5 单一写者架构图补 `persistCheckResult` 一层；§7.1 批量补「无定论不改写 + statusChanged」；§7.5 定期检测把「结论与后端一致时不回写」升级为「无正/负证据时不回写 + 7 天超龄兜底」；§8.1 徽章语义表补「保持原状态」的成因说明
- [x] 6.2 `AGENTS.md` QM-2 新增条目：**登录态真源只被正向/负向证据改写；任何「检测不确定/异常」路径不得把 `active`/`expired` 降级为 `unverified`，新增无定论出口必须走 `loginStatusTransition` 并由其回归覆盖 6 行规则表**
- [x] 6.3 另案登记（本 change 不做）：`status_reason` / `last_login_check_at` 落库需 Python 侧 `AccountUpdateRequest` 加字段 + `_account_to_dict` 投影 + pytest 迁移语义，另开 change；本 change 在 PRD 指向该待办
- [x] 6.4 `CHANGELOG.md` 前插（与并发会话冲突则 rebase 时保留双方条目）、`01-docs/learnings.md` 记录不对称根因与「缺证据≠反证」教训、`.quality-gates.md` 执行记录（含 2.3 反证与三处映射收敛的前后 grep 证据）
- [x] 6.5 门禁：账号相关定向 vitest + `apps/desktop` 全量、`packages/python-backend` 全量 pytest（本轮若未碰 Python 则记录「未触碰」）、QM-1 离线打包 + asar 指纹、QM-6 双模型外部评审（状态机 + 持久化，必做）、PR 过 CI 后合并

## 落地差异与未完成项（如实记录，不事后粉饰）

- **2.4 的实现形态与计划不同**：计划写的是「新增 `persistCheckResult` 写者封装」，实际先实现后自查发现它只在「调用方不持有现状」时才多干活，等于把编排逻辑复制进 account-manager；于是删除该封装，改为**唯一纯函数 `loginStatusTransition` 下沉 shared-utils，三个调用点直接 import**（IPC 单账号入口自己 `readAccountSnapshot` 读现状）。规则仍然唯一，但入口不是原计划的那个。
- **3.4 已补（QM-6 收口轮）**：`account-manager-relogin-status.test.js` 增「单一口径结构锁」—— 断言 `loginStatusFromCheckResult` 与 `loginStatusTransition` 在 account-manager 导出面上均为 `undefined`。转发 shim 与被替代的映射一并删除，「固化路径不经规则函数」因此从「靠人不去调用」升级为「无处可调用」。
- **5.2 的形态**：反向护栏并进了 5.1 的 e2e fixture（新增 `acc-fresh` 从未有结论 + 无定论 → 仍「未确认」），未单独成条；且**本机无 Playwright 浏览器，该规范未实跑**，由 CI 的 Browser E2E 覆盖。
- **1.2 未做**：没有取「改动前」的全量红名单基线（只跑了受影响套件）。判定「是否本 PR 引入」时依赖的是 CI 与逐条比对，不是一条本地基线快照。
- **5.3 未改代码**：`useExpiredAccountsBanner.test.js` 只是随大集跑过、未回归，没有新增断言。
- **6.4 / 6.5 进行中**：`.quality-gates.md` 执行记录、全量回归、QM-1 打包、QM-6 双模型评审在提交本台账时点尚未收口，完成情况以 `.quality-gates.md` 最终记录为准。

## QM-6 评审收口（2026-09-26，评审意见逐条处置）

| # | 来源与结论 | 处置 |
|---|---|---|
| C1 | 模型 A Critical：无定论 + 现状已是 `unverified` 仍发 PATCH，伪造 `last_validated`、`statusChanged` 失真。症状成立 | **采纳（收窄）**：写者层只在「无新证据」时跳过。建议原案「`next === current` 一律跳过」被反例驳回，见 C1-R |
| C1-R | 自查反例：正向证据 + 现状已是 `active` 若被跳过，宽限期锚点冻结，常青账号 7 天后被自己的兜底降级 | 新增用例「批量：正向证据且现状已是 active → 仍须回写，宽限锚点不得冻结」，先实测它在 C1 原案下必红，再按收窄判据实现 |
| C2 | 模型 B（降级自审）：真源 GET 瞬时失败仍可能把既有 `active` 降级。**成立，且是本分支新代码开的第二扇门** | **采纳**：现状读不到 → 本轮不改写、`loginStatus` 回传 null；并把原先把 Bug 钉成契约的那条断言（「读不到 → 落 unverified」）反转为「读不到 → 不改写」 |
| W1 | 两模型一致：`loginStatusFromCheckResult` 仍是一份映射，公开出口固化旧语义 | **采纳**：删除该函数与同名转发 shim、2 处测试假实现、以及断言旧语义的用例；规则表迁到唯一真源层测 |
| W2 | 模型 A：`account-batch-check.test.js` 夹具不带 status，超时路径未验到状态语义 | **采纳**：新增「硬超时打在 status=active 的账号上 → 保持 active 且不写真源」，含进度广播的 loginStatus |
| I1 | 模型 A：`Accounts.vue` 的 `item.loginStatus || (valid 三元)` 会在展示层绕开规则 | **采纳**：改为只跟随 `loginStatus`，缺席即保持原徽章（C2 落地后更必要） |
| I2 | 模型 A：shared-utils 缺 `login-state.test.js` | **采纳**：新增 9 例（规则表 6 行 + `checkError` 与 `valid` 并存 + grace 非法值回落 + 纯函数不做 I/O + 导出面收口） |
| W3 | 模型 B：监控层 `online` 兼容与规则第 6 行不一致 | **不采纳（有据）**：`online` 属历史脏值，规则第 6 行刻意把它诚实落回 `unverified`；若从监控可检测白名单移除，这类账号永远拿不到新证据。已在 PRD §7.6 记为设计意图 |
| W4 | 模型 B：`last_validated` 字段名易被误读为「最近一次有效验证」 | **采纳为文档修**：PRD §3 字段语义改写为「最近一次状态定论写入时间」并写明后端创建也会写它；代码改名牵动后端契约与存量数据，不在本轮 |
| W5 | 模型 B：`statusChanged` 命名与「是否改写真源」语义有偏差 | **不采纳（有据）**：该字段两个消费方（`persistedCount`、`last_validated` 镜像刷新）要的正是「本轮有没有写」；改名牵动 preload/渲染/e2e/locale 四处而无行为收益。已在 PRD §7.6 与 AGENTS.md 写明口径 |
| 独立性 | 模型 B 的 `codeagent-wrapper.exe` 缺失，实为主代理自审 | 如实登记：本轮 **有效发现 10 条 / 独立模型 1 个**，不得记作「双模型交叉评审 PASS」 |
| S1 | 自查发现（非评审提出）：单账号「验证」把无定论冒充「已失效」并弹去登录 —— 与批量侧同一契约的漏项 | **采纳**：`Accounts.vue` 的 `checkLogin()` 按 `valid` 三值分叉，新增 locale 键 `accountsPage.loginUnconfirmed`（zh/en 成对）；同时修正 3 条按旧形状（超时 mock 成 `valid:false`、items 不带 `loginStatus`）的夹具，并新增「loginStatus 缺席保持原徽章」用例 |
