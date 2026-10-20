## 1. 地基：隔离工作区与规格

- [x] 1.1 共享根与 `origin/main` 对齐后从规定入口建隔离 worktree：`scripts/start-mp-task.ps1 -TaskName ccg-convergence-exit`；**判据取产物不取 rc**——`git worktree list` 命中该路径、`rev-parse --abbrev-ref HEAD` == `ccg-convergence-exit`
- [x] 1.2 归因先于动手（用户指令「按你的建议做」= 先归因再决定是否动引擎）：初判「stall 误触」被实测否证（`isStalled([单轮]) ⇒ stalled=false（轮次不足）`），结论改为「③ 是唯一可达出口」。写错的初判留在 `design.md` 的否证段，不删
- [x] 1.3 本 change 四件套 + `.openspec.yaml` 落地；能力名 `ccg-deep-review-convergence`（主干无同名能力，故本 delta 是唯一出处）
- [x] 1.4 行尾档当场量取：`.gitignore` 与 `quality-gate.yml` 均为 `i/lf w/crlf attr/text=auto`；改动后两口径 numstat 对账相等（`13/0`、`4/0`），新建 md/json/js 为 LF

## 2. 夹具：真产物摘录

- [x] 2.1 `artifacts/verification-layer-sample.json` 取自 `.ccg/reviews/24cf2d8f…json`（PR #3724，被审 commit `5d660809a`），出处字段齐备（recordFile / reviewedCommit / pr / logLine / note）
- [x] 2.2 逐字段核对摘录与真记录：6 条 finding 全部 `fieldDiff=none`；`deepReview.status=self_play_blocked`、`performedBy=self-play`、`confidenceWeight=0.6`、`requiresExternalReview`=i2/i4（均 `crypto`）、`blocking` 3 条
- [x] 2.3 计数差异就地解释：logLine 的「8 条问题」是 critic 当轮原始产出，记录里的 6 条是裁决后留存。不写这段，下一个会话会把 8/6 读成漏抄（`note` 已写明）

## 3. 探针本体

- [x] 3.1 `locateVendor()` 候选顺序与 `deep-review.sh` 的驱动定位一致（`CCG_ARL_DIR` → `~/.claude/skills/adversarial-review-loop` → 本目录），且要求 engine 与 driver **同时**存在才算命中
- [x] 3.2 `readDefaults()` 现读 6 个参数；`readVendorSources()` 一处定义「读哪两份」，main 与测试同源（D2）
- [x] 3.3 `readDriverTaskShape()` 从驱动源码读 `currentRound` 表达式与单轮字面，不照想象构造 task
- [x] 3.4 ladder 四格：① 真实形状 ⇒ `self_play/stop=true`；② 被禁形状 ⇒ `continue/stop=false`（非终态）；③ 单轮 stall ⇒ `stalled=false（轮次不足）`；④ 第 2 轮打到阈值 8 ⇒ `converged`
- [x] 3.5 三档退出码 0/1/2，互不混档；`--json` 档 stdout 只放 JSON，人读行改道 stderr（D4，实测第一版把 P1 的解析炸在 position 1117）
- [x] 3.6 本机实跑读数（`node scripts/ccg-convergence-probe.js`，rc=0）：`cfg={"maxRounds":3,"scoreThreshold":8,"stallRounds":2,"stallScoreDelta":0.5,"selfPlayEnabled":true,"confidenceWeight":0.6}`、`currentRound=cfg.maxRounds 单轮字面=true`、结论行点名「只有 ③ 可达」

## 4. 回归锁（TDD：先见证红，再改判据本体）

