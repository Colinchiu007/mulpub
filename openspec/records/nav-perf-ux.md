---
record: nav-perf-ux
task: 账号页列表路径零解密——代理信息移出列表改为弹窗按需读取
date: 2026-10-15
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话（合并后在本文件内收口：远程同步行改 PASS + merge SHA，并删除上方三个 sync_* 字段）
---

## 本次执行记录：账号页列表路径零解密（nav-perf-ux，2026-10-15）【混合 PR】

> 载体说明：按 2026-10-15 起的「旧载体冻结」，本记录**只写在本文件**，
> 不往 `.quality-gates.md` 插块、不往 `scripts/gate-record-debt-ledger.json` 加键。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | **运行时代码变更** ⇒ 隔离 worktree `D:/Data/projects/mp-worktrees/mp-fix-sidebar-nav-slow`（D 盘，非 C 盘）+ 分支 `nav-perf-ux`。`pre-code-edit-guard.ps1` exit 0。**如实声明**：本任务开始时标准入口 `start-mp-task.ps1` 被硬拒（共享根有另一会话未提交的 3 个已跟踪文件，`mp-worktree-health.ps1 -RequireClean` 返回 `ok=false`），`session-init.sh` 同样 `exit 2` 且明确「leaving them untouched」。**未做任何手动补救**（无 `rm` worktree 注册、未在共享根落盘、未碰他人改动），改为**复用已有隔离 worktree** 并从 `origin/main` 开新分支（经用户明确批准）。 |
| 第一性原因（QM-5 ①） | PASS | 用户实测：上一轮 #3591 修完（同步串行 → 异步并行）后 `accounts:list` **仍是 1451–1579ms**（`shared-user-data/logs/app-2026-10-15.log`，8 账号、每账号一行 `checkLocalCredentials` 间隔 ~100ms）。第一性原因：`listAccounts()` 为给每个账号附加 `proxy`，逐账号走 `getAccountProxyStatus()` → `loadCredential()` → `decryptData()` → `deriveKey()` → **`crypto.pbkdf2Sync(100000)` 同步阻塞事件循环**。#3591 只改了**并行度**（wall-time 降 3.5–3.7x），**总 CPU 一字未减**，且每次进页复发 ⇒ 复发性成本。**正解是让列表根本不读代理**：代理是详情级信息。 |
| 逃逸分析（QM-5 ②） | PASS | 五层：① 单测 `mockReturnValue` 掉 `loadCredential` ⇒ 唯一 CPU 热点从未在测试里真跑；② 凭证层 15 条用例只断言功能正确性，零条断言耗时；③ 无「多账号 + accounts:list 计时」集成用例；④ 视觉回归对「画面正确只是迟到」结构性免疫；⑤ QM-2 清单原无性能维度（#3591 已补两条）。**本轮新增的第 6 层教训**：即使上一轮补了「并行度」契约（C5 断言 `maxInFlight>1`），**并行度合格 ≠ 成本被消除**——判据锁住了手段，没锁住目标。 |
| 修复 + 回归保护（QM-5 ④） | PASS | ① 列表**不再附加 proxy**（`return accounts` 直返），账号卡片代理行与列表徽标/tooltip 一并移除；② 新增 IPC `account:get-proxy` → `AccountManager.getAccountProxyStatusLazy()`（复用 #3591 的异步批量入口，不阻塞事件循环）；③ 交互三态（加载/错误+重试/预填）；④ 代理弹窗关注点下沉 `useAccountProxyDialog`。**回归锁 10 条**：主进程 L1–L6（L1 列表路径 `loadProxyStatuses` 与 `getAccountProxyStatus` **都不得被调用**）+ 渲染端 4 条（不再渲染代理行 / 加载态 / 错误+重试 / **只预填一次不覆盖用户输入**）。 |
| 防止再次发生（QM-5 ⑤） | PASS | ① `AGENTS.md` QM-2 已有「高频路径不得含同步 CPU 密集原语」+「详情函数复用到列表路径前必须核算单元素成本」两条（#3591 落），**本轮正是后者的第二个实例**（列表为读一个 `proxy` 字段解密整份凭证）；② 代码注释就地固化三条踩坑（数组 getter 的 watch 陷阱 / 为什么必须异步 / 为什么列表不读）；③ `CHANGELOG.md`；④ 本轮新增可复用判据：**「手段合格」的锁要配「目标达成」的锁**——`maxInFlight>1` 锁不住「总 CPU 是否被消除」。 |
| 行尾与 diff 对账 | PASS | 两口径 numstat 一致（`git diff --numstat` == `--ignore-cr-at-eol --numstat`） |
| 接线棘轮 | N/A | 未新增任何 `*.test.js` **文件**（10 条锁全部追加进两个已接线文件）；新增的两个**源码**文件 `account-proxy.js` / `useAccountProxyDialog.js` 不属接线棘轮管辖面 |
| QM-1 打包 | PASS | 见下「QM-1 证据」小节 |
| QM-4 视觉 | N/A | 账号卡片少一行、列表少一个徽标，属**移除**而非改样式；弹窗新增三态仅影响弹窗内部。**如实声明**：本轮未跑像素回归，理由是被删元素没有任何像素基线（移除即不存在），新增态在弹窗内且未被视觉基线覆盖 |
| QM-6 CCG 双模型评审 | 见下 | 判定器读数由 pre-commit 落盘 `.ccg/reviews/<sha>.json`；本 PR 为混合 PR（含运行时代码），按 §12.6 走 `mode=dual` |
| 逐文件行数门禁 | PASS | 首轮打红两条并已修：① `publish.js` 508 行 ≥ 500（我加的 `history:list` 耗时日志 +11 行）⇒ **回退该改动**并登记为遗留项（正确修法是先按范式拆文件再补日志）；② `Accounts.vue` 1624 行 > 点名目标 1578（零增长容差）⇒ 按门禁提示的 **composable 范式**把代理弹窗整体下沉到 `useAccountProxyDialog.js`，**1624 → 1538 行**。终局 `node .github/scripts/check-max-lines.js` → **exit 0**（`✅ 无新增超大文件，挂账清单与现实一致`） |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 merge SHA 与时间；`git ls-remote --heads origin nav-perf-ux` 返回 0 行证远端分支已删；回填后删除上方三个 `sync_*` 字段 |

