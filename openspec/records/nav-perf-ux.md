---
record: nav-perf-ux
task: 账号页列表路径零解密——代理信息移出列表改为弹窗按需读取
date: 2026-10-15
---

## 本次执行记录：账号页列表路径零解密（nav-perf-ux，2026-10-15）【混合 PR】

> 载体说明：按 2026-10-15 起的「旧载体冻结」，本记录**只写在本文件**，
> 不往 `.quality-gates.md` 插块、不往 `scripts/gate-record-debt-ledger.json` 加键。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | **运行时代码变更** ⇒ 隔离 worktree `<仓库父目录>/mp-worktrees/mp-fix-sidebar-nav-slow`（D 盘，非 C 盘）+ 分支 `nav-perf-ux`。`pre-code-edit-guard.ps1` exit 0。**如实声明**：本任务开始时标准入口 `start-mp-task.ps1` 被硬拒（共享根有另一会话未提交的 3 个已跟踪文件，`mp-worktree-health.ps1 -RequireClean` 返回 `ok=false`），`session-init.sh` 同样 `exit 2` 且明确「leaving them untouched」。**未做任何手动补救**（无 `rm` worktree 注册、未在共享根落盘、未碰他人改动），改为**复用已有隔离 worktree** 并从 `origin/main` 开新分支（经用户明确批准）。 |
| 第一性原因（QM-5 ①） | PASS | 用户实测：上一轮 #3591 修完（同步串行 → 异步并行）后 `accounts:list` **仍是 1451–1579ms**（`shared-user-data/logs/app-2026-10-15.log`，8 账号、每账号一行 `checkLocalCredentials` 间隔 ~100ms）。第一性原因：`listAccounts()` 为给每个账号附加 `proxy`，逐账号走 `getAccountProxyStatus()` → `loadCredential()` → `decryptData()` → `deriveKey()` → **`crypto.pbkdf2Sync(100000)` 同步阻塞事件循环**。#3591 只改了**并行度**（wall-time 降 3.5–3.7x），**总 CPU 一字未减**，且每次进页复发 ⇒ 复发性成本。**正解是让列表根本不读代理**：代理是详情级信息。 |
| 逃逸分析（QM-5 ②） | PASS | 五层：① 单测 `mockReturnValue` 掉 `loadCredential` ⇒ 唯一 CPU 热点从未在测试里真跑；② 凭证层 15 条用例只断言功能正确性，零条断言耗时；③ 无「多账号 + accounts:list 计时」集成用例；④ 视觉回归对「画面正确只是迟到」结构性免疫；⑤ QM-2 清单原无性能维度（#3591 已补两条）。**本轮新增的第 6 层教训**：即使上一轮补了「并行度」契约（C5 断言 `maxInFlight>1`），**并行度合格 ≠ 成本被消除**——判据锁住了手段，没锁住目标。 |
| 修复 + 回归保护（QM-5 ④） | PASS | ① 列表**不再附加 proxy**（`return accounts` 直返），账号卡片代理行与列表徽标/tooltip 一并移除；② 新增 IPC `account:get-proxy` → `AccountManager.getAccountProxyStatusLazy()`（复用 #3591 的异步批量入口，不阻塞事件循环）；③ 交互三态（加载/错误+重试/预填）；④ 代理弹窗关注点下沉 `useAccountProxyDialog`。**回归锁 10 条**：主进程 L1–L6（L1 列表路径 `loadProxyStatuses` 与 `getAccountProxyStatus` **都不得被调用**）+ 渲染端 4 条（不再渲染代理行 / 加载态 / 错误+重试 / **只预填一次不覆盖用户输入**）。 |
| 防止再次发生（QM-5 ⑤） | PASS | ① `AGENTS.md` QM-2 已有「高频路径不得含同步 CPU 密集原语」+「详情函数复用到列表路径前必须核算单元素成本」两条（#3591 落），**本轮正是后者的第二个实例**（列表为读一个 `proxy` 字段解密整份凭证）；② 代码注释就地固化三条踩坑（数组 getter 的 watch 陷阱 / 为什么必须异步 / 为什么列表不读）；③ `CHANGELOG.md`；④ 本轮新增可复用判据：**「手段合格」的锁要配「目标达成」的锁**——`maxInFlight>1` 锁不住「总 CPU 是否被消除」。 |
| 行尾与 diff 对账 | PASS | 两口径 numstat 一致（`git diff --numstat` == `--ignore-cr-at-eol --numstat`） |
| 接线棘轮 | N/A | 未新增任何 `*.test.js` **文件**（10 条锁全部追加进两个已接线文件）；新增的两个**源码**文件 `account-proxy.js` / `useAccountProxyDialog.js` 不属接线棘轮管辖面 |
| QM-1 打包 | PASS | 见下「QM-1 证据」小节 |
| QM-4 视觉 | PASS（重采基线，非抬预算） | **首轮我判成 N/A 是错的**——当时写「被删元素没有任何像素基线」，实际 `apps/desktop/tests/visual-testing/base-screenshots/` 里**有**账号页基线（`accounts-list[-flag-on][-dark].png`），删元素必然改变它。这是本轮最实质的失误：把「我没查」写成了「不适用」。CI 随后以 `Gate 7b - Baseline freshness` 打红（**不是** `Gate 7 - Visual regression`，后者 6% 阈值下通过了）。**归因证据四条**：① CI 两轮独立重采数值**逐位相同**（round1 == round2 == light 34481px/1.663%、dark 62878px/3.032%）⇒ 经 two-round verdict 判定为确定性真实漂移、非抖动；② 43 个受管视图**只有这 4 个**漂移、其余 39 个**零漂移** ⇒ 无附带损伤；③ 本地独立复现数值与 CI 一致（1.66% / 3.03%），差异图红带正落在被删的代理行处、其下为整片垂直重排（删掉一行后内容上移的机械必然后果）；④ **闭环**：换用新基线、去掉 `UPDATE_BASELINE` 重跑，浅/暗均 **0 失败**（漂移 → 0）。**手法受控**：用脚本自带 `PIXEL_ONLY` 限定范围（其注释明确全量重采会把无关环境差烘进基线）、`git rm` 4 张受管基线（正规路径）并先备份 `%TEMP%`、dev server 用**独占端口 5179**（脚本 L214 警告 TEST_URL 指向并发会话的 server 会拿到别人的构建当自己的证据）。判据原文支持这条路径：「该处行为已改，须重新取证而非抬预算」——抬 `DYNAMIC_ALLOWED` 会把「我删的」与「别的什么坏了」一起盖住 |
| QM-6 CCG 双模型评审 | 见下 | 判定器读数由 pre-commit 落盘 `.ccg/reviews/<sha>.json`；本 PR 为混合 PR（含运行时代码），按 §12.6 走 `mode=dual` |
| 逐文件行数门禁 | PASS | 首轮打红两条并已修：① `publish.js` 508 行 ≥ 500（我加的 `history:list` 耗时日志 +11 行）⇒ **回退该改动**并登记为遗留项（正确修法是先按范式拆文件再补日志）；② `Accounts.vue` 1624 行 > 点名目标 1578（零增长容差）⇒ 按门禁提示的 **composable 范式**把代理弹窗整体下沉到 `useAccountProxyDialog.js`，**1624 → 1538 行**。终局 `node .github/scripts/check-max-lines.js` → **exit 0**（`✅ 无新增超大文件，挂账清单与现实一致`） |
| 远程同步 | PASS | 已合并（PR #3742，squash）

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PASS

