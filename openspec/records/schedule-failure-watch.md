---
record: schedule-failure-watch
task: 定时作业的失败报警覆盖面（cleanup 的定时 run 连红 9 次的上游：报警装置存在，但名单是手抄的）
date: 2026-10-22
---

## 本次执行记录：给「CI 失败自动报警」补上全部定时作业，并加一把防漂移锁（schedule-failure-watch，2026-10-22）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合档（`.github/workflows/` ×2 + `scripts/` 判据本体）。入口 `scripts/session-init.sh schedule-failure-watch`；起点 `HEAD == origin/main == 85dc44ddc`；`rev-parse --abbrev-ref HEAD` == 分支名。第一次被共享根脏挡下（他人在飞的 `scripts/check-dep-audit.js`），**未绕过入口、未手搓 worktree**，等那笔提交落地后才建。偏差如实记：本刀未建 `openspec/changes/<slug>/`，pre-commit 决策层因此每次打「范围漂移：改动文件不在方案声明范围内」——与同族上一刀 #4199（同样是 `scripts/` 判据 + workflow）同形；判为 M 档（新增一条 CI 判据与其锁，不改任何运行时代码路径），不走 propose 前置门 |
| 第一性原因（QM-5 ①） | ✅ | 不是"没有报警装置"：`.github/workflows/ci-failure-handler.yml` 早就存在，`workflow_run` 失败 ⇒ 自动开 Issue + 在 PR 留言（实测它在 2026-10-22 当天有 completed/skipped 的正常心跳，确实活着）。真因是它的 `on.workflow_run.workflows` 名单**手抄了 5 个名字**（第 16 行），而仓里带 `on.schedule:` 的作业有 4 条（`Cleanup Artifacts`、`时钟位移引信巡检`、`依赖漏洞审计门禁`、`Sidecar Parity (cross-repo)`），**一条都不在名单里**。所以 cleanup 连续 9 次 schedule run `completed failure`（run `38385152658`…`39570873661`，2026-10-13 ~ 10-21；最后一次绿是 run `38239617921`，10-12）没有任何一处会响 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：这份名单没有任何载体（既无脚本读它也无测试读它）；CI 层：定时作业不产生 PR、不参与 required check，红了只落在 Actions UI；审查层：本仓有「测试有没有被 workflow 点名」的 `check-unwired-tests.js`、有「白名单条目必须接进不被短路的 job」的前提锁，唯独**没有"报警覆盖面有没有漂"的同族锁** —— 于是这份手抄清单从写下那天起就是滞后的，且漂移零成本 |
| 系统性漏洞（QM-5 ③） | ✅ | 类别=审查盲区 + 流程缺失：仓里已有三类「清单与真源对账、登记项只能缩小」的先例（`KNOWN_UNWIRED`、`MUST_LIVE_IN_UNGATED_JOB`、`HIGH_RISK_SURFACES`），报警名单是第四份手抄清单，也是唯一一份"漂了不会响"的。另有半条：**判据的"没扫到"必须与"扫了且全绿"可区分**（本仓同一周刚因 `collected != candidates` 报错过"一个没跑的文件在摘要里与跑了且绿完全同形"） |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 名单补齐 4 条定时作业；② 新增判据本体 `scripts/check-schedule-failure-watch.js`，**双向**不变量：带 `on.schedule:` 的作业必须被名单覆盖（漏 = "挂了没人知道"），名单里的名字必须还能在某个 workflow 的 `name:` 上找到（陈旧 = "读起来像已覆盖，实际永不触发"）；缩进下界取「至少 2 个空格/制表符」而非「恰好 2」——合法换缩进的文件在旧锚点下会**静默返回 0** 并让判据报"没有待覆盖项通过"（QM-6 第一轮 i5 命中，T11 钉住）；触发器判定还要求**紧邻的 `- cron:` 列表项**作合取条件，否则文档/示例里一行像 `schedule:` 的字样会被读成一次声明、凭空造出一条"必须被覆盖"的义务（QM-6 第二轮 i5，T12 反形夹具 + 正向对偶钉住；修不掉的一半如实写：仍不认 flow style，那需要真 YAML 解析器而落点作业无 Install deps）；三种工具失明（目录读不到 / 一个 yml 都没枚举到 / 名单块解析不出）统一 `SCANNER_FAULT` 非零退出，绝不退化成"没有待覆盖项 ⇒ 通过"；另带 `oddShape` 自证档（声明了 schedule 却找不到 cron ⇒ 我的形状判据抓到了别的东西）。判据只读文件、零出站、只用 node 内置（落点 `changes` 作业无 Install deps，用 js-yaml 会以 `MODULE_NOT_FOUND` 被读成"违规"）；另记一条与 Gate 12c 的现场摩擦（不是缺陷、但会咬人）：该判据按"某个字母后紧跟冒号再紧跟斜杠或反斜杠"数绝对路径，于是正则字面量 `/cron:/`、`workflows:\s*` 与"键名冒号紧跟转义换行"的 YAML 夹具串都会被数成新增本机绝对路径。正解是改写法（把冒号收进字符组 `cron[:]`、夹具用行数组 join），**不是**调大账本；控制对照：同一判据取空差量（`--base == --head`）读数 `counts=1161 files=561` 与主干一致 ⇒ 本 PR 净增 0；③ 行为锁 `scripts/check-schedule-failure-watch.test.js` **13 条**（T1-T12 含 T3b）：夹具正反控 + 真仓规模下界与成员钉 + 接线自检 + 驱动追踪锁 + 缩进弹性锁 + 形状判据的反形夹具；④ 接进 `quality-gate.yml` 的 `changes` 作业 `Gate 2b13`（只跑判据与锁，不动任何真实资源）|
| 变异反证 | ✅ | 驱动入仓 `scripts/check-schedule-failure-watch.mutation.js`，三靶子（判据本体 / 行为锁自身 / 两份 workflow）。终跑 **`SUMMARY CAUGHT=9 MISSED=1 PROBLEM=0 TOTAL=10`**、`RESULT=OK`、`RESTORE md5=true files=3`、还原后被测锁 `rc=0 tests=13`：m1 单向锁→T10；m2 不剥注释→T3；m8 缩进下界退回恰好 2→T11；m9 摘 cron 合取→T12；m3 不做行尾归一→T4+T6；m4b 同时摘两道 `SCANNER_FAULT` 守卫→T5；m5 摘 workflow 接线→T7；m6 名单删掉 Cleanup Artifacts→T7；m7 名单塞不存在的名字→T7。**唯一声明的 MISSED 是 m4（空扫描域守卫），而它的"重叠"不靠一句话**：m4b 同时摘掉两道守卫后 T5 立刻红，于是"这道被那道覆盖"是机械事实而非归因文字。驱动头七条硬约束，第 6 条反向校验"声明冗余却被抓住 ⇒ PROBLEM"——本行第一次写的 m3=冗余就是被它当场否证（T4+T6 抓得住）后改判 CAUGHT 的 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 把"手抄的清单"变成有真源可推导的不变量（真源 = 各 workflow 文件自己的 `on.schedule:` 与 `name:`），判据与夹具里都不再另存一份作业名枚举；② 双向不变量 + 三档失明各有一条夹具锁 ⇒ 新增定时作业忘了进名单、或名单里留了个已改名的作业，`Gate 2b13` 当场红并点名文件；③ 变异驱动入仓 `scripts/check-schedule-failure-watch.mutation.js`（脏树拒绝 / 锚点命中恰为 1 / 三靶子 / 还原后再跑一次被测锁），并把驱动头的第 6、7 两条纪律机械化：**MISSED 必须声明、且重叠要由另一条变异证明**（m4 靠 m4b，不再靠一句 `missWhy`），驱动反向校验"声明冗余却被抓住"与"写后回读不符"，前提一变就红—— 把 MISSED 报成 CAUGHT 是谎，把冗余防呆当成"已被反证守住"是第二种谎；④ 名单不变量与两条方向一起写进 workflow 的注释里，下一个改它的人读到的是判据而不是回忆 |
| 夹具自己的一课（不写成实现缺陷） | ✅ | ① 驱动**首跑 7 条里 5 条 MISSED**。逐条查下去：3 条是我的测试写空了（T1 的夹具同时含两类缺陷 ⇒ 摘掉单向判据它照样绿；T3 用 `#   schedule:` 测"剥注释"，而那行本来就匹配不上锚点；m5 摘的是断言本身 ⇒ 断言恒真时测试照绿），已分别补 **T10（只留陈旧项的夹具）**、把 T3 换成**名单括号内夹注释**这一真会坏的形状、把 m5 的靶子从"测试文件"改成 **quality-gate.yml 的接线行**；另 2 条（m3 行尾归一、m4 空域守卫）当时被我判成**重叠/冗余防呆**并标 `expectMiss` —— 其中 **m3 那个标签是错的**：QM-6 第二轮之后给驱动加了第 6 条的反向校验（"声明冗余却被抓住 ⇒ PROBLEM"），m3 当场被 T4+T6 抓住、驱动直接判我那句话为假，已改判 CAUGHT。剩下 m4 一条才是真的重叠，而它现在由 m4b 机械证明（同时摘两道守卫 T5 才红）而不是靠我写的 `missWhy`。这条留在这里的价值不是"我后来改对了"，而是**证明那条校验有牙**：人给自己贴"冗余防呆"的标签时，只有机器能把它撕下来  ② 本行第一次重写用的是 bash 里的内联 `node -e`，其中反引号被 bash 当命令替换执行 —— 结果是这一行里几处引用被静默吃掉、并把一个 `.js` 当 shell 脚本跑了一遍（无破坏，但记录当场变成假话）。已改用 .cjs 文件重写，并在此如实记下：**本仓明令禁止带反引号/嵌套引号的内联 `node -e`，我自己踩了**。 |
| 行尾与 diff 对账 | ✅ | 三处 CRLF 面改动（`ci-failure-handler.yml`、`quality-gate.yml`、`.gitignore`）全部用"按当场 eol 逐行写回"的脚本插入，未统一回写；每个锚点断言命中数、写盘前断言 CR 守恒（handler +15、gate +15、gitignore +4/+1） |
| QM-1 打包 / QM-4 视觉 | N/A | 差量文件集实测为 `.github/workflows/{ci-failure-handler,quality-gate}.yml`、`scripts/check-schedule-failure-watch{,.test,.mutation}.js`、`.gitignore`、本记录 —— 不触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件 |
| QM-6 CCG 双模型外部评审 | 两轮已跑并逐条处置（见下两节）；补齐 i2/i5/i7 后的第三轮在前头 | `sh scripts/deep-review.sh`（critic=claude / proposer=opencode，跨家族校验通过）。本笔命中 `.github/workflows/` **高危面**前缀 ⇒ 闭合只认 `tier=external` + 可核 `evidence`。`tier` 的生产方 `scripts/ccg-review-writeback.js`（#4151）本轮**现场在工作**，两次都以 `reason=not-closed` 正确拒写 —— 它只认真外部交付，自扮演收口拿不到 `tier`，所以那一格仍需会话手写并在记录里声明 |
| 远程同步 | 由门禁推导 | 不手写状态词、不为收口另开 PR |

