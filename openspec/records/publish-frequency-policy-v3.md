---
record: publish-frequency-policy-v3
task: 发布频率策略 v3——账号档 20′/10′/3′ 收到 5′/3′/1′、平台档改按档分级 3′/2′/1′、日配额 ×10 到 30/50/200，并同批修掉「超时竞态释放频控窗口」的 D1 与「回滚许可随日配额放大」两处耦合
date: 2026-10-15
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由后续 docs-only 回填 PR 写 PASS + merge SHA 并删除本三字段
sync_backfill_owner: 下一个会话（回填时同时新增 .quality-gates.md 本体块，直接写 PASS 形态）
---

## 本次执行记录：发布频率策略 v3（publish-frequency-policy-v3，2026-10-15）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 📦 新增功能 + 🐛 Bug 修复（D1）+ 🏗️ 策略数据结构收敛（15 行手抄 → 档位预设派生）⇒ **运行时代码变更（`packages/shared-utils/src/` 4 个文件 + 其测试 + desktop 装配锁）= 混合 PR，不走 docs-only**（`classify-docs-only.js` 在提交后取证的预期结果是 `false`）。隔离：`scripts/start-mp-task.ps1 -TaskName publish-frequency-policy-v3`（入口 rc=0，且**判据取产物**：`git worktree list` 出现 `mp-publish-frequency-policy-v3`、`git -C <路径> rev-parse --abbrev-ref HEAD` = `publish-frequency-policy-v3`），起点 `b7a0b34d1` **逐字等于** `git rev-parse origin/main`。工作区在 `D:\Data\projects\mp-worktrees\`（**非 C 盘**，满足用户约束）。依赖就绪三件套由入口自动跑完：`pnpm install --frozen-lockfile` + `ensure-electron.js`（v43.7.7）+ `verify-worktree-deps.js`（11 个消费方全部解析到本 worktree） |
| 第一性原因（QM-5 ①） | PASS | 本次的"bug"不是数值选错，而是**放松的前置条件没满足**。`_maybeRollback` 的判据 `rollbackable = !submitAttempted \|\| definitelyNotSent` 把"没打点"当"没发起"，而打点函数 `markSubmitAttempted` 的实现是 `const task = this._running.get(taskId); if (task) task.submitAttempted = true` —— 超时路径上 `finally` 的 `this._running.delete(task.id)` 先执行，执行器随后才走到"我确实发出了请求"那一行，打点落在 `undefined` 上、**静默丢弃**（不报错、不留日志）。于是"请求仍在飞"被读成"从未发起" ⇒ `release()` 还原两档窗口与日配额 ⇒ 同账号下一条立刻可发 = 重复发布。引入点是 change `publish-frequency-policy-v2`（P0-1 免等重试）：它同时发明了"按容器键查任务的打点"和"读打点状态的回滚判据"，两者单独都成立，**竞态输掉**这一格让它们互相欺骗；主干规格那句「失败、超时或被中止 MUST NOT 回滚该记账」（v2 之前的旧句）当时就已与实现相反，规格从未同步，所以缺陷在规格层也是无主的 |
| 逃逸分析（QM-5 ②） | PASS | ①**单元层**：`task-queue-guard-integration.test.js` 有「【已提交】失败重试必须等满间隔窗口」——它把 `markSubmitted` **先调好**再触发失败，即"已提交"那一格被测过，"超时且尚未打点"那一格**从未被表示**：夹具里执行器要么立刻 settle、要么根本不模拟在飞。②**为什么测试结构性免疫**：竞态输掉的判据依赖"执行器是否已收敛"，而所有既有夹具的执行器都在 race 之前或同时收敛 ⇒ `!executorSettled` 在测试域**恒为 false**，这条支路一次都没进过。③**审查层**：v2 的 QM-6 双模型评审查了 `bucket` 归因、`accountId` 取值源、`index.d.ts` 构造参数三条，没人问"打点存储的生命周期是否覆盖决策时刻"——那需要一个会**故意不 settle** 的执行器夹具，而写它的人此刻还不知道要它。④**观测层**：即便线上发生过，`_probeCounts` 里没有任何一格会因此变化（`releaseFailed` 只在 release 真失败时才加），窗口被"正确地"回滚了，日志零痕迹。⑤分类：**测试场景缺失 + 审查盲区**（不是 mock 过度：mock 是对的，缺的是那个状态） |
| 修复 + 回归保护（QM-5 ④） | PASS | ①**判据方向**（不改打点管道：改管道等于赌"迟到打点总在读判据之前到"，把竞态换成另一个竞态）：`_executeTask` 在 try **之前**构造 `executorPromise` 并携带 `executorSettled`，catch 以 `{ inFlightAtFailure: !executorSettled }` 传入；`_maybeRollback` 据此置 `task.submitUncertain`（**按任务终身不复位** —— 重试轮 `recordPublish()` 会覆盖 `_hold`，此时回滚还原的是"仍在飞那次提交之前"的窗口，比不回滚更糟）、`inflightUnknown += 1`、单次点名 `platform + taskId` 的 warn，并 `return false`。②**第二处耦合**：`_rollbackCap` 由 `max(2, dailyMax)` 改为 `min(max(2, dailyMax), MAX_ROLLBACK_PER_DAY=5)`，常量经 `PublishIntervalGuard` 导出；方向核对：long/clip 数值不变、`dailyMax=0` 仍是 2、short 档 20→5 属收紧。③**观测面丢失**（实测 D1 时撞出）：`_delayRequeue` 现登记 `_delayed` 并 `_saveState()`，任务在 grace 期内对 `getStatus/getPendingTasks/serialize/cancel` 重新可见。④**数值**：`TIER_PRESETS` + `PLATFORM_TIER` 派生平台表；`BASELINE_INTERVALS` 保持独立常量。回归锁：新文件 `tests/task-queue-timeout-keeps-window.test.js` **10 条**（4 条 D1 行为锁 + 4 条正向对偶 + cancel 不变量 + 退避可观测性），用**永不 settle 的执行器**真实进入该支路；守卫锁 +1 条含「真表读数必须大于封顶」的活性前置（否则那条硬顶锁测的是从不生效的死支路）；策略锁 +4 条含「日配额恰为 v2 的 10 倍」数据表 |
| 防止再次发生（QM-5 ⑤） | PASS | ①`AGENTS.md` 的 TaskQueue 合同条目从 2 条扩到 **4 条不可破**：新增「回滚资格必须先问竞态收敛性、再问打点状态（含终身锁与正向对偶两侧）」与「有界退避等待必须登记进 `_delayed` 并持久化」，并把"进 race 的必须是被观测的那个 promise"写进去（变异 M9 实测：另起一次 `_runTask` 会让执行器跑两遍，红的是"第二条任务被执行了"）。②`01-docs/learnings.md` 5 条：`lesson:number-relaxation-must-ship-with-its-coupled-gates`（改限额前先找"同一数值被推导成第二道闸"的落点，且**不许拆成后续 PR**）、`pitfall:late-signal-lookup-by-container-key-silently-dies`（打点存储生命周期是否覆盖决策时刻；能不依赖标记就别依赖）、`pitfall:mutation-driver-zero-hits-first-prove-the-probe-can-see-red`、`pitfall:state-that-lives-only-in-a-timer-closure-is-invisible-and-lost`、`lesson:stale-must-not-in-main-spec-is-a-real-hazard`（实现给 MUST 开例外时必须同 PR 改掉主干那句）。③主干规格那句已说谎的 MUST 已改写，并补 2 条 Scenario（在飞未知不得回滚 / 确证未送出仍须照常回滚）。④PRD §13 写死**重测/收紧触发条件**四条，下一个会话可照做 |
| 行尾与 diff 对账 | PASS | 前置当场测量（不引 MEMORY 旧数字）：`git ls-files --eol` 对 `CHANGELOG.md` / `.quality-gates.md` / `AGENTS.md` / `01-docs/learnings.md` / `scripts/gate-record-debt-ledger.json` 全部 `i/lf w/crlf attr/text=auto`；工作副本实测 `CHANGELOG.md LF=CR=21311 loneCR=0 NUL=0`、`learnings.md` 同形 ⇒ 新增块**按 CRLF 落**（写脚本逐行 `split('\n').join('\r\n')`，不做"探测多数派后统一回写"），写后回读断言 `loneCR=0 且 NUL=0`。两口径 numstat **逐行相等**：`learnings.md 73/0`、`CHANGELOG.md 11/0`、`AGENTS.md 1/1`、`spec.md 15/4` ⇒ 删除行全是语义行、无行尾重排。删除数归因：`AGENTS.md 1/1` 是把 TaskQueue 条目整条改写（同一条目替换）、`spec.md 4` 是被替换掉的旧 Scenario 与旧 MUST 句，全部属语义删除 |
| 接线棘轮 | PASS | 新增测试文件落在 `packages/shared-utils/tests/`，由该包 `vitest.config.js` 的 `include: ['tests/**']` **自动收集**、并经 workspace 的 `test` 脚本进 CI ⇒ 属 `check-unwired-tests.js` 的 `WORKSPACE_COVERED` 豁免域（不是"没接线"）。判据取现场：包内全量 **49 个文件 / 1021 passed / 10 skipped**，新文件的 10 条在其中被跑到（未变异正控 `rc=0 failedCount=0` 亦为实跑输出）。本次**未新增** `scripts/` 判据，故无 `.gitignore:106 scripts/*.js` negation 需要补 |
| QM-1 打包 / QM-4 视觉 | PASS / N/A | QM-1：`cd apps/desktop && pnpm run build:vue` → **rc=0**；`pnpm exec electron-builder --win --dir --publish never` → **rc=0**（electron 43.7.7，`appOutDir=dist-electron\win-unpacked`；日志另有两条 `file source doesn't exist`（`dist/fonts`、`.playwright-browsers`），与 v2 记录同形态、非本次引入）。**产物内容判据**经 `@electron/asar` 的 `extractFile` 直读（`entries=14993` 过规模下界）：v3 特征 **12/12 命中**（三档精确值 ×3、基线回落、`MAX_ROLLBACK_PER_DAY=5`、上限取 `min`、`inFlightAtFailure: !executorSettled`、`inflightUnknown: 0`、终身锁、退避登记 `_delayed`），v2 残留（`accountMinMs: 20 * MIN`、`accountDailyMax: 20`）**0 命中** ⇒ 交付产物确实带 v3 而不是源码树带 v3。**启动项按三层判据落第③层**：`Multi-Publish.exe --user-data-dir=<系统临时目录>` 8 秒**进程存活**（pid=40120）、**stderr 0 字节**、四类红线 0 命中；并额外自证隔离生效——`%APPDATA%\Multi-Publish` 启动**前后均不存在**（否则等于往用户默认 profile 写测试期数据）。⚠️ 一条与既有文档不同的实测：`--user-data-dir` 在**打包 exe** 上被 Chromium 正常接受（AGENTS 记录的 `bad option:` 属 `electron.exe .` 开发态路径，两者不是同一件事）。QM-4 视觉：变更集不含任何 `.vue/.css/.less/.scss` 与基线 PNG（4 个源文件 + 3 个测试文件 + 文档），设置页与进度面板的文案**一字未改** ⇒ 像素回归无对象；但如实声明**间接影响面**：`PublishFrequencySettings.vue` 的 `currentTierText`/`effectiveRangeText` 是按生效值动态分组的，v3 会让"当前生效"读数与分档形状变化，而该页无像素基线（既有缺口，非本次引入）。构建副产物三处 `*.bundle.js` / `card-paginator.iife.js` 出现 `M` 而 `git diff --numstat` 为空 ⇒ 索引态伪改动，按精确路径 `git checkout HEAD -- <三个文件>` 归位（**未用宽目录恢复**）**QM-6 处置后重跑**（不是沿用第一次打包的读数）：`pnpm run build:vue` rc=0 → `pnpm exec electron-builder --win --dir --publish never` rc=0（`appOutDir=dist-electron\win-unpacked`；两条 `file source doesn't exist`（`dist/fonts`、`.playwright-browsers`）同前、非本次引入）。产物内容判据换成**覆盖 QM-6 新增面**的那一组：`entries=14993` 过规模下界，**11/11 命中 / 0 缺失** —— 三档精确值 ×3、无 v2 残留 `20 分钟`、封顶 5 且取 `min`、D1 判据接进 race、终身锁、退避登记 `_delayed`、`_intervals` 回传 `tier`（F-C2）、主进程等待分钟用 `round` 且不再用 `ceil`（F-W1）。启动第③层：8 秒**存活** pid=42260、**stderr 0 字节**（stdout 21993 字节是应用自身日志，不进判据）、四类红线 0 命中，`%APPDATA%\Multi-Publish` 启动**前后均不存在**（隔离自证）⇒ `VERDICT=PASS`。 |
| QM-6 CCG 双模型外部评审 | PASS（替代通道） | 本机 CC Switch 网关 `127.0.0.1:15721` 实测 `-InformationLevel Quiet` = False，`~/.claude/.ccg/config.toml` 两个 primary（codex / claude）都绑该网关 ⇒ 走 `opencode run --agent plan` 只读档双轴。通道正控 `PROBE_OK`（首跑 rc=1 是我的提示词带 `<` `>` 被 cmd 当重定向，属探针自毁不是通道故障）。**后端 17 条 + 前端 15 条**，逐条在当前树重放后定归属：后端 5 条 Critical 里 4 条**不可达**（拒绝时附"哪一行让这条路走不通"），前端 2 条 Critical **成立且用户可见**（设置页 alert 写死旧默认值；`_intervals()` 不回传 `tier` 使「当前档位」渲染成 `undefined（4 个平台…）`，且该缺陷先于本变更存在、逃逸原因是**测试夹具自行注入了生产不存在的字段**）。处置表 **27 行覆盖双轴 32 条**（前端 Info #8 与后端 B7 命中同一处，合并写在 B7 行）：**采纳 17 行 / 拒绝 9 行**（其中 B3、B5 两行是"拒绝原主张但采纳其派生锁"）**/ 登记不认领 1 行**（该行覆盖 4 条非本 diff 引入的 Info）。逐条见下表 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin publish-frequency-policy-v3` 返回 0 行证远端分支已删；回填时删除上方三个 `sync_*` 字段，并在**同一次提交**内新增 `.quality-gates.md` 本体块（直接写 PASS 形态，故本体无需 ledger 登记项） |

