---
record: fix-quick-collect-clock-rot
task: 快捷采集夹具写死绝对时刻而窗口判据读真实墙上时钟——CI 每过 48 小时自己变红
date: 2026-10-13
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账）
---

## 本次执行记录：快捷采集时钟腐化修复（fix-quick-collect-clock-rot，2026-10-13）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 🐛 Bug 修复 + 🧪 测试变更，且**动了运行时代码**（`apps/desktop/electron/ipc-handlers/quick-collect.js`）⇒ 必须隔离：`scripts/start-mp-task.ps1 -TaskName fix-quick-collect-clock-rot`，worktree `D:/Data/projects/mp-worktrees/mp-fix-quick-collect-clock-rot`、裸分支 `fix-quick-collect-clock-rot`，基线 `c6b4709cd` = 当时 `origin/main` tip（`git rev-parse origin/main` 实测同值）。依赖就绪三步实跑：`pnpm install --frozen-lockfile` 16.4s、`ensure-electron.js` v43.7.7 就绪、`verify-worktree-deps.js` OK（11 项消费方解析通过）。入口脚本按判据以产物为准（`git -C <worktree> rev-parse --abbrev-ref HEAD` = 分支名 + `git worktree list`），不以 rc 代替 |
| 第一性原因（QM-5 ①） | PASS | 不是"断言写错"，是**夹具与判据不同源**：`quick-collect` 家族的夹具写死 `const NOW = Date.parse('2026-10-11T04:00:00.000Z')`、`<pubDate>Sun, 11 Oct 2026 02:00:00 +0000</pubDate>`、`created_utc = (NOW - 3600_000)/1000`，而被测路径的窗口过滤读的是**真实墙上时间**。引入点是 `2026-10-11` 那批快捷采集 S1/S2 落地（当时"离 NOW 1 小时"确实成立），失效方式是日历：越过 `windowHours=48` 后条目全部落到窗口外。归因证据：本机 `pnpm exec vitest run electron/ipc-handlers/quick-collect.test.js` 于 2026-10-13T03:30Z 复现 `2 failed`，失败文案直接是产品自己的诚实回执「本次未检索到最近 **48 小时**内的可核对素材」 |
| 逃逸链（QM-5 ②） | PASS | ①单元层——同文件里纯函数用例**都**显式传了 `now: NOW`（`normalizeMaterial(item, { windowHours: 48, now: NOW })`），所以那批用例永远不会腐，给整套文件一种"时钟已经管住了"的错觉；②装配层——真正读时钟的是 IPC 注册面构造的引擎，而 `registerHandlers` 只把 `deps.now` 透给了 `createFeedTrendFetcher`，**漏了 `createQuickCollectEngine`**（半接线缝隙），所以即便夹具想注入也没有入口；③CI 层——desktop shard/coverage 跑的是全量，红只出现在"日历跨过 48 小时"那一天，PR 作者当时看不到；④审查层——既有 review 只看 diff 与断言，对"夹具的绝对日期 vs 产品的真实时钟"这条跨时间尺度的一致性没有判据。**系统性漏洞 = 时钟接缝只接了一半 + 没有任何东西看守"驱动真实时钟路径的夹具必须自带时钟"** |
| 修复 + 回归保护（QM-5 ④） | PASS | ①接缝补齐：`ipc-handlers/quick-collect.js` 的 `createQuickCollectEngine({...})` 增加 `now: deps.now`，并把 `deps.now` 加进引擎缓存的依赖身份 `keys`（否则后到的时钟会被旧引擎冻住——与同文件"不在注册期解构 deps"是同一条理由）；②夹具侧把时钟接上：`ipc-handlers/quick-collect.test.js` 的 `makeDeps`、`services/quick-collect-cn-sources.test.js` 的 `baseDeps` 各加 `now: () => NOW`；③行为锁（红→绿）：修前实测 `1 failed`（solidot `expected [] to deeply equal ['published']`）+ `2 failed`（IPC 两条），修后 `Test Files 2 passed`、`Tests 28 passed`；④消费者并集全跑（改的是被多文件消费的模块，验证范围取并集而不是"我改过的文件"）：`quick-collect` 家族 + `hot-topics-quota` + `bootstrap/phase5-ipc` + `src/features/collection` ⇒ **24 个测试文件 / 303 passed / 0 failed** |
| 防再犯锁（QM-5 ⑤） | PASS | 新增 `apps/desktop/electron/services/quick-collect-clock-determinism.test.js`（4 条，vitest 按 workspace 自动收集，无需另接 workflow）：①扫描域非空 + 驱动者下界（实测 13 个域文件、4 个驱动者，解析退化即红，且点名两个必须在内）；②真实域违规必须为空（判据按语义切：只有"驱动读时钟那条路"——构造引擎 / 构造 feed 抓取器 / 导入 IPC 注册面——且夹具含绝对时刻的文件才要求注入）；③**合成夹具三例**（违规 / 合规 / 非驱动者）钉住判据本身，防"恒不成立"的装饰性门禁；④按调用点切的主进程接缝锁：`createQuickCollectEngine(` 与 `createFeedTrendFetcher(` 两处调用点 400 字符内必须出现 `now: deps.now`。锁自己也被"摘掉它必红"证过（见下行 D/E） |
| 变异反证（6 条，原件已入库） | PASS | `.ccg/reviews/qcclock-mutate.driver.js` + 结果原件 `.ccg/reviews/qcc-mutations.txt`：A 摘掉 handler 的 `now: deps.now` ⇒ 两个行为测试文件点名红（3 failed / 25 passed）；B 摘掉 IPC 夹具唯一注入 ⇒ 结构锁红；C 摘掉**另一个**驱动者（`quick-collect-engine.test.js`）唯一注入 ⇒ 结构锁红（证明它不是给单个文件立的纪念碑）；D 把驱动者判据改成永不匹配 ⇒ 反失明断言当场红（2 failed）；E 把违规判据改成恒不成立 ⇒ 合成夹具那条当场红；F（want=green）只把夹具的绝对时刻挪一天 ⇒ 照绿，证明本锁禁的是"夹具与判据不同源"而不是"不许换日期"。`MUTATION_BAD=0`，FINAL 还原后复跑 `32 passed / fail 0`，逐条 `restored=bytes_equal`，且 `grep -r "MUT-" apps/desktop/electron` 零命中 |
| 电池自身缺陷（不假装已闭合） | PASS（含一次自纠） | 第一版电池报 `MUTATION_BAD=3`，三条"BAD"全部是**电池自己的错**，不是实现错：①汇总解析照抄了 `node --test` 的 `ℹ Tests` 格式，而 vitest 打的是 ` Tests  1 failed | 18 passed (19)` ⇒ FINAL 误报 `SUITE_DID_NOT_RUN`；②`patch()` 用字面 `\n` 做 `split/join` 而目标文件是 `i/lf w/crlf` ⇒ "计数命中、替换没发生"的静默空转变异（已改为正则替换 + 按文件实际行尾落 `to` + 新增 `PATCH_NOOP` 守卫）；③原 C 条摘的是 `cn-sources` 的注入，而该文件有 7 处 `now: () =>`，文件级判据因此看不见——这不是判据缺陷而是它的**已知边界**，已如实写进锁的注释，并补了按调用点切的第 ④ 条覆盖真出事的那处 |
| 行尾与 diff 对账 | PASS | 动手前实测 `CHANGELOG.md` 工作副本 = 20470 行 CRLF / 0 行 LF-only，索引 blob = `i/lf`（`git ls-files --eol`）；插入块逐行按 `\r\n` 落盘，逐行保留被插入位置原有行尾。提交后再跑 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径对账 |
| QM-1 打包 | PASS | `pnpm run build:dir`（`build:vue` + `electron-builder --dir`，win32/x64，electron 43.7.7，`appOutDir=dist-electron\win-unpacked`）实跑 rc=0，vite `✓ built in 12.31s`。产物判据按 `@electron/asar` 的 `extractFile` 取 `electron/ipc-handlers/quick-collect.js`（**不整树 extract**，那会把字节挂到别的文件名），四条断言全过：引擎调用点存在 / `now: deps.now` 已到引擎 / `createFeedTrendFetcher({...now: deps.now})` / `const keys = [...deps.now]` ⇒ `QM1_ARTIFACT=OK`。打包现场两条 `file source doesn't exist`（`dist/fonts`、`.playwright-browsers`）是本机既有环境事实：前者是可选资源、后者是 Playwright Chromium 未捆包的本机态，均与本次改动无关，如实记而不消音 |
| QM-4 视觉 | N/A | 未触任何前端渲染文件与样式；`apps/desktop/src/features/collection` 只跑测试未改代码 |
| QM-6 CCG 双模型外部评审 | PENDING（合并前必须完成） | 本笔动了主进程 IPC 装配路径与测试时钟接缝 ⇒ 按 QM-6 触发条件（修改主进程服务/IPC handler）走双轴。通道沿用先例：CC Switch `:15721` 本会话实测 ECONNREFUSED，逻辑轴 `opencode/nemotron-3-ultra-free`、可维护性轴 `opencode/ling-3.1-flash-free`，任务书显式写"只读 + 结论进 stdout"，且**与写型变异串行**（电池已跑完并逐字节还原后才派发）。处置结果将在本行补记，不以自审冒充通过 |
| 远程同步 | PENDING | 合并后按 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 与 `gh pr view <N> --json state,mergedAt,mergeCommit` 两源同 sha 取 merge SHA，`git ls-remote --heads origin fix-quick-collect-clock-rot` 返回 0 行证远端分支已删；本行改写 PASS + SHA 的**同一次提交**内删除 frontmatter 三个 `sync_*` 字段 |

