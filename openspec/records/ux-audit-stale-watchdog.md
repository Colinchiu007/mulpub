---
change: ux-audit-stale-watchdog
branch: ux-audit-stale-watchdog
date: 2026-10-22
---

# 执行记录：发布进度「无更新」可见化（UX 审计 1.8）

## 门禁表

| 项 | 状态 | 读数与判据 |
| --- | --- | --- |
| 变更类型与隔离 | ✅ | 运行时代码变更（`apps/desktop/src/`）⇒ 隔离 worktree `mp-ux-audit-stale-watchdog`，裸分支 `ux-audit-stale-watchdog`，落点 `D:\Data\projects\mp-worktrees`（非 C 盘）；`node scripts/verify-worktree-deps.js` → OK（11 项解析通过） |
| TDD | ✅ 先红后绿 | 新增 `src/stores/publishProgress.stale.test.js`（9 条）**首跑 9 failed / 0 passed**（`/d/tmp/stale-red.log`：`Test Files 1 failed`、`Tests 9 failed (9)`），实现后同文件 9 passed；面板侧 4 条新用例首跑即红 1 条（`handleClose` 被写成两份、旧的一份覆盖新的），修完 45 passed |
| 消费者并集 | ✅ | 第二轮重算并集为 **14 个测试文件**（`git grep -l` 按 5 个被改 stem 取并集）：**305 passed / 0 failed，无 `Errors` 段**。第一轮那 12 文件 298 是外置前的范围，已被本轮取代（范围口径不变：不含 `electron/` 与 `tests/`） |
| 全域 | ✅ 两处红均**不是我引入的**，且当场归因后已消 | `pnpm.cmd exec vitest run src`（未先 `build:preload`）⇒ `405 files: 2 failed / 403 passed`、`6413 tests: 2 failed / 6409 passed / 2 skipped`。两条红的**同一**根因是构建产物缺失：`src/overlay-view-suspension.test.js` 与 `src/shell-mode-6b.test.js` 都 `readFileSync(electron/preload/index.bundle.js)` ⇒ `ENOENT`。跑 `pnpm run build:preload`（rc=0）后同两条 **29 passed**。归属判据：本批未动 preload，且这两条是既有的"产物先于测试"前置（AGENTS 5.4 的「先 build:preload」）——**不认领，也不顺手改测试** |
| 反证（10 道） | ✅ | `node scripts/stale-watchdog-contract-mutate.js --keep-going` ⇒ `[BASELINE] rc=0 failed=0 passed=47 collected=47 errors=0 blind=false`、`[SUMMARY] 共 10 条：CAUGHT=10 其余=0`、10/10 `RESTORE_OK`、驱动真实 rc=0（不经管道取）。S2 首跑是 **PARTIAL_RED（探针 0/1）**，成因见 §3.1；S4 首跑 **ANCHOR_NOT_FOUND**（锚点跨过了我新写的注释行），改窄为只摘守卫那一条后 CAUGHT。新增两道的来路见 §4 |
| QM-1 打包 | N/A（如实声明） | 本批只动 `apps/desktop/src/`（store + 三个组件 + locales），未触 `electron/` 与 `packages/rpa-engine/` ⇒ 按 QM-1 的触发条件不适用。**不是**"跑过且通过"，是"未触发" |
| QM-4 视觉 | ⏳ 交 CI 判 | `/first-run` 类改动不同：本批动的是 `PublishProgressPanel` 的徽标 DOM（class 由静态变绑定）与任务行文案。非陈旧态下 class 集合与文本未变，但**这不是我本地能证的** —— 由 `QG Visual`（Gate 7，windows-latest + CI 的 Chromium）判，红则按"基线只能取自同一次 CI 渲染"口径处理，禁止 `--update-baseline` 消化 |
| 静态门禁 | ✅ | `check-locale-sync.js --pair-base origin/main` → **PASS**；`--cjk` → **PASS（基线 1330 条，当前 1124 条，无新增硬编码）**；新增 3 键 zh/en 逐个 `grep -c` 均为 1；聚合 eslint 8 个改动文件 rc=0 |
| 行尾对账 | ✅ | 提交后 `git diff --numstat HEAD~1 HEAD` = **add 1357 / del 17**，与 `--ignore-cr-at-eol --numstat` 两口径**逐字一致**（差得远即行尾被改写）。新建文件一律 LF；`CHANGELOG.md` 顶部新条目按现场形态补成 CRLF 与该 blob 既有行尾一致（当场 `node -e` 数得 cr=23556 ⇒ 工作副本 CRLF），审计文档 cr=0（LF）未动 |
| 新文件未被 .gitignore 吞掉 | ✅ | `git check-ignore --no-index -v` 实测 `scripts/*.js`（.gitignore:106）**确实命中**新建的反证驱动 ⇒ 按既有惯例补 `!scripts/stale-watchdog-contract-mutate.js`（同族第 N 次：漏反选的症状是"本地全绿、CI 上 Cannot find module"）；测试文件 `publishProgress.stale.test.js` 不在忽略域内 |
| QM-6 双模型 | ⏳ | 见 §5 |
| 远程同步 | 由门禁推导 | PR 号见 §5；合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导收口，不手写状态词 |