## QM-6 第二轮深审（critic=claude，7 条）逐条处置

存档 `.adversarial/ccg-deep-980bb7b0/`。Critical 2 / Warning 5；最低维度分 4；待裁决 7 条，其中**高危域 1 条**（`i3 domains=[datamigration]` —— 由"写入/替换受跟踪文件"这类措辞触发，本 PR 差量里没有任何数据迁移）。

| 条目 | 指控 | 处置 | 证据 |
| --- | --- | --- | --- |
| i2 | `expectMiss` 把"测试没抓到"包装成"重叠防呆"，掩盖覆盖缺口、让反证表看着像已闭合 | **成立 ⇒ 已修，并且它当场证伪了我一个错标签** | 三点：① "得分虚高"没有载体——本仓驱动从不输出"变异得分"，它打的是 `SUMMARY CAUGHT/MISSED/PROBLEM` 三个分开的数；② 接受其要求"若确属冗余应由另一条变异证明"，新增 **m4b**（同时摘掉两道 `SCANNER_FAULT` 守卫 ⇒ T5 立刻红）⇒ m4 的重叠从归因文字变成机械事实；③ 更值钱的是这条逼出来的自我纠正：我原先把 m3（行尾归一）标成冗余，加了第 6 条的"声明冗余却抓住 ⇒ PROBLEM"校验后，**m3 被 T4+T6 抓住、驱动直接判我那句话为假** ⇒ 已改判 CAUGHT。终跑 MISSED 从 3 降到 1，且剩下那 1 条有配对证明 |
| i5 | 形状判据会把合法出现 `cron:`/缩进变化的文件读错，建议加"含 cron: 但非触发器"的负控并在解析失败时抛 `SCANNER_FAULT` | **成立 ⇒ 已修（一半），并如实写下修不掉的那一半** | `SCANNER_FAULT` 三档本来就在（本轮不加分支，指出正确）。补的是合取条件：一行像 `schedule:` **且**其后 4 行内有 `- cron:` 列表项才算触发器，并加 **T12** 反形夹具（出现 `  schedule:` 而无 cron 项 ⇒ 不造出"必须被覆盖"的假义务）+ 正向对偶（补上 cron 就必须认），驱动 m9 专摘合取、指名 T12 红。修不掉的一半如实写：形状判据仍不认 flow style（`on: {schedule: …}`），要完备就得引 YAML 解析器，而落点 `changes` 作业无 Install deps ⇒ 留在遗留 |
| i7 | `split/join` 替换后没有结构校验；崩溃无原子回滚；应"确保还原 md5 完全一致再继续下一条" | **成立 ⇒ 已修能修的那半** | 驱动加了三道写后回读：① 写入后回读若与原文逐字相同 ⇒ 判 PROBLEM 并跳过（命中数只证明锚点唯一，不证明落盘生效）；② 回读里找不到替换文本 ⇒ 判 PROBLEM；③ **还原后**再回读一次，与原文不同就中止整轮（否则后续每条变异量的都是脏文件，整张表不可信）。没做的那半也说清：不引 `js-yaml` 做结构解析（同上，作业无依赖），而变异替换刻意都是**同一行内的合法文本**，不改结构 |
| i1 / i6 | 判定产物的 `sha` 是父提交；`required:true` 配 `pending` + `findings:null` 是"未验证却入库"的虚假留痕 | **不成立**（那是拦截链的形状，不是留痕造假） | 同 #4199 与第一轮 i3 已登记的形态：pre-commit 在新提交生成前跑，故按父提交与 stagedDiffHash 命名，入口逐字打印"这是预期行为"；`pending` 的消费者就是 `check-pr-exec-record --mode=enforce`，它每次都在拦（本 PR 至今未合并即为证据）。i6 建议"未完成深审前不得生成产物"等于要求判定不落盘，而判定不落盘就没有可审计的路由决策；建议里的 `tier=unverified` 不在闭集 `{external, self-play, none, unknown}` 内，写进去会被读成 `unrecognized` 一律拦 |
| i3（域 `datamigration`） | 驱动就地写受跟踪的 workflow 文件，崩溃无原子回滚、脏态可固化 | **不成立**（后果响、可精确恢复，且脏态被前置挡住） | 三条实测：动手前 dirty 前置（本会话实跑打 `REFUSE: 被测面工作树不等于 HEAD（…）` 并 exit 2，正是"脏态固化"这条路径的堵点）；靶子内替换都是同行合法文本（m5 换成另一条 shell 行、m6/m7 增删一行名单项），不改 YAML 结构，且 `check-workflow-structure` 在 `Gate 2b` 每次都跑；还原阶段逐靶子比 md5 并再跑一次被测锁（终跑 `RESTORE md5=true files=3 rc=0 tests=13`）。域标签 `datamigration` 由"写入/替换"措辞触发而本 PR 无数据迁移代码 ⇒ 按引擎规则补外部复核三格，出处用公开 PR 评论 |
| i4 | 记录里承认过"bash 内联 `node -e` 含反引号被 shell 执行"这一反模式，说明构建脆弱；建议全面禁止并写后逐字读回 | **成立 ⇒ 已按它做，且比它要求的多一步** | 这条指控的"痕迹"正是本记录那条 learnings 本身（本仓要求如实留事故，不留才违规）。它要求的两件事都已机械化：文本写入一律走 .cjs；写后回读断言 —— 本轮还把"回读"升级成三道（见 i7），并把外部动作也改成"先断言锚点命中数再执行"。剩下的不是脚本问题：反引号只在**内联**时才危险，本刀的纪律是"任何含反引号或嵌套引号的内联脚本一律禁止"，写进 learnings 而不是删掉那次事故 |

