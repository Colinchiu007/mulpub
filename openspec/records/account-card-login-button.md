---
record: account-card-login-button
task: 账号卡片新增常驻「登录」按钮，并落定「已登录态点登录」的二次确认语义
date: 2026-10-24
---

## 本次执行记录：账号卡片「登录」按钮与已登录态重登语义（account-card-login-button，2026-10-24）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/src/**`）+ 文档 ⇒ 混合 PR，走完整质量节拍。隔离分支 `account-card-login-button`（裸分支名，不带 `team/` 前缀），本地检出 `git rev-parse --abbrev-ref HEAD` 实证。⚠️ 本次在沙箱内执行，`github.com` 直连被网关 TLS 中断（`gnutls_handshake() failed`），git 的 smart-HTTP 不可用 ⇒ 改走 `codeload` tarball 导入 main 快照（**树 SHA `b2a712018c682372ad89a1c558419965fc03205e` 与远端逐字节一致**）+ Git Data API 推分支；推完逐步回读校验（blob SHA / tree SHA / commit parent 三处对账，见「推分支的可核验路径」） |
| 第一性原因（QM-5 ①） | ✅ | 本次是**新增功能**（不是修 Bug），但连带两处既有缺陷，第一性引入点都指向**同一个设计选择**：把「本会话已确认失效」的集合 `checkedExpiredIds` 同时当作**状态载体**和**按钮可见性开关**。①`Accounts.vue` 的 `reloginAccount` 在 `result.cancelled` 分支执行 `checkedExpiredIds.value.delete(account.id)`（改动前的 `Accounts.vue:906-908`）—— 它的**唯一界面用途**是让条件式「去登录」按钮消失，语义上却是「账号恢复登录了」；②重新登录成功后无人清理该集合。这两条不是"顺手发现的 bug"，是「一个集合承担了两种语义」必然长出来的分叉 |
| 逃逸分析（QM-5 ②） | ✅ | ①**单测层**：`Accounts.test.js` 的 checkLogin 用例只断言「检测失效后 `checkedExpiredIds` 里有该 id」，**从不断言重新登录成功后它还在不在** —— D-A 落在断言的盲区里。②**语义层**：D-B 那行 `delete` 当初是为了「取消后按钮不再出现」，看起来完全合理（按钮确实消失了），没人追问「账号到底恢复没有」—— 典型的**行为合理但语义错误**。③**e2e 层**：`account-login-state-tristate.js` 只断言徽章三态与「未确认账号不出现登录按钮」，全程不涉及「重新登录之后集合怎么变」 |
| 系统性漏洞（QM-5 ③） | ✅ | **测试与实现共享同一个错误假设**：整个账号页把 `checkedExpiredIds` 当成「失效账号名单」而不是「会话级失效结论」。于是「取消重登」被自然理解成「不再是失效账号」，而真相是「用户没登录，账号仍然失效」。这个假设同时污染了**三处**代码（`checkLogin` / `batchCheckAllLogins` / `reloginAccount`），也污染了**两处**测试的写法（只断言 add、不断言 delete 的时机） |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①**集合语义收口并写死**：`checkedExpiredIds` = 「本会话内已确认该账号登录态失效」；增 = 检测确认失效；删 = **仅**重新登录成功。D-B 修复 = 取消分支不再删除；D-A 修复 = `onCompleted` 收到 `accountId` 时删除。②**判据单一真源**：新增 `utils/account-status.js` 的 `needsReloginConfirmation`（与 `accountStatusKind` 同文件）+ `lastLoginCheckAt`（把「最近检测时间」的字段名清单从卡片收到 util，避免第二份漂移），并配**结构锁**（全仓只允许一处实现）③**新 composable**：`features/accounts/composables/useReloginGuard.js` 收编「重新登录」的门禁与执行，**新增单测 8 例**。④**变异反证**（见下行） |
| 防止再次发生（QM-5 ⑤） | ✅ | ①`account-status.js` 的两个新函数各配**结构锁**用例（`/function needsReloginConfirmation\s*\(/` 全仓只命中一个文件），从机制上挡住"第二份实现"；②`useReloginGuard.js` 头注释写明「集合纪律」三条（增/删/取消≠恢复）并指向 D-A / D-B 的事故链；③PRD §4 专章记录两处缺陷的现象/根因/修法/为什么必须本次修；④`AccountManagementCard.test.js` 新增**位置契约锁**（操作条按钮清单精确等于 设置/验证/登录/删除 四个），把「登录在验证右侧」这条需求变成可机械核对的断言，而不是靠人眼看 |
| 变异反证 | ✅ | 逐条撤掉四处修复，确认对应用例**指名变红**（不是"整体变红"）：①`needsReloginConfirmation` 恒 `false` ⇒ **5 条**红；②撤掉 D-A 的删除 ⇒ **1 条**红；③在 composable 的「登录页被关闭」分支加回删除 ⇒ **2 条**红；④卡片按钮加回 `v-if="false"` ⇒ **5 条**红。全部还原后复跑 `187 passed | 1 skipped (188)` |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 逐字一致（`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat`）：`01-docs/PRD.md` +104/-0、`AccountManagementCard.vue` +13/-12、`account-status.js` +51/-0、`Accounts.vue` +10/-22、`useReloginGuard.js` +92/-0（新）、`useReloginGuard.test.js` +166/-0（新）、四个 locale/测试文件逐条一致。⚠️ 删除数归因：`Accounts.vue` 的 -22 = 搬走的 `reloginAccount` 实现（21）+ 移除的 `:checked-expired-ids` 绑定（1）；卡片 -12 = 被替换的条件式「去登录」按钮块（11）+ prop 定义（1） |
| 接线棘轮 | ✅ | 新增测试文件 `apps/desktop/src/features/accounts/composables/useReloginGuard.test.js` 位于 `apps/` 下 ⇒ 属 `scripts/check-unwired-tests.js` 的 `WORKSPACE_COVERED`（vitest 按 workspace 自动收集）⇒ **不需要**在 workflow 里点名。实测 `node scripts/check-unwired-tests.js` 通过 |
| 逐文件行数门禁（`check-max-lines`） | ✅ | **本轮被门禁当场抓过一次并按正解处置**：`Accounts.vue` 在 `targets`（点名还账清单，目标 1578 行）里，**零增长容差**；第一版实现把确认逻辑直接写进该文件（净增 32 行）⇒ 门禁报 `TARGET_GREW: 现 1610 行已超过点名目标 1578 行（超 32）`。**没有上调 `targets`**（那是「改谁来守门」，须人工过目），而是把「重新登录」抽成 `useReloginGuard.js` ⇒ `Accounts.vue` 反而**净减 12 行**（1577 → 1565）。最终 `node .github/scripts/check-max-lines.js` = ✅，其自测 `36/36` 绿（第一版是 34/36，2 条红） |
| QM-1 打包 / QM-4 视觉 | ✅ / N/A（附说明） | QM-1：改动全在渲染层（Vue + locale），无主进程/预加载面变更 ⇒ 以 `pnpm run build:vue` 全量构建通过（`✓ built in 1m 9s`，`BUILD_RC=0`）作为编译面证据；未跑 `build:dir` 整包（需 electron 二进制，本沙箱 `--ignore-scripts` 未下载）。QM-4：视觉面**无基线影响** —— 账号页在浏览器视觉环境里 `window.electronAPI` 不可用 ⇒ 账号列表加载失败 ⇒ **账号卡片组件根本不挂载** ⇒ `accounts-list` / `accounts-list-flag-on` 的像素基线不受本次改动影响（`run-pixel-tests.js` 的 `accounts-list` 等的是 `.mp-workspace .accounts-page` 容器，不是卡片）。CI 的 QG Visual 仍是权威判据 |
| ESLint | ✅ | `npx eslint` 覆盖本次改动的 8 个既有文件：**0 error**（11 个 warning 全部为存量：`AccountManagementCard.vue` 的 `Refresh`/`isActive`、Accounts.vue 的 7 个未用变量，改动前即存在；CI 门禁用 `--quiet` 只看 error） |
| 前端回归 | ✅ | 逐文件实跑（`vitest run`，本沙箱内存受限故单文件串行）：`Accounts.test.js` 119/119、`AccountsBatchCheck.test.js` 绿、`account-status.test.js` 16/16、`AccountManagementCard.test.js` 45（44 通过 + 1 存量 skip）、`useReloginGuard.test.js` 8/8 ⇒ 合计 `187 passed | 1 skipped (188)` |
| CI 门禁清单本地全跑 | ✅ | 从 `.github/workflows/*.yml` 抽出 **182 条**门禁命令逐条本地实跑（`node --test` / `node scripts/…` / `bash scripts/…`），失败项一律做 **origin/main 对照实验**（`git worktree add /tmp/pristine-main origin/main`，树 SHA 与远端 main 逐字节一致）判定归属 |
| 基线对照（存量失败） | ✅ | 对照实验判定：`check-max-lines.test.js` 在 origin/main 上 36/36 绿、在第一版分支上 34/36（2 条红）⇒ **是本分支引入**，已按 §「逐文件行数门禁」正解处置，复跑 36/36 绿。另一条失败（`check-hardcoded-secrets` + `workflow-contract` + `gate-budget` 等 8 文件合跑）在 origin/main 上同样红 ⇒ **主干存量**，与本次改动无关 |
| QM-6 CCG 双模型外部评审 | ⚠️ 未执行（如实记录） | 本沙箱**无 `codeagent-wrapper`**、无 `~/.claude/.ccg/config.toml`、评审驱动在仓外 ⇒ 无法执行双模型外部评审。**不以内部自审冒充通过**。替代证据：①变异反证 4 处（§变异反证）；②独立复核会话逐条回源码核对断言（见复核结论）；③自审六项（异常处理 / 权限边界 / 事务一致性 / 边界值 / 代码风格 / Demo 代码）。本仓 `check-pr-exec-record.js` 对本变更集的 `mode=dual` 产物走**收口矩阵**：本次变更集**未命中** `HIGH_RISK_SURFACES`（未改凭证加解密 / 登录态串行锁 / 云端账号校验 / 判据自指面 / workflow），按非高危面出口以含轮次标记与逐条处置结论的 `closureNote` 收口。⚠️ 该结论**不等于「QM-6 已闭合」**（CI 侧该判据仍以 `--mode=advisory` 运行） |
| 独立复核 | ✅ | 派独立会话逐条回源码核对本 PRD 与实现的断言（不看我的推理过程），结论：4 条 P1 + 6 条 P2 + 3 条 P3，**全部处置完毕**（详见下方「独立复核的发现与处置」）。复核方独立指出的关键一条：**「已登录时点登录」的结论必须建立在「重新登录=干净会话+覆盖凭证」这两个事实上，而不是直觉** —— 回源码核对 `auth-login-slot.js`（开局清槽位凭证）与 `account-manager.js:updateCapturedAccount`（成功后覆盖）后确认成立 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）。合并前把状态列写成 `PASS` 会被判「预写不存在的证据」而红。旧载体 `.quality-gates.md` 与 `scripts/gate-record-debt-ledger.json` 按「旧载体冻结」政策**零改写**；`CHANGELOG.md` 按 `changelog-record-carrier` 合同**零改动**（台账搬运由 `scripts/aggregate-changelog.js` 统一做） |

