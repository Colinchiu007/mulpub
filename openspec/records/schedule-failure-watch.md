---
record: schedule-failure-watch
task: 定时作业的失败报警覆盖面（cleanup 连红 8 天的上游：报警装置存在，但名单是手抄的）
date: 2026-10-22
---

## 本次执行记录：给「CI 失败自动报警」补上全部定时作业，并加一把防漂移锁（schedule-failure-watch，2026-10-22）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合档（`.github/workflows/` ×2 + `scripts/` 判据本体）。入口 `scripts/session-init.sh schedule-failure-watch`；起点 `HEAD == origin/main == 85dc44ddc`；`rev-parse --abbrev-ref HEAD` == 分支名。第一次被共享根脏挡下（他人在飞的 `scripts/check-dep-audit.js`），**未绕过入口、未手搓 worktree**，等那笔提交落地后才建 |
| 第一性原因（QM-5 ①） | ✅ | 不是"没有报警装置"：`.github/workflows/ci-failure-handler.yml` 早就存在，`workflow_run` 失败 ⇒ 自动开 Issue + 在 PR 留言（实测它在 2026-10-22 当天有 completed/skipped 的正常心跳，确实活着）。真因是它的 `on.workflow_run.workflows` 名单**手抄了 5 个名字**（第 16 行），而仓里带 `on.schedule:` 的作业有 4 条（`Cleanup Artifacts`、`时钟位移引信巡检`、`依赖漏洞审计门禁`、`Sidecar Parity (cross-repo)`），**一条都不在名单里**。所以 cleanup 连红 8 天没有任何一处会响 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：这份名单没有任何载体（既无脚本读它也无测试读它）；CI 层：定时作业不产生 PR、不参与 required check，红了只落在 Actions UI；审查层：本仓有「测试有没有被 workflow 点名」的 `check-unwired-tests.js`、有「白名单条目必须接进不被短路的 job」的前提锁，唯独**没有"报警覆盖面有没有漂"的同族锁** —— 于是这份手抄清单从写下那天起就是滞后的，且漂移零成本 |
| 系统性漏洞（QM-5 ③） | ✅ | 类别=审查盲区 + 流程缺失：仓里已有三类「清单与真源对账、登记项只能缩小」的先例（`KNOWN_UNWIRED`、`MUST_LIVE_IN_UNGATED_JOB`、`HIGH_RISK_SURFACES`），报警名单是第四份手抄清单，也是唯一一份"漂了不会响"的。另有半条：**判据的"没扫到"必须与"扫了且全绿"可区分**（本仓同一周刚因 `collected != candidates` 报错过"一个没跑的文件在摘要里与跑了且绿完全同形"） |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 名单补齐 4 条定时作业；② 新增判据本体 `scripts/check-schedule-failure-watch.js`，**双向**不变量：带 `on.schedule:` 的作业必须被名单覆盖（漏 = "挂了没人知道"），名单里的名字必须还能在某个 workflow 的 `name:` 上找到（陈旧 = "读起来像已覆盖，实际永不触发"）；三种工具失明（目录读不到 / 一个 yml 都没枚举到 / 名单块解析不出）统一 `SCANNER_FAULT` 非零退出，绝不退化成"没有待覆盖项 ⇒ 通过"；另带 `oddShape` 自证档（声明了 schedule 却找不到 cron ⇒ 我的形状判据抓到了别的东西）。判据只读文件、零出站、只用 node 内置（落点 `changes` 作业无 Install deps，用 js-yaml 会以 `MODULE_NOT_FOUND` 被读成"违规"）；另记一条与 Gate 12c 的现场摩擦（不是缺陷、但会咬人）：该判据按"某个字母后紧跟冒号再紧跟斜杠或反斜杠"数绝对路径，于是正则字面量 `/cron:/`、`workflows:\s*` 与"键名冒号紧跟转义换行"的 YAML 夹具串都会被数成新增本机绝对路径。正解是改写法（把冒号收进字符组 `cron[:]`、夹具用行数组 join），**不是**调大账本；控制对照：同一判据取空差量（`--base == --head`）读数 `counts=1161 files=561` 与主干一致 ⇒ 本 PR 净增 0；③ 行为锁 `scripts/check-schedule-failure-watch.test.js` **11 条**（T1-T10 含 T3b）：夹具正反控 + 真仓规模下界与成员钉 + 接线自检 + 驱动追踪锁；④ 接进 `quality-gate.yml` 的 `changes` 作业 `Gate 2b13`（只跑判据与锁，不动任何真实资源）|
| 防止再次发生（QM-5 ⑤） | ✅ | ① 把"手抄的清单"变成有真源可推导的不变量（真源 = 各 workflow 文件自己的 `on.schedule:` 与 `name:`），判据与夹具里都不再另存一份作业名枚举；② 双向不变量 + 三档失明各有一条夹具锁 ⇒ 新增定时作业忘了进名单、或名单里留了个已改名的作业，`Gate 2b13` 当场红并点名文件；③ 变异驱动入仓 `scripts/check-schedule-failure-watch.mutation.js`（脏树拒绝 / 锚点命中恰为 1 / 三靶子 / 还原后再跑一次被测锁），并把第 6 条纪律写进驱动头：**MISSED 必须声明并按声明校验**（冗余/重叠防呆要写清被谁覆盖，驱动反过来校验"确实没抓住"，前提一变就红）—— 把 MISSED 报成 CAUGHT 是谎，把冗余防呆当成"已被反证守住"是第二种谎；④ 名单不变量与两条方向一起写进 workflow 的注释里，下一个改它的人读到的是判据而不是回忆 |
| 夹具自己的一课（不写成实现缺陷） | ✅ | 驱动**首跑 7 条里 5 条 MISSED**。逐条查下去：3 条是我的测试写空了（T1 的夹具同时含两类缺陷 ⇒ 摘掉单向判据它照样绿；T3 用 `#   schedule:` 测"剥注释"，而那行本来就匹配不上锚点；m5 摘的是断言本身 ⇒ 断言恒真时测试照绿），已分别补 **T10（只留陈旧项的夹具）**、把 T3 换成**名单括号内夹注释**这一真会坏的形状、把 m5 的靶子从"测试文件"改成 **quality-gate.yml 的接线行**；另 2 条（m3 行尾归一、m4 空域守卫）经核确实是**重叠/冗余防呆**（JS 多行 `$` 在 `\r` 前即成立；空域时 handler 一定也找不到、下一条分支已覆盖），按第 6 条纪律标成 `expectMiss` 并写明原因，而不是把 MISSED 报成 CAUGHT  ② 本行第一次重写用的是 bash 里的内联 `node -e`，其中反引号被 bash 当命令替换执行 —— 结果是这一行里几处引用被静默吃掉、并把一个 `.js` 当 shell 脚本跑了一遍（无破坏，但记录当场变成假话）。已改用 .cjs 文件重写，并在此如实记下：**本仓明令禁止带反引号/嵌套引号的内联 `node -e`，我自己踩了**。 |
| 行尾与 diff 对账 | ✅ | 三处 CRLF 面改动（`ci-failure-handler.yml`、`quality-gate.yml`、`.gitignore`）全部用"按当场 eol 逐行写回"的脚本插入，未统一回写；每个锚点断言命中数、写盘前断言 CR 守恒（handler +15、gate +15、gitignore +4/+1） |
| QM-1 打包 / QM-4 视觉 | N/A | 差量文件集实测为 `.github/workflows/{ci-failure-handler,quality-gate}.yml`、`scripts/check-schedule-failure-watch{,.test,.mutation}.js`、`.gitignore`、本记录 —— 不触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件 |
| QM-6 CCG 双模型外部评审 | 待跑（PENDING） | 本笔命中 `.github/workflows/` **高危面**前缀 ⇒ 闭合只认 `deepReview.tier=external` + 可核 `evidence`。**且这条在本仓有实测边界**：`tier=external` 的生产方 `scripts/ccg-review-writeback.js` 只认"真外部交付"那一档，自扮演收口拿不到 `tier`（已登记），所以高危面这一格大概率仍要会话手写 + 如实声明。未闭合前不合并 |
| 远程同步 | 由门禁推导 | 不手写状态词、不为收口另开 PR |