## QM-6 第一轮深审（critic=claude，8 条）逐条处置

产物 `.ccg/reviews/`（本次判定的内容寻址键），存档 `.adversarial/ccg-deep-707ac4fa/`。维度分 correctness 4 / security 3 / performance 8 / maintainability 3，最低分 3；收敛落 `self_play`，待裁决 8 条，`requiresExternalReview=[]`（本轮**没有**高危域条目 —— 与 PR #4199 第三轮不同，那轮的两条来自指控措辞）。

| 条目 | 指控 | 处置 | 证据 |
| --- | --- | --- | --- |
| i1/i2/i4 | 变异驱动就地改受跟踪的文件、没有 try/finally 或原子替换，崩溃会留下被改坏的源；i2 特别点名靶子里有 `quality-gate.yml`；i4 更进一步说"破坏性工具不该入库" | **不成立**（后果是响的、可精确恢复），i4 与上一刀的裁决直接相反、按上一刀的理由保持 | 驱动动手前有 dirty 前置：本会话实测它在脏态打 `REFUSE: 被测面工作树不等于 HEAD（…）` 并 exit 2 ⇒ "上次崩在中间"不会把污染态固化成还原基线；恢复是单文件 `git checkout -- <精确路径>`（不碰宽目录，守 R2）；每条变异的替换都是**同一行内的合法文本**（m5 把接线行换成 `echo wiring-removed`，不破坏 YAML 结构），且跑完对三个靶子分别比 md5 并**再跑一次被测锁**（终跑 `RESTORE md5=true files=3 rc=0`）。i4 建议的"不入库"与 PR #4199 第一轮 i3 的结论（取证工具不入库 ⇒ 别人复跑不了）正面冲突；两边我按后者保持，并在此写明这是**同一族意见的对撞**而不是我漏读 |
| i3 | `.ccg/reviews/*.json` 的 `sha` 不等于 PR head（写的是父提交）、`required:true` 配 `status:pending` 等于"给未验证的产物盖章" | **不成立** | 同 #4199 已登记的形态：pre-commit 在新提交**生成之前**跑，父提交命名是既定行为，入口逐字打印过；`status=pending` 的用途正是让 `check-pr-exec-record --mode=enforce` 拦合并 —— 本 PR 现在就是带着它不开合并，机制在生效而不是在说谎。建议里的"对齐 head SHA"反而会把判定产物写成与任何提交都不可核对的东西 |
| i5 | `^\s{2}schedule:` 把缩进写死，YAML 换缩进即静默漏检 | **成立 ⇒ 已修** | 改成 `[ \t]{2,}`（名单正则同步），并加 **T11**：4/8 空格缩进的合法文件必须仍被识别；驱动 m8 重新定义为"把下界退回恰好 2"，实测指名 T11 变红（这一条从"重叠防呆 MISSED"升级成 CAUGHT，正是被这条指控逼出来的）。取向的理由写进注释：**多匹配会在真仓立刻响，少匹配是静的**，而"静默返回 0 ⇒ 报通过"正是本刀要消灭的形状 |
| i6 | 记录里的"连红 N 天"这类断言没带 run 号，读起来像未证 | **成立 ⇒ 已修**（并且它是对的） | 按 `gh run list --workflow=cleanup-artifacts.yml --event schedule` 重取：连续 **9** 次 `completed failure`（run `38385152658`…`39570873661`，2026-10-13 ~ 10-21），最后一次绿是 run `38239617921`（10-12）⇒ 我原写的"自 10-14 起 8 天"**少数了一天**。已把 run 号写进记录，并同步去改 #4199 的 PR 正文（那里也写着 8 天）；commit message 里的旧读数按"历史事实不改写"原则留着，由本行说明它是被否证的旧值 |
| i7 | 产物引用了"未配置的后端（opencode、claude）"且 `tier:unknown`，构成未决依赖 | **不成立** | 后端是配好的：`sh scripts/deep-review.sh --check-deps` 当次实跑打 `体检通过：后端可用`，两个裸名分别解析到 `~/.local/bin/claude.exe` 与 `/d/Program Files/npm-global/opencode.cmd`；真源是 `scripts/ccg-review-backends.list`（critic=claude、proposer=opencode），本轮跨家族校验通过。`tier` 的 `unknown` 是判定器**新建时**写的占位值（`ccg-review-decider.js:685`），不是"依赖没配" |
| i8 | `expectMiss` 靠人手写 missWhy 说明"这条确实被别处覆盖"，人写错了就没人查 | **部分成立 ⇒ 已把能自动化的部分自动化** | 机器可校的那半已在驱动里：声明 `expectMiss` 时驱动**要求该变异确实抓不到**，一旦抓到了就 `PROBLEM(声明冗余却抓住了)` 并让 `RESULT` 非 OK ⇒ "它已被别处覆盖"这件事的**下半**（移除后无人红）是机器校的。人写的那半是"被谁覆盖"的归因文字 —— 要全自动就得让驱动去证明存在另一条能抓同一缺陷的变异，那是跨变形的等价类判定，本仓没有那样的机制。i5/i6 修完之后，本轮的 MISSED 从 3 降到 2，就是这条被压实的过程本身 |
- 判定：混合 PR（含 workflow 与 `scripts/` 判据本体），不走 docs-only 快速通道
- 保留门禁：品牌残留 ✅ | 绝对路径账本未放宽 ✅（本记录不写本机绝对路径）| `check-workflow-structure` 0 违规 | `check-step-failfast` ✅（Gate 2b13 的 run 块两条命令、`shell: bash` fail-fast）| `check-unwired-tests` OK | `check-record-qm5-rows` OK | `check-gate-record-debt` OK | `check-text-encoding-integrity` 无新增损坏