- 保留门禁：判定 docs-only=false（混合 PR：`apps/desktop/src/**` + `01-docs/**`）| 行尾对账 ✅（两口径 numstat 逐字一致）| 品牌残留 ✅（`check-no-brand-residue.js` 随 182 条清单本地跑过）| 文档同步 ✅（新增专项 PRD + `01-docs/PRD.md` 专章 + 本执行记录）| 执行记录 ✅ 本文件 | 远程同步 由门禁推导

### 独立复核的发现与处置

| # | 级别 | 复核发现 | 处置 |
|---|---|---|---|
| R1 | P1 | 「已登录时点登录」若按直觉设计成"直接重登"，会覆盖一条**可用**的会话；必须先确认 | ✅ 采纳：新增 `needsReloginConfirmation` + 二次确认框（PRD §3.2 逐条排除 A/B/C 三个替代方案） |
| R2 | P1 | 重新登录成功**不清**失效集合 ⇒ 用户刚登录成功却打不开后台（D-A） | ✅ 采纳：`onCompleted` 删除 + 1 条专属用例 |
| R3 | P1 | 取消重新登录**误清**失效集合 ⇒ 失效账号带旧凭证进平台，撞 2026-09-16「二维码加载失败」事故（D-B） | ✅ 采纳：取消分支不再删除 + 2 条用例 |
| R4 | P1 | 「登录」按钮常驻后，条件式「去登录」若并存 = 同卡片两个同义按钮 | ✅ 采纳：移除条件式按钮，改用常驻「登录」+ 位置契约锁 |
| R5 | P2 | 「最近检测时间」的字段名清单若在卡片与账号页各写一份 ⇒ 漂移 | ✅ 采纳：下沉到 `account-status.js` 的 `lastLoginCheckAt` |
| R6 | P2 | `needsReloginConfirmation` 会有第二份实现 | ✅ 采纳：结构锁用例（与 `accountStatusKind` 同款） |
| R7 | P2 | `Accounts.vue` 净增会撞逐文件行数门禁的「点名还账」零容差 | ✅ 采纳：抽 `useReloginGuard.js`，该文件净减 12 行（**不抬基线**） |
| R8 | P2 | 「已登录」结论可能陈旧，确认框若不带检测时间会把用户挡在修复之外 | ✅ 采纳：确认框带「最近检测」段；无检测记录时**不编造**时间（有专门用例） |
| R9 | P2 | locale 的 zh/en key 集合必须一致 | ✅ 采纳：两个 locale 同时改（`login` / `loginTitle` / `reloginConfirmTitle` / `reloginConfirmMessage` / `reloginConfirmAction`），删 `accountCardLabels.goLogin` |
| R10 | P2 | e2e 那条「未确认账号不提供登录入口」的断言编码的是旧契约 | ✅ 采纳：改判「按钮常驻 + 徽章仍是未确认（按钮出现 ≠ 判为失效）」 |
| R11 | P3 | 停用账号（`is_active=false`）点登录 | ✅ 明确口径：停用只影响发布资格，不禁用登录按钮（PRD §8） |
| R12 | P3 | 「批量登录」「登录后自动重跑验证」是否要做 | ✅ 明确排除并写进 PRD §7「不做什么」 |
| R13 | P3 | 文档的绝对路径字面量会撞 `check-doc-abs-paths` | ✅ 本记录与 PRD 只写形态与行号，不复制本机路径字面量 |