- [x] 4.1 首跑**实测两条红**（不是推想）：P1 `SyntaxError: Unexpected non-whitespace character after JSON at position 1117`；P2 「vendor 源码里读不出 confidenceWeight」⇒ 按 D2/D4 修探针与读法后 6/6 绿（`node --test scripts/ccg-convergence-probe.test.js` rc=0，tests 6 / pass 6 / fail 0）
- [x] 4.2 P3 从「只测读得出形状」升级为**行为锁**：临时目录复制真 engine + 被改形 driver，`CCG_ARL_DIR` 指过去 ⇒ `rc=1` 且 `verdict=DRIFT` 且 problems 点名 `currentRound`；同目录换回真 driver ⇒ `rc=0`（A/B）
- [x] 4.3 踩坑并修：`CCG_ARL_DIR` 语义是**技能根**（探针自己再拼 `scripts/`），第一版传了含 `scripts` 的路径 ⇒ 夹具根本没被用上而断言仍可能巧合成立。现加正控「JSON 里的 vendor 路径必须命中临时目录名」
- [x] 4.4 P4 fail-closed：空 `CCG_ARL_DIR` + 假 HOME/USERPROFILE ⇒ rc=2、文案含「探针失明」、`--json` 档 stdout 必须为空串
- [x] 4.5 P5 夹具出处锁（含 64hex 内容寻址文件名、crypto 项与 `highRiskDomains` 同源）；P6 依赖锁（只准 require node 内置，因 changes 作业无 Install deps）
- [x] 4.6 修一行写坏的过程记录：Edit 匹配不上 ⇒ 按码点定位发现磁盘字节是 `real[k));`（少 `]`）而渲染显示 `real[k]);`；改走字节级 splice，写盘前 `vm.Script` 整份 parse、写盘后回读码点 + 行数对账（138→140）

## 5. 变异反证（判据本体的牙）

- [x] 5.1 MP1 json 档多嘴加回 ⇒ **CAUGHT**（failing=P1,P3）
- [x] 5.2 MP2 `readDefaults` 改成无视源码回传常量 ⇒ **CAUGHT**（failing=P1,P2,P3）
- [x] 5.3 MP3 摘掉「驱动形状」这条自评 ⇒ **CAUGHT**（failing=P3，指名）
- [x] 5.4 MP4 找不到引擎时返回 0 ⇒ **CAUGHT**（failing=P4，指名）
- [x] 5.5 MP5 读法退回只喂 engine ⇒ **CAUGHT**（failing=P1,P2,P3）
- [x] 5.6 MP6 把 `shipped.status !== 'self_play'` 摘成恒假 ⇒ **ESCAPED，如实记账**：P1 直接断言读数本身而不信探针自评，属**防御重叠**，不写成「锁已验证」。详见 design「否证与残留」
- [x] 5.7 还原核对：`restore md5 ok=true (f370fc85…e2)`，SUMMARY caught=5/6；驱动只改判据本体，不动测试文件

## 6. 接线与白名单

- [x] 6.1 `quality-gate.yml` changes 作业新增 `Gate 2b6 - CCG convergence-exit probe`（`shell: bash`，单命令）。编号避开 2b5：#3724 占用了 `Gate 2b5 - CCG evidence anchor` 且未合并，同号会在任一条先合时撞成两步同名
- [x] 6.2 `.gitignore` 补 `!scripts/ccg-convergence-probe.js`。判据用 `git check-ignore --no-index -v`：改前命中 `106:scripts/*.js`，改后命中 `224:!scripts/ccg-convergence-probe.js`，且 `git status` 里文件从「不存在」变为 `??`
- [x] 6.3 三条既有守卫实跑通过：`check-unwired-tests.js`（94 个测试文件，OK）、`check-step-failfast.js`（37 个多命令步骤，OK）、`.github/scripts/check-workflow-structure.js`（files=14 violations=0）

## 8. QM-6 真实双模型评审与逐条处置

