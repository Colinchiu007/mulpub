---
record: gui-cli-e2e-timeout
task: 闭合 PR #3807 合并后 main push 的红点归因，并把那颗反复砸到所有 PR 的病灶（CLI 端到端用例继承全局 10s 预算）单独修掉
date: 2026-10-17
sync_reason: 本 PR 合并后由同线程回填远程同步行（回填与销账同一次提交，并删除本 frontmatter 两个登记字段）
sync_backfill_owner: 本会话（gui-cli-e2e-timeout 线程）
---

# 本次执行记录：GUI 相关性 CLI 端到端用例的用例级预算（gui-cli-e2e-timeout，2026-10-17）【完整流程】

> 分支 `gui-cli-e2e-timeout`，worktree `<仓库父目录>/mp-worktrees/mp-gui-cli-e2e-timeout`（非 C 盘），起点 `origin/main` `3f5f9da38`。
> 载体冻结已生效 ⇒ **未写** `.quality-gates.md`、**未加** ledger 键；本篇是本 PR 记录的唯一载体。
> 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 PENDING | 远程同步 PENDING

| 门禁 | 状态 | Fresh 证据（当场实测，非记忆） |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更（测试层 + 工具脚本）⇒ 独立 worktree + 裸分支，入口 `scripts/start-mp-task.ps1 -TaskName gui-cli-e2e-timeout`（实跑：`Done in 1m 2s` → `[ensure-electron] electron dist 已就绪：v43.7.7` → `[verify-worktree-deps] 消费方解析通过 11 项` + `OK`）。开工前共享根 `git status --porcelain` **0 行**、`HEAD == origin/main == 3f5f9da38`；共享根上未落任何改动 |
| 第 0 步：main 红点归因（先归因再动手） | ✅ | 我那片（PR #3807，merge `77598c4ac`）合入后 main push 判 `failure`，红点唯一：`QG Desktop Shards (1/2)` 第 8 步 `tests/gui-ci-exit-contract.test.js > GUI/CI 工作流门禁契约 > CLI 端到端…`，`Error: Test timed out in 10000ms`（`:220`），连带 `Gate Result` 红。**三条对照读数**：① 该红的逐字同一形态出现在 **我合并之前 57 分钟**的 main push `ce3f25cdf`（07:16:30Z；我的 diff 不在其内）；② 同作业相邻的 `354c4183b`/`44054389e`/`ea257dd99`/`f818c214e` 全绿，该用例耗时分别 1657/1326/1466/1059ms，而两次红的耗时行是 11097/12744ms；③ **含我内容的 main tip `3f5f9da38`（run `39019636102`）判 success**、`red=[]`。⇒ 结论：非本 PR 引入，但属真实病灶，不认领也不放行，按 AGENTS「红了补一轮 follow-up」单独立片 |
| 根因（第一性，不是"偶发超时"） | ✅ | 该用例在临时目录里真起 **17 个子进程**（12 次 `git.exe` + 5 次 `node.exe`），却没有用例级预算，继承 `vitest.config.js:13` 与 CI 命令行两处的 `--testTimeout=10000`。空闲 1.0–1.7s、负载 11–12.7s 的 8 倍摆动全部来自 runner 环境，与被测语义（判据脚本的 rc / stdout / GITHUB_OUTPUT）无关 ⇒ 环境开销与被测语义共用一个预算，即 AGENTS.md QM-3「等待预算必须按相位拆分」同族。**同文件讽刺点**：它自己就有一条用例在锁"串行单测预算挂实测、超时可自证、且不与 job 级倒挂"，却没把同一条纪律用在自己身上 |
| 测试（TDD，先见证红） | ✅ | `gui-ci-exit-contract.test.js` 40 → **43 passed**（+3 条锁）。顺序按 TDD 走：先只建预算模块 + 三条锁 ⇒ 当场 `3 failed \| 40 passed`，红的是指名的三条锁本身（声明锁 / 台账锁 / 探针锁），不是 LOADFAIL；随后接线 ⇒ `43 passed`，现场留痕 `[gui-cli-e2e-budget] elapsed=3520.9017ms budget=60000ms headroom=17.04x`。锁的分工：**声明锁**（用例必须引用单点常量、且该引用必须落在**这一条**用例的闭合之前、禁裸数字、禁出现 `10000`）；**出处锁**（`预算 ≥ maxObservedMs × safetyMultiplier`、`samples ≥ 4`、`collectedAt` 形态、`source` 必须点名复测脚本且**该脚本必须存在于仓库里**）；**台账锁**（本次真跑必须留下样本，且观测值 ×2 不得超过预算——贴脸是要重测量抬预算的信号，不是放宽断言的信号） |
| 变异反证（8 条，全部指名红且无逃逸） | ✅ | 驱动落 `<临时目录>/mutate-case-timeout.cjs`，每轮按字节还原并核 md5（`restore:true` ×8），基线非绿即 `exit 2`：`M1` 摘掉用例级预算 ⇒ 声明锁红 1；`M2` 预算写死成裸数字 `60000` ⇒ 声明锁红 1；`M3` 预算收到 40000（< 12744×4）⇒ 出处锁红 1；`M4` 摘掉 `finally` 里的记账 ⇒ 台账锁红 1（这条同时证明"台账为空"不会静默通过）；`M5` 让探针不认文件名 ⇒ 探针锁红 1；`M6` 复测脚本自带第二份耗时正则 ⇒ 探针锁红 1；`M7` 复测输出字段改名（`maxObservedMs`→`maxMs`）⇒ 探针锁红 1；`M8` **把预算挪到下一条用例上** ⇒ 声明锁红 1（证明它锁的是"归属"，不只是"串存在"）。全部 `failedCount=1`，`POST_RESTORE total=43 failed=0` |
| 驱动自身的两处假绿（先记自己踩的，再谈成果） | ✅ | ① 第一版把 `pnpm.cmd exec vitest` 走 `shell:true` 拉起，JSON 报告里 `numTotalTests=0`，而我的判据只看"有没有失败用例"⇒ 基线被读成"全绿"、8 条变异齐报 `NOT_CAUGHT`。那 8 个 NOT_CAUGHT **全是驱动的产物**，不是锁没牙。修法是调用 `node <hoisted>/vitest/vitest.mjs` 直跑 + **规模下界**（`total < 43` 一律 `DOMAIN_COLLAPSED` 拒认领）。② 第二版把仓库根相对路径当 vitest 的位置过滤器传给一个 cwd 在 `apps/desktop` 的进程 ⇒ 收集到 0 个文件，同上被下界拦住；另有一条锚点恒 0 命中，根因是驱动用测试文件的 CRLF 档去锚我新写的两个 LF 文件 ⇒ 行尾必须**按文件各自**判档。这三条都是既有纪律（空集恒真 / 固定路径产物先删 / 按当场 eol 锚定）在我自己工具里的复发 |
| 实现（数据校验 / 流程 / 显示项） | ✅ | 预算值单点 `GUI_CLI_E2E_CASE_TIMEOUT_MS = 60000`，落在新模块 `apps/desktop/tests/gui-cli-e2e-budget.js`——**不放测试文件里**，因为复测入口要 require 它，而那份文件是 vitest 用例、被普通 `node` require 会因 `describe` 未定义而崩（同 `test-helpers/windows-file-lock.js` 的形态选择）。记账放在既有的 `finally` **首位**（先记账再清理，且 `rmSync` 抛错不会吞掉样本）；耗时用 `process.hrtime.bigint()`，与被测语义无关的清理时间也计入——这是刻意的，预算要包的是"这条用例在 CI 上真实占用的墙钟"。**locale 键新增 0 把**、**渲染层零改动**、**主进程零改动** |
| 复测入口（把"量过一次"变成"随时能再量"） | ✅ | 新增 `scripts/case-timeout-audit.js`：从**已结束**的 main push run 列表（客户端过滤 + 翻页，理由见脚本头第 5 条）取 `QG Desktop Shards` 作业日志，剥 ANSI 后用**共享探针**取该用例耗时行，打印可直接粘进 provenance 的对象。退出码分档：`0` 余量成立 / `3` 零样本（探针失明，绝不判"没问题"）/ `4` 观测最大值吃掉 `max×multiplier` ⇒ 该抬预算 / `5` 读不到出处。当场实跑 `--runs=8 --json` ⇒ `samples=8 runs=8 jobs=8 max=12744 headroom=4.71× OK`，provenance 里的数就是这条命令现在能重出来的数。**六条采集坐标坑**里第 6 条是本轮新踩：vitest 的 verbose 行自带 ANSI 且会把文件名**拦腰截断**，同一份日志未剥 ANSI `rawHits=0`、剥后 `cleanHits=1 values=11097` ⇒ "0 命中"在这里是探针瞎了，不是"没有长尾" |
| 禁词锁必须先剥注释（本轮被自己的锁抓到） | ✅ | 第一版声明锁把「从用例起点到下一个 `it(`」整段当被测区，于是我自己写在两条款之间的说明文字（含 `10000ms` 这个旧预算数字）被禁词判成违规——合规实现因散文而红。处置**不是**删注释，而是两处收紧判据：区间的终点改为"预算引用的位置"（顺带让 M8 有牙），禁词扫描前先 `replace` 掉整行与行尾注释（只在 `//` 处于行首或空白后时剥，避免误伤 `https://`）。这正是既有纪律「禁词锁不剥注释会反向假红」的又一次兑现 |
| QM-1 打包 | N/A（**判据不触发，不是跳过**） | QM-1 的触发面是 `apps/desktop/electron/` 与 `packages/rpa-engine/`；本次改动集是 `apps/desktop/tests/` 两个文件 + `scripts/` 一个工具 + `.gitignore`，未动主进程 / preload / IPC 通道 / bundle ⇒ 按 AGENTS 口径记 N/A，未跑 `electron-builder`，也不借上一片（#3807）的读数顶替 |
| QM-4 视觉 | N/A（**已当场量，不是转述**） | 本片零渲染层改动。注册即判定域棘轮读数与开工前逐字相同：`进域注册表 5 张（all 37 / supp 19 / pixel 20 / loopPixel 20 / loopViews 14）| 视图并集 56 → 判定域 112 | 基线 43 | 缺 69（已登记 69，上界 69）| 无主基线 0`，`node scripts/check-visual-coverage.js` rc=0 ⇒ 没有为"不存在的改动"新增任何登记 |
| 行尾与 diff 对账 | ✅ | 两口径逐行相同：`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 均为 `.gitignore 2/0`、`gui-ci-exit-contract.test.js 85/0`。当场量的 EOL 档位：被改的测试文件是 `i/lf w/crlf`（工作副本 cr=658 lf=658，编辑后仍纯 CRLF），我新建的两个文件是 LF（cr=0）——索引侧统一存 LF，故不产生幽灵行；CHANGELOG 顶部插入按**逐行原样**保留各行自己的行尾（见 CHANGELOG 行的 splice+join 驱动） |
| 品牌残留 / 文档同步 | ✅ / PENDING | `node scripts/check-no-brand-residue.js` 实跑 `PASS（扫描 9803 个 tracked 文件，无品牌残留）` rc=0；openspec 同步检查本机不冒认，由 CI 的 `openspec-sync-check` 出结果后随回填改写本格 |
| QM-6 CCG 双模型外部评审 | PENDING（本行由后续提交就地改写） | 改动集 >200 行 ⇒ `scripts/ccg-review-decider.js` 判 `mode=dual`。产物按**父提交**入库、`deep-review.sh` 只服务当前 HEAD，所以顺序摆正：**先提交、再在 HEAD 上跑双轴**，让评审范围与判定记录同源，不回补历史产物 |
| 远程同步 | PENDING | 待本 PR 合并后由同线程回填 |

## 一、这一片交付的是什么

一句话：**把上一轮收尾链里"main 回读出来的一盏红"处理到底**——先按对照跑证明它不是我引入的，再把它修掉，因为它会砸到每一个 PR。

三件事：
1. **归因**（不是认领、也不是放行）。用三条对照读数把 `77598c4ac` 上的红定成"既有病灶 + 负载触发"，其中最硬的一条是**含我内容的 main tip 后续 push 判 success**。
2. **预算接线**。那条用例从此有用例级预算，且这个预算的数值出处在仓库里可重跑；预算常量、provenance、探针、台账四个角色收敛到一份模块，测试与复测脚本共读它。
3. **复测入口**。`scripts/case-timeout-audit.js` 让"这个 60000 是怎么来的"永远能被当场重新回答，而不是留给注释。

## 二、三处值得留给下一个人的判断

- **"跑了 0 条测试"必须与"全绿"可区分**，且区分它的必须是**工具自己**而不是人。我的变异驱动第一版就是靠 `failed.length===0` 判基线绿，于是 8 条变异齐报 NOT_CAUGHT——那一刻我差一点得出的结论是"这些锁没牙"。规模下界（`total < 43` 即拒）是这条的唯一解；同族的第三次复发。
- **归因要有"时间方向"**：只说"这不是我改的文件"不够，要说"这个红在我进主干之前就已经在 main 上出现过、在我之后又消失过"。这两条都是可数的读数，不是可解释的措辞。
- **锁自己的注释会被自己的禁词判红**。凡是"扫源码找禁词"的判据，写的时候就要假设**注释里会出现那个禁词**（因为解释病灶必须引用病灶），并把剥注释做成判据的一部分，而不是事后删注释。

## 三、故意没做

- 不改全局 `--testTimeout=10000`：那是整个 fleet 的预算，为一条 17 子进程的用例放宽等于把其余 488 个文件的挂起检测一起调慢。
- 不把该用例的 17 次 spawn 改小以减少长尾：长尾由 runner 负载主导（同一份代码空闲 1.1s / 负载 12.7s），减少两三次 spawn 改变不了摆动量级，只会让被测语义变薄。
- 不往 `.quality-gates.md` 插块、不往 ledger 加键（载体冻结）。
- 不动 `01-docs/learnings.md`：该病灶属已写进 AGENTS.md 的「预算倒挂」同族，没有新增判据；而 `learnings.md` 是多会话共用的顶部追加型写面，为一次归因去挤那条写面不划算。这一条是**有意偏差**，理由与指针在此。
- 不把复测入口接进 required check：它每作业要拉 ~14MB 日志，接进关键路径就是把 Gate 4 刚拆掉的预算墙重新立起来；`scripts/lock-timing-audit.js` 同样是人工复测入口（实测 `.github/workflows/` 内零引用），这里保持同源形态。
