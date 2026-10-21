---
record: ux-audit-offline-live
task: UX 审计 1.7 —— 离线横幅实时出现（浏览器事件 + 主进程复核）与显示面整改
date: 2026-10-21
---

## 本次执行记录：离线横幅实时出现（ux-audit-offline-live，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 运行时代码（仅渲染层） | worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-offline-live`，裸分支 `ux-audit-offline-live`（非 C 盘，`scripts/start-mp-task.ps1` 建立） |
| 第一性原因（QM-5 ①） | ✅ | 两处缺口叠加：`offline-manager.js::onNetworkChange` 的判据 `if (wasOffline && !isOffline)` **只在恢复边通知**；渲染层 `useOfflineStatus.init()` 只有「一次性读 + onOfflineRestored」，没有任何实时监听 ⇒ 中途断网横幅永不出现 |
| 逃逸分析（QM-5 ②） | ✅ | 单元：`useOfflineStatus.test.js` 11 例全部围绕「init 读回」与「restored 事件」，没有任何用例问过「派发一个 window offline 事件后状态怎么变」——**该行为在测试面上根本不存在**；视觉：横幅仅在离线时渲染，采集态不出现 ⇒ 结构性失明；审查：静默 `catch(() => {})` 被当成「防御式写法」而非缺陷 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `useOfflineStatus.live.test.js`（9 例）+ `OfflineIndicator.test.js`（12 例）；实现改 4 个文件（composable / 组件 / locales zh+en / tokens 两档） |
| 防止再次发生（QM-5 ⑤） | ✅ | `scripts/offline-live-contract-mutate.js` 13 道变异全部 CAUGHT；显示面加了三条结构锁（禁 hex 字面量、禁内联 style、token 必须在 tokens.css 有定义） |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径相等（提交后取数，见 PR 正文） |
| 接线棘环 | ✅ | 两个新增测试都在 `apps/desktop`（vitest workspace 自动收集）；反证驱动 `scripts/offline-live-contract-mutate.js` **未接进 CI**，与同族驱动一并挂在任务 #23 |
| QM-1 打包 / QM-4 视觉 | N/A / 未触 | 本批 **不动 `apps/desktop/electron/`**（刻意拆出，见「遗留」），因此不触发打包判据；未改写任何已登记视觉视图的 DOM —— 注意这是**推理不是像素证据**：横幅只在离线时渲染，采集态不出现，故没有可对比的像素变化，也没有被门禁验证过 |
| QM-6 CCG 双模型外部评审 | PENDING | 见 tasks.md 4.4 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导归属 |

## 一、验证现场（全部当场跑过）

- 三套件（最终）：`useOfflineStatus.test.js` 11 + `useOfflineStatus.live.test.js` 12 + `OfflineIndicator.test.js` 12 ⇒ `Tests 35 passed (35)`；
  挂载了本组件的相邻套件 `App.sidebar-collapse.test.js` + `shell-mode-6a.test.js` ⇒ 12 passed
- 聚合 eslint（**CI Gate 11 同一条命令**，不是"改动文件逐个 lint"）：
  `cd apps/desktop && eslint electron/ src/ --quiet` ⇒ `AGG_RC=0`
- 门禁：`check-css-var-defined` PASS（未定义 0 / 基线 64）、`check-color-literals` PASS（**125 / 基线 129**，本次减 4）、
  `check-frontend-consistency` PASS、`check-locale-sync --pair-base HEAD` PASS、`--cjk` PASS（1122 条）
- 反证驱动：

```
[BASE] src/composables/useOfflineStatus.live.test.js rc=0 red=0
[BASE] src/components/OfflineIndicator.test.js rc=0 red=0
M1 CAUGHT red=4  摘掉 window offline 监听
M2 CAUGHT red=1  只挂 offline、不挂 online
M3 CAUGHT red=3  浏览器事件后不向主进程复核
M4 CAUGHT red=1  复核只写计数、不回写连通性
M5 CAUGHT red=1  复核失败退回静默 catch（被禁形态本身）
M6 CAUGHT red=1  dispose 不再解绑 window 监听
M7 CAUGHT red=1  去掉 dispose 的 attached 守卫
M8 CAUGHT red=1  文案退回硬编码中文
M9 CAUGHT red=1  横幅去掉 role=status/aria-live
M10 CAUGHT red=1 颜色退回 hex
M11 CAUGHT red=1 去掉 prefers-reduced-motion 守卫
M12 CAUGHT red=1 图标不再 aria-hidden
M13 CAUGHT red=1 计数段改为恒渲染
M14 CAUGHT red=1 摘掉**复核**的迟到响应守卫
M15 CAUGHT red=2 摘掉 **init 读回**的迟到响应守卫
ALL_CAUGHT（15 条）；两个被改文件 md5 还原一致
红集（逐条打印，供人核对同异）：M1:7 M2:2 M3:5 M4:1 M5:1 M6:3 M7:1 M8:1 M9:1 M10:1 M11:1 M12:1 M13:1 M14:1 M15:2
```