- [x] 8.1 真实跑通（proposer=opencode / critic=claude，跨家族校验通过），critic 出 8 条、进裁决 6 条，`高危域必须外部复核 0 条`；日志两行 `收敛判定: status=self_play reason=selfPlay minScore=4` 与探针 ladder 逐字同形 ⇒ 探针测的是真路径
- [x] 8.2 **i1（Critical）upheld**：P3 夹具只复制 engine.js + 驱动 ⇒ 引擎若新增同目录兄弟模块，`require` 失败会把「偏离(rc=1)」伪装成「失明(rc=2)」，与本篇自己的「三档不混档」判据自相矛盾。修：整目录复制 + 「夹具文件数 == vendor 文件数 且 ≥2」下界断言
- [x] 8.3 **i2（Critical）upheld，且是真代码执行面**：`locateVendor` 第三个候选是仓库自身 `__dirname`，而 main 会 `require()` 命中文件 ⇒ 任何 PR 只要提交 `scripts/engine.js` + `scripts/ccg-deep-review.js`，Gate 2b6 就执行该 PR 作者写的代码。另两个候选需要写权限（仓库变量 / runner 本机文件），这一个不需要 ⇒ 威胁面是本 PR 新造。修：候选面删到只剩显式环境变量 + 用户技能目录，新增 P7 结构锁；变异 **MP7（把回落加回来）实测指名让 P7 变红**
- [x] 8.4 **i4（Warning）按原表述 dismiss、按修正表述换判据接住**：「依赖注释里的行号」机制不成立（生效的是路径规则，实测 `git check-ignore --no-index -v` 打印规则命中行）；但同一风险换成**规则顺序**就有牙（gitignore 后命中覆盖前者）。新增 P8，并做负控：末尾追加一条同名忽略规则 ⇒ **P8 CAUGHT**，还原后 `md5 ok=true`
- [x] 8.5 **i3 / i5 / i6（Warning）dismissed，每条给可核对证据**：i3 指「CHANGELOG 不该写工程细节」——实测既有 489 个标题块同体例、Gate 2c3 只判集合单调性（489→490 PASS），而 `远程同步 PENDING` 是协议规定的中间态；i5 指「正则无缓存浪费 CPU」——实测 8 条用例约 1.5 秒，且加缓存会把「读不到」与「读到旧值」合并，削弱 D2 的现读前提；i6 指「未引用 tasks §7」——同块「诚实边界」原文已逐字引用三条出路
- [x] 8.6 裁决按引擎模板逐条填 `prosecution/defense/verdict/rationale`（写前校验：每格非空、verdict 只取 upheld/dismissed、`critiqueFingerprint` 不碰）；**status 一律由引擎算，仓侧不手写**。复用存档 critique 的 resume 路径零模型调用即完成判定：`status=self_play_blocked`、`blocking=[i1,i2 self_play_upheld]`
- [x] 8.7 全量重跑：`node --test scripts/ccg-convergence-probe.test.js` ⇒ **tests 8 / pass 8 / fail 0**（P1–P8）；`openspec-sync-check` OK；`check-unwired-tests` / `check-step-failfast` / `check-workflow-structure` 全 OK
## 7. 故意不做（写成欠账而不是写成已完成）

- [ ] 7.1 出路①「真跑多轮抬分」：成本由用户拍板，不在本 PR 决定（#3724 单轮实测 23–40 分钟）
- [ ] 7.2 出路②「给引擎加『已外部复核』表达」：属改上游共享制品，须先在上游立 issue；本仓不得私改 vendor 副本
  - [x] 7.2a 上游 issue 草稿已写并**实跑校验过复现步骤**：`artifacts/upstream-issue-external-review-field.md`。三条归属当场纠正（`blockingFromAdjudication` 在**驱动**不在 engine 导出表；`classifyHighRisk` 收的是**字符串**不是条目对象；调用方显式给的 `highRiskDomains` 会被文本重算覆盖 —— 实测传 `['crypto']` 回来 `[]`）。投递交付渠道待维护者指定（制品内无版本号/repository 字段，不猜 URL）
- [ ] 7.3 出路③「放宽 `check-pr-exec-record` 闭合词表」：属改「谁来守门」，AGENTS.md 明文禁止 agent 自动合并这类 PR，须人工过目
- [ ] 7.4 与 #3724 的关系：两条 PR 判据互不依赖，可任意顺序合并；合并后若 `Gate 2b5/2b6` 编号读起来别扭，属命名整洁问题，不影响执行

## 9. QM-6 第二轮（对第二条判定记录 `8b8309bc…json` 所服务的那笔修复提交的真实双模型评审）

- [x] 9.1 评审日志两行继续复现探针读数：`[轮 1/1]`、`收敛判定: status=self_play reason=selfPlay minScore=4`，`待裁决 6 条；其中高危域必须外部复核 1 条`
- [x] 9.2 **新量到比 #3724 更宽的一格**：本 PR 改动集里没有任何加解密代码（`git diff --name-only origin/main..HEAD` 无相关路径），某条却被打了 `crypto` 域标签 —— 标签来源是**文案里出现了那个字样** ⇒ ③ 的「高危域必须外部复核」这道闸可由**散文**触发，不是只有真写加密才会中
- [x] 9.3 upheld 4 条并逐条落地：`i2` CHANGELOG 前页降披露（保留缺陷类别，收回可照抄的落点与步骤号）、`i6` `.gitignore` 注释去掉会腐烂的行号（改按内容指向）、`i8` P3 增「`vendor.engine` 必须以 `scripts/engine.js` 结尾」的形状断言、`i3` 本条由「填完裁决 + resume 零模型调用收敛为终值」处置
- [x] 9.4 dismissed 2 条并给可核对证据：`i1`（「记录没有已解决这一格 ⇒ 假阻断」是本 PR 的**被测对象**，不是本 PR 的缺陷；仓侧自造标记＝再造一份漂移口径，按 D8 出路②留给上游）、`i4`（「P8 会静默失效」与实测相反 —— 改变规则顺序正是它的检测目标，负控已实测 CAUGHT）
- [x] 9.5 修复后复跑：`node --test scripts/ccg-convergence-probe.test.js` ⇒ tests 8 / pass 8 / fail 0（P1–P8，含新形状断言）

