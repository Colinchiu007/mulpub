# tasks: qm6-closure-writeback

> 本片改 `scripts/deep-review.sh`（高危面前缀 `scripts/deep-review`）与 `scripts/check-pr-exec-record.js`
> （前缀 `scripts/check-`）⇒ **两条高危面同时命中**。自反条款沿用 #3987：不得以 `self-play` 收口 QM-6，
> 且**不自动合并**（改"谁来守门"），一律人工过目。

## 0. 先把前提钉成可重取的读数（不做这步后面的设计都是猜）

- [x] 0.1 当场重取并把读数写进 `design.md`（2026-10-21 于基点 `eda41eb0e` 取、`ef81036a8` 复核）：① `deep-review.sh` 里 `exec node "$DRIVER"` **4 条，现位于 `:855 :876` 那组（`855/857/876/878`）**——**上一版写的 `850/852/859/861` 隔 3 笔合并漂了 5 行**，这条漂移本身就是「行号只能现取」的现场证据；② 引擎对 `deepReview` 仍是**单点整体替换**（`:520` `rec.deepReview = deepReview`，合并式写回命中 0）；③ 成功收口对象键 = `required,status,performedBy,findings,minScore,at`（`:1252-1256`，**无 `tier`、无 `evidence`**）；④ 引擎全文 `tier`/`sessionId`/`ses_`/`durationMs`/`exitCode` 命中 **全 0**。**新增两条 design §1 未记的事实**：引擎所在的 `adversarial-review-loop` 是 `skill-repo` 的 **submodule（gitlink `fe8a518…`）**，锚点存在；但工作树那份相对 HEAD **+49/−3 未提交**（blob `57ef9590…`→`a2842b93…`），且 **tasks 5.1 要逐字对账的 `externalReviewSatisfied`/`EXTERNAL_EVIDENCE_RE` 只存在于这份未提交补丁里**（HEAD 命中 0）。每条命令都写进了 design §1/§2，未使用「据前述」。
- [x] 0.1b **把 ①-④ 之外的「闭环 × tier」交叉读数收进仓内工具**：`scripts/ccg-artifact-shape-survey.js` 现产出交叉表 + `[闭环×tier]` 摘要行，且**自报它落在哪个 commit**（`REF=origin/main@<9位>`；主干并发合并，同一条命令隔 4 分钟实测 1658→1662，不带 sha 的数无法归因）。闭环词表与 tier 词表**都不在工具里抄**：`closedSet` 与 `vocabOf` 是**调用方显式透传的注入参数**，缺任一当场抛错；词表由判据的 `classifyEvidenceTier` 现问。锁：`scripts/ccg-artifact-shape-survey.test.js`（10 条，含夹具仓真跑采集路径、两个注入键的「换一个就改数」行为对偶、空集出行、裸调 `collectRows` 自查），接在 `quality-gate.yml` 的 **Gate 2b10**（changes 作业，判定域非空自证）。变异反证 10 条：9 条各自**指名红**，第 10 条（`M6b` 把 cwd 整条不收）如实记 `BLIND_AS_PREDICTED`——它的表现是让锁变慢/挂死而不是精确红，不得记成「已反证」。design §2 两条旧读数行已按工具口径改写，并**明写 22→3 不可比**（旧探针按 `{external,unknown,其它}` 分桶，`其它` 里混着 `self-play`；工具按判据词表分桶）。工具改 `scripts/` 自身 ⇒ 本片按混合 PR 走完整质量节拍，未借 docs-only 通道。
- [ ] 0.1c **重跑决策层以真正消掉「范围漂移」**（QM-6 i2）：钩子那条告警比的是最近一条 `layer=plan` 产物的 `plannedFiles`
  （`ccg-gate.js:205-245`），**与 proposal 正文无关**——所以补 D0 不构成修法（我第一版把它当修法，已否证并改对措辞）。
  正解是 `sh scripts/plan-review.sh <方案文件>` 重落一条 plan 产物，让 `plannedFiles` 覆盖本片动的 survey / Gate 2b10。
  本切片**没跑**，理由如实写：它不在任何 enforce 判据上（`check-pr-exec-record.js` 不读 `plannedFiles`），而重跑要再来一次长时间外部评审。
  代价是这条告警会继续在每个碰到本 change 的提交上响——把它当噪声而不是待办就是失守，所以它记在 tasks 而不只记在运行记录里。
- [ ] 0.2 实测一次「跑完真评审后记录的 `tier` 键到底在不在」：不是从代码推，是跑一次 `sh scripts/deep-review.sh --dry-run` 与一次真审查（或注入假驱动），再 `git show`/读文件回结构。**若实测发现 `tier` 其实在某条路径上被保留**，本片的 D6 当场作废并在 design 记否证（不得留着一条已死的"修复"）
- [ ] 0.3 量一次本片改动的**增量成本**（不是总成本）：主干最近 40 笔第一父提交里，有多少条 dual 产物会因新增 `delivery` 档而改变读数。预期是 0（历史产物不含该形态），若不为 0 必须逐条解释

## 1. 示踪弹：先让"没有生产方写 tier"这件事变红

- [x] 1.1 **落点改动（如实记）**：契约锁没写在 `scripts/check-pr-exec-record.test.js`，写在**新文件** `scripts/ccg-closure-writeback-chain.test.js`。
  原因是这条锁要同时跑「驱动写回 → 判据读数」两端，而 `check-pr-exec-record.test.js` 是判据单端夹具（它不加载写回器），
  塞进去会让"契约"变成"判据自己测自己"；新文件按 6.1 逐个点名接进 Gate 2b11（未点名的测试文件等于没写）。
  内容：从 `buildDeepReviewInit()` 出发，经"驱动写回"到 `closureCorroboration()` 真跑一遍，断言一条刚交付的记录能读成 `external`
  **且不靠测试自己手写 `tier`**。立项时它必然红（没有任何生产方写 `tier`）——那条红就是本片的立项证据，现已转绿
