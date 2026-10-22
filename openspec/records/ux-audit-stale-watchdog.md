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

现改为显式挂在必经出口 `_recomputeSessionStatus` 上，并对三条**不经该出口**的路径
（新建会话分支 / `dismissSession` / `clearFinished`）各补一次调用 ——
"单一入口"在这里不成立，成立的是"单一判据 + 全部出口都调它"。

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

### 5.2 第二轮（对外置重构后的最终 diff）

（跑完后回填：后端真名、产物路径、条目与逐条处置、`deepReview.tier`/`evidence`、闭环状态。）

