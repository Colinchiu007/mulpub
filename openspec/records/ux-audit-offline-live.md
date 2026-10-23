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
| QM-1 打包 / QM-4 视觉 | ⏳ / 未触 | **口径变更（2026-10-22 §七）**：主进程半边已并入本条 PR，`apps/desktop/electron/` 已被改动 ⇒ QM-1 从 N/A 变成**必跑**，读数待回填；未改写任何已登记视觉视图的 DOM —— 注意这是**推理不是像素证据**：横幅只在离线时渲染，采集态不出现，故没有可对比的像素变化，也没有被门禁验证过 |
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

- ~~主进程 `offline:lost` 推送没做~~ —— **已于 2026-10-22 并入本条 PR 闭合**（见 §七）。当年拆开的理由是"不动 electron 就不触发 QM-1"，
  而那个理由本身就写在这条遗留里：拆出去的代价是一条**没人订阅的方向性静默**继续存在于 main。
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
- 横幅文案进 zh/en 语言资源（英文用户不再看到中文），图标转为纯装饰；**状态播报锚点改为常驻容器**
  （`role=status` + `aria-live=polite` 挂在从不被插入/移除的 region 上，横幅只是它的内容），
  恢复时给一条会自己消失的「已恢复连接」回执 —— 此前播报属性挂在 `v-if` 的横幅节点上，
  「已恢复」这半边对读屏用户不存在；颜色从硬编码 hex 收进警告族令牌并显式声明暗档值
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

### 三之二、三份产物的收口（2026-10-24，仓库所有者授权后由 agent 代为回写）

本分支带三份 `mode=dual` 的评审产物，状态各不相同，**如实分别收口**：

| 产物 | 引擎写回 | 现场 | 现在 | tier / evidence |
|---|---|---|---|---|
| `0c4d42d2…` | `error` | critic 输出被截断（JSON 不完整，28262 字符）⇒ 解析失败，**未产出 findings** | `self_play_resolved` | tier 缺席（没有外部评审出处可声明） |
| `e9b93f3b…` | `error` | 同上（5774 字符，结尾不是 `}`）⇒ **未产出 findings** | `self_play_resolved` | tier 缺席 |
| `68664cda…` | `self_play_pending` | **外部 critic 真跑过**（critique=claude，fingerprint 49325d0d49dcec88，3 条 Warning），逐条处置见本文 §三 | `self_play_resolved` | `tier=external` + `evidence=openspec/records/ux-audit-offline-live.md`（本记录，在变更集内可核） |

口径：
- 两份 `error` 的产物：**评审没跑成**，不是评审通过 —— findings 保持 null，引擎的 error 字段原样保留为现场；
- 真跑过的那份：`tier=external` 的含义是「外部评审确实跑过且逐条处置在仓内可核」，
  evidence 指向**本记录**（引擎原始产物在 gitignored 的 `.adversarial/` 下、不随提交入库）；
- **由仓库所有者授权处理需要人判断的项后，agent 代为回写。**

## 三、QM-6 第二轮评审处置（critique=claude，fingerprint 49325d0d49dcec88，3 条 Warning）

判据：**每条都先对当前 HEAD 重放一遍再定裁决**（评审读到的可能是开发途中的旧 tip，
本仓已有先例：把"读取时的旧状态"当成"当前主张"）。