### 本轮我自己制造并当场抓到的问题（不抹平）

1. **变异驱动的第一版报"9 条 MISSED"，是探针失明不是锁失效**。`FAIL` 行带 ANSI 颜色码，
   `/FAIL\s+\S+\.test\.js > /` 在 `FAIL` 与路径之间撞上转义序列 ⇒ `rc=1`（确实有测试失败）
   却 `red=0`（一条名字都没抓到），于是"有红"与"叫不出名字"在输出里完全同形。
   处置：剥 ANSI + 新增 `PROBE_BLIND` 独立档位（与 `MISSED` 分开）+ **跑变异前先做未变异正控**
   （证明基线全绿且解析器此时应当报 0 条红）。这条判据写进 learnings 第 3 条。
2. **三条"期望写错"被我误读成锁没牙**，改正后各自的红集与变异语义才自洽：
   M2 认领了 `回滚未提交尝试` 那条守卫用例 —— 它直接测 `release()`，**不经** `_maybeRollback`，
   本就不该红；M7（clip 档退回 v2）我期望「平台档不再统一」变红 —— clip 的 2′ 退回后集合仍是
   `{1′,2′,3′}`，那条锁测的是集合大小不是每档取值，**它抓不到是事实**，如实写进 PRD §11 而不是
   把断言改成恰好能红；M10（算了标志却没传判据）我期望终身锁变红 —— 它读的是未被该变异触及的
   sticky 分支，由 M3 负责。三条都在驱动里留了注释说明"为什么不期望"。