- [x] 1.2 加一条反向负控：把写回器改成恒不写（no-op）时，1.1 MUST 变红；若 1.1 在 no-op 下仍绿，说明夹具替对方把结论算好了（本仓反复踩的形态），先修夹具
- [x] 1.3 变异反证：本切片每条 MUST 各自指名红，驱动按当场 eol 档锚定，并断言"跑了多少条"而非只看有无红

## 2. D1 驱动侧写回点（先保 rc，再加动作）

- [x] 2.1 `deep-review.sh` 4 条 `exec` 改为 `node …; _rc=$?` + 调写回器 + `exit $_rc`；`--dry-run` 分支与 `DRY_NO_DRIVER` 分支**保持不引入写回**（dry-run 不该产生产物）
- [x] 2.2 行为锁（不是结构锁）：注入一个假驱动（写在 `os.tmpdir()` 下、按 `MP_*` 变量指路），三种 rc（0 / 1 / 2）各跑一次入口，断言入口 rc 逐字相等。**只断言"源码里出现了 `exit $_rc`"不构成证据**。落点文件 **`scripts/deep-review-entry-rc.test.js`**（评审 i7：原任务没指定文件，无法定位就无法接线），同时承载 2.3 的顺序断言
- [x] 2.3 接线锁：写回步骤 MUST 排在"引擎已返回"之后、`exit` 之前；把写回调用挪到 `exit` 之后必须当场红（本仓「释放必须发生在控制流正确位置」的同型）
- [x] 2.4 回归：`scripts/deep-review-deps.test.js` 与既有 `--check-deps` 相关用例全量（本片动了同一个文件的出口段）

## 3. D2/D6 写回器 `scripts/ccg-review-writeback.js`

- [x] 3.1 **五条件**合取判据逐条实现（条数随 design §7 i1/i6 由 4 变 5，本行当时漏改，2026-10-21 由口径自检 grep 抓到——它比 spec 晚两个文件才追上），每条一个**独立**出声名：
  `not-closed` / `empty-findings` / `backend-mismatch` / `no-write`（字节未变）+ `no-new-delivery`（去 `at` 的语义指纹未变）/ `missing-record-path`；
  缺哪条写哪条，禁止塌成一个布尔；④ 的两条**必须各打各的读数**（只打一条会把「时间戳单独变化」这一格重新藏起来）。
- [x] 3.2 「期望后端由驱动写、不由填写方自选」：`expectedCritic` MUST 由调用方（`deep-review.sh` 侧，取自 `scripts/ccg-review-backends.list` 真源）显式透传。**多层回退链的定位键必须由上层显式透传**——漏传不报错、中间两级成死代码那条教训直接适用这里
- [x] 3.3 原子写：临时文件 + rename，Windows 下只对 `EPERM/EACCES/EBUSY` 有界退避重试；超过预算原样抛（沿用 AGENTS「Windows 原子文件替换重试」口径）。失败 MUST 留日志，禁止静默（既有产物在失败时必须逐字不变）
- [x] 3.4 缺 `tier` 键时按 `buildDeepReviewInit()` 同一口径补初值再判定；`buildDeepReviewInit` MUST 被 require 而不是重抄字段表（重抄就是第二份事实）
- [x] 3.5 夹具纪律：写回器的测试夹具 MUST 让不同输入返回不同记录内容（"恢复/选址类夹具若对所有输入返回同一份数据，按输入区分类缺陷对它结构性免疫"）；并至少一条"引擎写的是**别的** sha 的记录"负控

## 4. D3 `delivery@` 档与就地重算

- [x] 4.1 摘要规范化实现**只放一处**（建议 `scripts/lib/ccg-delivery-digest.js`），写回器与判据都 require 它；加接线锁禁止第二份
- [x] 4.1b **规范化规则本身要有一条固定行为向量**（评审 i2：只写"只有一份实现"防得住分叉、防不住腐蚀）：输入写死的 findings 样本，断言摘要逐字符等于写死的期望值。规则定义见 design §3-D3（对象递归按键名码点升序、数组保序、`JSON.stringify(v, null, 0)`、sha256 小写 64 hex）。反证两条各测各的：① 改成按键序不排序 ⇒ 向量红；② 改成 `JSON.stringify(v, null, 2)` ⇒ 向量红。只测"业务改动变红"不证明向量在跑
- [x] 4.1c 降档文案措辞锁（评审 i4）：`external-unverified` 的红文案 MUST 说「摘要与本记录 findings 重算值不符」，MUST NOT 说「证据无效/伪证」；模块文件头 MUST 有「本地一致性校验，不提供身份绑定」注释。两把都是禁词/正词锁，注释里的字样 MUST 被剥掉后再判（本仓已三次被自己的禁词锁打到）
- [x] 4.2 `evidenceForm()` 增 `delivery` 档；`classifyEvidenceTier`/`closureCorroboration` 对它走**内容验证**（重算比对），与 `path` 档并列成"两档可就地验证"
- [x] 4.3 负控三条：抄来的合法十六进制串 / 从别的记录整段复制 / `findings` 被截断后摘要对不上 ⇒ 三条都必须降 `external-unverified`，且在高危面判欠账
- [x] 4.4 如实标注其余四档（`pr`/`session`/`uuid`/`oid`）仍只判形状，**不得**在文案或注释里把五档统一说成"已验证"
- [x] 4.5 红文案更新：`unrecognized`/高危面那两条出口文案里，把"跑真评审"出口从「会话手写 `tier`」改述为「跑 `sh scripts/deep-review.sh` 由驱动写回」——**文案不是写入方**，但文案是指路牌，留旧措辞就是在教人手写