### 现场读数（引用前先重跑，都是活数）

- `node scripts/check-schedule-failure-watch.js` 修复前：`workflows=16 scheduled=4 list=5 未覆盖=4 陈旧名单项=0 判定=FAIL`；修复后：`list=9 未覆盖=0 判定=OK`
- `node --test scripts/check-schedule-failure-watch.test.js` → `# tests 13 / pass 13 / fail 0`
- `node scripts/check-schedule-failure-watch.mutation.js` → `SUMMARY CAUGHT=9 MISSED=1 PROBLEM=0 TOTAL=10`、`RESULT=OK`、`RESTORE md5=true files=3`、还原后被测锁 `rc=0 tests=13`（这一条**必须在干净基线上跑**：驱动对脏树直接 `REFUSE` 并 exit 2）

## 遗留（不假装已闭合）

1. **QM-6 第三轮与高危面闭合**：两轮已跑完并逐条处置（见上两节），补齐 i2/i5/i7 后还要再跑一轮确认无新增 Critical；本笔命中 `.github/workflows/` 高危面前缀，闭合只认 `tier=external` + 可核 `evidence`，而 `tier` 的唯一生产方 `scripts/ccg-review-writeback.js` 对自扮演收口一律拒写 ⇒ 那一格由会话手写并在记录里明写"由会话手写"（这不是绕行，是把代用如实登记）。
2. **报警只对"失败"出声，不对"整月没有一次运行"出声**：`workflow_run` 只在有 run 完成时触发。若某条定时作业因 cron 写错、被禁用或 runner 长期排队而**根本没有 run**，本判据看不见（它量的是覆盖面，不是心跳）。那需要另一把读 `gh run list --event schedule` 近期是否存在 run 的锁，属独立一刀。
3. **非定时的 7 条工作流仍不在名单里**（`Visual Tests`、`ops-center CI`、`债务基线重算`、`债务熔断门禁`、`autonomous-loop`、`AI Agent Judge`、本 handler 自身）。刻意不收：本刀的不变量是"带 schedule ⇒ 必须被覆盖"这一类**没有 PR、没人盯**的形状；把名单语义从"无人看的那类"扩成"全部工作流"是另一个决定（会给每次成功也建立 Issue 的噪声面提要求），需要单独取证。
4. **判据看的是形状，不是产物**：某条定时作业跑成功但实际什么都没做（例如上游静默返回空列表），本锁读不出来 —— 那要靠作业自己打印可核对的读数（`cleanup-artifacts.js` 的 `ARTIFACT-CLEAN … verdict=` 就是这个形状，但只有它一家这么做）。

