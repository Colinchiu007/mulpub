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
- [ ] 10.5 **i2（Critical）的外部复核**：跑一次真外部（claude）复核 → 结论落成 PR 公开评论取 `evidenceRef` → 填 `.adversarial/ccg-deep-<sha8>/adjudication.json` 5 条 → 重跑入口收口。**不得伪造那三格**；做完这步，`tier=external` 应由本片落地的写回器自动产出（tasks 7.2 的自反检验在此刻才成立）
- [x] 10.6 **i5（Warning）处置**：其"写入瞬间不比对 findings"就是 D3 声明的强度边界（不是签名，tasks 8.5 写明 MUST NOT 说成防伪造），可操作的那半随 10.1 闭合；其 CI 预算前提被 runner 实测否证（`Gate 2b10` 1 秒 / `Gate 2b11` 3 秒），文档里的 60 秒已标明是 Windows 本机数