3. **`_maybeRollback` 的终身锁用例一开始写错了平台**：我让 acc_1（weibo）之后接 acc_2（同 weibo）做正向对偶，
   但 `recordPublish` 同时写平台键 `weibo:*`，回滚账号键后**平台键仍占着** ⇒ 断言 `allowed=true` 恒红。
   这不是锁的错，是我把"回滚"和"平台档"两件事混在一个断言里。改为对偶用 `zhihu`，并在注释里写明
   "换平台而不是换账号"的理由。
4. **编辑测试文件时误删了下一条用例的声明行**（`test('平台键独立判定…` 被我的 new_string 吞掉），
   当场靠 vitest 报"锚点后紧跟裸块"发现并补回。教训同「AI 工具修改后的完整性校验」：改完必须回读结构。
5. **`node --max-warnings=0` 在本机 Node 24 是坏参数**（`bad option`），一次误判成"测试起不来"。
   判执行与否只看自己打的标记，不看 shell 表面报错。
6. **驱动首版 `restore()` 里留着一段自我循环的死闭包**（把长度校验写成读回再比长度），
   改成"写回原文 + 独立 `md5sum -c` 外部对账"，并用一份**先于运行落盘**的基线清单在跑完后复核
   ⇒ 还原证据不由驱动自己出具（这是「反证不得执行被守护动作」的同族：自证还原不可信）。
