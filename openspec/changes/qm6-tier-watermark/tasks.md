# tasks — qm6-tier-watermark

> 前置：用户裁决「advisory→enforce 暂不翻，等水位」（2026-10-23）。
> 本 change 只造水位与预览，**不**改 CI 那一步的 `--mode=`。

## 0. 前置核对与设计轴评审

- [x] 0.1 并发预检：#4238 在飞且与本刀零文件交集（proposal §五 表）
- [x] 0.2 现判据读数面核实：`TIER-COVERAGE` 统计域=本次变更集，无仓内落点（design D1）
- [x] 0.3 成本实测：全量派生可重取；逐 blob spawn 实测不可用（proposal §二 + design D13 修正）
- [x] 0.4 设计轴 QM-6 评审：轮 1 critic=claude 出 7 条（Critical 2），逐条处置见 design D11；
      proposer=opencode 轴被 7800 字符上限同步拒绝 ⇒ 缺轴登记为欠账（D14-1）
- [x] 0.5 两条 Critical 的处理：i1 已在 proposal §三 补出 `AUDIT_ARTIFACT_RE` 字面量与出处文件；
      i2 已落进水位行（两个子读数 + 等式锁 1.1.10）
      ⚠ 顺序偏差如实记：i2 的落点是"文档 + 实现 + 锁"同轮补的，严格意义的"文档先行"只到
      proposal/design 层，锁（1.1.10）晚于该函数首次实现。不影响结论，但别把这条写成"先红后绿"。

## 1. 阶段 1：水位计

### 1.1 失败测试（先见证红，再实现）

- [x] 1.1.1 六档读数逐字对上的锁（首跑红：无 `TIER-WATERMARK` 读数行）
- [x] 1.1.2 M-F1 输入面：`tier:"external"` + 不可核 evidence ⇒ `external-unverified`
- [x] 1.1.3 域外不得进分母但必须打条数并提示"域由正则划"
- [x] 1.1.4 多行 JSON 只计一条（按行切帧那版的陷阱面）
- [x] 1.1.5 探针缺省必须出声 `probe=off`，且开/关两档给出**不同**读数（1 与 2）
- [x] 1.1.6 趋势按 committer 日期分桶；重写不再计加入；author 日期分桶即红
- [x] 1.1.7 主干 ref 取不到 ⇒ `WATERMARK-SELF-FAULT` + rc=2，不得打空读数退 0
- [x] 1.1.8 结构锁：必须一次 `cat-file --batch`，不得留逐文件取 blob 形态；注释不算命中
- [x] 1.1.9 接线锁：本测试必须被 `quality-gate.yml` 可执行正文点名
- [x] 1.1.10 设计轴 i2 落点：`unknown-字段缺席 + unknown-字面值 == unknown`（真实拆法 139/7）

### 1.2 实现

- [x] 1.2.1 取域（`ls-tree` + 判据 `AUDIT_ARTIFACT_RE`）
- [x] 1.2.2 批量取对象（单进程 `cat-file --batch`，按声明字节切帧）
- [x] 1.2.3 分类只 require 判据本体的 `classifyEvidenceTier` / `summarizeTierCoverage`
- [x] 1.2.4 趋势分桶 + 三条边界打印进输出（design D5；含"667 笔加入全在 2026-10"这一格实况）
- [x] 1.2.5 退出码与"零条 ≠ 取不到"的区分（design D9）

## 2. 阶段 2：假想 enforce 扫描

- [x] 2.1 命令行逐字含 `--mode=enforce` / `--no-remote` / `--base=` 的锁
- [x] 2.2 `PREVIEW-NOT-GATE` 首行早于任何 `pr=` 行、末行再打一次
- [x] 2.3 取不到 ref / 回显不是 oid / 合成失败 ⇒ `UNJUDGEABLE` 三档，且不得写成 `WOULD-BE-OK`
- [x] 2.4 `prs=0 (none-open)` 退 0 与"列不出来"退 2 不同形
- [x] 2.5 `--max` 非法值回落并带出原值（0 合法）；单实例锁：活锁点名 PID、陈旧锁接管、写不下去拒绝运行
- [x] 2.6 结构锁：本文件不得直接调 merge-tree / commit-tree / worktree
- [x] 2.7 实现 `qm6-enforce-preview.js`
- [x] 2.8 **真实现契约锁**（本机首跑把形状错打出来之后补的，见 design D15-①）：
      §N 断言真 `mergedTreeEvidence` 把 inspect 结果放在 `baseline` 键下；
      §O 让 preview 经**真实现**（只假 git）跑通 `rc=1 ⇒ WOULD-BE-RED`