## 5. D5 跨仓 parity 锁（两份形状判据互认）

> **本片不做 §5**（2026-10-22 决定，写在这里而不是默默留着）。三条理由，逐条可核：
> ① 对账对象 `EXTERNAL_EVIDENCE_RE` / `externalReviewSatisfied` **只活在引擎那份未提交的本机补丁里**
> （§1 实测：锚点 blob `57ef9590…`→工作树 `a2842b93…`，锚点 commit 上命中 0），
> 所以在任何别的机器上这把锁的第一跑必然落 `skipped(symbol-absent:*)`——它能守的东西要等 8.2（vendoring）之后才有实体；
> ② 本片已经有两条高危面前缀进评审（`scripts/check-` × `scripts/deep-review`），再加"跨仓文本对账"这一维会把
> 一个 PR 的评审载荷推到不可处置；
> ③ 更要紧的是：5.1/5.2 的全部价值在**判据不空转**，而它现在的先决条件（引擎侧符号可取得）不在本仓手里。
> 下一片的前提是先决定 8.2（搬不搬引擎）；不搬，就只能把这条锁做成"锚点存在时逐字对账 + 不存在时按两档出声"的纯留痕件，
> 那与本片 D3 的"就地自洽"是两件事。
> 本节 5.1-5.3 因此保持未勾，并在 PR 正文与 `openspec/records/` 里点名"本片未交付 §5"。

- [ ] 5.1 本仓自持一份「外部复核成立」判据；与引擎的 `EXTERNAL_EVIDENCE_RE`/`externalReviewSatisfied` 做**逐字对账**行为锁（同一批样本两侧布尔数组 `toEqual`）。
  两条附加约束（QM-6 i3，因为那两个符号**只活在未提交的本机补丁里**，HEAD 命中 0）：
  ① 对账的前置条件取**符号是否存在**，不取「文件是否可读」——文件在而符号不在是常态（别的机器上、一次同步之后），
  此时必须走 5.2 的 `symbol-absent:<名>` 档；② **`skipped` 一律不得读成 `pass`**：`parity=skipped(...)` 必须单独成计数、
  单独成一行读数，文案明写「本次未对账」。否则这把锁在 CI（那里根本没有引擎）会永远输出「零不一致 ⇒ 通过」——
  那是「装饰性门禁」的又一格，而且这次是**我自己刚写的那把**。
- [ ] 5.2 引擎不可读时 MUST 出声，且**必须分两档**（2026-10-21 依 §1 新事实改写本条）：`parity=skipped(engine-absent)`（文件读不到）与 `parity=skipped(symbol-absent:<名>)`（文件在、但 `externalReviewSatisfied`/`EXTERNAL_EVIDENCE_RE` 不在——那两个字**只活在未提交的本机补丁里**，一次同步或 `git checkout --` 即消失，别的机器本来就没有）。两档文案与计数分开；**禁止** `if (!engine) return`（那把"没比对"读成"比对通过"，本仓实测的第三种装饰性落点），也**禁止**把 symbol-absent 并入 engine-absent——那会把"上游把补丁冲掉"读成"这台机器没装技能"，是两种完全不同的待办。
- [ ] 5.3 样本条数下界断言（命中 0 条即探针失明），且样本 MUST NOT 只取自引擎自己的正则字面量（用黑名单测黑名单是恒真）

## 6. 接线与文档同步

- [x] 6.1 新增 `*.test.js`（写回器 / 摘要 / parity）逐个显式点名进 `quality-gate.yml` Gate 2b/2c，由 `check-unwired-tests.js` 兜；`.gitignore` 第 106 行 `scripts/*.js` 会吞新脚本，按既有惯例补 `!scripts/<name>.js` negation，并 `git check-ignore --no-index` 当场证明没被吞
- [x] 6.2 `openspec validate qm6-closure-writeback --strict` 通过；与在飞的 `ccg-review-degradation-ladder` 不产生 Requirement 重名
- [x] 6.3 AGENTS.md：把「`tier=external` 此刻仍由会话手写进产物」那段改为指向驱动写回；顺带把 #4087 里那句「在飞的候选 `scripts/lib/ccg-review-`」收成现状（该前缀已随 #4071 进常量）。**不为此单开回填 PR**
- [x] 6.4 执行记录（**落点按 carrier 合同改**）：唯一强制载体是分支名文件，实际写在 `openspec/records/qm6-writeback-survey-tab.md`（原任务写的 `qm6-closure-writeback.md` 是 change 名，不是分支名，按 2026-10-15 的冻结合同那个文件名不会成为判据的读取对象）。表行状态列写「由门禁推导」，不写状态词；另补 `## CHANGELOG 条目` 两块（普查工具 / 写回链），台账由聚合器在发版时搬运

## 7. QM-6（本片自身）