### 推分支的可核验路径（本沙箱 github.com 直连不可用时的做法）

1. `codeload` tarball 导入 main 快照 ⇒ 本地 `git write-tree` = `b2a712018c682372ad89a1c558419965fc03205e` = 远端 main 的 tree SHA（**逐字节一致**，不是"大概一样"）。
   ⚠️ 落地这一步时踩了两个坑：①`git add -A` 会**跳过「上游已跟踪但命中 .gitignore」的 1346 个文件**（`git add -A -f` 会连 `node_modules` 一起加进来）⇒ 正解是「先普通 add，再按远端 tree 差集逐个 `git add -f`」；②`pnpm config set --location project` 会**重写 `pnpm-workspace.yaml`**（pnpm 重新序列化 YAML，注释缩进都变）⇒ 提交前必须 `git diff -- pnpm-workspace.yaml` 确认零改动。
2. Git Data API 推分支，每步回读对账：上传的 **blob SHA 必须等于本地 `git rev-parse`**；生成的 **tree SHA 必须等于本地 `HEAD^{tree}`**；**commit 的 parent 固定为远端 main 的真实 commit SHA**（不是本地快照 commit）。任一不符即中止。

### 变更清单

| 文件 | 变更 |
|---|---|
| `apps/desktop/src/features/accounts/components/AccountManagementCard.vue` | 条件式「去登录」按钮 → **常驻**「登录」按钮（位置在「验证」右侧、「删除」左侧）；移除 `checkedExpiredIds` prop；「最近检测」时间解析改走 util |
| `apps/desktop/src/features/accounts/composables/useReloginGuard.js`（新增） | 「重新登录」的门禁（`confirmRelogin`）与执行（`reloginAccount`）+ 集合纪律注释 |
| `apps/desktop/src/features/accounts/composables/useReloginGuard.test.js`（新增） | 8 例：确认框出/不出、文案四要素、无检测记录不编造时间、两种「取消」语义、确认后进链路、失效态不打扰、平台缺失不请求 |
| `apps/desktop/src/utils/account-status.js` | 新增 `lastLoginCheckAt`（字段名清单收口）+ `needsReloginConfirmation`（重登是否需二次确认） |
| `apps/desktop/src/views/Accounts.vue` | 本地 `reloginAccount` 移出（-21）；`onCompleted` 增删失效集合（D-A）；移除 `:checked-expired-ids` 绑定；挂 `useReloginGuard`（**净减 12 行**） |
| `apps/desktop/src/locales/accounts-page/zh.js` / `en.js` | 卡片按钮文案 `login` / `loginTitle`；确认框 `reloginConfirmTitle` / `reloginConfirmMessage` / `reloginConfirmAction`；删 `accountCardLabels.goLogin` |
| `apps/desktop/src/features/accounts/components/AccountManagementCard.test.js` | 断言改写为「登录按钮常驻」+ 新增位置契约锁 |
| `apps/desktop/src/utils/account-status.test.js` | 新增 `needsReloginConfirmation` 5 态矩阵 + 结构锁；`lastLoginCheckAt` 取值/非法值 |
| `apps/desktop/src/views/Accounts.test.js` | 新增 5 例（确认/取消/失效直进/D-A/D-B） |
| `apps/desktop/tests/e2e/specs/account-login-state-tristate.js` | 断言改判「按钮常驻 + 徽章仍未确认」 |
| `01-docs/PRD-ACCOUNT-CARD-LOGIN-BUTTON-2026-10-24.md`（新增） | 专项 PRD：现状取证、四个候选方案逐条排除、状态分派表、两处连带缺陷、变更清单、验收标准、风险取舍、变异验证 |
| `01-docs/PRD.md` | 新增专章《账号卡片「登录」按钮与已登录态重登语义（2026-10-24，account-card-login-button）》并指向专项 PRD |