- 判定：混合 PR（含 workflow 与 `scripts/` 判据本体），不走 docs-only 快速通道
- 保留门禁：品牌残留 ✅ | 绝对路径账本未放宽 ✅（本记录不写本机绝对路径）| `check-workflow-structure` 0 违规 | `check-step-failfast` ✅（Gate 2b13 的 run 块两条命令、`shell: bash` fail-fast）| `check-unwired-tests` OK | `check-record-qm5-rows` OK | `check-gate-record-debt` OK | `check-text-encoding-integrity` 无新增损坏

### 现场读数（引用前先重跑，都是活数）

- `node scripts/check-schedule-failure-watch.js` 修复前：`workflows=16 scheduled=4 list=5 未覆盖=4 陈旧名单项=0 判定=FAIL`；修复后：`list=9 未覆盖=0 判定=OK`
- `node --test scripts/check-schedule-failure-watch.test.js` → `# tests 11 / pass 11 / fail 0`
- `node scripts/check-schedule-failure-watch.mutation.js` → `SUMMARY CAUGHT=5 MISSED=3 PROBLEM=0 TOTAL=8`、`RESTORE md5=true files=3 还原后被测锁 rc=0 tests=11`

## 遗留（不假装已闭合）

1. **QM-6 未跑**（上表已标 PENDING）：跑完把逐条处置追加在本节上方，未闭合前不合并。
2. **报警只对"失败"出声，不对"整月没有一次运行"出声**：`workflow_run` 只在有 run 完成时触发。若某条定时作业因 cron 写错、被禁用或 runner 长期排队而**根本没有 run**，本判据看不见（它量的是覆盖面，不是心跳）。那需要另一把读 `gh run list --event schedule` 近期是否存在 run 的锁，属独立一刀。
3. **非定时的 7 条工作流仍不在名单里**（`Visual Tests`、`ops-center CI`、`债务基线重算`、`债务熔断门禁`、`autonomous-loop`、`AI Agent Judge`、本 handler 自身）。刻意不收：本刀的不变量是"带 schedule ⇒ 必须被覆盖"这一类**没有 PR、没人盯**的形状；把名单语义从"无人看的那类"扩成"全部工作流"是另一个决定（会给每次成功也建立 Issue 的噪声面提要求），需要单独取证。
4. **判据看的是形状，不是产物**：某条定时作业跑成功但实际什么都没做（例如上游静默返回空列表），本锁读不出来 —— 那要靠作业自己打印可核对的读数（`cleanup-artifacts.js` 的 `ARTIFACT-CLEAN … verdict=` 就是这个形状，但只有它一家这么做）。