## CHANGELOG 条目

# fix(ci): 定时作业全部接进失败自动报警，并加一把防漂移锁（schedule-failure-watch）

- 现场：`Cleanup Artifacts` 的 schedule run 连红 9 次无人发现（run `38385152658`…`39570873661`，2026-10-13 ~ 10-21；最后一次成功是 run `38239617921`，10-12）。报警装置其实早就有（`ci-failure-handler.yml`：`workflow_run` 失败 ⇒ 自动开 Issue + PR 留言），但它的工作流名单是手抄的 5 个名字，仓里 4 条带 `on.schedule:` 的作业一条都不在里面 —— 定时作业没有 PR、不参与 required check，红了只落在 Actions UI 里。
- 修法：名单补齐 4 条定时作业；新增判据本体 `scripts/check-schedule-failure-watch.js`，**双向**对账（带 schedule 的必须被覆盖 / 名单里的名字必须还存在），三种"工具失明"统一判 `SCANNER_FAULT` 而不是退化成"没有定时作业 ⇒ 全绿"；接进 `quality-gate.yml` 的 `changes` 作业 `Gate 2b13`（放 `static-gates` 等于给自己关校验，因为 `.github/workflows/**` 在 docs-only 白名单里）。
- 行为锁 13 条（夹具正反控 + 真仓规模下界 + 接线自检 + 驱动追踪锁 + 缩进弹性 + 合取条件反形夹具）；变异驱动入仓，10 条变异终跑 `CAUGHT=9 / MISSED=1 / PROBLEM=0`，唯一那条 MISSED（空扫描域守卫）的重叠由另一条变异 m4b 机械证明。驱动首跑时 7 条里 5 条 MISSED，查出 3 条是测试写空（单向夹具、匹配不上的锚点、摘断言本身），补成 T10 / 重写 T3 / 把反证靶子改到 workflow 接线行；第二轮又给驱动加了两道自我校验（"声明冗余却被抓住"与"写后回读不符"），当场否证了我贴在 m3 上的"冗余"标签。

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