## 1. 用户可见变化（逐项）

| 位置 | 修前 | 修后 |
| --- | --- | --- |
| 面板头部徽标（全部任务 3 分钟无事件） | 永远转圈显示「进行中」，与"正在推进"不可区分 | **停掉转圈**，中性档显示「N 分钟无更新」；不用失败红（无事件不是失败的证据） |
| 任务行状态列 | 只显示阶段词 | 无更新的行追加「（N 分钟无更新）」；未陈旧的行不追加 |
| 关闭按钮 | `:disabled="hasRunning"`，挂死时**永久灰** | `hasRunning && !hasStalledRunning`：只要还有任务在动仍禁；全部无更新即解禁，`title` 改为「任务已 N 分钟无更新，可关闭面板（不会取消任务）」 |
| 点关闭 | 只在 `sessions.length===0` 时收起 ⇒ 即便解禁也"点了没反应" | 追加 `|| hasStalledRunning` 出口：真的把面板收起，且**不丢** `sessions`（展开仍是原状态）、不发取消 IPC |

## 2. 时钟与预算

- 阈值 `STALL_AFTER_MS = 180_000`、心跳 `STALL_TICK_MS = 15_000` 均在 store 模块级单点导出，
  组件不再各算一份时间差（反证 S1 打的就是"阈值被改成永不发火"这一格）。
- **同域比较**：判据两侧都取渲染端 `Date.now()`（`lastEventAt` 本就是它写的），
  刻意**不读**事件里带来的主进程 `timestamp` —— 反证里专门有一条
  「事件带一个 13 位纪元戳，不得据此判陈旧」。
- 测试全部 `vi.useFakeTimers({ now: … })`，不写死"相对当下的绝对时间戳 + 相对窗口"那种引信形态。

## 3. 本轮两处自错（按实况记，不删）

### 3.1 `watch` 恒不触发 —— 一条"接了线但不执行"的装饰性接线

最初把 tick 的启停挂在：

```js
watch(() => 有没有非终态任务, (hasLive) => hasLive ? 起 : 停, { immediate: true, flush: 'sync' })
```

看起来是"所有出口自动覆盖"的最省写法。实测**一次回调都没执行**：本 store 的会话对象是
`push` 进 `ref([])` 之后按**原始引用**继续改的（`_createSession` 返回 raw session，
`_ensureTask` / `handleProgressEvent` 直接改 raw），Vue 的响应式追踪看不见这些写入。

发现方式不是读代码，是**新写的行为锁当场红**：`存在非终态任务 ⇒ 需要 tick` 那条读出
`活跃 tick 数 = 0`。如果我只测"陈旧集合对不对"（computed 在被读时照样算得出来），
这条装饰性接线就会带着"看起来已实现"的状态进主干。