- [x] 2.9 流式锁：`onLine` 逐行回调且序列与 stdout 一致（跑 30 条时全程无输出等于工具坏了没人知道）
- [x] 2.10 repo 传递锁：`materialize` 收到的 `repo`/`baseSha` 必须是本次真被测的那一份
- [x] 2.11 全量真跑已完成：base `451320a1` 上 30 条在飞 = 会红 4 / 不会红 19 / 判不了 7（全部 reason=conflict）。
      单笔实测分布 n=41：min 6745 ms（冲突提前返回）/ 中位 74158 ms / max 140830 ms（D15-②）。
- [x] 2.11b 红线名单已写进 PR 评论（`4308#issuecomment-6370125410`）：base `98558636eb` 上 30 条在飞 = 会红 9 / 不会红 19 / 判不了 2（全部 `reason=conflict`），会红那 9 条按类别归好（4 条未跑评审 / 3 条未带记录 / 2 条正是 11.5 那一格，其中一条是本 PR 自己）。名单与本刀的验证清单同一轮写，5.5 回读时再补 main 侧读数
- [ ] 2.12 把 preview 接进 `debt-baseline-recheck.yml` 的非阻断面。**两条前置条件，缺一不可**：
      ① 先读 `blockingGateInputs`，否则会把测量步写成阻断步、连带拉长触发面（见 §D14-4）；
      ② 先解决**执行面归属**（实现轴轮 5 i2）：预览跑的是合成合并里那份 `scripts/check-pr-exec-record.js`，
      也就是**被评估的那个 PR 自带的代码**。本地按需调用时它由三条撑住——操作者亲手发起、
      首末行 `PREVIEW-NOT-GATE`、每条读数带实际 `cmd`；这三条在无人值守作业里**一条都不成立**。
      未定归属就接进 CI，等于把"PR 的 diff"升级为"runner 上的执行载荷"——属改「谁来守门」，须人工过目
- [x] 2.13 实现轴轮 3 的处置落点（design §D17）：i4 采纳 ⇒ 本刀余下两处行号引用改为按模式名描述；
      i6 采纳（后果比指控更糟：判据本体缺席时 `node` 退 1，而 1 在本工具里就是"这条会红"）⇒ `runChecker`
      加存在性前置，缺席归 `rc=2 / checker-missing` ⇒ `UNJUDGEABLE/self-check-fault`，新锁 §V；
      变异 **M-F12**（把该前置改成恒假）实测只让 §V 一条红、还原后两套锁 fail=0
- [x] 2.14 实现轴轮 3 的处置落点（design §D18）：i3 采纳的那一半当场落成 **§1.1.12**——判据面从"我自己两个配对"
      推广为"workflow 可执行正文点名的全部测试"（当场读数：点名 98 / 同名实现在盘 56 / 违规 0）。
      判据取**受跟踪**而非**有 negation**：实测 origin/main 有 3 个被跟踪却无 negation 的本体正常工作
      （文件一旦被跟踪，默认忽略对它不再生效），按后者写会当场红在三条与本次无关的历史文件上；
      另加两条规模下界（点名 ≥50、在盘 ≥40）防"抽取退化成空集合 ⇒ 零违规看着像通过"。
      变异 **M-F13**（抽取正则换成永不命中）只让下界那条红；**M-F14**（摘掉"未跟踪即红"那一格）让现场负控由红转绿。
      负控是一个在盘、未跟踪的同名实现，它对 `git status --porcelain` **完全不可见**——这一格本身就是本坑的现场形态。
      两条工具侧事实：① `safe-delete.js` 对被 `.gitignore` 吞掉的文件一律拒绝（闸 3 要求目标以 `??` 出现在 status 里），
      所以那次清理只能对本会话自建的单个文件走 `fs.unlinkSync`；② 我第一版 M-F14 把断言整行截断成语法错，
      红的是"整片 LOADFAIL"而不是那一格，改成"把条件写成恒假"才拿到"摘掉判据 ⇒ 转绿"这条有效反证