| # | 主张 | 裁决 | 现场证据 |
|---|------|------|----------|
| i1 | 复核/初始读回没有序列标记，乱序落地会把已确认的离线改回在线 | **dismissed（已在上一轮修掉，本轮是对旧 tip 的重复）** | `useOfflineStatus.js` 现有 `readEpoch`，init 与 reconcile **共用**同一计数器，两条回调各自 `if (epoch !== readEpoch) return`；行为锁 `useOfflineStatus.live.test.js` 的「迟到的复核响应必须丢弃」+「两条写入路径不得各有各的守卫」；反证 M14（摘复核守卫）红 1 条、M15（摘 init 守卫）红 2 条 |
| i2 | 恢复时整个 live region 被 `v-if` 移除，「已恢复」这半边不会被读屏播报 | **upheld，已修** | 成立：`role=status`/`aria-live` 原挂在 `v-if="isOffline"` 的横幅节点上，而 4.1.3 的播报语义依赖常驻 region。修法：锚点改为常驻 `.offline-live`，横幅/回执成为其内容；新增 `RECOVERY_NOTICE_MS=6000` 的一次性「已恢复连接」回执（首挂载不显示、再次断网立即让位、卸载清表）；locales zh/en 成对补 `offlineRecovered`。新增 6 条用例 + 3 条反证 M16/M17/M18 全部实测变红 |
| i3 | `disposers` 从不 push，清理是空操作，window 监听跨用例泄漏 | **dismissed** | `useOfflineStatus.live.test.js:57` 有 `disposers.push(api.dispose)`，`afterEach` 用 `while (disposers.length > 0) disposers.pop()()` 逐个调用；该文件正是上一轮同族评审命中后才补的登记。本轮实测：新增的定时器/播报用例与既有 18 条同文件跑，无顺序依赖红 |

**i2 的验收更正**（原来那句话是过度声明，必须改）：本 PR 早期在 PRD §5 写的是
「横幅是状态消息：`role=status` + `aria-live=polite` ⇒ 断网与恢复都要被读屏播报」——
断网半边成立（region 插入即播报），**恢复半边当时不成立**。现按常驻 region 重写，
并把这条写成结构锁（属性必须在容器行、不得在横幅行、容器行不得有 `v-if`），
使"退回挂在 v-if 节点"这个动作当场变红，而不是等下一个会话再读一遍代码。

**第二轮反证总数**：`node scripts/offline-live-contract-mutate.js` 现 **18 条 ALL_CAUGHT**
（M1–M15 既有 + M16 播报锚点退回 / M17 卸载不清定时器 / M18 跃迁判据写反），
两个套件基线各 `red=0`，`[RESTORE-CHECK]` 两文件逐字节还原。

## 七、主进程半边并入本条 PR（2026-10-22，闭合 §遗留 第 1 条）

### 7.1 为什么改主意

原拆分理由（"不动 `electron/` ⇒ 不触发 QM-1"）省的是本批的打包成本，留的是产品缺口。
拆开还会带来两个更坏的形状：① 消费方（`useOfflineStatus` 订阅 `offline:lost`）在另一条 PR 里，
新开分支只能基于 main，而 main 上没有那个形状 —— 属「我引用了 main 还没有的东西」；
② 若只把主进程半边先合，世界上就多了一条**没人订阅的 IPC 通道**（注册≠注入≠生效的同形）。
并回同一条 PR 后，"发出 / 白名单 / preload / 订阅 / 断言"五段在同一批里闭合，且不开第 95 个工作区。

### 7.2 现场取证（读 main 同源文件，非推演）

`offline-manager.js::onNetworkChange` 原先只有一个分支：

```js
if (wasOffline && !isOffline) { log.info(...); processCachedTasks(); notifyFrontend() }
// 没有 else —— 进入离线方向既不写日志也不通知任何人
```

而 `startMonitoring` 是**对称注册**的：`net.on("online", …false)` 与 `net.on("offline", …true)`。
⇒ 状态机两侧都跑，通知只有一侧有；这就是"断网横幅只能靠浏览器事件"的根因。

还挖到一条同批的事实：**既有测试从来没测过推送**。
`tests/offline-manager.test.js` 里那条用例名字写着 `onNetworkChange sends offline:restored event`，
断言体里一次 `send` 都没查（只查 `isOffline()`）；而该文件顶部的 `var mockSend = vi.fn()` **全文件零引用**（死夹具）。
根因之一在宿主 mock：`test-setup.js` 的 `webContents.send` 是**空函数而不是 vi.fn**，
所以"有没有发"在这个夹具里根本不可表示。本轮改为在用例里把实例的 `send` 换成探针。