中间实现曾改为「显式挂在必经出口 `_recomputeSessionStatus` 上，并对三条**不经该出口**的路径
（新建会话分支 / `dismissSession` / `clearFinished`）各补一次调用」——
**这句描述的是已被放弃的那一版**（QM-6 第二轮 i5 点名更正）。最终形态见 §3.4：
派生层整体外置到 `publishProgressStall.js`，`usePublishProgressStall(store)` 用 WeakMap
按 store 实例缓存 tracker，启停由**面板**这一宿主用公共入口 `beginStallClock` / `endStallClock`
负责，tick 内部自泊，面板再 watch `hasRunning` 与 `sessions.length` 把它叫回来。
"单一入口"在这里不成立，成立的是"**单一判据 + 由唯一的读者决定生命周期**"。

### 3.2 同名函数被写出两份，后者静默覆盖前者

改 `handleClose` 时没注意文件里已有一个同名声明，于是我以为的新实现是**死代码**。
抓它的正是 §1 第 4 行那条用例（解禁后点关闭 ⇒ `panelVisible` 仍为 true）。
已删除旧实现，只留一份。教训与 §3.1 同源：**"我以为改了"与"运行时执行的是哪一份"是两件事**，
只有行为锁能分辨。

### 3.3 反证 S2 首跑 PARTIAL_RED 的成因（判据顺序，不是断言写错）

`stalledTaskIds` 是 computed，副作用只在**求值时**发生。用例原先的顺序是
「断 phase 未变 → 再读 stalledTaskIds」，于是 S2 注入的 `task.phase='failed'` 发生在断言之后，
锁抓不到自己声称的东西。修法不是改宽断言，而是**按生产的读取顺序排队**
（先算派生值，再断 phase）—— 面板渲染就是这个次序。
这条与「测试断言不得反向固化错误行为」同族，但落点是**断言顺序**，值得单记。

## 3.4 第二轮：CI 红逼出来的落点重构（派生层从 store 外置）

**现场读数**：`QG Changes` 红，逐步归因到 `scripts/lib/git-domain.test.js` 子用例 ⑩ ——
`AssertionError: 消费者套件必须整体通过 … FILES_OVER_500: 96 > baseline 95`。
`check-debt-budget.js` 的计数判据是 `lines >= 500`，`publishProgress.js` 本来 496 行
⇒ **只有 3 行余量**，本批任何"往 store 里加一层"的形式都会撞上它。

**两条候选的取舍**（记下来是因为第二条被实测否证）：
① 调大基线到 96 —— 直接否决。AGENTS「计数/比例型门禁」条写明正解是补东西而非调阈值，
且 `scripts/debt-baseline.json` 调大须与真实清理同 PR；为"容忍自己新增"而调大 = 把熔断改成装饰。
② 搬出去 —— 采纳。先例是同目录 `publishProgressSessionMerge.js`（同一条门禁逼出来的）。
抽第一版后 store 仍 521、第二版仍 500（**500 也红**，因为判据是 `>=`），
第三版把 store 收敛成「相对 `origin/main` 只多一个 `export` 关键字」才回到 95。

**搬动带来的三个真实改动**（不是纯粹的机械搬迁，各有一条新锁）：
1. 时钟生命周期从 store 移到**面板**（`beginStallClock` / `endStallClock`）。
   理由不只是行数：这一层存在的唯一目的是让面板重新渲染，store 不该为可能不挂载的读者常驻定时器。
   新增 V12（面板挂载起表 / 卸载交还同一句柄）。
   写这条用例时我第一次拿 `mock.calls[i][0]`（回调函数）去比 `clearInterval` 的首参，
   恒不等 ⇒ **句柄必须取 `mock.results[i].value`**，注释已写进测试防重演。
2. tracker 按 **store 实例** WeakMap 缓存（`usePublishProgressStall(store)`）。
   模块级单例会让定时器跨实例泄漏（多次 `setActivePinia`、测试逐例、未来第二个消费方）。
   新增 V13（两次取用返回同一对象 + 取用本身不起表）。