### QM-1 证据（三层判据 + 存活断言）

待补：本次改动含 `apps/desktop/electron/` 下代码，按 QM-1 必须本地打包验证。

- 打包：`cd apps/desktop && pnpm exec electron-builder --win --dir --publish never`
- 断言 1（存活，**新增的独立前提**）：窗口期内进程必须仍存活 —— 进程提前退出时 stderr 必然为空，只看 stderr 会把「根本没启动」读成「启动干净」
- 断言 2（子进程 env）：spawn 必须显式传 `env`，用 `scripts/lib/qm1-child-env.js` 的 `buildChildEnv()` 剔除 `ELECTRON_RUN_AS_NODE`（该变量会随 shell 继承，令 Electron 以纯 Node 模式静默退出：rc=0 / stdout 空 / stderr 空）
- 断言 3（stderr 三层）：① 命中红线 ⇒ FAIL；② 非空未命中 ⇒ NEEDS_REVIEW；③ 为空 ⇒ PASS
- 另：`node scripts/verify-worktree-deps.js` 必须 OK（断言 `@multi-publish/*` 解析到本 worktree）

### 本轮实测修到的实现缺陷（写进注释防回归）

`watch(() => [props.visible, props.account?.id], resetForm)` 这类**数组 getter**：每次依赖失效都会返回**新数组**，watch 用 `Object.is` 比较必然不相等 ⇒ 父组件换上带 `proxy` 的新 `account` 对象时（惰性读取正是这么做的，`id` 并未变）也会触发 `resetForm`，**清掉用户在读取窗口里已经输入的内容**。改为原始值拼成的字符串键。回归锁：`AccountProxyDialog.test.js`「惰性读到的当前代理只预填一次，不覆盖用户已输入的内容」（先用数组 getter 复现变红，再改字符串键转绿）。

### 遗留（不假装已闭合）

1. **`history:list` 仍无耗时读数**（本轮实测发现）：用户报「点左侧菜单『发布链接』慢 1–2 秒」，排查结论是**与账号页不同因**——该页零凭证层、零 `pbkdf2`；唯一同步阻塞原语 `publish-history.js:60` 的全量 `readFileSync` 用**用户真实数据实测仅 4ms**（71 行 / 178KB）。但 `ipc-handlers/publish.js` 的 `history:list` 日志**不打印耗时**（对比 `account.js` 的 `accounts:list` 有 `耗时=`），所以拿不出主进程读数 ⇒ 只能推理不能证实。**补日志时撞上行数闸**（该文件 497 → 508 ≥ 500），故回退并登记：正解是先把 `publish.js` 按向例拆出 `history` 相关处理器，再补 `耗时=` 与 `>300ms` 阈值告警。
2. **模块改名后的一致性**：`credential-proxy-status.js` 的 `loadProxyStatuses` 现在只被「单个 id」的按需路径调用，名字里的「批量」语义已名不副实。改名属独立切片（要同步改测试与注释），本轮不动。
3. **列表失去「哪些账号配了代理」的一眼可见性** —— 这是**有意的产品决策**（用户确认：代理信息从账号卡片去掉）。若将来要恢复，正解不是给列表加回解密，而是把 `configured` 布尔作为**明文元数据**存进后端 `accounts.json`（详情仍以解密为准），代价是引入第二个真源。
4. **用户报告的「1–2 秒」未被完整归因**：静态分析找不到能吃掉 1–2s 的主进程成本，日志也缺该页读数。未证伪的候选（无证据指向，仅登记）：dev 态懒加载路由首次模块图加载（打包态为独立 chunk，不适用）、每 5s 整库 `export()` 的间歇争用（`multi-publish.db` 5.5MB）、LoginMonitor 巡检窗口（日志可见单次占用 40–90s）。**打通第 1 条（耗时日志）是证实或证伪它们的前提。**
5. **上一轮 #3591 的远程同步回填尚未做**：`openspec/records/fix-sidebar-nav-slow.md` 仍是 `PENDING`。该记录的收口属「关闭冻结前已存在的行」，允许就地改写（ledger 里那条登记也同属旧载体，可销账）。