### 7.3 改动清单（五段）

1. `electron/services/offline-manager.js`：新增 `!wasOffline && isOffline` 分支 →
   `log.info("offline", "Network lost, new tasks will be cached")` + `notifyFrontendOffline()`，
   推 `offline:lost`，载荷 `{isOffline: true, cachedCount: loadCache().length}`。
   **判据是状态迁移不是事件计数**：已在离线态时重复的 offline 事件不得重发。恢复侧一字未动。
2. `electron/preload/system.js`：新增 `onOfflineLost(cb)`（与 `onOfflineRestored` 同形，返回取消函数）。
3. `electron/preload/access-control.js`：导出清单登记 `onOfflineLost`；
   `electron/preload.test.js` 两处计数随之 141→142、339→340，并把日期与原因写进用例名。
4. `src/api/publisher.js`：`onOfflineLost(callback) => bridgeOn("OfflineLost", callback)`。
5. `src/composables/useOfflineStatus.js`：订阅 `offline:lost` ⇒ 立即 `isOffline=true` 并采纳载荷里的
   `cachedCount`（真源带的值），随后仍 `reconcile()` 一次（**载荷字段缺席时由复核补正**，第 4 条用例专门锁这个）；
   注册失败只 warn；`dispose()` 改成按 `[通道名, 取消函数]` 成对解绑，**红文案点名是哪条通道没解绑**。

**刻意不改的一处**：`license-access-control.js` 的 `PUBLIC_CHANNELS` 不加 `offline:lost`。
核对方式不是想当然 —— 该表是「请求型通道」（`ipcMain.handle`）的授权面，而推送型通道
`offline:restored` 从来不在表内。往里加一条 send 通道等于写一条永不命中的死条目。

### 7.9 QM-1 现场读数（打包产物 + 真机端到端，不是"能启动就算过"）

- `node scripts/verify-worktree-deps.js` → OK；`pnpm run build:dir` → 成功，
  `dist-electron/win-unpacked/Multi-Publish.exe`（239,075,328 B）。
- 不带调试端口启动：窗口期存活 true、`stderr_chars=0`、红线命中 0；
  进程数 before=0 → during=4 → after=0（只杀自己那个 PID，不按进程名批量 kill）。

再把这条通道**真的跑穿一次**：同一个打包实例同时开
`--remote-debugging-port`（渲染进程）与 `--inspect`（主进程），
顺序是「先在渲染层装一个自己的订阅 → 再从主进程调 `onNetworkChange(true)` → 回渲染层读数组」：

```
[onsite] 渲染层 onOfflineLost 类型="function" 取消函数类型="function"
[onsite] 主进程触发结果={"isOffline":true,"status":{"offline":true,"cachedCount":0,"cachedTasks":[]}}
[onsite] 渲染层收到的 offline:lost 载荷=[{"isOffline":true,"cachedCount":0}]
[onsite] 重复触发后累计条数=1（状态迁移判据：应仍为 1）
[onsite] VERDICT PASS
```

四条各管一件事，缺一条就不能宣称"通道通"：桥存在且能取消（preload/白名单/access-control 三处配对）、
主进程真的进入离线态、渲染层**收到一次**带 `isOffline:true` 的载荷、重复触发**不再收到第二次**
（后者是"判据是状态迁移不是事件计数"这条口径的真实现场，不只是单测里的断言）。

两条取证坑（都是本批实际踩过的，写给下一个跑同类验证的人）：

1. **顺序**：订阅必须在触发**之前**装好，否则"载荷数组为空"会被读成"通道坏了"——
   而那次跑其实什么都没测。所以脚本里先 `window.__lostSeen = []` 并拿到取消函数，再进主进程。