7. **我把 `publish-interval-guard.js` 推过了逐文件行数硬门**：基线实测 495 行（`git show
   b7a0b34d1:<路径> | split('\n').length`），本次为 `MAX_ROLLBACK_PER_DAY` 加了常量 + 注释 +
   方法文档共 18 行 ⇒ 513 行 ⇒ `check-max-lines` 报 `NEW_OVER_LIMIT`（该文件原本不在 97 条挂账
   清单里，越线即算"新代码引入超大文件"）。两条出路里选了**压缩注释**（模块头的 v2/v3 版本史
   与新注释 → 499 行，事实全部搬进本记录与 PRD），没有走 `--update` 把挂账清单扩大 ——
   后者是"接受漂移"，本次没有任何人裁决过要接受它。压缩后重跑 `check-max-lines` rc=0
   且 49 文件 / 1021 passed 与 M1–M11 全 CAUGHT（M5/M11 的锚点行未被注释压缩破坏，这一点
   必须重跑而不是推理，因为压缩改的正是同一文件里 M11 锚点的邻域）。

### QM-6 发现处置

通道：本机 CC Switch 网关 `127.0.0.1:15721` 实测 `Test-NetConnection -InformationLevel Quiet` = **False**，
而 `~/.claude/.ccg/config.toml` 的 `[routing.backend].primary = codex` 与 `[routing.frontend].primary = claude`
两路都经该网关 ⇒ 按既有降级口径走 `opencode run --agent plan`（只读档）。
通道正控先行：`PROBE_OK Nemotron 3 Pro Free`（首跑 `rc=1 / len=20` 是**我的提示词里带了 `<` `>`**，
被 cmd 当重定向吃掉 —— 与「反证不得执行被守护动作」同族的"探针自己先把命令毁了"）。