### 上游影响面（为什么这一笔不是"顺手"）

同一条根因在 2026-10-13 同时打红了三条 required check：`QG Desktop Shards (1/2)`、`QG Desktop Shards (2/2)`、`QG Coverage`（覆盖率作业日志 `Test Files 2 failed | 913 passed | 1 skipped (916)`，红的是同两个文件），并连带 `Gate Result`。
`origin/main` tip 自身（`c6b4709cd`，2026-10-12T21:41Z push 曾为 success）在跨过硬编码 48 小时窗口后转为必红——
也就是说它挡的不是本 PR，而是**当时全部 13 个 open PR** 里每一个要跑 desktop shard 的那条。

### 遗留（不假装已闭合）

- **文件级判据的覆盖边界**：同一个文件里"部分调用点漏注入"仍看不见（本次电池 C 条就是这么暴露的）。
  现在靠第 ④ 条按调用点切的接缝锁兜住真出事的那两处；要把"每个调用点"都做成通用判据，需要可靠的括号/字符串
  配平扫描（本次试写时撞过 `UNBALANCED`：把 `()` 与 `{}` 混在一个深度计数器里，遇到字符串里的半个括号就崩），
  留给下一次真需要时再做，不提前建结构。
- **域内另有 6 个文件含绝对时刻夹具但不驱动真实时钟路径**（`quick-collect-command/materials/prompt`、
  `src/features/collection/quick-collect-commands` 等）：按本锁的语义切分它们合规。若将来有用例把
  `normalizeMaterial(..., {now})` 换成走引擎，就必须同步注入判据——那条锁会当场红。
- 探针/CI 侧没有"日历漂移"类检查：这类腐化的特征是**任何人的改动都没有，但红随日期出现**。
  可选做法（每日 main push 之外再加一条夜间 schedule 跑受影响家族并只报不改）没有在本次夹带。