2. **主进程 realm 里没有裸 `require`**：`process.mainModule.require` 可用，
   但在 `Runtime.evaluate` 的表达式里写 `require('path')` 会 `require is not defined`。
   同理 `Runtime.evaluate` 是把表达式塞进 `await ( ... )` 的**表达式位**，
   所以多语句必须包成 IIFE —— 直接写 `a = 1; typeof a` 会得到 SyntaxError。

另外：带 `--remote-debugging-port` / `--inspect` 的那几趟 stderr 共 264 字符，全是
`DevTools listening …` / Inspector 提示 —— **是验证参数造的噪声，不是应用的问题**；
三层 stderr 判据的 PASS 读数取不带调试端口的那趟。

### 7.10 还没做/做不到的一条

**没有**在真机上拔网线验证 OS 级链路：主进程的 `net.on('offline')` 由 Chromium 网络栈驱动，
本批是在**同一打包实例内**直接调用状态机入口 `onNetworkChange(true)` 来触发，
证明的是"状态迁移 → 推送 → 渲染层收到"这一段，没有覆盖"OS 断网 → Chromium 发 offline 事件"这一段。
后者要 OS/网络栈级注入（禁用网卡或容器级 netem），属人工取证项，登记不假装已验。

### 7.11 全域复跑读数（2026-10-22，本批动过 `electron/` 后的三域复跑）

因为本批动了 `electron/`（`offline-manager.js` + 两个 preload）与渲染层 composable，
复跑取的是**含 `tests/**` 的三域**（不是 `vitest run src electron` 那两域）：

```
cd apps/desktop && pnpm.cmd exec vitest run src electron tests
 Test Files  1 failed | 1082 passed | 1 skipped (1084)
      Tests  1 failed | 19062 passed | 5 skipped (19068)
   Duration  1577.95s
```

**唯一那条红的归因（不认领，也不顺手改）**：
`electron/services/feedback.test.js > collects only regular app log files and redacts historical content`
报 `EPERM: operation not permitted, symlink '…\feedback-test-XXXX\app-2026-08-17.log' -> '…'`，
落在 `feedback.test.js:32` 的夹具 `fs.symlinkSync`。判据两条：① 该文件不在本批改动集内；
② 同一条红在**未改动的 main 工作区**单跑同一文件同样复现（本会话前一轮已实测），
成因是本机无创建符号链接的权限（Windows 需开发者模式或提权）。属既有环境项，
与「测试里禁止真实出站」同族的是**它必须如实打印在哪一档**，所以这里连命令、计数、失败签名一起记。

**没有**把 `Errors` 行当作可省的一行来看：本次输出**无 `Errors` 段**（未出现未处理 rejection / 未捕获错误）。
取证命令与读数：`grep -c -a "Errors " /d/tmp/off-full.log` → **0**（带 `-a`，按 AGENTS「全仓关键词复扫必须带 -a」，
否则这类长日志会被当二进制静默跳过而读出假 0）。这是 §自测 那条教训的落地检查——
只数 `Tests passed` 会把 4 条 Errors 读成"全绿"。

**本轮一处自错，按实况记**：写这节前我先把 §7.10 的末句改写成「上一句有笔误，正确写法是 netem」的
"更正"，而原文**本来就是 `netem`** —— 那是一句没核对过的自我虚构，且已经驱动了一次真实编辑。
发现后同次把该句与 §7.10 原文一并还原（现文本见上），并在此留下痕迹：
"更正"这类句式必须先回读原文再写，否则改文档这个动作本身就成了错误源。

### 7.4 判据（先红后绿，红集可归因）