| 轴 / 模型 | 回文规模 |
|---|---|
| 后端 `opencode/nemotron-3-ultra-free` | 17 条（5 Critical / 5 Warning / 7 Info） |
| 前端 `opencode/big-pickle` | 15 条（2 Critical / 4 Warning / 9 Info） |

**评审原件入库**：`.ccg/reviews/freq-v3-review-backend.md`（17 条）与
`.ccg/reviews/freq-v3-review-frontend.md`（15 条），头部带轴 / 模型 / 通道 / 被评审 head
（`b63bb9e97`）四项出处。留存范围只到结论段 —— `===STDERR===` 之后的过程转录（含对仓库文件的
`ls`/`cat` 回显与机器本地绝对路径）**刻意不入库**，因为那会把"评审者读过什么"误当成结论。
下一个会话据此可逐条复核下面的每一条"拒绝"，不必采信我的转述。

**处置口径**：每条先在**当前树**重放（读那一行代码 / 跑那条断言），再定归属；
拒绝时必须指出"哪一行让这条路走不通"，而不是"我觉得不会发生"。

| # | 主张 | 重放结果 | 处置 |
|---|---|---|---|
| B1 | D1 分支抢在接线探针前 ⇒ 整平台停用回滚永不触发、窗口永久膨胀 | 不成立：`inFlightAtFailure` 只在执行器**未收敛**时为真，那种失败本来就不是"接线缺陷"信号；执行器快失败时走原判据（对偶②绿） | 拒绝 |
| B2 | `executorPromise` 提前求值 ⇒ 执行器跑两遍 / 已决 promise 使 D1 误判 | 前半不成立（同一 promise 只求值一次；M9 证明"另起一次调用"才跑两遍）。后半成立但方向正确：已收敛=不在飞，允许回滚正是设计（对偶③） | 拒绝 |
| B3 | `submitUncertain` 不持久化 ⇒ 重启后可回滚；`retry()` 复用对象把锁带进新轮次 | 两条失败路径都不可达：恢复走 `_queue.push({...task})` 且投影不含 `_hold` ⇒ 首行 `!task._hold` 即拒；`retry()` 在 `task-queue.js:263-272` 新建对象 | 拒绝原主张，**采纳派生**：把"不可达"落成两条锁（恢复不回滚 / 真两轮 release=0），不再靠我读码断言 |
| B4 | 设置页可填 dailyMax=200 而回滚上限 5 ⇒ 配置假象；`clearRollbackDisabled` 会读 dailyMax | 上限与配额是两件事，不存在"填大没生效"；后半是对未实现代码的推测 | 拒绝（PRD §8 如实写明本片不暴露回滚许可） |
| B5 | `cancel()` 不清 `_delayed` ⇒ 取消的任务在 grace 到期后复活 | 不成立：`cancel()` 第 218–225 行本就 `clearTimeout` + `_delayed.delete` + `_markCancelled` | 拒绝原主张，**采纳派生**：新增"退避期内可取消"锁（该能力本次才给，必须被测） |
| B6 | 中止被算作在飞 ⇒ 误判 | 不可达：取消在 catch 首行 `if (task.cancelRequested…) return`，根本不进 `_maybeRollback` | 拒绝（cancel 不变量锁已在测该方向） |
| B7 | `BASELINE_INTERVALS` 与 long 档同值 ⇒ "独立常量"失去防漏改价值 | **成立**：既有断言用 `>= weibo(1′)`，恒过，挡不住基线被调得比 long 还松 | 采纳：新增"逐维度不弱于任何已登记平台"锁（间隔取上界、配额取下界——**两维度的"更严"方向相反**，写进注释）；不采纳"把基线改成 6′"（数值无依据）。**与前端轴 Info #8 同源**（两个模型独立命中同一处），合并在本行处置 |
| B8 | 终身锁测试绕过真实两轮路径 | **成立** | 采纳：新增真两轮锁，判据取 **release 是否被调用**（首版取"窗口是否仍占用"，在 60ms 小窗口下必然过期 ⇒ 假红，已改） |
| B9 | 硬顶测试只验 weibo 一档 | 部分成立（活性前置已在，但覆盖面窄） | 采纳：逐平台断言真表读数 > 封顶 |
| B10 | `console.warn` 日志注入（task.id 含换行） | 不成立：`task.id` 由 `_add` 生成 `task_<n>_<ts>`，不接受外部值 | 拒绝 |
| B11 | 新导出 `TIER_PRESETS` / `PLATFORM_TIER` 零消费者 | **成立**（`git grep` 只命中文档）——正是我自己在 D7 批评的形状 | 采纳：从 `module.exports` 收回，保持模块内常量 |
| B12 | `_probeCounts` 注释写「供设置页/诊断读取」而实际零消费者 | **成立** | 采纳：注释改为如实（进程内、重启归零、无消费者），并在 PRD §10 登记 |
| B13 | `findLiveTask` 可能读到 `_history` 里的旧快照 | 不成立：`_history` 存的是同一对象引用 | 拒绝 |
| B14 | 档间单调只测三代表平台，改 `PLATFORM_TIER` 分组无人可见 | **成立**：`byTier` 断言的是"每档的值"，不锁"谁在哪档" | 采纳：新增逐平台 platform→tier 成员映射锁 |
| B15 | `platformMinMs ≤ accountMinMs` 无测试 | 不成立：既有锁逐平台遍历策略表 | 拒绝 |
| B16 | 终身锁屏蔽旧判据处缺显式注释 | 成立（小） | 采纳：加注释 + 指出两条分支各有锁（M1/M3 各红一条） |
| B17 | container 的 `>=` 断言过弱 | 与 B7 同源 | 采纳：改与最严那档精确比 |
| F-C1 | 设置页 alert 写死「默认值 3 / 5 / 20」，与同屏动态读数矛盾 | **成立**（zh:42 / en:40 逐字读过） | 采纳：两条 locale 改成指回动态读数；新增锁断言旧串不得残留 |
| F-C2 | `_intervals()` 不回传 `tier` ⇒「当前档位」渲染成 `undefined（4 个平台…）` | **成立**，且**先于本变更存在**；四层测试全绿的原因是**夹具自行注入了生产不存在的 tier** | 采纳：实现补键（含 minInterval 兼容分支）+ 守卫形状锁两条 + 夹具退回该字段必红（M16）+ `index.d.ts` 接口补 `tier` |
| F-W1 | 等待分钟 `ceil` 在短档把 60–84s 显示成「2 分钟」 | **成立**（绝对误差 ≤59s 与 v2 相同，但相对误差因收紧而放大到近 100%） | 采纳：主进程与渲染层两处改 `round`（共用 helper 需跨主/渲染，代价大于收益 ⇒ 两处各一条锁 + 注释互指） |
| F-W2 | 平台档提示做绝对承诺 | **成立**：守卫是两桶取更严，用户填大即反转 | 采纳：条件式改写（zh/en） |
| F-W3 | `index.d.ts` 与实现全面漂移；`recordPublish` 被声明成 `void` | **成立**，且该包子路径 require 在类型检查里恒为 `any` ⇒ 漂移**永远不会红** | 采纳（范围控制）：补齐本 PR 涉及的三面 + `recordPublish` 返回 hold 对象；并新增**枚举式声明契约锁**（实现面每个公开名字都必须在 d.ts 里出现）；剩余 v2 -era 缺口记 遗留 |
| F-W4 | 我在 PRD/CHANGELOG 写的「long/clip 许可不变」算错 | **成立**：实况是 clip 持平、short 20→5 收紧、**long 3→5 放宽** | 采纳：三处文本全部改正，并说明放宽 long 的理由与改法（按 tier 取值 ≠ 回到 `max(2, dailyMax)`） |
| F-I1 | `release()` JSDoc 仍是旧公式 | 成立 | 采纳（顺带在行数门禁下压缩注释，事实移入 PRD） |
| F-I2/I3 | PRD 把静态快照说成"倒计时"、`7′→约 7′` 笔误 | 成立 | 采纳：§8/§9 改写 |
| F-I4 | 两处模块头仍写 v2 | 成立（我改过的那个文件） | 采纳：`task-queue-frequency.js` 头改 v3；`ipc-handlers/publish-frequency.js` 未在本次改动面内，登记不做 |
| F-I5/6/7/9 | `fmtMin` 输出英文单位、`effectiveRangeText` 不看平台档、平台输入框无 placeholder、full-auto 旁路 | 成立但**非本 diff 引入** | 登记不认领（前三条另成 UI 片；第四条已在我自己的 遗留 里） |
**我自己被这批处置抓出来的两个新问题**（不抹平）：
① M18 变异三轮才对上，第二轮暴露我新写的 d.ts 锁里有一条恒真断言（`toContain('at')` 同时被
"platform" 子串与相邻成员 `release(hold: { at: number; … })` 满足）——判据改成"按花括号配对只切出
recordPublish 自己的返回块"后才真红；
② 为压 `publish-interval-guard.js` 的行数（495→513 触发 `NEW_OVER_LIMIT`）压缩注释时，
第一次 `git ls-files --eol` 的判据被我写成 `cr !== lf`，对**纯 LF 工作副本**必然假红，
并把"已写盘"的状态留在文件里——同族于「观察者要报告自己的失明」，只是这次失明的是我自己的检查。