- [ ] 7.1 两轴外部评审：后端真源读 `scripts/ccg-review-backends.list`（改 `config.toml` 对评审链无效）。跨家族轴不可得时**按四档归因**（启动形态错 / 额度重置 / IP 级拒绝 / 403 额度不足），并如实写"只经过单轴复审"，不得写成双模型完成
- [ ] 7.1b **设计层第 1 轮是单轴**（2026-10-21 实跑 `plan-review.sh --force` rc=2：critic=claude 交付 7 条 / Critical 3，proposer=opencode **未跑成**——任务提示 9790 + 角色提示 147 = 9944 字符，超该后端实测上限 7800，边界 `(8125, 8145]`）。7 条处置已进 design §6，但**跨家族那一半欠着**。补法不是换后端凑数，是按引擎自己的对策把**送审副本**压到上限内（剥掉 §2 读数表与 §4 被否证表——那两张是给人核对出处的，不是评审对象），仓内 design.md 一字不动。压完重跑一轮，仍未收敛就升级报告，不盖章
- [ ] 7.2 本片收口 MUST 由**本片自己落地的驱动写回**产出 `tier=external` + `delivery@` 摘要，而不是手写 —— 这是 1.1 那条契约锁的现场检验：**如果本片最后还要手写，说明写回器没真跑通**
- [ ] 7.3 逐条处置评审意见：采纳前量"这个修法会不会把刚建的门禁整条关掉 / 能不能触发"；否证要带证据；只接受真的那一半
- [ ] 7.4 不自动合并，交人工过目（判据本体 + 评审驱动本体两条高危面）

## 8. 遗留（本片刻意不做，写清楚免得被读成已闭合）

- [ ] 8.1 **联网核验** `pr`/`session`/`uuid`/`oid` 四档指向的仓库外对象是否真实存在 —— 单独立片，代价是判据要网络与凭据、且必须可离线降级
- [ ] 8.2 **引擎归属 / vendoring 决策**：要把引擎按字节锚点搬进本仓（先例：Logto webhook 补丁要求运行时文件 SHA-256 绑定 + 漂移即 fail closed），属"谁来守门"，人工过目，本片不做
- [ ] 8.3 **提交级归因**（产物写"本次改动文件清单"）仍在 8.1b 范围① 挂着：本片写回器只补 `tier`/`evidence`，不产文件清单 ⇒ 矩阵仍按 PR 差量判，提交级归因做不了
- [ ] 8.4 **`unknown` 占比不降**：本片给了合规路径，但历史产物不会被改写；转拦仍取决于新增产物是否走驱动，不取决于本片。现读数以 `node scripts/ccg-artifact-shape-survey.js --ref=origin/main` 的 `[闭环×tier]` 行为准（2026-10-21 实测：未闭环 `absent` 1104 + `unknown` 315；已闭环里 `absent` 178）。**同档还有一条没人问过的欠账**：交叉表里有 **3** 份已闭环产物写着闭集之外的野值（`unrecognized`）——判据只对**进入变更集**的产物判它，存量这 3 份不会被任何一次 PR 扫到，除非有人主动改它们。这 3 份是不是该有人认领，本切片不裁决，只把数交给工具（引用时现跑）。
- [ ] 8.5 **写回器仍可被绕过**：`delivery@` 摘要**任何填写方都能一条命令自算**（它只哈希本记录的 `findings`，不含外部秘密），所以它**不构成成本壁垒**——跨家族评审 codex i4 打掉了原文"成本从一词抬到一份自洽正文"那句，本文已删。这一档的全部价值是"多一个可就地验证的形态"+ 让合规路径不需要手写；措辞上 MUST NOT 称"防伪造"，也 MUST NOT 称"抬高成本"
- [ ] 8.6 **提交与判定产物的配对无人校验**（QM-6 i7）：钩子按父 sha / 内容哈希落产物，而本仓没有任何判据问「这次变更集里的 dual 产物数是否等于需要评审的提交数」。
  本切片就因此走过一次弯路：两笔提交会留两条 `mode=dual` 产物而评审只服务当前 HEAD ⇒ 第一笔永久 pending 且**结构上无法回补**；
  我用 `git reset --soft` + 手工回收站把它压成一笔，**审计线索只剩我自己写的执行记录**（critic 原话：no automated artifact linkage）。
  正解是加一把「变更集内 dual 产物数 == 需评审提交数，且每条都能归因到一个 commit」的锁——它在判据本体上（高危面），单独排片。
- [ ] 8.7 **`scripts/lib/ccg-delivery-digest.js` 不在高危面清单里**（本片自查发现，刻意不在本片收敛）：
  `HIGH_RISK_SURFACES` 现有 `scripts/ccg-review-`（写回器本体命中）与 `scripts/lib/ccg-review-`，但**没有** `scripts/lib/ccg-delivery-`。
  后果：单独改摘要实现（把 `matchesDeliveryEvidence` 改成恒真）不会被矩阵要求"必须有外部复核出处"，
  它只受自己的向量锁与行为用例约束。这条与 8.5① 同型（decider 的 `RULES.sensitivePaths` 与本清单是两份表、实测已分叉），
  所以修法应与 8.5 一并处理，而不是在本片顺手加一行——**加前缀本身就是改"谁来守门"**。
  当场读数（本片工作树，`git ls-files` 口径）：`scripts/lib/ccg-delivery-*` 归因 **0 个**（该文件本片才新建、尚未入库），
  入库后为 1；因此若直接加条目并写「命中 1 个」下界，本地会红在 `owned >= want` 那条对账上——这是"下界声明必须取自已入库事实"的现场，
  不要靠把声明写成无下界来绕过（`check-pr-exec-record.test.js` 会把无声明条目原样打印出来，绕过是看得见的）。

## 9. 跨家族那一轮（critic=codex，8 条 / Critical 3 / 最低分 4）产生的新工项

> 处置正文见 design §7。这一轮是**换后端**跑成的：护栏只对 `BACKEND_INPUT_LIMIT` 表内后端生效（表里只有 opencode），
> 所以出路是把第二家族放到 **critic** 位而不是继续挤 payload。回路本身仍 rc=2，失败在引擎自动改文的
> `before` 逐字校验（markdown 粗体与转义打断了逐字复制），**不是评审没发生**——照旧由我改文档。

