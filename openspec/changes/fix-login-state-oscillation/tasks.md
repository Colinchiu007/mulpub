## 1. 前置确认（不动代码）

- [ ] 1.1 确认基线含 `1f77a4a9`（#2401 新建账号固化 active）；不含则以该提交为基线重开 —— 本 change 的「无定论不改写」必须与「凭证落盘即固化」同时成立，缺一侧都会留下新漏洞
- [ ] 1.2 取改动前红名单：`cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run`（本机 `feedback.test.js` symlink EPERM 为既有基线）；`cd packages/python-backend && pytest -q` 同理。留存供后续判定「是否本 PR 引入」
- [ ] 1.3 只读核实全仓「三态 → status」映射只有三处（`account-manager.loginStatusFromCheckResult`、`ipc-handlers/account.js:loginStatusFromCheck`、`login-status-monitor.js:_loginStatusOf`），把 grep 结果写进本目录备注；若发现第四处，纳入 2.x 一起收敛

## 2. 单向证据规则：纯函数（TDD）

- [ ] 2.1 RED：新建 `apps/desktop/electron/publishers/account-manager-login-state-transition.test.js`，按 proposal 规则表逐条断言（6 行全覆盖），关键三条必须精确：① 无定论 + `currentStatus='active'` 且 `lastValidated` 在 grace 内 → 返回 `null`；② 无定论 + `active` 且 `now - lastValidated > graceMs` → 返回 `'unverified'`；③ 无定论 + `currentStatus='expired'` → 返回 `null`（不得翻案）。另加 `lastValidated` 缺失/非法字符串、`graceMs` 边界（恰好等于）、`checkError` 与 `valid===undefined` 两条入口等价 四类边界。实测确认全部变红
- [ ] 2.2 GREEN：实现 `loginStatusTransition({ result, checkError, currentStatus, lastValidated, nowMs, graceMs })`，`DEFAULT_GRACE_DAYS = 7`，`graceMs` 支持 `MP_LOGIN_STATE_GRACE_DAYS` 覆盖（非正数回落默认）。**函数内不得读环境变量以外的全局状态、不得有 I/O**（保证可测）
- [ ] 2.3 反证（断言必须有鉴别力）：临时把 `active + 无定论` 分支改成恒返回 `'unverified'` → 2.1 ①必须立刻变红；再改成恒返回 `null` → 2.1 ②必须变红。两次反证结果与红线截图/日志记入 `.quality-gates.md`
- [ ] 2.4 实现 `persistCheckResult({ accountId, platform, result, checkError, currentStatus, lastValidated })`：内部复用 `loginStatusTransition` → 需要读真源时按需 `GET /api/accounts/:id`（**仅无定论分支**）→ 需要写时才 `PATCH`；返回 `{ ok, status|null, changed, reason }`。异常不外抛（与 `persistLoginState` 同口径）

## 3. 三处调用点收敛（TDD）

- [ ] 3.1 RED：`ipc-handlers/account.test.js` 新增 —— ① `account:check-login` 返回无定论且真源为 `active`（在 grace 内）时**不发 PATCH**，结果 `statusChanged === false`；② 返回 `valid === false` 时照旧发 `expired`；③ 检测抛异常（`checkError`）不再无条件写 `unverified`。`account-batch-check.test.js` 同步：硬超时账号（`CHECK_LOGIN_TIMEOUT`）在真源为 `active` 时保持原状并把「超时」如实记入 `code`
- [ ] 3.2 GREEN：改造 `account.js:533` / `:610` 两处改调 `persistCheckResult`；删除 `loginStatusFromCheck` 本地映射，改为「`AccountManager.persistCheckResult` 缺失时」的兜底路径，且兜底必须与规则表逐条一致（防止再长出第二份口径）
- [ ] 3.3 `login-status-monitor.test.js` RED→GREEN：① 无定论 + `active`（grace 内）→ 不回写、不广播、`last_validated` 不变；② 无定论 + `active` 超龄 → 回写 `unverified` 并广播；③ 无定论 + `expired` → 不回写（与 `:75` 既有注释一致）；④ 假时钟推进到 grace 边界**一次**并断言每个端点各被请求一次（防退化为串行/重复写）
- [ ] 3.4 核对 `saveCapturedAccount` / `updateCapturedAccount` 的 `active` 固化**不受本规则影响**（那是正向证据 + 主动登录，直写 `persistLoginState`，不经 `loginStatusTransition`），补一条断言锁死这条边界，避免日后把「登录」也接进规则函数造成双门