### 遗留（不假装已闭合）

- **D1 的残留**：窗口保持占用只保证"同通道下一条不早于窗口"。若平台侧处理时间本身超过
  `task.timeout`（默认 180s），窗口（1–5′）到点后重试**仍可能重复发布**。彻底解法是"迟到成功要把
  已排定的重试撤下"，需要任务级状态机与迟到结果归属，未做（PRD §10.7）。
- **`submitUncertain` 不持久化**：不在 `task-projection.js` 的字段清单里，重启后不再是"终身"锁。
  实际后果与预期方向一致（恢复路径也不带 `_hold` ⇒ 依然不回滚），所以刻意没扩投影
  （AGENTS「新增持久化字段必须同时改所有投影白名单」的代价与本案收益不匹配），但这句话本身是判断，留此供复核。
- **`full-auto-pipeline` 的活旁路**：`createPublisher(...).publish()` 直发、自带
  `PUBLISH_INTERVAL_MS = 5000`，**完全绕过队列与守卫**，违反策略模块头部"禁止在调用方另抄一份"。
  它经 `container.setup.js` 注册、`phase1-context.js` 与 `ipc-handlers/auto-pipeline.js` 使用 ⇒ 是活链路。
  v3 把间隔收紧后，这条链路的 5 秒成了**全仓唯一的快速通道**，风险面相对变大；收敛它要改流水线与
  队列的归属关系，另成 PR（PRD §10.6）。