- [x] 9.1 **D2 条件 4 改成两条并立、各自出声**（i1，Critical）：`no-write`（字节未变）+ `no-new-delivery`（去 `at` 的语义指纹未变）。三条用例齐：只有 `at` 变 ⇒ 不写；`status` 变而 `findings` 未变 ⇒ 写；两条都没变 ⇒ 不写且两条读数各打各的
- [x] 9.2 **两个规范化不得合并**（i1 + i7）：证据摘要 = `sha256(findings)`；本次产出指纹 = `sha256(deepReview 去掉 at)`。各一个函数名、各一条向量用例；把任一改成另一个必须当场红
- [x] 9.3 **rc 映射**（i2，Critical）：**修法随实现改了口径**（原样留着会写成一条没做的事）。入口是 bash，`128+signo` 是 `$?` 的原生语义，所以对本仓的要求不是"再抄一份映射表"，而是**入口不得加工 rc**——调用后立刻 `_wb_rc=$?`，其后任何命令（含写回器）都不得改写它。写回器 CLI 包 `try/catch`，抛错打成一行 `reason=throw` 且退出码恒 0（不以裸栈收尾）。落点 `scripts/deep-review-entry-rc.test.js`：⑧ 用假驱动 `process.kill(pid,'SIGKILL')`，**期望值由同一个 bash、同一份 env 现测**（本机 2026-10-22 实测读数 `SIGKILL => 1`，不是 137——写死 137 的锁会在 Windows 侧恒红、在 POSIX 侧才是恒真），再断言入口逐字等于该读数；⑨ 写回器模块缺失（node 非零）时入口仍返回驱动的 rc 并打印「写回器自身未能运行」
- [x] 9.4 **路径透传缺失必须出声**（i6，Critical）：`missing-record-path` 分支 + 一条用例；禁止"扫目录取最近一个"与"用 HEAD sha 猜"两种回退
- [x] 9.5 **闭集冻结快照锁**（i5）：写回器侧断言 `CLOSED_DEEP_REVIEW_STATUSES` 逐项等于快照；快照只能整体替换、不得单边加宽（本仓「计数型棘轮只能缩小」同型）
- [x] 9.6 **失配处置**（i7）：`delivery@` 与本记录重算值不符 ⇒ `external-unverified` + 可操作指引；红文案 MUST NOT 出现"伪造/无效证据"字样（禁词锁按语义位置切，注释里的字样要剥掉后再判）
- [x] 9.7 **排障开关**（i8）：按 design §7 i8 的最终处置**不实现**——本片既不引入 env 开关，也不引入 `--writeback-dry` 旗标。理由就是处置本身改成了"没有开关"：写回是旁路（不改 rc、拒绝时产物逐字不变），今天没有任何人要关它；而"旗标要落进产物"与"dry 不落盘"结构上互斥。合同留在 design §7 i8 那一行：**真要加时必须是显式旗标（进命令行与日志行），MUST NOT 用 env**（本仓对 pre-commit 也做过同一否决）
- [ ] 9.8 **送审副本必须自证"哪些约束在别处"**（i3 的方法论半边）：原子写/有界重试本已写在 tasks 3.3，副本 B 没带 tasks 就被当成缺口。下次裁剪 MUST 在副本头列一行「写入原子性与重试口径见 tasks 3.3，本副本未包含」

## 10. 外部深审第 2 轮（critic=claude，跑在 a8d6900e1）的处置落地

- [x] 10.1 **i1（Critical，crypto）修掉**：`④` 的两半都变成必需——入口在调驱动**之前**用共享实现取动手前语义指纹（新增 `scripts/lib/ccg-delivery-digest.js --print-fingerprint=<记录>` 出口，禁止在 shell 重抄规范化算法），与 `--before-sha256` 一起透传；缺一半 ⇒ `before-state-missing` 拒写且不给 `delivery-changed` 打点。原缺陷现场：CLI 形态下 `at` 单变被 `wrote=true` 放过（既有 ④-b 只喂 Buffer，所以它绿着漏掉生产缺口）
- [x] 10.2 新增三把锁：单元 ④-e（生产传参形态 + 只变 `at` ⇒ `no-new-delivery`）/ ④-f（只给字节哈希 ⇒ `before-state-missing`）/ ④-g（真跑 `--print-fingerprint`，断言两侧同一份实现）；入口行为 ⑪（stale-closed 夹具的 findings 与假驱动**逐字相同只差 `at`**，否则测的是 no-write 而不是这一格）；deps 位置锁（两个 `--before-*` 都必须在位，且取指纹必须排在调驱动之前）
- [x] 10.3 **i3（Warning）修掉**：夹具的 `ENTRY_WRITEBACK_CLOSURE_B` 不得手抄——新增「闭包完整性锁」，从被登记文件的实际 `require('./…')` 递归推出闭包并逐项要求已登记，带 `got.size >= 4` 规模下界防解析退化空转
- [x] 10.4 **i4（Warning）否证并补取证用例**：`cmpCodePoints` 是 `Array.from` + `codePointAt`（码点序）；新增 `U+FFFF` vs `U+1F600` 的双键序 canonicalize 同串 + 串内方向断言（只测"稳定"测不出方向错）。附带自我纠正：第一版把对象当字符串 `strictEqual`，那是判据自身的假红
- [x] 10.5 **i2（Critical）的外部复核**：跑一次真外部（claude）复核 → 结论落成 PR 公开评论取 `evidenceRef` → 填 `.adversarial/ccg-deep-<sha8>/adjudication.json` 5 条 → 重跑入口收口。**不得伪造那三格**；做完这步，`tier=external` 应由本片落地的写回器自动产出（tasks 7.2 的自反检验在此刻才成立）
  - **实测结果与本片原本的预期相反（不改写上面那句，只把现场补在这里）**：外部复核真跑并交付后，引擎把收口交给**自扮演第三档出口**，那条出口的 `performedBy` 逐字是 `self-play`，而写回器合取③要求它逐字等于本轮 critic（`claude`）⇒ 写回器**两次实跑两次拒写**（第一次 `reason=not-closed status="self_play_pending"`；填完裁决重跑后 `reason=backend-mismatch performedBy="self-play" 期望 "claude"`）。所以「做完这步 `tier=external` 应由写回器自动产出」这句话在自扮演这一档**不成立**，已按实测登记为 11.5。本条的收口走 `closureNote` 出口（本 PR 变更集非高危面，那条够用），`tier`/`evidence` **不是**会话手写——写回器拒写时产物逐字不变，这一点由 `scripts/ccg-review-writeback.js` 的旁路语义保证。逐条读数见 design §8。