- [x] 2.15b 轮 5 i2 的追加采纳（design §D20）：`runChecker` 原先不传 `env` ⇒ 未评审的 PR 自带代码会继承操作者"
      全部环境（含令牌）。新增 `subjectEnv()`（在 `gitSafeEnv` 之上按键名形态再剥一轮，保留 `PATH` 与后端选择器），
      两条锁 = 纯函数档 + **接线档**（一份真的会被执行的桩判据自己回吐看见的键）；变异 M-F17 实测只让接线锁红，
      且桩回吐 `SECRET=leak` 证明摘掉那一格确实重开了口子。踩到的一条测试侧自错记进 §D20：第一版 canary 取名
      `MP_PREVIEW_CANARY`，不含凭证词 ⇒ "它通过了"根本不是判据，红的其实是断言本身
- [x] 2.15 实现轴轮 4 的处置落点（design §D19）：i5 采纳 ⇒ `--only` 遇非法项改为**拒跑**（`exit 2`、一条都不判、
      首尾仍打免责），并与 `--max` 的"回落默认"刻意不对称（回落是**多判**、丢弃 only 项是**少判一条却报判完**）；
      规格增量补一条 Scenario 把这套语义写进验收面，不只在实现里。i8 采纳 ⇒ 新增 §1.1.13 悬空引用锁
      （扫本 change 四件 + 执行记录里所有 `D<n>` 引用，要求 design 有对应小节；下界：小节 ≥12、引用 ≥30，
      当场读数 小节 19 / 引用 88）。变异 M-F15（把拒跑改成恒假）只让 §K 指名红；M-F16 用**造一个悬空引用**做 A/B：
      造出来指名红（红文案打印那个不存在的小节号），摘掉判据后转绿，两个被改文件逐字还原

## 3. 阶段 3：接线与落点修正

- [x] 3.1 两条测试接进 `quality-gate.yml` 的 `changes` job（与 `check-debt-recheck.test.js` 同 step，
      `shell: bash` 天然 fail-fast）
- [x] 3.2 **否证原计划的"CI 打印档"**：水位是按需派生数，挂到路径过滤作业上等于罕见触发、
      挂到高频作业要为一笔十几秒的读付整份 job。代价与承担方式记在 design D12
- [x] 3.3 `check-workflow-structure.js` rc=0（rebase 后重取：files=17 violations=0，原读 16 是上一版基线）、
      `check-step-failfast.js` rc=0（43 个多命令步骤全 fail-fast 或已登记）、
      `check-unwired-tests.js` rc=0（域内 130 个测试全接线，原读 129）

## 4. 阶段 4：验证收口

- [x] 4.1 变异反证 **M-F1..M-F10 共 10 条逐条实跑**（评审轮 2 后追加 M-F12、轮 3 后追加 M-F13/M-F14、轮 4 后追加 M-F15/M-F16，见 2.13/2.14/2.15）：全部 CAUGHT、10 轮 restored=true、收尾重跑两套锁 fail=0；
      红集互不相同（无两把锁给出完全相同集合），包含关系如实披露：M-F3(6) ⊂ M-F7(7) ——
      判别依据是"趋势按 committer 分桶"那条只在 no-op 那轮进红集，故两把锁测的不是同一件事
- [x] 4.2 消费者并集全跑：`check-pr-exec-record.test.js` 139/139、`check-debt-recheck.test.js` 39/39、
      `ccg-convergence-probe.test.js` 8/8、本刀两文件全绿（被改模块的消费者面，不是"我改过的那几个文件"；条数以 2.13 的最后一次读数为准）
