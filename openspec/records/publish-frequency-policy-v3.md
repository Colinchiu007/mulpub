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
| QM-1 打包 / QM-4 视觉 | PASS / N/A | QM-1：`cd apps/desktop && pnpm run build:vue` → **rc=0**；`pnpm exec electron-builder --win --dir --publish never` → **rc=0**（electron 43.7.7，`appOutDir=dist-electron\win-unpacked`；日志另有两条 `file source doesn't exist`（`dist/fonts`、`.playwright-browsers`），与 v2 记录同形态、非本次引入）。**产物内容判据**经 `@electron/asar` 的 `extractFile` 直读（`entries=14993` 过规模下界）：v3 特征 **12/12 命中**（三档精确值 ×3、基线回落、`MAX_ROLLBACK_PER_DAY=5`、上限取 `min`、`inFlightAtFailure: !executorSettled`、`inflightUnknown: 0`、终身锁、退避登记 `_delayed`），v2 残留（`accountMinMs: 20 * MIN`、`accountDailyMax: 20`）**0 命中** ⇒ 交付产物确实带 v3 而不是源码树带 v3。**启动项按三层判据落第③层**：`Multi-Publish.exe --user-data-dir=<系统临时目录>` 8 秒**进程存活**（pid=40120）、**stderr 0 字节**、四类红线 0 命中；并额外自证隔离生效——`%APPDATA%\Multi-Publish` 启动**前后均不存在**（否则等于往用户默认 profile 写测试期数据）。⚠️ 一条与既有文档不同的实测：`--user-data-dir` 在**打包 exe** 上被 Chromium 正常接受（AGENTS 记录的 `bad option:` 属 `electron.exe .` 开发态路径，两者不是同一件事）。QM-4 视觉：变更集不含任何 `.vue/.css/.less/.scss` 与基线 PNG（4 个源文件 + 3 个测试文件 + 文档），设置页与进度面板的文案**一字未改** ⇒ 像素回归无对象；但如实声明**间接影响面**：`PublishFrequencySettings.vue` 的 `currentTierText`/`effectiveRangeText` 是按生效值动态分组的，v3 会让"当前生效"读数与分档形状变化，而该页无像素基线（既有缺口，非本次引入）。构建副产物三处 `*.bundle.js` / `card-paginator.iife.js` 出现 `M` 而 `git diff --numstat` 为空 ⇒ 索引态伪改动，按精确路径 `git checkout HEAD -- <三个文件>` 归位（**未用宽目录恢复**） |
| QM-6 CCG 双模型外部评审 | PENDING | 见「QM-6 发现处置」节；本行在评审跑完后就地改写，不留复合状态 |
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

（待评审回文后逐条填写：来源轴 / 严重度 / 采纳或拒绝 + 证据。）

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
