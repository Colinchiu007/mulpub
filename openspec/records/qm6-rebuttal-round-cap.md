---
record: qm6-rebuttal-round-cap
task: 外部深审的跨调用轮次上限（§1 已落地）+ 已否证清单（§2 未开工，以仓外引擎授权为前提）
date: 2026-10-23
---

## 本次执行记录：外部深审轮次与已否证清单——合同片（qm6-rebuttal-round-cap，2026-10-23）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯规格变更（新增 `openspec/changes/qm6-rebuttal-round-cap/{proposal,tasks}.md` 与 `specs/qm6-rebuttal-round-cap/spec.md` + 本篇记录），零代码、零 CI 改动。为与后续实现片同分支，仍按运行时代码任务的规格走独立 worktree（`<仓库父目录>/mp-worktrees/mp-qm6-rebuttal-round-cap`，裸分支同名，起点 `origin/main == 05597f42e`）——AGENTS 的 docs-only 允许就地编辑，这里不借那个便利，避免合同与实现分处两分支 |
| 立项动因（读数以八轮实跑为源） | ✅ | 同一切片（PR #4148）真跑外部深审八轮：Critical 2/3/3/3/3/4（轮 3→8），最低 security 分 2→6→4。其中 **6 条是真属于我的缺陷**（拒写名散在 11 个 return / 复核漏引擎 / `dry-run` 游离两张表 / 快照被信号打断即漏盘 / "约 30 处夹具"从没量过 / 一条**成因写反**），其余是**同一指控重复 3–5 次**（realpath 当安全边界、记录 `sha` 指父提交、design 混排）。机制只看见前者，对后者没有任何记忆，也没有跨调用的轮次上限 |
| 本刀明确**不做**的事 | ✅ | 不改"什么算闭合"（`CLOSED_DEEP_REVIEW_STATUSES` / `tier=external` 取得条件 / `HIGH_RISK_SURFACES` / 收口矩阵逐条保持现状，并计划加一条结构锁钉住"未被本 change 修改"）；不引入严重度标尺；不做 tasks 8.2（引擎 vendoring）；**不自动合并** |
| 合同的落点选择（为什么账不放 `.ccg` 下） | ✅ | 前提实测在 tasks §0.1 / §0.4：判定记录名是内容寻址（八轮里换过 6 个名字）⇒ 计数器挂在记录名上每次归零且看起来完全正常；而 pre-commit 暂存记录用的 glob 是 `:(glob).ccg/reviews/*.json`（`*` 不跨 `/`）⇒ 子目录里的账不会随 PR 入库，会变成"只有本机看得见"的第二份事实。故落 `openspec/changes/<change>/external-rounds.json`（受管、可 diff） |
| 两个待决岔口（要人拍板） | 交人工 | tasks §4.1「短路重跑算不算一轮」（现按"不算"，因为零模型调用，且算的话"填完裁决再跑一次"这个必须动作会白烧配额）；§4.2「账本受管 vs 提交噪声」（现选受管，正解是合并写策略而不是搬到不受管区） |
| 行尾与编码对账 | ✅ | 四个新文件全部新建、LF；提交前后两口径 numstat 一致（读数见 PR 正文）。未改写任何既有受管文件 ⇒ 不存在 CRLF 幽灵行风险 |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` 通过（外部后端一律写 `critic` / `proposer` / "评审引擎"，不写产品品牌名） |
| 文档同步 / 绝对路径 | ✅ | `scripts/check-doc-abs-paths.js` 通过；worktree 路径一律写 `<仓库父目录>/...` 占位形态，仓外引擎一律写 `~/.claude/...`（Gate 12c 的教训：执行记录的取证力靠分支名与 PR 号，不靠本机绝对路径） |
| QM-1 打包 / QM-4 视觉 / TDD | N/A | 零运行时代码、零 UI；本刀不产可测行为，实现片的 TDD 步骤逐条写在 tasks §1–§2（且刻意先写红再写码） |
| QM-6 CCG 双模型外部评审 | 不适用（docs-only） | 判定器对纯 openspec 差量判 `skip`/`single`，机械链上不强制双模型。但本 change 是**改评审怎么算数**的方案文档，其评审归属被写进 tasks §3.2：交人工过目，不自动合并 |
- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 的读数在 commit 之后取并写进 PR 正文
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 由门禁推导

### 遗留（不假装已闭合）

1. **实现未开工**：本篇只落合同。tasks §1 起才是代码，且 §2 的前置 §0.2 可能要求一次**仓外引擎改动**（送审载荷注入点），那需另行人工授权——本 change MUST NOT 被读成"注入已经能做成"。
2. **上限默认值 3 是价值判断不是事实**：它来自"我在第八轮才停手"这个反面教训，不是量出来的分布。选 3 的代价（真需要 4 轮的复杂改动会提前升级）与选 5 的代价（每轮约 10 分钟 + 模型额度）都写在这里，改值需人工过目。
3. **第 1 条与第 3 条未采纳也未否决**：收口判据从"没有 Critical"改成"每条 Critical 都有可核处置"、以及严重度标尺，都留在讨论区。#4148 的收口目前仍只有"一轮零 Critical"这一条机械出口，本 change 不为它开后门（tasks §3.3 明写）。
4. **`.ccg/reviews` 无界增长治理**（更早的欠账）与本 change 无关，不因本篇而闭合。

## 本次执行记录：轮次上限实现片（qm6-rebuttal-round-cap，2026-10-23）【混合 PR，非 docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更（`scripts/lib/*.js` + `scripts/deep-review.sh` + `quality-gate.yml`）⇒ 独立 worktree `<仓库父目录>/mp-worktrees/mp-qm6-rebuttal-round-cap`，裸分支同名，起点 `origin/main == 05597f42e`；共享根未落盘 |
| 落点（做什么） | ✅ | tasks §1 全格：新增唯一实现 `scripts/lib/ccg-review-rounds.js`（键 = **(分支, HEAD sha)**、`capOf` 非法值回落必出声、`exceedsCap` 只读、`writeJsonAtomic` 有界退避、CLI 未知模式 rc=2）；`deep-review.sh` 的 `run_driver_with_writeback` 在**驱动之前**查上限（超限 ⇒ `ESCALATED` + `exit 1`，不调模型）、在**驱动返回之后**落账（跳过已记 sha）；读数三档各说话术，超限那一档不再声称"本轮真调用" |
| TDD 顺序 | ✅ | 先红：`Cannot find module '…scripts\lib\ccg-review-rounds.js'`（库不存在时入口级用例即挂），后写实现；库侧 7 条 + 入口侧 3 条（⓬⓭⓮） |
| 变异反证（6 条全 CAUGHT） | ✅ | M-a 键改记录名→R3 红；M-b 超限删 `exit 1`→⓭ 红；M-c 回落静默→R1 红；M-d 未知模式返 0→R7 红；M-e 摘幂等→R5 红；M-f 摘入口跳过→⓬ 红。驱动逐条验 pristine md5 并还原回验（两个新文件**未跟踪**，HEAD 里没有它们 ⇒ 还原基线只能取动手前自己的字节，不得 `git checkout HEAD --`）。**M-f 首轮 MISSED**：幂等在库里兜着，原断言只查"不出现 counted=1"看不见这一格 ⇒ 把 ⓬ 收紧为「重跑不发起记账调用」，先复跑 baseline（绿 181s）再重放变异才 CAUGHT。教训：防御重叠时先怀疑断言的观测面，不是先怀疑变异无效 |
| 本刀明确**不做**的事 | ✅ | 不改"什么算闭合"：现场读数 `git diff origin/main -- scripts/check-pr-exec-record.js` **空**，该 diff 里 `CLOSED_DEEP_REVIEW_STATUSES`/`HIGH_RISK_SURFACES`/`classifyEvidenceTier` 命中 **0** 次；§2（已否证清单）一条未动，因 §0.2 实测注入点不存在、必须改仓外引擎，需另行人工授权（并与 PR #4304 那份规格对齐，不各造一份清单） |
| CI 接线 | ✅ | 不新开 Gate 号（在飞期间号会被主干抢），把 `ccg-review-rounds.test.js` 登记进已有 `quality-gate.yml` Gate 2b11。`check-unwired-tests.js` → 检查域 128 个文件 / OK；`check-workflow-structure.js` → files=16 violations=0；`workflow-contract.test.js` 46/46；`check-doc-abs-paths.js` PASS 且 counts=1161 未增。`.gitignore` 无需 negation（`check-ignore -v` 回显：lib 无规则命中、测试命中 `!scripts/*.test.js` 反选；注意 rc 对反选也返回 0，判据取回显） |
| 耗时读数（两处必须分开写） | ✅ | runner 侧 Gate 2b11 整步骤 **3–4s**（job 120219562032 / 120216426391 / 120213481660 / 120211621835 的 step 时间戳，且日志里入口用例题名逐条出现）；本机一条入口用例 **88–181s**（Windows 冷启动 × 每次 node/bash）。⇒ 全量入口回归以 CI 为准；本机只跑被改到的那几条。workflow 注释里原写"本机实测 ~60s"已按此纠正 |
| 本地已跑 / 未跑（点名交 CI） | ✅ | 已跑：`①`、`②③`（rc 逐字传递）、`⓬`（收紧后复跑）、`⓭`、`⓮`、库侧 7/7（变异后复跑仍绿）、`ccg-review-writeback.test.js` 22/22、`ccg-closure-writeback-chain.test.js` 3/3。未在本轮本地跑：入口 `④⑤⑥⑦⑧⑨⑩⑪⑫`（每条真跑 bash）⇒ 交 CI 全量（该步骤在 runner 上跑完本文件 13 条）。另 `deep-review-deps.test.js` 全量批跑 46/47，红的那条是 PATH-prepend/ABS，**单跑两档均绿**（HEAD 原文件与含本次改动）⇒ 归因既有间歇红，不认领也不据此免责，以 CI 为准 |
| 行尾与编码对账 | ✅ | `scripts/deep-review.sh` 是 `attr:text eol=lf`（工作树 LF），`deep-review-entry-rc.test.js` 是 `i/lf w/crlf`（工作树 CRLF，350→431 行 CR/LF 守恒）；改后两口径 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` **逐字相同**（82/1 与 47/0）⇒ 无 CRLF 幽灵行 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触碰 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件；改动面全在 `scripts/` 工具链与 workflow |
| QM-6 CCG 双模型外部评审 | 未闭合 | 本片改 `scripts/check-*` 判据家族所在的守门面与评审入口链（高危面前缀），因此机械上要求 `tier=external`。**当前状态：未收口，交人工**。不得手写 `tier`/`evidence`，也不得在高危面用 `closureNote` 收口（AGENTS「撞线时的处置纪律」）。本片自身正是给这条链加"何时停手"的闸，故一律人工过目、不自动合并 |
| 远程同步 | 由门禁推导 | 不事后改写：合并后由 `scripts/lib/merge-ledger.js` 按 squash 尾注推导 |
⛔ 本分支这篇记录有**两个**执行块，但 `| 远程同步 |` 收口行**全篇只写一行**（写在末块=实现片那节）：`check-gate-record-debt.js` 的 `dupClosureRows` 判据是「结果文件 >1 行且本 PR 新增行 ⇒ 红」，第二个块再写一行就是它点名的"绕过收口锁最自然的退化形态"（本轮 CI `QG Changes` 就是被这一格打红的，见 §第三轮之后）。反向的坑同样真踩过：并发会话各删一行、rebase 自动合完⇒**零行**，`missingRecordRows` 立刻判红（见末块之后那条实录）。
- 判定：本 PR 含 `scripts/` 工具脚本与 workflow 改动 ⇒ **不是 docs-only**，`classify-docs-only.js` 读数在 commit 之后取并写进 PR 正文
- 保留门禁：行尾对账 ✅ | 文档同步 ✅ | 绝对路径 ✅ | QM-6 未闭合（交人工）

### 本片遗留（不假装已闭合）

1. **QM-6 收口未闭合**：见上表最后一行。机械出口只有一条——用本片落地的入口真跑一轮**零 Critical** 的外部评审拿 `tier=external`。
2. **sha 去重留了一个已知松口**（tasks §4.1 已写成待决岔口）：同一 sha 上反复真调模型仍只算一轮。更严口径可用（入口手上已有 `_wb_before` / `_wb_before_fp` 这对交付读数），但选它要把"交付判定失败"那一档定成计或不计，属人来定。
3. **`_wb_before` 与轮次账是两套读取数**：目前互不消费。将来若合并，必须同 PR 改两侧并各配变异，不得只改一侧留"看起来统一了"。
4. **§2 整节未开工**，且它以一次仓外引擎授权为前提。

## 第一轮外部评审逐条处置（round 1，载荷 `980f3ca33`，2026-10-23）

`sh scripts/deep-review.sh` 真跑：后端 claude + opencode 均 `[ABS]` 就绪、critic 交付 **7 条**、维度最低分 **4**
⇒ 引擎落第三档 `status=self_play reason=selfPlay`，裁决模板 6 条未填 ⇒ 状态 `self_play_pending`，
写回器如实拒写 `reason=not-closed`（**没有**冒充外部收口，这正是 #4148 那刀要的形状）。
计数侧第一次自用上：`外部评审轮次 第 1/3 轮（本轮真调用外部评审）` + `[rounds] counted=1 round=1`
+ 账本落在 `openspec/changes/qm6-rebuttal-round-cap/external-rounds.json`（受管，随本 PR 入库）。

4 条 Critical + 2 条 Warning 逐条处置（完整表在 tasks §5，这里只记结论与"是否改码"）：

| # | 处置 | 改了什么 |
| --- | --- | --- |
| i1 change 名未消毒拼路径 | **机制采纳、可达性否证**（git 拒 `..` 分支名 rc=128 三种写法；固定前缀吸收两级 `..`；目录不存在时不创建） | 补 `assertChangeName`（只拒 `..` 与绝对路径，`team/feature` 放行）+ CLI **无条件**校验（`--ledger` 显式给出时也要过，否则怪键静默读到空桶 ⇒ 上限永不触发）+ rc=2 出声；新增锁 R8/R10 |
| i2 无跨进程锁 corrupt 账本 | **一半修**（修的是它没提的那半：坏 JSON 上照样追加＝把 2 轮历史压成 1 轮，A 档实测复现）；**它主张的并发那半本机 4 进程探针没复现**（终态 4 条齐全）⇒ 不写断言、不加没验证过的锁，残留登记 tasks §1.8 | `record` 读不出即抛错且**逐字节保留坏文件**；新增锁 R9 |
| i3 proposal 写"没有实现"而差量落了代码 | **采纳**（决策层点名 7 文件范围漂移不是误报，是文档没跟着差量走） | proposal 首行改状态句 + 列 §1 落点清单 |
| i4 `_QM6_KV` 空格切分歧 | **否证**：造含空格路径实测 `round=1 max=3 exceeded=0 unreadable=0 seen=1` 全对，被截断的只有末位 `ledger`，而入口从不消费它做判定 | 无码改；把"参与判定的键必须是纯 token"记进 §5 |
| i5 删目录即静默重置 | **否证 "silently"**：入口打 `⚠ 无账本可记，本轮不计数`、CLI 打 `nochange=1`（R7 锁不创建目录），且账本受管 ⇒ 删除在 PR diff 里可见 | 无码改 |
| i6 spec 有 `rebuttals[]` 而代码没有 | **采纳，但正解不是补实现**：§0.2 实测仓内零注入点，补实现要 vendor 授权 | 在该 Requirement 顶部写交付状态（未实现 + 前提 + 与 #4304 同用一份 `rebuttals[]`） |

补锁后的变异（第二批驱动 `--baseline=1` 先证明 pattern 选中，再放变异）：
**M-g/M-h/M-i/M-j 四条全部 CAUGHT**（分别指名 R8 / R9 / R10 / R10），还原后 md5 回验一致。
库侧计数演进：7 条（R1–R7，提交 `980f3ca33` 时）→ **10 条**（R1–R10，本轮补 i1/i2 锁后），10/10 绿。
本机入口用例仍只实跑 `①②③⓬⓭⓮`，其余 `④–⑫` 交 CI 全量（同上一节口径，未变）。

**本轮之后**：为免留下两枚 dual 产物（旧那枚的名字是内容寻址、软重置后不会再被入口命中），
按既有配方 `git reset --soft` 重投为一枚提交，旧 `.ccg` 产物经 `git cat-file` 确认不在上游后
`git rm --cached -f` + `safe-delete.js` 移除，再对新载荷跑 round 2。


## 第二轮外部评审（round 2，载荷 `6ddfbfb4e`，2026-10-23）

`sh scripts/deep-review.sh` 真跑：critic 交付 **8 条**、维度最低分 **4** ⇒ 仍落第三档，
状态 `self_play_pending`，写回器 `reason=not-closed`。计数侧 `第 2/3 轮` + `[rounds] counted=1 round=2`
——**闸在自己身上第二次生效**，这一刀从此不能靠"再改宽一点判据"过关。
逐条处置见 tasks §6，结论摘要：

| # | 严重度 | 处置 | 是否改码 |
| --- | --- | --- | --- |
| i1 两份产物都 pending | Critical | **否证**：另一份是 `mode=skip / required=false`；权威读数 `check-pr-exec-record.js --mode=enforce` 打印 `CCG 深度审查欠账 1 条` | 否 |
| i2 §2 未实现却立约 | Critical | **采纳**；第一轮"加交付状态标记"的修法被第二轮再判一次 ⇒ 把该 Requirement **整块搬出 spec delta** 进 tasks §2 留稿（Scenario 逐条回验 3 条，搬运脚本自带"Requirement 3→2"判据） | 合同形状 |
| i3 账本读不出 ⇒ 上限失效 | Critical | **采纳，取向反转**：无证据 = 按超限处理（入口 `exit 1`，文案与"跑满了"分档） | 是（R6 改写、新增 ⓯、变异 M-k） |
| i4 计数口径未决即落地 | Critical | **采纳，且这次不等人**：去重键换成 **(sha, 交付指纹)**（写回器判 `no-new-delivery` 用的同一份语义指纹）⇒ 复用存档仍免费、同 sha 真跑新交付照计；§4.1 因此不再是待决岔口 | 是（新增 R12、⓰；变异 M-n / M-o） |
| i5 shell 解析 CLI 输出 | Warning | **采纳**：加 parse 判据（五键必在且为纯数字，缺一 `exit 1` 并打印原文），并把形状本身钉成合同（R11）；`badchange` 行原先少打 `seen=` 正是被这条逼出来的 | 是（R11、变异 M-l / M-m） |
| i6 无跨进程锁 | Warning | **维持第一轮结论**：4 进程并发探针仍未复现丢更新 ⇒ 残留登记 §1.8，不加没验证过的锁 | 否 |
| i7 依赖 `process.cwd()` | Warning | **否证**：入口 `deep-review.sh:50/55` 自己 `cd "$ROOT" || exit 2`，经入口进来的调用永远落在仓库根；绕过入口时走 `nochange=1` 出声档 | 否 |

锁的演进：库侧 **10 → 12 条**（R11 输出形状、R12 交付身份键），入口级 **3 → 5 条**（⓯ 无证据档、⓰ 同 sha 新交付必计）。
本地实跑：`R1–R12` 12/12、入口 `⓬ ⓭ ⓮ ⓯ ⓰` 全绿（⓰ 含两次真跑）；
变异第二批 **9 条全部指名红**（M-g…M-o，其中 M-m 第一版锚点写错命中 0 次，由驱动自己 ABORT 出来才改对——
"锚点命中 0 次"必须是一档独立读数，否则它读起来就像"这条锁没牙"）。

三条要记住的现场教训：
1. **我在文档里先写了"变异 M-n / M-o 指名红"，那时它们还没跑。** 发现后立刻补跑并确认 CAUGHT——
   顺序错了就是"把没发生的写成发生过"，与这条链要防的原罪同型。
2. **收紧断言的观测面时，先复跑 baseline。** ⓬ 的断言从"这一行不许出现"改回"必须出现且 counted=0"
   是因为键语义变了（入口不再预判跳过）；不跟着改就会把正确实现判成红，而把它删掉又会把 i4 那一格看丢。
3. **守卫按字符串切会打自己。** 追加 §6 的那道"不得残留『等人拍板』"判据被自己的引用触发了 ABORT
   ——§6 的表格**引用**评审原话是合规的。正解是按语义位置判（那一行不得再是未勾的 `- [ ] 4.1`），
   这也是 AGENTS 里"禁令与存在性判据必须按语义位置切"的又一次现场应验。

**未闭合项不变**：本 PR 的 QM-6 收口仍需一轮"零 Critical 的真外部评审"拿 `tier=external`；
round 3 是本闸允许的最后一次自动尝试（3/3），跑完若仍有 Critical，按 §4/§7 的合同**交人工**，不再加轮。


## 第三轮外部评审（round 3 = 上限那一轮，载荷 `cee109520`，2026-10-23）

`sh scripts/deep-review.sh` 真跑：critic 交付 **8 条**（4 Critical / 3 Warning / 1 Info）、维度最低分 **4**
⇒ 仍落第三档 `self_play_pending`，写回器 `reason=not-closed`。计数侧 `外部评审轮次 第 3/3 轮` +
`[rounds] counted=1 round=3`。**这就是本片立项要结束的那种循环第三次开机**：轮 1 交付 7 条、轮 2 交付 8 条、
轮 3 交付 8 条，其中同一指控（无跨进程锁）第三次原样回来，而新增的两条是形状与风格问题。
按合同到此为止：**不跑第 4 轮、不删账本、不手写 `tier`/`evidence`、不在高危面用 `closureNote`**，交人工。

逐条处置（口径沿用前两轮：**采纳观察、否证结论**，每条给可复跑证据）：

| # | 严重度 | 处置 | 证据 |
| --- | --- | --- | --- |
| i1 `e14…` 记着 `skip` 而差量含运行时代码 | Critical | **否证**：那枚产物由判定器按 `d21b86b21` **那一笔**的差量算出（纯 openspec ⇒ `skip`/`required=false`，逐笔判定本来就是既有语义）；欠账判据只要求 `mode=dual` 的产物收口 | 当场 `--base=$(git merge-base origin/main HEAD) --mode=enforce` ⇒ rc=1 且打印 `CCG 深度审查欠账 **1** 条`，点名 `842dc2554…（mode=dual，status=self_play_pending）`；`TIER-COVERAGE dual-closed total=0` |
| i2 跨进程竞态未修 | Critical | **维持前两轮结论**：这是 §1.8 已登记的残留，本机 4 进程探针仍未复现丢更新 ⇒ 不加没验证过的锁 | 同一指控第三次原样回来，正是"机制对重复没有记忆"的现场样本 |
| i3 读不出=超限，无"没预算/没证据"之分，可被文件损坏 DoS | Critical | **采纳前半（两档确实都存在）、否证后半**：分档是刻意的取向反转（round 2 i3），且两档在产物上可区分 | CLI 打 `exceeded=1 unreadable=1` vs `exceeded=1 unreadable=0`；入口 `deep-review.sh` 对两档各说各话（`轮次读数不可用` / `账本读不出` / `已达上限`）；锁 R6/R10/R11。损坏账本的出口写在红文案里（人工看过再修，**不要删文件再跑**） |
| i4 shell 用 `tr`/`sed` 解析且不看退出码 | Critical | **否证：这条描述的是第二轮之前的形状**，i5（第二轮）已落地修复 | `deep-review.sh:900-905` 五键必须齐且为纯数字，否则 `_QM6_UNPARSED=1` ⇒ `:921` 打印 CLI 原文并 `exit 1`；`|| echo '…unreadable=1…'` 兜住非零退出；形状本身由 R11 钉成合同 |
| i5 `MP_QM6_MAX_ROUNDS` 无上限，设 99999 即关闸 | Warning | **采纳观察、结论交人工**：`capOf` 只验正整数（`lib/ccg-review-rounds.js:93`），确无 ceiling。加不加属"谁来守门"，不在本片自选 | 三点如实记下：额度是操作者自己的；每轮都打印 `第 N/max`，把 max 改成 99999 在日志与账本 diff 里都可见；`external-rounds.json` 受管 ⇒ 绕过会留在 PR 上 |
| i6 `defaultLedger` 依赖 `process.cwd()`，`assertChangeName` 只在 CLI | Warning | **否证 cwd 那半**（入口 `deep-review.sh:55` 自己 `cd "$ROOT" || exit 2`）；**登记库侧那半为可选加固**：目前除 CLI 与本测试外无 importer（`grep -rn defaultLedger scripts/` 只这三处），把校验下沉到 `defaultLedger` 是零风险但需要新锁的一格，交人工 | 同 i1 的 enforce 读数；grep 结果逐条列出 |
| i7 `tasks.md` 混着未开工草案与调试流水 | Warning | **采纳草案那半**（§2 的 Requirement 已整块搬出 spec delta，未开工逐条点名）；**否证"临时记录不该留正文"那半**：本仓的记录文化要求现场教训与实测数字随交付写全（AGENTS「不假装已闭合」），M-f 首轮 MISSED 那条正是下一个人要读的 | 见本篇 §第一/二轮 与 tasks §5/§6 |
| i8 原子写用有界自旋 | Info | **采纳事实、不改码**：确为 `while (Date.now() < end)`，`ATTEMPTS=5`、`wait=40*attempt` ⇒ 最坏只在 `EPERM/EACCES/EBUSY` 上自旋合计 **400ms**。不改的理由不是"没必要"，是**这条改动的验证故事很弱**：`Atomics.wait` 与自旋对调用方逐字等价，任何"不再忙等"的断言只能写成文本锁——那正是要防的装饰性断言 | 函数体在 `lib/ccg-review-rounds.js` 的 `writeJsonAtomic` |

### 第三轮之后：本 PR 自己被 CI 打红的一处缺陷（不是我修的判据发现的，是它发现的）

`QG Changes`（run 39914783195，载荷 `6ddfbfb4e`）红在步骤 `Detect docs-only changes`，**不是** `classify` 取不到
base/head——那行 `::error::取不到本 PR 的 base/head（[]/[]）` 是**步骤正文被回显**（`bash -e` 在它之前就退了）。
真正的失败在同一个步骤块更后面的 `node scripts/check-gate-record-debt.js --carrier-mode=visible`：

```
HAND-CLOSURE 人工改写=0 新增重复行=1 记录被删=0 触碰记录=1
❌ 本 PR 给已经有多行的记录又新增了 `| 远程同步 |` 行 1 篇 …
  qm6-rebuttal-round-cap.md —— 结果内容 2 行，本次又加 2 行
```

根因是我自己的记录形状：本篇有**两个执行块**（合同片 + 实现片），而我在第二块又写了一行收口行。
判据 `check-gate-record-debt.js:334` 的条件是 `addedRowLines > 0 && count > 1` ⇒ 一篇记录只准一行。
本机同一条命令复现 rc=1，删掉第二块那行后 `新增重复行=0`、rc=0（当场重跑取数，不靠推理）。
**这条不是评审提到的**：轮次上限管的是"调用模型"，管不着"闸门自己会抓什么"——所以第三轮的 8 条里没有它，
而它在 push 后被 CI 抓到。已在本篇第二个块留一句显式禁令，免得下一个会话给第二个块"顺手补一行"。

**紧接着的同格第二次红（并发删行的净零形态，实测）**：我按下红后本地提交，`git push` 被拒——
远端已多出一枚并发会话的 `a4799f133 fix(records): 一个记录文件只留一行「远程同步」`，
它删的是**第一块**那行、留末块；我删的是**末块**那行、留第一块。`git rebase origin/<本分支>` **一次冲突都没报**
（两侧删的是不同行，git 各自应用），结果文件里 `| 远程同步 |` 行数 = **0**，
`missingRecordRows` 当场判红：`❌ 记录文件整块缺 远程同步 行 1 篇 —— qm6-rebuttal-round-cap.md`。
三条口径记下来：① **"Successfully rebased" 不等于合并结果合法**，两侧各删一行的自动合并只会把两条欠账都清掉；
② 收口这一格的判据是**双向**的（>1 行红、0 行也红），所以并发处置的唯一安全做法是
"先读对方的版本、再决定保留哪一块"——这里采纳对方那半（删第一块、留末块），我的新增散文单独重放并改写指向；
③ 复跑必须在**rebase 之后**再做一次，`git diff --numstat` 与 rc 都是当场取的，不沿用重放前的读数。