3. store 的 `TERMINAL_PHASES` 改为 `export`，由派生层 `import` —— 终态集合仍是**一处派生**，
   没有第二份。面板测试因此必须用 `vi.importActual` 把真集合带出来，
   不得在夹具里另抄（抄了就是"替对方剥壳"，集合漂移时测试照样绿）。

**新增两道反证都来自本轮真实写错的形态**（不是设想）：
- `S6` 读数从 `nowTs` 换成当场 `Date.now()` —— 直觉上"更准"，实际切断 computed 的失效链，
  第一次求值后冻结；当时让 `advanceTimersByTime(3*MIN)` 后仍读出 `[]`。CAUGHT 红 5 条。
- `S10` `publicApi` 退回普通对象 —— 模板不做跨对象解包，`Boolean(ComputedRef)` 恒真，
  症状是"徽标永亮 + 转圈永不停 + 关闭永久解禁"且**不报错**。CAUGHT 红 10 条（探针 2/2）。

**测试夹具的一次实质加强**：面板测试删掉了 `storeStateRaw` 里的
`hasStalledRunning` / `maxStallMinutes` / `stalledTaskIds` / `taskStallMinutes` / `isTaskStalled`
五个存根（它们在新落点下没有读者，属"死观测字段"——正是阶段 5.4 要门禁的东西），
改为只喂 `lastEventAt` 让真 tracker 算。副作用是面板测试从"测夹具"变成"测派生 + 绑定"，
37 条全绿且 `S7/S8/S9/S10` 都在这上面变红。

## 4. 收尾清单（提交后回填）

- 提交：`78bb932ab`，`git diff --numstat HEAD~1 HEAD` = add 1357 / del 17，
  与 `--ignore-cr-at-eol --numstat` 逐字一致 ⇒ 行尾未被改写。
- 新建脚本 `scripts/stale-watchdog-contract-mutate.js` 已随 `.gitignore` negation 一起进提交
  （`git check-ignore --no-index -v` 当场证明它命中第 106 行 `scripts/*.js`）。
- PR 号、CI 结果、是否自动合并及理由：见 §5。

## 5. QM-6

### 5.1 第一轮（批判产物 10 条：1 Critical + 4 Warning + 5 Info）

- 产物（**已复制到受跟踪面**，因为 `.adversarial/` 被 .gitignore 吞掉 —— 只留在引擎工作目录里等于证据随本机清理而消失，这是本仓记过的「产物在 gitignored 目录 ⇒ 不构成证据」同型坑）：`.ccg/reviews/stale-watchdog-critique-round1.json`（批判原文 10 条）与 `.ccg/reviews/stale-watchdog-adjudication-round1.json`（逐条裁决），`critiqueFingerprint=fe1111ad3f0fe4c0`。
- 逐条处置见 `01-docs/PRD-STALE-WATCHDOG-2026-10-22.md` §10。采纳并修 i1/i2/i3/i4/i7/i8/i10，i5 驳回前提并补锁，i6/i9 落成显式裁决。
- **i1 是本批唯一 Critical，且是真缺陷**：`taskStallMinutes` 的多会话路径把「没找到」读成「不陈旧」。  现场修法是先补双会话用例再由反证 S11 证明该用例确实打这一格（退回 `return 0` 只有那条红）。
- 引擎把 i1/i3/i5 标为高危域（`domains:["auth"]`）要求外部复核。该标签系启发式误判 ——   改动集全仓无 auth/凭证/登录态路径（见本次 `git diff --name-only`）。**但不因归因错误而免跑**：  判据问的是「这类面有没有被外部模型看过」，不是「标签打得对不对」；所以第二轮对外置后的最终 diff 跑真外部评审，  闭环状态以 `tier=external` 的证据收口（见 5.2）。

### 5.2 第二轮（对外置重构后的最终 diff，真外部模型）