未改动：主进程（`apps/desktop/electron/**`）、preload 暴露面、IPC 通道、账号存储 schema、平台 URL 表、登录槽位实现、`CHANGELOG.md`（聚合器专属写面）、`.quality-gates.md` 与 `scripts/gate-record-debt-ledger.json`（旧载体冻结，零改写）。

### 遗留（不假装已闭合）

1. **QM-6 双模型外部评审未执行**（本沙箱无 `codeagent-wrapper` 与仓外评审驱动）。替代证据是变异反证 + 独立复核 + 自审六项，**强度低于双模型交叉审查**。若后续在有评审驱动的环境接手本 change，建议补跑一次 `scripts/deep-review.sh`。
2. **QM-1 整包未跑**（`build:dir` 需 electron 二进制，本沙箱 `pnpm install --ignore-scripts` 未下载）。已用 `build:vue` 覆盖编译面；本变更不触碰主进程/预加载面，整包风险低但**未实测**。
3. **视觉回归未本地实跑**（需 Playwright + Chromium）。判定「无基线影响」的理由是**账号卡片在浏览器视觉环境里根本不挂载**（`window.electronAPI` 不可用 ⇒ 列表加载失败），但这是**读码推断**，不是实跑读数；CI 的 QG Visual 是权威判据。
4. **`batchCheckAllLogins` 的 unconfirmed 分支仍会删失效集合**（本次刻意未动）。兜底由本地 `account.status` 承担（该分支把主进程回传的 `keptStatus` 写回本地 status）。若将来「keptStatus 读不到」（`item.loginStatus` 为空），失效账号会短暂失去干净会话保护 —— 与本次改动**无因果关系**（该路径不在「登录」链路上），但值得单独立项。
5. **「已登录」结论的时效性**没有机制化（`status=active` 可能来自很久以前）。本次靠确认框展示「最近检测时间」让用户自行判断。彻底解法是给 `status` 加宽限期降级（仓内 `account-manager.js` 的「active 超过宽限期仍无定论则降级」策略只对**批量检测**生效，单条检测不触发）—— 属独立议题。