- [x] 4.3 本地判据点名跑（**每条都写全路径**：`check-max-lines.js` 与 `check-workflow-structure.js` 在
      `.github/scripts/` 而不在 `scripts/`——我在 `scripts/` 下调用它们拿到 MODULE_NOT_FOUND，
      差点把"这条判据不存在"写进本条。"我调错了目录"与"它不存在"是两件事，引用判据名前先 `ls` 落点）：
      `node .github/scripts/check-max-lines.js` rc=0（limit=500 超限 94/挂账 94、测试超限 13/挂账 12，无新增超限）、
      `node scripts/check-unwired-tests.js` rc=0（域内 130 个测试全接线）、
      `node .github/scripts/check-workflow-structure.js` rc=0（files=17 violations=0）、`node scripts/check-step-failfast.js` rc=0（43 个多命令步骤全 fail-fast 或已登记）、
      `node scripts/openspec-sync-check.js` rc=0 **外加它自己的 20 条测试**（Gate 12e 那一档 = 编号连续性的唯一消费者；本刀先漏了它、CI 当场红，见 4.5）、
      `check-doc-abs-paths.js` **两次 rc=1 两次当场修**（第一次：测试夹具里的 `D:/fake/...` 字面量；
      第二次：本记录写了 worktree 的绝对路径）⇒ 现 rc=0，counts=1161 files=561，**未调大账本**