## 二之二、QM-6 i1 采纳：并发写同两个字段时必须有新鲜度序号

外部评审的 i1 指出：`init` 的首次读回与每次事件后的复核**都是异步写同两个 ref**，
而实现无任何新鲜度判据 —— 正确性依赖「Electron IPC 同一通道按发起顺序响应」这个**未声明的假设**。

采纳并实现为**两条写入路径共用一把 epoch**（`readEpoch` 自增，回调里 `epoch !== readEpoch` 即丢弃）；
分两把计数器不行（各自单调，跨路径的先后关系仍然丢失）。

反证逼出的两个形态，各自一条独立用例：
- **M15**（摘掉 init 的守卫）→ 红 2：init 迟到响应把已确认的离线改回在线。
- **M14**（摘掉复核的守卫）→ 起初 **MISSED**：只测「init 迟到 + 复核新鲜」时，
  摘掉复核守卫不改变任何可观测结果（另一条守卫仍在守住那条场景）——**等价变异 ≠ 锁没牙，但也 ≠ 已覆盖**。
  缺的是「**两次复核之间**谁先发起、谁后返回」这一格，于是补
  `offline(A 慢) → online(B 快) → A 后返回` 用例；补后 M14 独立 CAUGHT。

- 对比度为按 WCAG 公式现算（非目测）：浅档 `#92400e` on `#fef3c7` = **6.37:1**；暗档 `#fbbf24` on `#33240c` = **9.00:1**。

## 二、一次自我纠正：M4/M5 首跑 MISSED，病因是我的夹具时序

第一轮驱动跑出 `M4 MISSED red=0` 与 `M5 MISSED red=0`。逐条排查后确认**不是等价变异，是两条用例的前提没立住**：

1. **M4**：用例写「先 `init()`，立刻派发 online，再 flush，断言主进程的离线结论覆盖它」。但 `init()` 自己那次
   `offlineStatus()` 的 promise 也在同一个 flush 里落地，而 init 的回调**仍然写连通性** ——
   于是「对的结果」是 init 给的，不是复核给的，摘掉复核的写入照样绿。
2. **M5**：用例断言「warn 里出现 `[offline]`」。init 那次失败**已经**warn 过一次，
   事件后的复核被改成静默也照样有 warn。

处置（改测试，不改判据、不放宽断言）：两条用例都改成**先把 init 那一轮跑完并断言其落地**，
再触发事件（M5 额外 `warnSpy.mockClear()` 把 init 的痕迹清零）。改后各自 CAUGHT。

## 遗留（不假装已闭合）

- **主进程 `offline:lost` 推送没做**（本批刻意不动 `electron/`）：要改 `offline-manager.js::onNetworkChange`、
  `electron/preload/system.js` 暴露面、`preload/access-control.js` 与 `preload.test.js:112` 的**等值** API 名单，
  并按 QM-1 做打包 + 8 秒 stderr 三层判据。当前实现里浏览器事件是唯一的实时源。
- 反证驱动未接进 CI（任务 #23）。
- 横幅的暗色档对比度是**算出来的**，不是像素门禁验出来的（该视图不在视觉注册表内）。

## CHANGELOG 条目

# fix(离线): 会话中途断网即时出现离线横幅，并把文案/颜色/播报收进合同（ux-audit-offline-live）

- 断网不再需要重启应用才有提示：浏览器 online/offline 事件即刻改变横幅，随后向主进程复核，
  复核结论覆盖事件值（待发布数量始终取主进程真源）。
- 复核或初始读失败不再静默：保留事件给出的连通性并留一条 `[offline]` 告警，
  让「IPC 不可用」和「一切正常」在日志里可区分。
- 横幅文案进 zh/en 语言资源（英文用户不再看到中文），图标转为纯装饰；横幅成为可播报状态区域
  （role=status + aria-live=polite）；颜色从硬编码 hex 收进警告族令牌并显式声明暗档值
  （浅 6.37:1 / 暗 9.00:1），入场动画尊重系统减弱动效设置。
- 待发布数为 0 时不再显示「0 个待发布」。

## learnings