## CHANGELOG 条目

# feat(账号页): 账号卡片新增常驻「登录」按钮，已登录时先确认再覆盖凭证（account-card-login-button）

- 账号管理页每张卡片底部常驻一个「登录」按钮（排在「验证」右侧）：原来只有「本会话刚判定失效」的账号才看得到「去登录」，导致「已失效但还没点过验证」以及「显示已登录但实际已掉线」的账号在用户主动检测之前没有自救入口。
- 「登录」= 重建会话（打开平台登录页，登录成功后覆盖现有凭证），与「验证」（只查状态）正交。想用现有会话去平台请点卡片主体。
- 账号当前显示「已登录」时点「登录」会先弹一次确认（附最近检测时间），其余状态（已失效 / 未确认 / 异常 / 无检查记录）直接进登录链路，不打扰。
- 顺带修掉两处既有缺陷：重新登录成功后账号不再被误判为失效（否则刚登录成功却打不开自己的后台）；取消重新登录不再误清失效标记（否则失效账号会带着旧凭证进平台页，撞上「二维码加载失败」）。

## learnings

### lesson: 条件式按钮把状态集合变成了可见性开关，两种语义必然分叉（account-card-login-button）

**现场**：账号页的「去登录」按钮用 `v-if="checkedExpiredIds?.has?.(account.id)"` 控制显示，而 `checkedExpiredIds` 同时是「本会话已确认该账号登录态失效」的集合。于是同一份数据被迫承担两种语义：①「这个账号失效了吗」（状态）；②「该不该给用户看这个按钮」（可见性）。分叉长在两处 —— 取消重新登录时执行 `checkedExpiredIds.delete(id)`（为了让按钮消失，语义却是「账号恢复登录了」），以及重新登录成功后没人清理它（语义是「失效结论已作废」）。前者让失效账号带旧凭证进平台页撞上 2026-09-16 公众号「二维码加载失败」；后者让用户刚登录成功却看到登录页。