- [x] 10.6 **i5（Warning）处置**：其"写入瞬间不比对 findings"就是 D3 声明的强度边界（不是签名，tasks 8.5 写明 MUST NOT 说成防伪造），可操作的那半随 10.1 闭合；其 CI 预算前提被 runner 实测否证（`Gate 2b10` 1 秒 / `Gate 2b11` 3 秒），文档里的 60 秒已标明是 Windows 本机数

## 11. 收口那一次真外部复核（2026-10-22，载荷 = 主干 `72f371925` 的 diff）产生的登记项

> 这一段是 tasks 10.5 的执行现场。**先写测到的，再写原本打算的**，因为两者结论相反。
> 入口按内容寻址命中那份 pending 记录的现场：`git diff --no-textconv --no-ext-diff --no-renames HEAD^ HEAD -- . ':(exclude).ccg' | sha256sum`
> 逐字等于记录名 `918d6061…2f8d35e1`（2026-10-22 实测命中 ⇒ 收口不必重建提交，squash 后的主干提交就是同一份载荷）。
> **本节交付范围（读勾之前先看这行）**：已交付 = 守门面轴 11.1 ①、11.5 的裁决 ③ 与其两项配套；**未交付且明确未做** = 11.6（把判据消费的库纳进守门面，属扩表）、11.7（③+T3 组合会把高危面 PR 闭环，三条候选落点全部属改谁来守门）与 **11.8（umbrella：11.6 ∧ 11.7 同时勾掉才算本节闭合）**。上面三条 `[x]` 的范围各自写在条目里，不得读成"两张守门表已同步"或"高危面已有机械出口"。内容风险轴 `RULES.sensitivePaths` **按设计不合并**，不是遗漏。

- [x] 11.0 现场读数（都是活数，引用时现跑）：判定 DUAL、`critic=claude` 交付 **6 条 / 四个维度分 / 最低分 7**（高于 #4151 当时三轮的 4 与 5）⇒ 收敛判定 `status=self_play`，待裁决 4 条、其中高危域需外部复核 1 条；那条单独跑了一次真外部（后端 claude、rc=0、75 秒、会话 id 写进公开评论）判 `dismissed`，结论与 URL 填进 `.adversarial/ccg-deep-72f37192/adjudication.json` 的 `externalReview` 三格；重跑入口走「复用存档 critique」短路（零模型调用）⇒ `自扮演裁决未发现阻断项` ⇒ `status=self_play_resolved`
- [x] 11.1 **守门面轴单一真源已交付（本条的 `[x]` 只覆盖守门面轴：清单收成单源 + 决策层报告命中；auth/加密轴按设计不合，扩表残差另立 11.6、机械出口另立 11.7，两条仍是 `[ ]` ⇒ 本条不构成"两张守门表缺同步机制"已闭合）**（外部复核的 BLINDSPOT，比指控原条目更深，本条取代 8.7 的措辞）：`check-pr-exec-record.js::HIGH_RISK_SURFACES`（路径前缀）与 `ccg-review-decider.js::RULES.sensitivePaths`（决策层敏感路径）是两份独立清单、实测已分叉（8.5 记过一次）。后果不是"某文件漏登记一行"，而是**判据消费的库与判据自身可以分处两表**：`scripts/check-` 在表内、它依赖的 `scripts/lib/ccg-delivery-` 在表外 ⇒ 改库不改表，矩阵对"改谁在守门"始终看不见。修法要同时收敛两表口径来源，且**属改谁来守门 ⇒ 人工过目，不在 agent 自动合并授权内**；扩表必须同次重取每条前缀的已入库命中下界（写高了本地当场红）
  - **2026-10-23 交付（分支 `qm6-gate-surface-parity`）**：守门面清单收成单一真源 `scripts/lib/ccg-review-gate-surfaces.js`（5 条前缀 + why），判据 `HIGH_RISK_SURFACES` 的这 5 条改为 `...GATE_SURFACES` 派生，决策层 `ccg-review-decider.js` 新增 `stats.gateSurfaceHits`（**只报告、不改 mode**，与 i3/i5 的 doc/ccg 敏感词同构）。三条锁：两表同源对账（含反向"判据不得自己长出一条守门面条目"）、匹配实现只一处（决策层复用 `highRiskPrefixOf`，由**段起点**那一格行为区分，见下）、清单禁词（决策层源码不得出现守门面字面量）。本条原文要的"收敛两表口径来源"只做了**守门面轴**：`RULES.sensitivePaths` 那条 auth/加密语义轴与本表问题不同，没合，也不该合。
  - **残差另立 11.6（未做，需人工过目）**：本条点名的 `scripts/lib/ccg-delivery-` 至今不在任何一份表里。
  - **变异反证现场**：MT-B（决策层自写根锚定匹配）第一次 **ESCAPED** —— vendored 那一格两版实现同形；补"段起点"用例后同一变异才指名变红。弱测不是靠"看起来严格"发现的，是靠把锁本身改成 no-op 发现的。