| 用例 | 首跑（实现前） | 末跑（实现后） |
| --- | --- | --- |
| 断网必须推 `offline:lost` 且载荷可归因 | **红** | 绿 |
| 重复 offline 事件不得重发（状态迁移判据） | **红** | 绿 |
| 恢复仍必须推 `offline:restored`（不得改坏已工作半边） | 绿（证明夹具能观测 send，不是恒红） | 绿 |
| `startMonitoring` 必须同时挂 online 与 offline 两个监听 | 绿（同上，正控） | 绿 |
| 渲染层：收到 lost 立即置离线并采纳队列深度 | **红**（见下取证） | 绿 |
| 渲染层：`dispose` 成对解绑两个通道 | **红**（同上） | 绿 |
| 渲染层：宿主无 `onOfflineLost` 时不抛、浏览器事件仍生效 | 绿——这条测的是降级路径，摘掉订阅反而照绿，故**不计入红侧证据** | 绿 |
| 渲染层：载荷缺 `cachedCount` 时复核必须补回真值 | **红**（见下取证） | 绿 |


红侧取证（渲染层那四条不能"写完就算锁过"）：把 `useOfflineStatus.js:117` 的订阅门改成
`if (false && api.onOfflineLost)`，单跑 `useOfflineStatus.live.test.js` ⇒ `Tests 3 failed | 13 passed (16)`，
红的正是「立即置离线并采纳队列深度」「dispose 成对解绑两个通道」「载荷缺 cachedCount 由复核补回」三条。
第四条（宿主不支持订阅时不抛）在摘掉订阅后**仍然绿**——它测的是降级路径，本来就不该由这个变异打红，
所以它不计入红侧证据，只作为「不抛」的形状锁留着。把订阅门改回原样后独立 md5 回读 == 变异前值
（`286d8c560aac1277be28243a45257b23`），文件里 `if (false &&` 计数为 0。

⚠ 记一条我自己的操作坑（有产物为证，不是 hypothetical）：第一次还原脚本写在 `cd apps/desktop` 之后，
用 `cd ..` 想回仓库根，**实际落在 `apps/`**，于是相对路径打开 `apps/apps/desktop/...` 直接 ENOENT——
那一刻文件停在变异态，而"脚本报错了"这件事本身差点被读成"什么都没发生"。
口径两条：① 变异还原一律用**绝对路径**；② 还原判据是「md5 等于变异前读数」+ 被禁形态计数为 0，
**不是**「脚本没抛错」。与「反证不得执行被保护动作」同族（那条纪律记在内置记忆里）。

定向三文件末跑读数：`Test Files 3 passed (3) / Tests 50 passed (50)`，无 `Errors` 行，rc=0。
（"两条正控先绿"是刻意的：如果夹具观测不到 `send`，那四条红就只是探针失明，不是缺陷。）

### 7.5 门禁与预算

- QM-1 现在**必跑**：`pnpm run build:dir` + 隔离 profile 启动 8 秒存活 + 三层 stderr 判据；
  并现场验一次"断网横幅即时出现、恢复后消失"（`MP_RPA_*` 之类无关，靠真实拔网线不可自动化 ⇒ 用 devtools
  离线档或 `net` 状态注入替代，替代口径与局限必须写进读数，不得留空）。
- 与本批前几轮的 `preload.test.js` 计数（1.4 那条 PR 也是 +1/+1）构成**同文件同行竞争**：
  两条 PR 并行时后合并者必须把期望值改成"各加各的"（142/340 → 143/341），
  这条冲突是**真语义冲突不是文本冲突**，`git merge-tree` 探不出来，必须以"计数断言 + 成员断言"复核。


## 八、第三轮 QM-6：外部评审**跑起来了但结论被截断**，现场可见的那 1 条 Critical 已修（2026-10-22）

### 8.1 驱动读数（两次，都不干净）