- 后端：`critic=claude`（评审主力）+ `proposer=opencode`（跨家族校验），
  经 `sh scripts/deep-review.sh --force` 实跑，判定基线 `origin/main`（2365 行），
  产物 `.adversarial/ccg-deep-4583f881/`（`critique-v1.md` 8 条：5 Warning + 3 Info）。
- **i1 Critical 之后没有再出现 Critical**，但第二轮抓到 4 条会改变行为的 Warning：

| # | 严重度 | 裁决 | 落点 |
| --- | --- | --- | --- |
| i1 | Warning | 采纳（前提部分驳回） | V12 原先在**全局** `setInterval` 调用历史上 `findIndex`，把「之前每次 mount 都被拆毁了」这条隐含前提交给文件级 `afterEach`。实测本仓 `afterEach` 确有 `wrapper?.unmount()`（两处，属上游既有形态，不在本批合并），所以「V12 直接红」的后果没有现场发生；但前提交进判据是免费的 ⇒ 改为只认本用例挂载之后新增的那一起表（`callsAtStart` 切片）。 |
| i2 | Warning | 采纳并修 | 真缺陷：`begin()` 无条件 `setInterval`，自泊只发生在 tick 内部 ⇒ 面板在「零非终态任务」时挂载也要白起一次 15s 定时器，直接违反 spec 的「无运行中任务 ⇒ tick MUST 已停止」。修法是起表前自检 `hasLiveTask()`，配套把面板 watch 从只读 `hasRunning` 扩到也读 `sessions.length`（数组级写入是 Vue 追得到的那一维）。新增两条用例（store 侧 + 面板侧空态不建表）与反证 S13。 |
| i3 | Warning | 采纳并修 | `blocked` / `captcha` 按设计就不会产生进度事件，却与非终态相位一起被当陈旧候选：用户正在输验证码时被贴「N 分钟无更新」，且若它是唯一 live 任务还会解禁关闭 —— 与本层自己的口径 I1（「没有新事件」不是证据）冲突。改为显式豁免集合 `STALL_SILENT_BY_DESIGN`（不算陈旧、但仍算 live ⇒ 继续禁着关闭）。新增用例 + 反证 S12。 |
| i4 | Warning | 采纳并修（选了更稳的那一支） | 评审指出关闭判据跨两条派生链，「`status=running` 而 `live=0`」时会得到「按钮可点、点了不收起」，即本批要消灭的形态换入口复活。采纳其**修法建议**：`:disabled` 与 `handleClose` 整条换成任务 `phase` 链（`hasLiveTasks` / `hasStalledRunning`）。附带一条现场收获：改完后既有测试「完成后可点」变红 —— 它的夹具只改 `status` 不改 `phase`，造的正是这条错位态；按真源语义（任务落终态才收口 status）补写 `phase`，而不是把判据改回去。新增反证 S14。 |
| i5 | Warning | 采纳并修 | 文档漂移：CHANGELOG 与记录 §3.1 还写着第一版机制（挂 `_recomputeSessionStatus` 并补三条调用），而 shipped 代码是「WeakMap 按 store 实例 + 面板持有生命周期」。同处 i7 刚以「文档 vs 代码」为由修过三处 ⇒ 本轮把两处一并改写为最终机制，并 `grep -na _recomputeSessionStatus` 全批文档确认无残留。 |
| i6 | Info | 采纳并修（改文案不改判据） | `maxStallMinutes` 用在头部与 `title` 上时，「任务已 N 分钟无更新」对非均匀陈旧集合是**过陈述**（3/5/40 分钟只显 40）。文案改为「最久 N 分钟无更新」/「longest …」，zh/en 成对；行级后缀是按任务自己的分钟数，不改。 |
| i7 | Info | 采纳并修 | `eachLiveTask` 对每个任务调 `stallAnchor` 两遍（传参一次、求 idle 一次）⇒ 先算一次再传。合并三处全扫为单份 `taskId → minutes` computed 仍属另批（与第一轮 i6 同一裁决）。 |
| i8 | Info | 落成裁决 | 混合态头部继续转圈 —— 写进 PRD §5.7 与 spec 的「部分任务仍在动」Scenario，由面板用例钉住（头部不含无更新字样 + 行级后缀在场）。 |