- **`clearRollbackDisabled()` 的承诺与接线不符**：日志文案写"重启或**用户在设置页确认后**解除"，
  但没有 IPC handler、没有 UI 入口。本次既不建入口也不改文案（改文案属产品判断），登记待裁。
- **`getProbeCounts()` 零消费者**：v3 新增的 `inflightUnknown` 同样只进内存与一次 warn。
  我刚批评了这条（D7），本次**只加了计数、没加消费面** —— 这是刻意的范围控制，不是已完成。
- **`prunePublishDailyCount()` 零生产调用**：日计数表只增不删。
- **`PLATFORM_BUCKET_DAILY_KEY_PREFIX`（平台级日配额）全仓零引用**：计划了但没接。
- **`maxConcurrent=3` / `timeout=180s` 未随 v3 重标定**：节奏变快后这两个值是否仍合适需要真实运营
  数据；"并发按测不按猜"的欠账仍在（PRD §10.8）。
- **`clip` 档混装短视频 / 图文社区 / 横站长视频**：`tier` 复用 v2 分组（当初为日配额引入，刻意不新增
  分类器），拆第四档要连带改 `resolvePolicyOverrides` 的 `dailyMax` 闭集与设置页三个输入框。本次按
  PRD §4 如实写明不精确而不下探。