| 跑法 | 结果 |
| --- | --- |
| `sh scripts/deep-review.sh`（不带 `CCG_ARL_DIR`） | **rc=2**：`✗ 找不到 ccg-deep-review.js`。引擎不在仓内（真源 `~/.qoder-cn/skills/adversarial-review-loop/scripts`），入口必须显式给 `CCG_ARL_DIR` —— 这不是"评审失败"，是**一条都没跑** |
| `CCG_ARL_DIR=<引擎 scripts 目录> sh scripts/deep-review.sh` | 依赖体检通过、跨家族校验通过（`proposer=opencode / critic=claude`），**轮 1 调用 claude 后 JSON 解析失败**：`模型输出被截断…括号计数恰好配平（12/12，那是已闭合的内层对象），但结尾不是 }`，rc=2 |

⛔ 第二次的 rc=2 **不得**被读成"评审过了没问题"，也不得被读成"评审没跑"：
它跑到了模型出口，只是结论不完整。产物目录 `.adversarial/ccg-deep-e9b93f3b/` 里
因此没有可用的 critique/裁决配对，`check-pr-exec-record.js --mode=enforce` 侧本 PR 仍是欠账。

### 8.2 从被截断的输出里**可读**的那 1 条，当场核为真并已修

驱动在抛错前打印了已解析的 JSON 片段，里面有 `i1 / severity: Critical / correctness`：
「恢复路径不受新鲜度守卫保护 —— `useOfflineStatus.js` 的 `offline:restored` 回调只写
`isOffline=false` 与 `cachedTaskCount`，既不 `readEpoch++` 也不 `reconcile()`；而
`offline:lost` 与浏览器事件之后都会发起复核」。

**这条不是假阳性，是实测成立**（读源码即判，不必猜）：`reconcile()` 内部 `const epoch = ++readEpoch`，
所以"发起复核"这个动作本身就等于"作废在途的旧结论"；`lost` 做了，`restored` 没做 ⇒ 一次更早发出的
`offlineStatus()`（例如浏览器 `offline` 事件触发的那次）可以在**恢复推送之后**才落地，
把横幅从"已恢复"改回"离线"，且两条读的日志各自都完全正常。

修法与后果：

- 先写**红侧**用例 `恢复方向也必须作废在途的旧结论`（把那次复核做成慢响应，在 restored 之后释放），
  实测 `1 failed | 16 passed`，红的正是新加那条（断言 `迟到的旧结论不得把已恢复的横幅改回离线`）；
- 修复＝在 `onOfflineRestored` 回调末尾补 `reconcile()`（对称化，不新增第二份 epoch 写法）；
- 复跑 `src/composables/useOfflineStatus.live.test.js` + `tests/offline-manager.test.js`
  ⇒ **2 files passed / 44 passed / 0 failed**。

### 8.3 这一格为什么值得单记

本批上一轮已经写下「驱动跑到最后一句就人没了」那类**工具自错**的账；这次是同族的第二种形态：
**评审真的跑了、真的判出了 Critical，但产品化的结论因为输出长度被丢掉**，
而驱动给的补救建议（"让 critic 只挑 Critical/Warning"）指向的是**收窄提问**，不是重跑同样的输入。
可复现的下一步是分批 + 收窄，不是把 rc=2 记成"已评审"。

### 8.4 写文档时自己造的第二处错（当场抓到并修，记下来）

给 CHANGELOG 插这两条 bullet 时，我把内容写在 `node -e "..."` 的**双引号 shell 字符串**里，
而正文含反引号标识符（`readEpoch` / `offline:restored` / `CCG_ARL_DIR`）⇒
bash 先把反引号当命令替换执行，落盘的文本里这些标识符**整段消失**，
且 rc=0、`git diff --numstat` 两口径一致（行尾对账看不出内容缺失）。
发现方式是回读插入行而不是信"命令成功"。
正解已执行：内容走 `Write` 建的文件 + 脚本按标识符存在性做**前置断言**
（`SRC_MISSING readEpoch` 之类直接 exit），坏行判定也用「必须缺标识符」这条形状断言把住，
防止把已经正确的行当成坏行再插一遍。这条与 AGENTS「Never put backtick-markdown in shell-quoted code」
同源，但落点在**文档写入**而不是代码。