- **引擎出口与闭环**：第二轮收敛判定仍是 `status=self_play`（critique 来自真外部模型 claude，
  但**裁决**由本会话填写），其中 2 条被标高危域要求外部复核。高危域标签在此批系启发式误判
  （改动集全仓无 auth/凭证/登录态路径），但判据问的是「这类面有没有被外部模型看过」，
  不因归因错误而免跑 ⇒ 收口走 `tier=external` + 可核 evidence（本记录的产物路径 + PR #4222），
  并在 `closureNote` 里如实写明「critique=外部模型、adjudication=本会话」这一层分工。

### 5.3 结算现场读数与**未闭合**的结论（不改写）

`node …/ccg-deep-review.js --sha 4583f8814…`（零模型调用，复用存档 critique 8 条 + 已填裁决）打印：

```
♻ 复用存档 critique（8 条）+ 已填完的裁决 —— 跳过模型调用
🔴 自扮演裁决判定存在阻断项 5 条
   - [Warning] i1 self_play_upheld / i2 … / i3 …
   - [Warning] i4 high_risk_requires_external / i5 high_risk_requires_external
```

产物 `.ccg/reviews/4583f8814d….json` 里引擎自己写的是
`mode=dual, deepReview.status=self_play_blocked, performedBy=self-play`。

**结论：本 PR 不自动合并。** 三条理由，一条都不粉饰：

1. 机制缺口（已知、另议）：「外部模型评审过 → 裁决成立 → 同一批里修完」在当前判据里没有合法闭合档
   —— `upheld` 一律计阻断，`self_play_resolved` 只表达"自扮演判定已消化"，
   而把 status 手改成闭环值正是 AGENTS 禁止的「手写 status 买绿」。
2. `performedBy` 我只在本文与 PR 评论里如实补充（critique=claude 真实外部、adjudication=本会话），
   **不改产物里的这个字段** —— 改它就是替门禁伪造执行者。
3. 引擎标出的 2 条 `high_risk_requires_external` 我没有外部复核证据可挂（`tier=external` 的
   可核 evidence 需要"该条争议被第二个模型独立看过"，本轮只有一次 critique + 一次自扮演裁决）。

因此本轮产物全部入库（批判原文、两轮裁决、结算读数），PR 保持 open，
连同其余在飞 dual PR 一起进「QM-6 闭合需人工」账（task #19）。

## CHANGELOG 条目

# [未发布] fix(发布进度): 「无更新」看门狗 —— lastEventAt 第一次有了读者，卡住的面板终于关得掉（ux-audit-stale-watchdog）