- [ ] 11.2 **入口取不到动手前哈希/指纹时一律出声**（深审 i4 的可操作半边，也是 #4151 第 3 轮那笔遗留小修，正式落到这一格）：`scripts/deep-review.sh` 的 `_wb_before` / `_wb_before_fp` 都来自命令替换，`$(…)` 内失败不触发外层 `set -e` ⇒ 两值可能静默为空串，写回器只报笼统的 `before-state-missing`，读日志的人分不清"记录不存在"与"取哈希的管道坏了"。改法：入口在传参前判两值非空，缺一即打一行点名成因的告警（**只出声、不改 rc、不改拒写语义**，本仓「静默配置失败必须留日志」那条），并补一条入口级边界用例覆盖 `$REC` 不可读这一档（现 ①–⑪ 只覆盖到"记录存在但驱动没写过"与"写回器自身起不来"）
- [ ] 11.3 **本仓证据形态的 `url` 档比引擎侧宽**（深审 i3 顺带量到的真实差，不随 i3 被 dismiss 一起消失）：`evidenceForm` 认 `https://github.com/<o>/<r>/pull/<n>` 之后**跟任意非空白**（含 `?x=1`、含没有评论 id 的光秃 PR 地址），而引擎的 `EXTERNAL_EVIDENCE_RE` 要求整串以 `#issuecomment-<数字>` 结尾。今天两把判据分属不同字段（`deepReview.evidence` 与 `items[].externalReview.evidenceRef`），推不出一条假的收口；但"指向一整条 PR"与"指向一条具体评论"的可核度不是一回事。二选一并写明理由：① 收紧本仓 `url` 档到要求 `#issuecomment-` 加数字（先量主干既有合规写法会不会被误杀，会误杀就走"先登记再收窄"）；② 保持宽，但在记录里点名这条宽度差已被对账（即本条）。parity 锁的前提仍是对端制品先入库（见 0.1 读数）
- [ ] 11.4 0.1c 的正解仍在这一格：`sh scripts/plan-review.sh <方案文件>` 重落一条 `layer=plan` 产物，让 `plannedFiles` 覆盖 survey 切片与 Gate 2b10/2b11；**做完当场记下"范围漂移"告警是否仍报**（#4151 开发期第 6 笔提交的 pre-commit 日志逐字报过「8 个文件不在方案声明范围内」）。那条读数写进收尾评论而不是文档——它是运行态读数，不是规格
- [x] 11.5 **自扮演出口与写回器合取③结构互斥 —— 本条的 `[x]` 只覆盖「政策已裁决 ③ + 两项配套实现已交付」；互斥本身没有被消除，高危面的机械出口仍挂在 `[ ]` 的 11.7（umbrella 见 11.8）**（本轮实测出来的，原判据设计没预料到这一格）：引擎 `finalizeAdjudication` 写 `performedBy: "self-play"`，写回器要求 `performedBy === expectedCritic` ⇒ 凡经自扮演收口的记录**永远**拿不到 `tier=external`。这不是"想办法让它成立"的噪声——自扮演收口本来就不是外部评审，盖上 external 才是造假。真问题在另一头：**高危面上的记录若只能经自扮演收口，就没有任何机械出口**（`closureNote` 在高档不够格，`tier=external` 又写不出来）。三个候选落点（都属改谁来守门，须人工过目，本片一个都不动）：① 合取③承认"记录级 `performedBy=self-play`，但 `externallyReviewed[]` 里有与本轮 critic 同名且带公开 URL 的条目"这一形态；② 引擎在外部复核解除高危项时把记录级 `performedBy` 写成 critic 而非 self-play（改的是仓外引擎，本仓不可写）；③ 维持现状，明文接受"自扮演收口一律 `tier=self-play`，高危面必须走真外部收敛那一档"
  - **2026-10-23 用户裁决走 ③**（"维持现状，明文接受自扮演收口一律拿不到 `tier=external`"），另两档不动：①要改写回器合取③、②要改仓外引擎，两者都属改谁来守门。为使 ③ 不是一句空话，本刀另加两项**实现**（编号化，免得一条勾同时装政策决定与实现扩展：【11.5-配-a】【11.5-配-b】，两者均已交付）。这条 ③ 本身只是裁决：(a) `check-pr-exec-record.js` 的**高危面零外部证据**判据 —— 变更集命中高危面而其中没有任何 `tier=external` 已闭环产物时当场红，并只给真外部那一条出口（不看 `mode` 标签、只看证据，避开缺陷 G 那条"凭 pending 记录通过"的老路）；(b) 普查工具 `ccg-artifact-shape-survey.js` 单列 **self-play 收口 × 有无 externallyReviewed** 四格读数，让这个被 ③ 承认下来的状态在数据里可见而不是靠散文记忆。
  - 合取③与自扮演出口的互斥**没有**被放宽：写回器仍拒这类记录（本轮实测两次拒写，见 #4151 收尾与 design §8 第 2 点）。