## CHANGELOG 条目

# fix(ci): 定时作业全部接进失败自动报警，并加一把防漂移锁（schedule-failure-watch）

- 现场：`Cleanup Artifacts` 连红 8 天无人发现。报警装置其实早就有（`ci-failure-handler.yml`：`workflow_run` 失败 ⇒ 自动开 Issue + PR 留言），但它的工作流名单是手抄的 5 个名字，仓里 4 条带 `on.schedule:` 的作业一条都不在里面 —— 定时作业没有 PR、不参与 required check，红了只落在 Actions UI 里。
- 修法：名单补齐 4 条定时作业；新增判据本体 `scripts/check-schedule-failure-watch.js`，**双向**对账（带 schedule 的必须被覆盖 / 名单里的名字必须还存在），三种"工具失明"统一判 `SCANNER_FAULT` 而不是退化成"没有定时作业 ⇒ 全绿"；接进 `quality-gate.yml` 的 `changes` 作业 `Gate 2b13`（放 `static-gates` 等于给自己关校验，因为 `.github/workflows/**` 在 docs-only 白名单里）。
- 行为锁 11 条（夹具正反控 + 真仓规模下界 + 接线自检 + 驱动追踪锁）；变异驱动入仓，8 条变异 `CAUGHT=5 / MISSED=3`，其中 3 条 MISSED 是**声明过的重叠防呆**并逐条写明被谁覆盖 —— 驱动首跑时 7 条里 5 条 MISSED，查出 3 条是我的测试写空了（单向夹具、匹配不上的锚点、摘断言本身），补成 T10/重写 T3/把反证靶子改到 workflow 接线行。

## learnings


### lesson: 内联脚本里的反引号会被 shell 执行掉，静默改坏文本

在 bash 双引号里写 `node -e "…`on.schedule:`…"` 时，反引号不是字符串内容而是命令替换：shell 会**真的执行**
被反引号包住的东西，把它 stdout 的结果拼进脚本。后果分两级——轻则那段文字凭空消失（本次：执行记录一整行的引用
被吃成空格，读起来仍然像一句完整的话），重则执行的是路径（本次把一个 `.js` 当 shell 脚本跑，逐行报 command not
found，若无外泄副作用也只是吵）。三条口径：① 任何含反引号或嵌套引号的内联 `node -e` / `bash -c` /
`powershell -Command` 一律写成 .cjs/.ps1 文件再跑（本仓既有硬规则，这次是它第 N 次以另一种形态出现）；
② 写文本类文件必须"写盘前断言目标片段确实存在"，本次靠 `if (!out.includes(probe)) throw` 才没让坏行留在盘上；
③ 事后核查不要只看命令 rc，要**把被改的段落读回来逐字看**——rc=0 + "OK row fixed" 那次，产出的就是一行假话。

### lesson: 手抄的清单必须有真源对账，且"没扫到"必须与"扫了全绿"可区分

一份靠人维护的名单（这里是 `workflow_run.workflows`）从写下那天就开始滞后。三个可复用的判据形状：① **双向对账**——漏项与陈旧项都要红，只判一边等于给退化留门；② **真源从被描述物自己推**（`on.schedule:` 与 `name:` 都在 workflow 文件里），不许在判据或注释里手抄第二份枚举；③ **三档失明**（目录读不到 / 枚举为空 / 目标块解析不出）一律 `SCANNER_FAULT` 非零退出，绝不允许退化成"没有待覆盖项 ⇒ 通过"。另记一条：给锁做变异反证时，**MISSED 不是失败也不是通过**——要么证明它守的性质已被别条路覆盖（写下来并让驱动校验"确实抓不到"），要么承认测试写空去补；把 MISSED 报成 CAUGHT 是谎，把冗余防呆当成"已被反证守住"是第二种谎。