- **设置页"平台档"是全局单值**：v3 起平台档按档分级，用户一旦在该字段填值就把三档抹平成同一个值。
  正解是改成三档输入（与 `dailyMax*` 同形），属 UI 改动另成 PR（PRD §9）。
- **主干规格仍滞后**：`publish-frequency-control` 只 6 条 Requirement，不含日配额 / 抖动 / 回滚许可 /
  三档分级（v2 的 change 尚未归档）。本次只改掉那句**与代码相反**的 MUST，未补齐全部差异。
- **`.quality-gates.md` 与 ledger 刻意不由本 PR 携带**：沿用 `ops-base-single-src`（#3622）确立的
  热点载体规避口径 —— 那两个文件是全体会话共同追加的活冲突面，携带会造成"~13min 冲突 vs ~40min CI"
  的活锁。本体欠账由本记录 frontmatter 的 `sync_*` 三字段满足；回填 PR 新增 QG 块时直接写 PASS 形态。
### QM-6 处置后的实况更正（追加，不改写上面已写下的读数）

- 测试规模由「1021 passed / 10 skipped（49 文件）」变为 **1034 passed / 10 skipped（50 文件）**；
  净新增用例 14 → **27**（QM-6 处置补 13 条：`_intervals` 的 tier 两格、d.ts 枚举契约锁六格、
  真两轮 / 退避期内可取消 / 恢复不回滚三格、显示面四格中的两条守卫 + 两条文案锁）。
- 变异反证由 M1–M11 → **M1–M20**，第二批 9 条专打 QM-6 修复本身，20/20 CAUGHT、还原逐字节相同。
- 本 PR 改动了 `apps/desktop/electron/bootstrap/phase4-events.js` 与两处 locale ⇒ **QM-1 必须重跑**
  （不是沿用第一次打包的读数）；重跑已实跑，读数落在 QM-1 行的「QM-6 处置后重跑」段：**asar 判据 11/11 命中（`entries=14993`**，覆盖 tier / round 两个新增面）、**启动 8 秒存活且 stderr 0 字节**。
- PRD 首稿的两处自述被评审否证并已改正：「本次不改任何用户可见文案」（实际改了 4 条 locale）
  与「回滚许可 long/clip 不变」（实况是 **long 由 3 放宽到 5**、clip 持平、short 由 20 收紧到 5）。
- 我自己的新锁被自己的变异抓出一条**恒真断言**（M18 第二轮：`toContain('at')` 同时被 "platform"
  子串与相邻成员 `release(hold: { at: number; … })` 满足）；判据改为按花括号配对只切
  `recordPublish` 自己的返回块后才真红。这条记进 learnings 的同族："断言存在"≠"锁有效"。