**根因**：**一个集合只能有一种语义。** 当它同时被 UI 可见性读取和状态判定读取时，「为了界面效果改一下集合」就会悄悄改掉状态判定 —— 而且因为界面上确实变对了，代码评审与测试都看不出问题：测试只断言了「失效后集合里有它」，从不断言「重新登录之后它还在不在」。

**可复用的 N 条**：

1. 任何「本会话缓存 / 临时集合」被 UI 可见性条件读取时，先问一句：**它到底是状态还是开关？** 想让按钮消失有两条路 —— 改按钮的显示条件，或者引入一个独立的、纯展示用的派生量。**不要**让状态集合兼任开关。
2. 「取消一个动作」≠「动作的目标状态达成」。取消重新登录 = 用户没登录 = **原状态不变**。凡是「取消分支里改状态集合」的代码，都该被当成 bug 候选看一眼。
3. 动作**成功**后必须显式作废它产生的中间状态。成功路径不清理 ⇒ 中间状态泄漏到后续流程（本例是「失效结论」泄漏成「打开平台页要干净会话」）。
4. 这类缺陷的测试盲区有固定形状：**只断言 add 不断言 delete**。写「集合型状态」的用例时，必须成对覆盖「什么时候加」与「什么时候减」，并且「减」的时机要单独断。
5. 反模式自检：把同一个集合既喂给 `v-if` 又喂给业务判据，就是分叉的预告片。