- [ ] 11.6 **判据自己消费的库不在任何守门表里（11.1 点名的那一格，实测仍在表外）**：`scripts/lib/ccg-delivery-digest.js` 是 `delivery@<sha256>` 摘要的唯一实现，判据与写回器都靠它对齐，改它就能让"写回器写的"与"判据认的"永久对不上——而 `highRiskPrefixOf` 对它返回 `null`。同型面当场一起量出来（读数 = `git ls-files` 份数 / `highRiskPrefixOf` 归因，2026-10-23 现跑）：`scripts/lib/ccg-` 7 份（其中 delivery-digest 1）、`scripts/lib/main-red.js` 1（主干红闸门本体）、`scripts/lib/merge-ledger.js` 1（远程同步收口推导本体）、`scripts/lib/gate-timeout-registry.js` 1 —— **四者归因均为 null**。候选修法：把 `scripts/lib/` 下"判据/闸门实现"纳入守门面（前缀取 `scripts/lib/ccg-` 还是整段 `scripts/lib/` 是两种宽度，后者会把 `qm1-paths.js`、`image-mime.js` 这类非判据库一并拉进高危面）。**这是扩表 = 改谁来守门，须人工过目，本刀没有动**；任何扩表必须同次重取每条前缀的已入库命中下界（X2-14 会按新归因对账）。
- [ ] 11.7 **③ 与本刀 T3 合起来会把高危面 PR 闭环（现场＝本 PR #4261 自己）**：引擎只要收到 **1 条 Critical** 就不走"按严重度收敛"那一档 ⇒ 落到自扮演出口 ⇒ 记录级 `performedBy` 恒为 `self-play` ⇒ 写回器合取③永不成立 ⇒ `tier=external` 永不会出现。而高危面的收口矩阵只认 `tier=external`（`closureNote` 在高档不够格，这是 #3987 刻意改的惯例），本刀又加了「高危面零外部证据」⇒ 两条合起来：**改判据的 PR 必须让 critic 交出零 Critical 才能合，且 critic 的一条假阳性 Critical 就足以把它永久钉住**。第 1 轮实测读数：6 条 / 维度分 4 个 / 最低分 7 ⇒ `status=self_play`，其中 **i1 是 Critical**，内容是对本刀记录里"MT-B 曾 ESCAPED"那段的复述（修复与反证已在同一 diff 内）⇒ 属**关于过程的 Critical**，不是关于代码的：按严重度判据它仍算一条 Critical，因此机械上就挡住了 external。三个候选落点（都属改谁来守门 ⇒ 人工过目，本刀一个都不动）：(a) 收口矩阵承认「自扮演收口 + `externallyReviewed[]` 带公开可核出处」这一形态（即 11.5 的①，当初否掉是因为要改写回器合取③，而不是因为它不对）；(b) 引擎侧在 critic 交付含 Critical 时继续下一轮而非直接转自扮演（改的是仓外引擎，本仓不可写）；(c) 明确接受"高危面 PR 必须先消掉全部 Critical"，并把 T3 的红文案从"跑一次真外部评审"改写成可执行判据（逐条 Critical 的处置与公开出处要求），免得红指向一条走不通的路。
- [ ] 11.8 **本节 umbrella（第 3 轮外部评审 i1 要求把"整体未闭合"写成可勾的格子，而不是只写在散文 banner 里）**：闭合判据 = **11.6 与 11.7 两条同时变 `[x]`**。在此之前，11.0 / 11.1 / 11.5 的 `[x]` 一律只表示「该刀声明的交付项已落地」，**不表示** auth/加密轴已收敛、**不表示**高危面已有机械出口。加这一格的理由不是文风：只解析勾选状态的工具（`scripts/openspec-sync-check.js` 就按 `^\s*-\s*\[([ xX])\]` 逐行取）看到的是一串 `[x]`，而"未做"只存在于那句括号里 —— 声明与勾选在机器眼里不同源，正是本仓反复记过的过度声明形态。
- [ ] 11.9 **决策层 require 整份判据，只为取 `highRiskPrefixOf` 一处（第 3 轮外部评审 i3）**：实测 `ccg-review-decider.js:40` 引入 `check-pr-exec-record.js`，唯一消费点是 `:550` 的前缀归因。后果不是"难看"而是**加载期耦合**：判据在模块顶层跑 `assertGateSurfaces`，真源坏时决策层跟着起不来（与 i5 同一条链）。不照抄"抽一份中性 lib"的修法，理由要连着成本一起写：`HIGH_RISK_SURFACES` = 5 条守门面（来自单源）+ 5 条判据自有面（凭证 / 登录态锁 / 云端账号 / 三态口径 / 指纹），搬家要么把非守门面也搬进"守门面"lib（语义污染），要么在 lib 里再造一份合并（两份真相），且「匹配实现只有一处」那条源锚锁的测量对象要同次改（本仓记过：搬家后锁测量的文件要跟着改，否则锚点静默失效）。**增量成本大于本刀收益 ⇒ 另立一格，不在本片做。**
- [ ] 11.10 **`mode=skip` 的判定产物带 `deepReview.status: "pending"`（第 3 轮外部评审 i4）**：实测本 PR 的 `c8a28e91…json` 为 `mode=skip / required=false / status=pending / performedBy=null`。**不构成功能漏洞**：`evaluateDeepReviewDebt` 在 `required !== true` 处 `continue`，skip 档的 `status` 是惰字段，不会被读成"已评审"。评审建议把它改成 `"skipped"` 或置 null —— 置 null 会让"skip 与未启动"在产物里不可区分（那才是建议要修的歧义），改 `"skipped"` 则往 `CLOSED_DEEP_REVIEW_STATUSES` 的**闭集之外**新增一个值，而 tier/status 分类对"字段在、值不在闭集里"是有拦截语义的（`unrecognized` 一律拦）：为消一个惰字段的歧义去扩闭集，代价是既有三档语义要重取。**处置：宽度差在此点名，不改判据也不改产物形态**；真要动，先量主干既有 skip 产物有多少条会被新档咬到。