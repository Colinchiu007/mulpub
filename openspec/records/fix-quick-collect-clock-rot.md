---
record: fix-quick-collect-clock-rot
task: 快捷采集时钟腐化的防再犯层（结构锁 + 变异电池）——运行时接缝由并发的 #3459 先落地
date: 2026-10-13
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账）
---

## 本次执行记录：快捷采集时钟腐化修复（fix-quick-collect-clock-rot，2026-10-13）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 🧪 测试/门禁变更（rebase 后**净差量不含运行时代码**：`git diff origin/main --stat` = 6 个文件＝结构锁 1 + 电池与两份现场 3 + CHANGELOG + 记录）。原以为本笔要动主进程 IPC handler（🐛 + 运行时代码 ⇒ 必须隔离），仍按隔离流程做：`scripts/start-mp-task.ps1 -TaskName fix-quick-collect-clock-rot`，worktree `D:/Data/projects/mp-worktrees/mp-fix-quick-collect-clock-rot`、裸分支同名，基线 `c6b4709cd`；依赖就绪三步实跑（`pnpm install --frozen-lockfile` 16.4s / `ensure-electron.js` v43.7.7 / `verify-worktree-deps.js` OK 11 项）。**并发纠偏**：期间 `origin/main` 前进到 `5552f1f0a`（= #3459 `qc-clock-seam`，同缺陷的另一半修复），本分支按 AGENTS.md 走 `git rebase origin/main`，三个重叠文件取 main 侧（含他们那条"过去时钟"行为锁），我自己的重复注释丢弃，`--force-with-lease` 重推 |
| 第一性原因（QM-5 ①） | PASS | 不是断言写错，是**夹具与判据不同源**：家族夹具写死 `NOW = Date.parse('2026-10-11T04:00:00.000Z')`、`<pubDate>Sun, 11 Oct 2026 02:00:00 +0000</pubDate>`、`created_utc = (NOW - 3600_000)/1000`，而窗口过滤读真实墙上时间 ⇒ 越过 `windowHours=48` 那刻必红，与谁的改动无关。归因现场：本机 03:30Z 复现 3 条红，产品自己的回执「本次未检索到最近 48 小时内的可核对素材」；另一半是装配层——`registerHandlers` 只把 `deps.now` 透给 `createFeedTrendFetcher`，漏了 `createQuickCollectEngine`（半接线缝隙）。**这一半的修复由并发会话 #3459 先落地**（`git show origin/main:apps/desktop/electron/ipc-handlers/quick-collect.js` 里那段 `⛔ now 必须转发（2026-10-13，change: qc-clock-seam）` 的注释是他们的措辞，不是我写的），本笔不再认领它 |
| 逃逸链（QM-5 ②） | PASS | ①单元层——同文件里纯函数用例**都**显式传了 `now: NOW`（`normalizeMaterial(item, { windowHours: 48, now: NOW })`），所以那批用例永远不会腐，给整套文件一种"时钟已经管住了"的错觉；②装配层——真正读时钟的是 IPC 注册面构造的引擎，而 `registerHandlers` 只把 `deps.now` 透给了 `createFeedTrendFetcher`，**漏了 `createQuickCollectEngine`**（半接线缝隙），所以即便夹具想注入也没有入口；③CI 层——desktop shard/coverage 跑的是全量，红只出现在"日历跨过 48 小时"那一天，PR 作者当时看不到；④审查层——既有 review 只看 diff 与断言，对"夹具的绝对日期 vs 产品的真实时钟"这条跨时间尺度的一致性没有判据。**系统性漏洞 = 时钟接缝只接了一半 + 没有任何东西看守"驱动真实时钟路径的夹具必须自带时钟"** |
| 修复 + 回归保护（QM-5 ④） | PASS | ①运行时接缝与夹具注入（`now: deps.now` 转发 + `keys` 纳入 + 两个夹具的 `now: () => NOW`）——**归 #3459**，本笔 rebase 后取其版本；②本笔交付的防再犯层：`quick-collect-clock-determinism.test.js` 5 条（见下行）；③行为锁红→绿的事实由 #3459 的那条"过去时钟"用例与本笔的结构锁共同守住；④可复现命令逐字（在 `apps/desktop/` 下）：`pnpm exec vitest run electron/ipc-handlers/quick-collect.test.js electron/services/quick-collect-{cn-sources,engine,trend-sources,command,materials,prompt,presets,clock-determinism,sources}.test.js electron/services/hot-topics-quota.test.js electron/bootstrap/phase5-ipc.test.js src/features/collection`（末项展开 4 个渲染端文件）⇒ rebase 后 **25 个测试文件 / 313 passed / 0 failed**（2026-10-13T04:57Z 实跑）。改的是被多文件消费的模块，验证范围取"并集"而不是"我改过的文件" |
| 防再犯锁（QM-5 ⑤） | PASS | 新增 `apps/desktop/electron/services/quick-collect-clock-determinism.test.js`（**5 条**，vitest 按 workspace 自动收集，无需另接 workflow）：①扫描域非空 + 驱动者下界（**实测整域 14 个文件、驱动者 5 个**，含锁自身；下界 files≥10 / drivers≥4 各留余量，并点名 `ipc-handlers/quick-collect.test.js` 与 `quick-collect-engine.test.js` 两个必须在内）；②渲染端 `import('@/api/quick-collect')` **不得**被算成驱动者（那个模块只是 `invokeWithFallback` 桥接层，不读主进程时钟）；③真实域违规必须为空；④**合成夹具三形**（`Date.parse` / `Date.UTC` / RFC-822 `pubDate`）都必须被同一判据抓住，加上"合规"与"非驱动者"两个负向对照——防"恒不成立"的装饰性门禁，也防判据形状窄到把事故自己的夹具形状漏掉；⑤按调用点切的主进程接缝锁：`createQuickCollectEngine(` 与 `createFeedTrendFetcher(` 两处调用点 **800 字符**内必须出现 `now: deps.now`（实测偏移 246 / 53）。判据按语义切：只有"驱动读时钟那条路"且夹具含绝对时刻的文件才要求注入；只把 `now: NOW` 当普通实参传给纯函数的不受约束。锁自己也被"摘掉它必红"证过（见下行 D/E/G/H/I/J） |
| 变异反证（**10 条**，原件已入库） | PASS | `.ccg/reviews/qcclock-mutate.driver.js` + 第 1 轮 `qcc-mutations.txt`、rebase 前 `qcc-mutations2.txt`、rebase 后 `qcc-mutations3.txt`：A 摘 handler 透给引擎的 `now: deps.now` ⇒ 两个行为文件点名红（6 failed / 23 passed，比第 1 轮多一条红正是 #3459 那条行为锁）；**B 必须摘 IPC 夹具的两处 `now: () =>` 才算测到**（见下行盲区）；C 摘引擎测试唯一注入；D 驱动者判据永不匹配；E 违规判据恒不成立；G 去掉 `(?!@)`；H 绝对时刻判据退回只认 `Date.parse`；I 调用点窗口 800→60；J 摘 feed 那处 `now`。9 条 want=red 全部点名到位、F（夹具日期挪一天）want=green 照绿；`MUTATION_BAD=0`，FINAL 还原后 `34 passed / fail 0`，逐条 `restored=bytes_equal`，开工先 `PREFLIGHT_NO_RESIDUE`。电池支持多补丁 case（`patches[]`）就是为 B 这条 |
| 电池自身缺陷（不假装已闭合） | PASS | 五处自纠都记现场不写"已修"：①汇总解析照抄 `node --test` 的 `ℹ Tests` 而 vitest 打的是 ` Tests  1 failed \| 18 passed (19)` ⇒ FINAL 误报 `SUITE_DID_NOT_RUN`；②`patch()` 用字面 `\n` 做 `split/join`，目标文件 `i/lf w/crlf` ⇒ "计数命中、替换没发生"的**静默空转变异**（改正则替换 + 按文件行尾落 `to` + `PATCH_NOOP` 守卫）；③原 C 条摘的是有 7 处注入的 `cn-sources`，文件级判据看不见 ⇒ 换驱动者；④`RUN['ABCDEF'[i]]` 与 cases 下标隐式对齐，删一条 case 会让 want=green 在缩小的文件集上**真空成立** ⇒ 每条自带 `run` + 启动自检；⑤**rebase 后 B 条自己变瞎**：`quick-collect.test.js` 因为 #3459 的行为锁多出第二处 `now: () => past`，只摘一处时文件级判据照旧通过、`点名红=false`。这不是电池写错，是**文件级判据的盲区被并发合并当场演示了一次**，也正是"部分调用点漏注入"这一类的第一例现场——处理：B 改成一次摘两处（所以电池支持 `patches[]`），并把兜得住这一类的两层写明是行为锁（他们的）与按调用点切的接缝锁（本锁第 ⑤ 条），而不是假装文件级判据能覆盖 |
` 做 `split/join`，而目标文件是 `i/lf w/crlf` ⇒ "计数命中、替换没发生"的**静默空转变异**（已改为正则替换 + 按文件实际行尾落 `to` + `PATCH_NOOP` 守卫）；③原 C 条摘的是 `cn-sources` 的注入，而该文件有 7 处 `now: () =>`，文件级判据因此看不见——这不是判据缺陷而是它的**已知边界**，已写进锁头注释并补第 ⑤ 条按调用点切。第 2 轮又自纠两处：④`RUN['ABCDEF'[i]]` 与 cases 下标隐式对齐（可维护性轴 MAJOR#3 指出：删一条 case 会让 want=green 在缩小的文件集上**真空成立**）⇒ 改成每条自带 `run` + 启动自检；⑤pre-flight 起初要求"被触文件与 HEAD 一致"，但被测对象本身就是未提交改动，要求干净等于要求自己先提交 ⇒ 改成查 `MUT-` 残留并打印 status 供留痕 |
| 行尾与 diff 对账 | PASS | 动手前实测 `CHANGELOG.md` 工作副本 = 20470 行 CRLF / 0 行 LF-only，索引 blob = `i/lf`（`git ls-files --eol`）；插入块逐行按 `\r\n` 落盘，逐行保留被插入位置原有行尾。提交后再跑 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径对账 |
| QM-1 打包 | N/A（rebase 后本笔不含运行时代码） | 第 1 轮我确实动过 `ipc-handlers/quick-collect.js` 并跑过打包：`pnpm run build:dir` rc=0、`@electron/asar` 的 `extractFile` 取产物内该文件、四条接缝断言全过（`QM1_ARTIFACT=OK`，现场 `.tools/tmp/qcc-qm1.log`）。rebase 后那段运行时改动归 #3459、本笔 diff 只剩测试与文档 ⇒ QM-1 对本笔不再适用；把两次事实分开写，避免"用别人的打包证据给自己发通行证" |
| QM-4 视觉 | N/A | 未触任何前端渲染文件与样式；`apps/desktop/src/features/collection` 只跑测试未改代码 |
| QM-6 CCG 双模型外部评审 | PASS（双轴回信已到，逐条处置见下） | 通道：CC Switch `:15721` 实测 ECONNREFUSED ⇒ 替代通道，逻辑轴 `opencode/nemotron-3-ultra-free`、可维护性轴 `opencode/ling-3.1-flash-free`。**逻辑轴 1 CRITICAL + 2 MAJOR + 4 MINOR、可维护性轴 0 CRITICAL + 3 MAJOR + 8 MINOR**（两轴的统计行我都按正文逐条数过再采信——本仓前科是"引用了评审自己写错的统计"）。逐条处置：**已落地**——可维护性 MAJOR#1「绝对时刻判据形状过窄」：`ABS_FIXTURE` 从只认 `Date.parse('20` 扩成 `Date.parse|Date.UTC|new Date('20|ISO 串|RFC-822 pubDate`，而最后那一种**正是本次事故夹具本身的形状**（新增合成用例 + 变异 H 钉住）。可维护性 MAJOR#2「`import('@/api/quick-collect')` 被误算成驱动者」：加 `(?!@)` 负向预查（实测驱动者从 7 收到 5；渲染端那个模块只是 `invokeWithFallback` 桥接层，不读主进程时钟，对它要求"注入时钟"是不可满足的账）。**且这两条必须一起改**——只拓宽 ABS 而不修驱动者，那两个渲染文件会当场假红。可维护性 MAJOR#3「电池用 `RUN['ABCDEF'[i]]` 与下标隐式对齐」：改成每条 case 自带 `run` + 启动自检（缺 run 即抛、want=red 的 run 集必须覆盖 expectFiles），因为它举的场景正是 F 那条 want=green 会在缩小的文件集上**真空成立**。MINOR 采纳：调用点窗口 400→800（实测偏移 246/53，400 只留 154 余量，一次无害换行就假红）+ 新增变异 I「收到 60 必须红」证明余量在测东西；测试 1 的名字补「并点名两个核心驱动者」（名字与 `toContain` 行为对齐）；锁头注释补三层覆盖关系与"扫描域按文件名定义、异名同族不在看守内"；电池加 `PREFLIGHT_NO_RESIDUE`（查 `MUT-` 残留，不要求工作树干净——被测对象本身就是未提交改动，要求干净等于要求自己先提交）。**否证/不采纳并写明理由**：逻辑轴 CRITICAL「生产不传 `now` ⇒ 修复不生效，建议在 phase5 注入 `now: () => Date.now()`」——事实对（`phase5-ipc.js` 的 handlerDependencies 确无 `now` 键，两处都落 `() => Date.now()`，我逐行复核过），**结论方向反**：本 PR 修的是"夹具与判据不同源"，生产侧读真实时钟是产品语义（用户要的就是"最近 48 小时"），它给的修法是恒等变换；我把这条写成锁头注释防下一个会话"顺手补全"。逻辑轴 MINOR「引擎 `:221` 用 `Date.now()` 生成 ID」——非语义时间、且先于本 PR 存在，不在本笔夹带。逻辑轴 MINOR「engine 把 `now()` 塞进 `opts` 而 fetcher 从不读 `opts.now`」——它自己已核实是**先于本 PR 的死参数**，记遗留不动代码 |
| 双轴并发的现场污染（如实归因，不算实现缺陷） | PASS | 两个评审并发读**同一个 worktree**，逻辑轴自述跑了我的写型变异电池并 `git restore`（违反只读），可维护性轴同轮报「单独跑全绿，但 16 文件联合跑有 3 个失败」。我随后按消费者并集复跑：`25 个测试文件 / 312 passed / 0 failed`（命令见"修复 + 回归保护"行），**那 3 条红不可复现**；最合理的归因是它撞上了对方并发 mutation 的瞬时态。教训已落成动作：①同一工作树上的 QM-6 双轴必须**串行**派发（与"评审读目录时禁止跑变异"同族，只是这次违规者是评审本身）；②电池加残留检查，让"被杀后留下的变异"当场响。工作树当前 `git diff HEAD` 为空、注入行在位（`quick-collect.test.js:46`、`quick-collect.js:66/152`），已核实无损坏 |
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