**merge SHA**：`c2cda02d640b79fb2a44fd3eda1029a3fe59d04a`
**合并时间**：`2026-10-16T18:50:35Z`（UTC）
**远端分支**：`git ls-remote --heads origin nav-perf-ux` 返回 **0 行** ⇒ 已删除。
**main push 回读**：本次合并触发的 main push run 结论按 AGENTS.md 收尾清单第 7 条单独核（见下方「收尾留痕」）。

### QM-1 证据（三层判据 + 存活断言）

本改动含 `apps/desktop/electron/` 下代码，已本地打包验证。**全部实测读数如下**：

| 项 | 命令 / 断言 | 结果 |
|---|---|---|
| 依赖解析 | `node scripts/verify-worktree-deps.js` | **OK**（消费方解析通过 11 项；被消费 workspace 9 个） |
| 打包 | `pnpm exec electron-builder --win --dir --publish never` | **exit 0**（electron-builder 25.1.8 / electron 43.7.7 / win32 x64） |
| 产物含新文件 | `asar list .../app.asar` | 命中 `\electron\ipc-handlers\account-proxy.js` 与 `\electron\services\credential-proxy-status.js` |
| **① 存活断言**（三层判据的隐含前提） | 8000ms 窗口期内进程必须仍在存活 | **OK 存活断言通过** —— 未提前退出 |
| **② 子进程 env** | spawn 必须显式传 `env`，经 `scripts/lib/qm1-child-env.js` 的 `buildChildEnv()` 剔除 `ELECTRON_RUN_AS_NODE` | **已剔除 = true**（不传 env 会继承父环境，该变量令 Electron 以纯 Node 模式静默退出：rc=0 / stdout 空 / stderr 空，与「启动干净」完全同形） |
| **③ stderr 三层** | 红线命中 ⇒ FAIL；非空未命中 ⇒ NEEDS_REVIEW；为空 ⇒ PASS | **PASS（第③层）** —— stderr 为空 |

产物内 `require` 与旧 API 未破坏：新增的两个主进程文件均进入 asar，且 `credential-proxy-status.js` 是上一轮已在产物中验证过的模块（本轮未改其内部契约，只改了调用方）。

- 打包期两条 `file source doesn't exist`（`dist/fonts`、`.playwright-browsers`）为**既知环境态**：本 worktree 未跑 renderer build、未安装 Playwright 浏览器，与本次改动无关（本次未触碰 renderer 构建配置）。

### 本轮实测修到的实现缺陷（写进注释防回归）

**① 数组 getter 的 watch 会误触发重置（渲染端）**