## 4. 渲染层与文案（locale 成对）

- [ ] 4.1 `Accounts.vue`：`batchCheckAll` 计数区分 `失效(valid===false)` / `本轮未定论(valid===undefined)`；`checkedExpiredIds` 口径不变（无定论不进失效集合，不显示「去登录」）；对 `statusChanged === false` 的账号**不得**用返回结果覆盖本地已展示状态（避免闪烁）
- [ ] 4.2 `src/locales/zh.js` 与 `en.js` 成对新增/改写 `batchCheckAllDone` 的未定论段文案（「N 个未取到定论（保持原状态）」/ "N unresolved (status kept)"），跑 `node .github/scripts/check-locale-sync.js --pair-base HEAD` 必须 PASS
- [ ] 4.3 `Accounts.test.js`：断言汇总提示在三态混合下的完整字符串（用 `toBe` 精确断言整句，不允许只用 `toContain` —— AGENTS.md 文本结构断言 MUST）

## 5. 既有契约反转与护栏

- [ ] 5.1 `apps/desktop/tests/e2e/specs/account-login-state-tristate.js`：把「检测后：视频号降级为『未确认』而非『已登录』」改为「视频号保持『已登录』，且汇总提示含『未取到定论』」；文件头注释同步改写并注明**本条是 #2233 D3 的有意反转**及理由，避免后来者以为是被改坏的断言
- [ ] 5.2 新增反向护栏（防回到假绿灯）：「从未有结论」（真源缺 status）且本轮无定论 → 仍显示「未确认」；「valid===false」→ 立即「已失效」。本机无 Playwright 浏览器时该规范由 CI 跑，本地须在 PR 说明里标注未实跑
- [ ] 5.3 `useExpiredAccountsBanner.test.js`：确认无定论不被计入失效横幅（既有契约保持）

## 6. 文档与门禁

- [ ] 6.1 `01-docs/PRD-ACCOUNT-LOGIN-STATE-PERSISTENCE-2026-09-23.md`：§5 单一写者架构图补 `persistCheckResult` 一层；§7.1 批量补「无定论不改写 + statusChanged」；§7.5 定期检测把「结论与后端一致时不回写」升级为「无正/负证据时不回写 + 7 天超龄兜底」；§8.1 徽章语义表补「保持原状态」的成因说明
- [ ] 6.2 `AGENTS.md` QM-2 新增条目：**登录态真源只被正向/负向证据改写；任何「检测不确定/异常」路径不得把 `active`/`expired` 降级为 `unverified`，新增无定论出口必须走 `loginStatusTransition` 并由其回归覆盖 6 行规则表**
- [ ] 6.3 另案登记（本 change 不做）：`status_reason` / `last_login_check_at` 落库需 Python 侧 `AccountUpdateRequest` 加字段 + `_account_to_dict` 投影 + pytest 迁移语义，另开 change；本 change 在 PRD 指向该待办
- [ ] 6.4 `CHANGELOG.md` 前插（与并发会话冲突则 rebase 时保留双方条目）、`01-docs/learnings.md` 记录不对称根因与「缺证据≠反证」教训、`.quality-gates.md` 执行记录（含 2.3 反证与三处映射收敛的前后 grep 证据）
- [ ] 6.5 门禁：账号相关定向 vitest + `apps/desktop` 全量、`packages/python-backend` 全量 pytest（本轮若未碰 Python 则记录「未触碰」）、QM-1 离线打包 + asar 指纹、QM-6 双模型外部评审（状态机 + 持久化，必做）、PR 过 CI 后合并