- [x] 4.4 `classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=false（含 scripts/ 与 workflow）
      ⇒ 按混合 PR 走完整质量节拍，未借道
- [x] 4.5 **CI 红过一次并被当场定位到本刀**：`QG Changes` 的 `Gate 12e - OpenSpec/CCG linkage integrity`
      红在 run 39924929145 / job 120319989826，判据读数
      `VIOLATION TASKS_MD_NUMBERING_GAP: tasks.md group 2 has numbering gap: missing 2.15`。
      成因是我加完 2.16 之后**没有重跑 Gate 12e 那一档**（4.3 那条点名清单里没有它，而它才是编号连续性的
      唯一消费者）⇒ 正解不是改判据而是把 `openspec-sync-check.js` + 它的 20 条测试补进 4.3 的点名清单，
      并当场把 2.16 改回 2.15（重排后审计器 rc=0、测试 20/20）。
      同轮另修一条**假证据**：4.3 原写 `check-max-lines.js rc=0`，我在 `scripts/` 下调用它拿到
      MODULE_NOT_FOUND —— 该判据实际在 `.github/scripts/`，是"我调错目录"而不是"判据不存在"，
      差点据此在文档里写出一句假话；现逐条带全路径与实测读数
- [x] 4.6 **rebase 到 c2c0bb085 后消费者并集复跑抓到 6 条真跑红**，根因不在我的实现：主干 40e1fb1ba(#4093)
      把 `check-pr-exec-record.js` 的状态词字面量换成 `require('./lib/exec-record-statuses')`，而
      `deep-review-entry-rc.test.js` 的 `SCRIPT_CLOSURE` 是一份**手抄的临时仓库复制清单** ⇒ 子进程里
      MODULE_NOT_FOUND，红文案长得像"写回器坏了"而坏的是夹具（见 §D23）。我当时按两件事落了一版：
      ① 清单补 `lib/exec-record-statuses.js` 与 `lib/exec-record-audit.js`（后者是**懒 require**，
      只在 `--audit` 档才加载，所以它没让 6 条真跑红——只补前者就等于把同一颗雷留在原地）；
      ② 新增本文件第一条锁「require 闭包必须被 SCRIPT_CLOSURE 全覆盖」（含"命中数 > 0"的反失明下界）。
      **最终产物不含这一版**：#4347 随先后落地（同一断链、同一把机械守卫 ⑫，且解析面比我那版更宽——
      认 `../`、认 `index.js`、还区分"仓内找不到该文件"与"没抄进清单"），按「修复有主就别再开第三刀」
      与既有记录里"不合并两份同用途锁"的承诺，rebase 时该文件**整取主干 blob**，只把本刀真正需要的
      ④ 加宽（两个被拒原因各测一格）重放上去。**我那半的增量只剩 `hits > 0` 一条反失明下界，
      未合入主干那把守卫**——这条是如实登记的"没做"，不是遗漏：两把守卫防的格子不同，主干那把
      把 specifier 还原做全了（认 `../`、认 `.js`、认 `index.js`，并把"仓内根本找不到该文件"单列），
      但**整表命中 0 条时它照样通过**（`missing` 为空 ⇒ 断言成立），而我那半防的恰好是
      "扫描正则退化 ⇒ 一条也没扫到"这一格。两格不是同一件事，不得写成"已被覆盖"。
- [x] 4.7 上面那把**已被撤回的**锁，其变异读数留档（不构成最终产物的证据，只构成"当时确实测过"）：
      M-G7 把 `lib/exec-record-audit.js` 从清单注释掉 ⇒ `pass=10 fail=1`，红集**只有**那把锁
      （10 条真跑锁逐条绿 ⇒ "懒 require 不影响真跑链"这一隔离性由实测给出，不是推断）；
      M-G8 把扫描正则换成永不命中的形态 ⇒ 同样 `pass=10 fail=1`、同一条锁红，但红的是
      "命中数 > 0"那一格。**两条红集相同必须如实披露**：两个不同缺陷由同一把锁的两个断言分支接住，
      区分依据是失败文案（M-G7 点名缺哪个模块、M-G8 报探针失明），不是条数。
      两轮 restored=true、收尾复跑 11/11 绿。另 11 条本地判据同轮点名全 rc=0
      （max-lines 超限 94/挂账 94、unwired 131、workflow-structure files=17 violations=0、
      openspec-sync 387 tasks/105 changes/244 archives、doc-abs counts=1161/files=561、
      gate-record-debt、no-hot-carrier `MODE=advisory 命中热写面=0`、record-qm5-rows 缺行 0、
      debt-budget、step-failfast 43、aggregate-changelog --dry-run）

## 5. 阶段 5：交付

- [x] 5.1a 实现轴真跑六轮并逐条处置完毕（轮 1–6 = §D16–§D21）：轮 5 的 7 条与轮 6 的 8 条
      全部填 `dismissed` 给出现场判据，重跑入口走复用档（`♻ 跳过模型调用`），引擎打出
      `✅ 自扮演裁决未发现阻断项`，记录 status=self_play_resolved、blocking=0、findings=7。
- [ ] 5.1b **拿不到工具签名的 `tier=external`**——写回器打的是
      `reason=backend-mismatch spoke=closed-status|findings-present|nonempty-findings
      detail=performedBy="self-play" 期望 "claude"`：五格合取**只欠第三格**，而第三格在自扮演收口下
      结构上不可能成立（引擎 `finalizeAdjudication` 无条件写 `performedBy:"self-play"`）。
      本 PR 变更集命中 `.github/workflows/` ⇒ enforce 按"凭空收口"拦 ⇒ **自动合并判据第 4 条无法满足**，
      属已登记的 `qm6-closure-writeback` tasks 11.5。三个修法候选见 §D20，均需人工过目，本刀不实现。
- [ ] 5.1 实现轴 QM-6 外部评审与逐条处置（原条目，保留指向）。**本 PR 命中的高危面前缀是 `.github/workflows/`，不是 `scripts/check-`**
      （本刀没改任何判据本体，接线改的是 workflow）；须 `tier=external`，由 `ccg-review-writeback.js` 写、不得手写。
      轮 1–6 已真跑，逐条处置见 design §D16–§D21，六轮汇总在 §D21 末
- [x] 5.2 `openspec/records/qm6-tier-watermark.md` 已落（QM-5 五步含③、变异表 10 条、QM-6 两轴处置、
      CHANGELOG 条目与 learnings 两条 lesson；「远程同步」状态列只写「由门禁推导」）
- [ ] 5.3 `check-pr-exec-record.js --mode=enforce --no-remote` 已跑：**rc=1**，红因逐字贴在 §D20
      （`tier 整段缺席 … 高危面上按"凭空收口"拦`）。这一条不是"待修的实现缺陷"，是 5.1b 那格的下游后果；
      在 11.5 被裁决之前它无法机械转绿，**不得**用手写 tier 或删 tier 来消掉（后者只是退回 unknown 被放过）
- [ ] 5.4 PR + `check-main-red.js --pr` 取 verdict + 合并产物取证（三条产物判据，不看 rc）
- [ ] 5.5 回读本次合并触发的 main push（按「(merge SHA, workflow)」格判）
- [ ] 5.6 `check-branch-merged.js` rc=0 后才删分支；worktree 走 `safe-worktree-remove.ps1 -WhatIf` 再实跑
      （本机已实测一次中断残留：tmp 合成 worktree 处于 `locked` + 一条 `refs/preview/*`，
      先 `worktree unlock` 再 `remove --force`、`update-ref -d`，事后核对共享根仍在 main）
- [ ] 5.7 记忆收敛（水位落点、夹具"替对方决定返回值放在哪个键"第 4 种落点、路 B 与幂等键两片待办）

## 6. 阶段 6：合取③ 的第二条出口（2026-10-24 用户裁决授权，design §D22）

- [x] 6.1 规格先行：`specs/qm6-review-chain/spec.md` 新增一条 Requirement + 三个 Scenario
      （六件齐备才写、缺件各自点名红因、直签档一字不动）
- [x] 6.2 红档先行：写回器 6 条新锁 + 判据 3 条（分档 / 未知 `tierBasis` / 绑定失配降档）+ 水位 2 条
      （`§1.1.14` 求和等式与"检查自己会不会恒真"）——先见证变红再实现
- [x] 6.3 实现：`lib/ccg-delivery-digest.js`（`adjudicationDigest` / `matchesAdjudicationDigest`）、
      `ccg-review-writeback.js`（六件前置 + `tierBasis` + ④⑤ 对新档同样适用）、
      `check-pr-exec-record.js`（`classifyEvidenceTier` 认绑定、`summarizeTierCoverage` 分档）、
      `deep-review.sh`（`--evidence <url>` / `--evidence=<url>` / `MP_QM6_ADJUDICATION_EVIDENCE`）
- [x] 6.4 两处同批被改的既有锁（不得当成"放宽断言"）：`ccg-review-writeback.test.js` ③ 那条
      `self-play` 用例的红因从 `backend-mismatch` 改为 `no-adjudication-evidence`（仍断不写、不动文件）；
      `deep-review-entry-rc.test.js` ④ 扩成两档（`Claude ⇒ backend-mismatch 且带"期望 claude"`、
      `self-play ⇒ no-adjudication-evidence`），入口透传的证据由前者继续提供
- [x] 6.5 变异反证 **M-G1..M-G6 逐条实跑**（动手前基线 29/142/15 全绿，六轮后逐字还原、收尾复跑同绿）：
      M-G1 把 URL 形态判据改恒真 ⇒ 1 条红（`adjudication-evidence-form` 那条）；
      M-G2 删 blocking 检查 ⇒ 1 条红（六件前置那条）；
      M-G3 让 `performedBy` 任意值都走新档 ⇒ **2 条红**（既有的 ③ 那条 + 我为新档写的那条），
           这一条是"把放宽做成整体拆闸"的形态，红集比别家大正好说明两把锁各守各的；
      M-G4 判据不再就地重算绑定 ⇒ 2 条红（降档那条 + 覆盖率求和那条）；
      M-G5 未知 `tierBasis` 不拦 ⇒ 1 条红；M-G6 水位不等式改恒真 ⇒ 1 条红
      （"分档撒谎"的检查自己也会误报——它上线时就先错了一次：拿 `sum.external` 而不是
      `sum.by.external` 比，恒真地喊 defect，被 §1.1.14 当场抓回）
- [x] 6.6 AGENTS.md QM-6 段落补记这条出口（含"放宽必须可见"与"这不是签名"两句）
- [ ] 6.7 自用一遍：本 PR 把 critique + 逐条处置贴成公开评论，用 `--evidence=<URL>` 让工具写自己的章