`watch(() => [props.visible, props.account?.id], resetForm)` 这类**数组 getter**：每次依赖失效都会返回**新数组**，watch 用 `Object.is` 比较必然不相等 ⇒ 父组件换上带 `proxy` 的新 `account` 对象时（惰性读取正是这么做的，`id` 并未变）也会触发 `resetForm`，**清掉用户在读取窗口里已经输入的内容**。改为原始值拼成的字符串键。回归锁：`AccountProxyDialog.test.js`「惰性读到的当前代理只预填一次，不覆盖用户已输入的内容」（先用数组 getter 复现变红，再改字符串键转绿）。

**② 漏带 preload IIFE bundle（打包版才会暴露的功能性缺陷）**

`preload/account.js` 新增 `accountGetProxy` 后，打包会重生成 `electron/preload/index.bundle.js`；我前两次提交**漏带了该产物**（3 行新增）。后果：**打包版**（非 dev）的 preload 里没有这个 API ⇒ `invokeWithFallback` 静默返回 `code=-1` ⇒ 代理设置弹窗**永远显示「读取当前代理配置失败」**。

为什么五层测试都没拦住：单测全部 mock 掉 `window.electronAPI`，只能验渲染端分支；而 dev 态 Vite 直接走源文件、不经过该 bundle ⇒ **只有真实打包产物里才暴露**。这正是 QM-1「单元测试不能替代完整打包验证」要拦的形状——而且它**确实被 QM-1 拦到了**（打包重生成后工作区出现该文件改动），是我第一轮漏看了工作区变化、没把它纳入提交。

> 可复用判据：凡改 `electron/preload/*.js`，**必须检查 `git status` 里 `index.bundle.js` 是否被重新生成**，是则一并提交。仅跑打包不够——还要看产物是否"脏"。

**③ 漏喂「清点式守卫」（CI 抓到，本仓第 N 次同族）**

新增 preload 方法必须**同 PR 喂齐登记点**。我漏了 `electron/preload.test.js` 的两条计数断言，CI 的 `QG Desktop Shards (2/2)` 与 `QG Coverage` 同时打红：

```
FAIL electron/preload.test.js > preload 子模块方法数
  account 模块应导出 51 个方法 -> expected 52 to be 51
  合并后 api 总键数应为 342   -> expected 343 to be 342
```

已按既有风格更新（52 / 343），并把 `accountGetProxy` 加进「新增方法必须真实存在于聚合入口」那组断言——只改数字不加存在性断言，等于把这条锁降级成装饰。

> 教训：**新增任何 IPC/preload 面，先搜同族计数断言再提交，别等 CI。** 本次搜索面：`electron/preload.test.js`（计数 + 存在性，381 passed）、`.github/scripts/check-ipc-bridge.js`（470 handlers / 488 preload、0 缺口，动态计算无需改字面量）、`.github/scripts/check-ipc-sender-guard.js`（显式守卫 67.5% ≥ 65%）。

### 遗留（不假装已闭合）

1. **`history:list` 仍无耗时读数**（本轮实测发现）：用户报「点左侧菜单『发布链接』慢 1–2 秒」，排查结论是**与账号页不同因**——该页零凭证层、零 `pbkdf2`；唯一同步阻塞原语 `publish-history.js:60` 的全量 `readFileSync` 用**用户真实数据实测仅 4ms**（71 行 / 178KB）。但 `ipc-handlers/publish.js` 的 `history:list` 日志**不打印耗时**（对比 `account.js` 的 `accounts:list` 有 `耗时=`），所以拿不出主进程读数 ⇒ 只能推理不能证实。**补日志时撞上行数闸**（该文件 497 → 508 ≥ 500），故回退并登记：正解是先把 `publish.js` 按向例拆出 `history` 相关处理器，再补 `耗时=` 与 `>300ms` 阈值告警。
2. **模块改名后的一致性**：`credential-proxy-status.js` 的 `loadProxyStatuses` 现在只被「单个 id」的按需路径调用，名字里的「批量」语义已名不副实。改名属独立切片（要同步改测试与注释），本轮不动。
3. **列表失去「哪些账号配了代理」的一眼可见性** —— 这是**有意的产品决策**（用户确认：代理信息从账号卡片去掉）。若将来要恢复，正解不是给列表加回解密，而是把 `configured` 布尔作为**明文元数据**存进后端 `accounts.json`（详情仍以解密为准），代价是引入第二个真源。
4. **用户报告的「1–2 秒」未被完整归因**：静态分析找不到能吃掉 1–2s 的主进程成本，日志也缺该页读数。未证伪的候选（无证据指向，仅登记）：dev 态懒加载路由首次模块图加载（打包态为独立 chunk，不适用）、每 5s 整库 `export()` 的间歇争用（`multi-publish.db` 5.5MB）、LoginMonitor 巡检窗口（日志可见单次占用 40–90s）。**打通第 1 条（耗时日志）是证实或证伪它们的前提。**
5. **上一轮 #3591 的远程同步已在本回填 PR 中收口**（openspec/records/fix-sidebar-nav-slow.md 远程同步改 PASS + merge SHA 84e67e7203da69b2122250709f046df78a63b26，frontmatter 三个 sync_* 字段已删，scripts/gate-record-debt-ledger.json 登记项已同次销账）。