## 10. 刀E：探针现读 vendor 的「外部复核」表达（2026-10-20，change 范围在此显式扩）

- [x] 10.0 **本节存在的理由 = §7.2 的前提已被推翻**：那条写「本仓不得私改 vendor 副本，须先在上游立 issue」。
  2026-10-20 经用户显式授权（"按你的建议 3 → 1"）改为先给本机 vendor 驱动打补丁，让「外部复核发生过」在机械上可表达；
  §7.2 原文不改写（它是当时的决策快照），本条声明现状取代之。上游 issue 草稿仍有效、投递渠道仍待维护者指定。
- [x] 10.1 补丁落点：vendor 驱动 `ccg-deep-review.js` 加 `externalReviewSatisfied(i, adj)`（高危域项填齐
  `performedBy/evidenceRef/reviewedAt` 三格才解除阻断，缺一 fail-closed）+ `expectedExternalBackend` 跨家族校验
  + 驱动末尾 `module.exports`（原文件无导出、以裸 `process.exit(main())` 结尾，导致探针无法在不拉起进程的前提下读判据）。
  原始文件 sha256 记在 `openspec/records/ccg-probe-external-review.md` §5；备份目录与补丁后 sha256 只写在 vendor
  文件头注释里（不受本仓版本管理，因此**换机即失效**，这条是已知代价不是遗漏）。
- [x] 10.2 先写失败测试：P9（vendor 在位 ⇒ 结论必须现读为「已能表达外部复核」）、P10（在位/不在位都不得进 `problems`，
  三档退出码 0/1/2 语义不变）。红态实测 `tests 10 / pass 8 / fail 2`，实现后 `10/10`。
- [x] 10.3 探针本体新增纯函数 `externalReviewCapable(driverSrc)`（两格都在位才算在位）并入 `readings`、新增一条结论分支；
  `module.exports` 导出该函数，供测试直接喂字符串夹具（不等 vendor 在场）。
- [x] 10.4 变异反证 E-M1（在位判定退回恒 `false`）/ E-M2（退回恒 `true`）各自实测变红，
  且**红集不同**：E-M1 指名 P9、E-M2 指名 P10 ⇒ 两条断言各守一格，不互相掩盖。
- [x] 10.5 收尾判据：`node --test scripts/ccg-convergence-probe.test.js` 10/10；`node scripts/ccg-convergence-probe.js` rc=0
  并打印新结论；Gate 12c / 品牌残留 / workflow 结构 / 接线棘轮 / fail-fast / 记录欠账 / max-lines 全 rc=0；
  每次提交前跑 `--numstat` 与 `--ignore-cr-at-eol --numstat` 两口径对账，逐字相等才提交。
  （现场补记：第一笔提交前该测试文件末尾留了一个**孤立 CR**，`git ls-files --eol` 因此报 `i/-text w/-text` ——
  即 `text=auto` 整份跳过归一化，索引里躺着 243 行 CRLF、原始 numstat 243/217 而 ignore-cr 只有 26/0。
  摘掉那一个字节后 `i/lf w/crlf`、两口径同为 25/0。这条是本仓已知坑的第三次现场复现。）

### 10.6 故意不做（本刀）

- [ ] 10.6a 不改 `scripts/ccg-review-decider.js` 的宽严，也不改 `check-pr-exec-record.js` 的闭合词表 ——
  本刀只让探针**说实话**，闭环词表仍是 §7.3 的人工裁决项。
- [ ] 10.6b 不把 vendor 补丁搬进本仓。因此探针的「在位」读数**是机器局部的**：换机器/换 runner 上
  `externalReviewCapable` 会是 `false`，而按 10.2 的设计那不构成红 —— 这正是本刀要固化的口径：
  **结论随现场变，判据不随结论变**。