### lesson: 没 dispose 的 composable 实例会在后续用例里继续消费 mock ——「跨用例泄漏」的第三种落点

**现场**：给 `useOfflineStatus` 加迟到响应守卫时，两条新用例（`mockImplementationOnce` 依次给 A/B 响应）
稳定失败在「期望 true 得到 false」。逐层排查后确认实现是对的：
前面用例里 `create()` + `init()` 过的实例**从未 dispose**，它们的 window 监听器仍挂在全局，
于是新事件被**多个实例同时收到**，旧实例抢先消费了 `once` 实现 —— 当前实例拿到的是排在后面的默认 mock。

**根因**：`init()` 注册宿主级监听（window / IPC / 事件总线）而清理靠调用方自觉；
测试夹具只写 `beforeEach` 重置 mock，没有重置"谁还在监听"。
mock 的 `once` 队列是**全局计数**，它对"哪个实例拿到了第几号响应"完全盲目。

**可复用的 N 条**：

1. 任何「注册宿主级监听」的 composable，测试里的构造函数必须把 `dispose` 记进清理队列
   （本仓现写法：`disposers.push(api.dispose)` + `afterEach` 逐个调用），
   **不要**只清 mock 不清监听。
2. 用 `mockImplementationOnce` 序列区分"第几次调用"的用例，前提是**只有一个消费者**。
   消费者可能多于一个时，要么在断言里显式证明消费者身份（本用例改为按"值不同"断言），
   要么先保证上一个实例已 dispose。
3. 「期望 X 得到 非 X」且实现看着没错时，第一个要查的不是时序竞态，而是
   **有没有别的对象也在写同一个东西**。

### lesson: 反证驱动不得把「文件没编译」读成「变异没造出红」

**现场**：新增的两条用例里有一处笔误（`async () {` 漏了 `=>`），整个文件编译失败。
驱动读到 vitest 汇总行 `Tests  no tests`，正则找不到 `N failed` ⇒ 返回 0 ⇒ 打印 `MISSED red=0`，
把「探针根本没跑起来」报成「这条锁没有牙」。同时基线档也因同一原因为 `red=2`（文件级失败）而被拦住，
两条信号混在一起极易误读。

**根因**：子进程输出解析里「没有失败记录」与「没有测试」是两个不同的状态，
把它们折叠成一个 0 就是把工具故障判成实现无罪 —— 与「0 命中先证明我的坐标是旧的」互为镜像。

**可复用的 N 条**：

1. 汇总行存在但内容是 `no tests` 一律返回 `-1`，并单独成档 `PROBE_BLIND`（两个同族驱动都已补，判据同源）。
2. `rc != 0` 而 `red == 0` 时优先怀疑**运行本身**，不是判据强度。
3. 驱动打印必须同时给出 `rc` 与 `red`（本驱动已如此），只给一个数就会让下一次排查从零开始。

### lesson: 「init 的异步回调」会替被测事件写状态，事件类用例必须先让 init 那一轮落地

**现场**：`node scripts/offline-live-contract-mutate.js` 首跑 `M4 MISSED red=0`、`M5 MISSED red=0`。
两条用例都是「`init()` → 立刻派发 window 事件 → flush → 断言」。但 `init()` 自己的
`offlineStatus()` promise 也在同一次 flush 里 resolve，而它的回调**同样写连通性、同样打 warn** ——
于是断言接住的是 init 的效果，摘掉事件后复核（M4）与摘掉事件后的 warn（M5）都看不出来。

**根因**：一个被测对象有**两条写入路径**（初始化读回 / 事件后复核），而用例把两者放进同一个观察窗口，
只断言"最终值对"。这不是断言太弱，是**前提没建立**：没有证明"此刻只有事件路径在写"。

**可复用的 N 条**：

1. 写「事件驱动状态变化」的用例，必须在事件之前**显式跑完并断言初始化那一轮已落地**
   （`await flush()` + 必要时 `mockClear()`），否则测的是两条路径的并集。
2. 计数器/warn 类断言要在触发被测事件前清零；`warnSpy.mockClear()` 一行就能把
   "谁叫的"归因到被测路径上。
3. 「变异 MISSED」的排查顺序应当是：先看**用例能不能区分这两条路径**，再看变异是否等价，
   最后才怀疑锁没牙。本次两条都是第一条，改测试即可，**不需要**动判据或放宽断言。
4. 同一份 composable 被多处挂载时，init 的读回是**每实例一次**的副作用 —— 用例里任何
   「先 init 再操作」的写法都会带上它，别把它当无害。