- **问题**：`stores/publishProgress.js` 在四处写 `task.lastEventAt`（`:104/:166/:173/:213`），**全仓零读取**（当场 `git grep` 复核，其余命中全是测试夹具）。而 `PublishProgressPanel.vue` 的关闭按钮是 `:disabled="store.hasRunning"`，`hasRunning` 只能被**终态事件**解除 ⇒ RPA 窗口挂死、主进程任务没发出终态时：徽标永远转圈「进行中」、底部「请勿关闭应用」常驻、**关闭按钮永久灰**，用户唯一能点的「取消全部」走的还是同一条可能已挂死的链路，只剩重启应用排障。
- **落地的三条口径**：① **只读派生** —— 陈旧不改 `phase`、不写持久化、不触发取消/重试。「没有新事件」不是失败的证据；映射成 `failed` 会让一次 IPC 投递抖动变成用户可见红态并污染发布历史（与本仓「状态只被正/负证据改写」同源）。② **锚点回落链** `lastEventAt ?? startedAt ?? session.createdAt` —— 「登记了但一个事件都没来」正是需要看门狗的那一种，因"没有锚"而永不陈旧即失灵。③ **阈值单点 + 时钟同域 + 惰性单实例 tick**：`STALL_AFTER_MS=180000` / `STALL_TICK_MS=15000` 由 store 一处导出（组件不再各算时间差），两侧都取渲染端 `Date.now()`（刻意不读事件里带来的主进程 `timestamp`），tick 只在有非终态任务期间存活。
- **用户侧变化**：全部任务 3 分钟无事件 ⇒ 徽标**停掉转圈**并显示「N 分钟无更新」（`--color-text-muted` 中性档，不用失败红）；任务行追加「（N 分钟无更新）」；关闭按钮在「全部无更新」时解禁、`title` 改为「任务已 N 分钟无更新，可关闭面板（不会取消任务）」；**部分陈旧仍禁用**（还有在动的任务，收起面板等于丢可见性）。文案 3 键 zh/en 成对进 `locales/publish-page`。
- **本批最有价值的一条：两处"看起来已实现"的装饰性接线，都是新写的行为锁当场抓出来的**（不是读代码读出来的）。① tick 启停最初挂在 `watch(() => 有没有非终态任务, …)` 上——看着是"所有出口自动覆盖"的最省写法，但本 store 的会话对象是 `push` 进 `ref([])` 后按**原始引用**继续改的（`_createSession` 返回 raw session，`_ensureTask`/事件处理直接改 raw），Vue 追踪看不见这些写入 ⇒ 回调**一次都没执行**；若只测"陈旧集合对不对"（computed 被读时照样算得出来），这条死接线就带着"看起来已实现"进主干了。最终形态既不是这条、也不是"换个更巧的 watch"：派生层整体外置到 `publishProgressStall.js`（`usePublishProgressStall(store)` 用 WeakMap 按 store 实例缓存 tracker），启停由**面板**这一宿主用公共入口 `beginStallClock` / `endStallClock` 负责，tick 内部自泊，面板另 watch `hasRunning` 与 `sessions.length` 把它叫回来——"单一入口"在这里不成立，成立的是"单一判据 + 由唯一的读者决定生命周期"。（本句由 QM-6 第二轮 i5 更正：此处原文描述的是已被放弃的中间实现。）② 改 `handleClose` 时文件里已有一个同名函数声明，**函数声明后者覆盖前者** ⇒ 新写的那份是死代码，症状恰好就是本批要修的"按钮能点了但点了没反应"；由 §验收 V9 那条用例抓出后删旧留新。
- **附带一条断言顺序教训**：`stalledTaskIds` 是 computed，副作用只在求值时发生。用例原先「先断 `phase` 未变 → 再读派生值」让反证 S2（把 `task.phase='failed'` 写进派生路径）首跑只拿到 **PARTIAL_RED（探针 0/1）**——锁抓不到自己声称的东西。正解是按**生产的读取顺序**排队（先算派生、再断 `phase`；面板渲染就是这个次序），不是放宽断言。
- **验证**：新增 `src/stores/publishProgress.stale.test.js` 9 条（首跑 **9 failed** 的先红证据）+ 面板 4 条；消费者并集 12 个测试文件 **298 passed / 0 failed、无 `Errors` 段**；反证 `scripts/stale-watchdog-contract-mutate.js` 8 道（S1 阈值 Infinity / S2 陈旧写进 phase / S3 摘 `clearInterval` / S4 摘单实例守卫 / S5 `>=`改`>` / S6 关闭按钮退回 / S7 `handleClose` 退回只清空 / S8 不传分钟数）末跑 `CAUGHT=8/8`、8/8 `RESTORE_OK`、基线 `collected=45 passed=45`。`check-locale-sync --pair-base` 与 `--cjk` 均 PASS（CJK 基线 1330 → 1124）；聚合 eslint 改动文件 rc=0。QM-1 本批**未触发**（只动 `apps/desktop/src/`，未触 `electron/` 与 `packages/rpa-engine/`）；像素回归交 `QG Visual` 判，不用 `--update-baseline` 消化。
- **刻意不做**（写明）：无更新 ⇒ 自动取消/自动判失败（需主进程任务存活判据，单方面判定会造出「用户以为失败但平台已发布」的假结论）；audit-14 的 `aggregate` 进度口径；22 个未接 `useBatchPollGuard` 的轮询点；阈值不做用户配置（配置面即第二份真源）。阶段 5.4「死观测字段」门禁的上线条件由本批补齐——审计文档原写「5.4 不得早于 1.8」，顺序已按此执行。
- **第二轮的落点是被 CI 逼出来的，不是预先设计的**：第一版按任务 2.1/2.2 把派生层写进 `stores/publishProgress.js`，本地全绿，`QG Changes` 当场红 —— `check-debt-budget.js` 的判据是 `lines >= 500`，而该文件本来 496 行 ⇒ 只有 3 行余量，现场读数 `FILES_OVER_500: 96 > baseline 95`。正解是**搬代码不动基线**（调大基线等于把熔断改成装饰）：新增 `src/stores/publishProgressStall.js` 承载 `createStallTracker` + `usePublishProgressStall(store)`（WeakMap 按 store 实例缓存，避免模块级定时器跨实例泄漏），store 相对主干只多一个 `export TERMINAL_PHASES`，同目录 `publishProgressSessionMerge.js` 是先例。时钟生命周期随之改由**面板**持有（它才是唯一读者），并新增两条反证把本轮真实写错的形态钉住：S6「读数从 `nowTs` 换成当场 `Date.now()`」—— 直觉更准，实际切断 computed 的失效链 ⇒ 第一次求值后永久冻结；S10「`publicApi` 退回普通对象」—— 模板不做跨对象解包，`Boolean(ComputedRef)` 恒真 ⇒ 徽标永亮、转圈永不停且不报错。面板测试同时删掉 5 个在新落点下没有读者的派生存根，改为只喂 `lastEventAt` 让真 tracker 算。反证 8 → 10 道，`CAUGHT=10/10`、基线 `collected=47`、消费者并集 14 文件 `305 passed`、`filesOver500` 回到 95。
- **QM-6 第一轮外部评审抓到一条真 Critical（i1），且它逃过了全部 9 条 store 级用例**：`taskStallMinutes` 把「这个会话里没有这个 taskId」当成「这个任务不陈旧」直接 `return 0`。本 store 支持多会话（`MAX_SESSIONS=5`），于是落在第 2 个及以后会话的任务**永远读出 0 分钟**，行级「（N 分钟无更新）」后缀对它失灵——而面板测试当时用 `vi.fn` 把该函数整个 mock 掉，store 级用例又全部只建一个会话，两层夹具一起把这条路径遮死。修法：`if (!task) continue`（命中且终态才 return 0）+ 双会话用例 + 一条「未知 id / 终态都返回 0」的对偶用例，并加反证 **S11** 把 `continue` 退回 `return 0`（只有那条多会话用例红，证明这条锁抓的正是这一格）。同轮另处置：i2 补真 tracker 的面板级「新事件即解除」锁（写它时先按「徽标元素消失」断言，当场红——徽标是同一元素换类换文案）；i4 承认原「差 1 毫秒」用例**没测到它声称的那一侧**（读数只随 15s tick 推进，实际比的是 165000 vs 180000），改为用公共出口把钟精确钉在 179999/180000；i8 把跨用例残留的 fake ticker 在 afterEach 显式收掉并加「活跃 tick 为 0」卫生断言；i10 摘掉零消费方的 `isTaskStalled`（本批立项理由就是「不许有死观测字段」）；i7 按代码收敛三处文档漂移；i5 驳回「adopt 带上一次运行墙钟」的前提（领养新建会话，`createdAt` 是本次运行）但补一条锁；i6/i9 落成显式裁决。反证 10 → 11 道 `CAUGHT=11/11`、基线 `collected=52`、消费者并集 14 文件 `310 passed`。
- 文档：`01-docs/PRD-STALE-WATCHDOG-2026-10-22.md`（显示项/交互逻辑/数据校验/验收逐项）、`01-docs/UX-AUDIT-2026-10-17.md` §11、`openspec/records/ux-audit-stale-watchdog.md`。
