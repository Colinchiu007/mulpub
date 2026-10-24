---
record: qm6-tier-watermark
task: 给 QM-6 外部出处覆盖率装一把可重取的水位计，并加一条"现在翻 enforce 会红几条"的假想扫描
date: 2026-10-23
---

## 本次执行记录：QM-6 外部出处覆盖率水位计 + 假想 enforce 扫描（qm6-tier-watermark，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合 PR（动 `scripts/` 判据本体 + `.github/workflows/quality-gate.yml` 接线）⇒ 必须在隔离 worktree：`<仓库父目录>/mp-worktrees/mp-qm6-tier-watermark`（占位符形态，判据 `check-doc-abs-paths.js` 按文件计数，受管文档里不写本机绝对路径），裸分支 `qm6-tier-watermark`，由 `scripts/start-mp-task.ps1 -TaskName qm6-tier-watermark` 创建；依赖就绪三连（`pnpm install --frozen-lockfile` / `ensure-electron` / `verify-worktree-deps`）全过。`classify-docs-only.js --base=origin/main --head=HEAD` 判 false ⇒ 不借 docs-only 通道 |
| 第一性原因（QM-5 ①） | ✅ | 不是"缺一把统计"，是**判据的读数域与裁决需要的域不同源**：`check-pr-exec-record.js` 的 `TIER-COVERAGE` 统计的是本次变更集（实测分母常为 1），而"能不能转 enforce"要的是主干全量占比。该行为只在跑的瞬间存在于 stdout，跑完即消失，仓内无任何落点，于是每次裁决都得临时写探针，而临时探针写完即弃（本仓记作"量过一次没人再量"）。引入链：tier 收口矩阵 PR #3987 落地时只解决了"拦不拦"，没解决"水位在哪" |
| 逃逸分析（QM-5 ②） | ✅ | 单元测试：判据自身的测试只断言"变更集内的分桶"，从未量过全量 ⇒ 无覆盖；集成测试：CI 的 `Gate 2c2` 以 `--mode=advisory` 跑，打印后恒退 0 ⇒ 打印物没人消费；视觉/巡检：不适用（纯门禁面）；代码审查：本轮设计轴评审 i3 独立命中"`<6 秒` 是单机单次快照、无预算与失败档"——即自审把探针的分段读数当成了工具成本，**外部评审拦下的正是这个**；流程：AGENTS 里「QG Changes 全绿 ≠ QM-6 已闭合」写了，但没有一把尺让人知道什么时候可以闭 |
| 系统性漏洞定位（QM-5 ③） | ✅ | 两类，都不是"少写一个测试"：① **观测面的分母无处可取** —— 判据的读数域被实现绑死在 PR 差量上，而治理决策需要仓级域，两者之间没有任何桥（`summarizeTierCoverage` 是纯函数，本来就能被仓级复用，缺的只是取数与域划分）；② **交付链上没有一环会因"文件被 .gitignore 吞掉"而停下** —— `git add` 对被忽略路径报错，但后续 `git commit` 照样成功，于是"测试入库、判据没入库"在本地表现为全绿（详见 learnings 第 1 条） |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `scripts/qm6-tier-watermark.js`（派生水位，域=判据 `AUDIT_ARTIFACT_RE`、单进程 `cat-file --batch` 按字节切帧、分类只 require 判据本体、趋势按 committer 日期）+ `scripts/qm6-enforce-preview.js`（合成合并态里跑 `--mode=enforce --no-remote`，装配复用 `mergedTreeEvidence`）。回归锁 31 条：水位 11 + 预览 20（含两条**真实现契约锁** §N/§O、一条流式锁、一条 repo 传递锁、一条"测量行不得冒充判决行"负控、一条"工具失明不得记成会红"改判锁）。实测现网读数：`total=253 external=63 external-unverified=13 self-play=28 unknown=146 unrecognized=3 域外=77`；假想扫描（base `451320a146`，30 条在飞）`WOULD-BE-RED=4 WOULD-BE-OK=19 UNJUDGEABLE=7` |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 水位与预览的**扫描域/分类/闭集**三处都只允许判据本体一份实现，由机械锁钉：`§1.1.2`（两版实现答案不同的输入 `{tier:"external",evidence:"x"}`）、`§1.1.3`（域外必须打条数）、`§I`（预览不得出现 merge-tree/commit-tree/worktree 字面量）、`§H`（默认闭包 `materialize === mergedTreeEvidence` 身份锁）。② 交付链上加了一环可重取的自检：`git diff --name-only <merge-base> HEAD` 必须含判据本体，本条已写进 `.gitignore` 的 negation 注释（第 3 次兑现同一坑）。③ AGENTS 无运行面变更，规则落点是 `openspec/changes/qm6-tier-watermark/specs/qm6-review-chain/spec.md` 三条 Requirement（可重取性、域自报、跨模块形状不得由夹具代定） |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 完全相等：`git diff --cached --numstat <merge-base 2a0635ee>` = add=1797 del=0，`--ignore-cr-at-eol --numstat` = add=1797 del=0（本记录随收口提交一起计数，故不含 `.ccg/reviews/*.json` 判定产物）。删除数为 0 ⇒ 本 PR 不触碰任何共享热点写面（`CHANGELOG.md` / `01-docs/learnings.md` / `.quality-gates.md` / ledger 均未编辑，`check-no-hot-carrier-edit.js` 与 `check-gate-record-debt.js` 均 rc=0）。工作副本呈 `w/crlf` 而 blob 为 LF，是 git checkout 的行尾转换，不构成内容差异 |
| 留痕（公开可核） | ✅ | 评审载荷、六轮汇总、两个读数与验证清单贴在 PR 评论 `4308#issuecomment-6370125410`（红线名单 9/19/2 也在里面；merge SHA 一类只在合并后存在的证据按 AGENTS 走评论，不写回仓库文件） |
| 接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` → 域内 129 个测试全部接线（含本刀两个新 `*.test.js`，登记在 `quality-gate.yml` 的 `changes` job `Detect docs-only changes` 步内，`shell: bash` 天然 fail-fast）；另有两条自锁（`§1.1.9` / `§J`）断言 workflow **可执行正文**含这两个文件名，注释里提一句不算接线 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件；本刀全部是仓侧治理脚本与 CI 接线，打包与像素回归无对应物 |
| QM-6 CCG 双模型外部评审 | 进行中 | 设计轴（决策层）：`sh scripts/plan-review.sh` 跑真后端，轮 1 critic=claude 交付 7 条（Critical 2 / Warning 3 / Info 2，最低维分 security=4），逐条处置见 `openspec/changes/qm6-tier-watermark/design.md` §D11。**proposer=opencode 轴未跑通**：输入 9919 字符 > 该后端上限 7800（实测边界 (8125, 8145]，非文档承诺），后端同步拒绝、exit 1、零错误信息 ⇒ 本轮只拿到单轴，按既有裁决"认单轴 + 登记缺轴"（design §D14-1）。实现轴（验证层）：`.github/workflows/` 属高危面前缀，须真外部评审产出 `tier=external`（由 `ccg-review-writeback.js` 写，不手写），读数与本行状态在本记录最终提交时回填。**轮 1 已回**：critic=claude 真交付 7 条（Critical 3 / Warning 3 / Info 1，最低维分 maintainability=3），引擎因 minScore=3 落自扮演档、状态记 self_play_pending、写回器按合同拒写（reason=not-closed）；逐条取证处置见 design §D16 —— 三条 Critical 均被否证（父 sha 与内容寻址是入口当场打印的设计；§N/§O 已修掉它指控的那个形状错；.gitignore 两个行号当场核对为真），但 i4/i5 两条 Warning 成立并已落锁 §1.1.11 与重取分布。**轮 2** 把 §1.1.11/分布重取落盘后重投一笔，再跑一轮真外部 ⇒ 交付 8 条、待裁决 7 条（Critical 3 / Warning 4，最低维分 maintainability=3），三轮里三条 Critical 反复落在同三类"格式既有事实 / 已有锁覆盖 / 收尾链未完成项"上，逐条取证处置见 design §D17；该轮采纳的两条落点：i4（余下两处行号引用改为按模式名描述）与 i6（**判据本体在合成合并里缺席时 `node` 退 1，而 1 在本工具里就是"这条会红"** ⇒ 加存在性前置归 `UNJUDGEABLE/checker-missing`，新锁 §V + 变异 M-F12）。**结构性结论（轮 1/2 同形，轮 3 复现 ⇒ 不再是推断）**：本 PR 命中 `.github/workflows/` 高危面，而只要那一轮含 Critical 就必经自扮演裁决、记录级 `performedBy` 被写成 `self-play` ⇒ 合取③ 永不满足 ⇒ **工具签名的 `tier=external` 只在"某一轮真跑零 Critical"时可达**。这不是本片能决定的事，属已登记的 `qm6-closure-writeback` tasks 11.5；本刀不自造闭环值、不手写 `tier`。**轮 3**（head=8e6fe3c3，重投后）交付 8 条、待裁决 7 条（Critical 4 / Warning 3），高危域须外部复核 **0 条**；处置见 design §D18，其中 i3 采纳的那一半当场落成一条**推广到全仓**的锁 §1.1.12（从 workflow 可执行正文抽 98 个被 CI 点名的测试，凡同名实现在盘就必须受 git 跟踪；当场违规 0 条，两条规模下界 98/56 防"抽取退化即空集合"假绿），配套变异 M-F13/M-F14。**轮 4**（head=9cac5b08）交付 8 条 / 待裁决 6 条（Critical 2 / Warning 4），高危域须外部复核 0 条，处置见 §D19：i2 是**把 hunk 上下文读成本刀新增**（`git diff HEAD^ HEAD -- .gitignore \| grep '^+' \| grep -c '第 106 行'` = 0，那 23 处属上游已合并记录），i5/i8 两条采纳并各落一把锁（`--only` 拒跑 + §1.1.13 悬空引用），变异 M-F15/M-F16 已实跑。**轮 5（终轮，head=64ed6f26）**交付 8 条 / 待裁决 7 条（Critical 4 / Warning 3，最低维分 2），7 条逐条填 `dismissed` 并给现场判据；重跑入口走复用档（`♻ 复用存档 critique + 已填完的裁决 —— 跳过模型调用`，零 token），引擎打 `✅ 自扮演裁决未发现阻断项` ⇒ 记录 status=self_play_resolved、blocking=0、findings=7。随后写回器打出的正是 11.5 那一格：`reason=backend-mismatch spoke=closed-status|findings-present|nonempty-findings detail=performedBy="self-play" 期望 "claude"` —— **五格合取只欠第三格，而第三格在自扮演收口下结构上不可能成立**（`finalizeAdjudication` 无条件写 `self-play`；验证层那条写 `cfg.critic` 的出口五轮一次都没走到）。`--mode=enforce` 随之 rc=1，红因逐字为"tier 整段缺席 … 高危面上按『凭空收口』拦" ⇒ **本 PR 的自动合并判据第 4 条无法满足**；三个修法候选写在 §D20 末段，均属改「谁来守门」，须人工过目。**轮 6（终轮，head=eb57b405）**交付 8 条 / 待裁决 8 条（Critical 4 / Warning 4，最低维分 3），8 条逐条 `dismissed` 并给现场判据，重跑走复用档，终值与轮 5 逐字同形（`status=self_play_resolved`、`blocking=0`、`reason=backend-mismatch`）；六轮汇总表与「零 Critical 不是本片质量的函数」这句结论在 §D21 末 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按主干 squash 尾注推导归属；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>` |

### 变异反证（驱动 `f-mutate.cjs`，10 条全部实跑）

轮 2 之后新增 M-F11（摘掉本刀自己那条 .gitignore negation）：只让 §1.1.11 一条指名红、还原后全绿。
驱动自带三条护栏，都对应本仓已发生的事故：① 动手前先跑两套锁**必须全绿**（否则还原目标本身可能是脏的）；② 每轮 mutate 前断言当前文件字节 == 启动基线，不等即拒跑；③ 收口一律 `process.exitCode`，绝不在 `try` 里 `process.exit()`（那会跳过 `finally` 把文件留在变异态）。另加单实例锁与 `SIGINT/SIGTERM/uncaughtException` 还原，以及 collected 下界（多文件合跑会截断，"0 失败"可能只是"一条没跑"）。

| 变异 | 含义 | 结果 | 红集（条数） |
|---|---|---|---|
| M-F1 | tier 分类退回"自写一份"（只看字段值） | CAUGHT | 2：`自称 external 但 evidence 不可核`、`探针开/关两档读数不同` |
| M-F2 | 扫描域退回"目录里有什么" | CAUGHT | 1：`域外不得进分母但必须打条数` |
| M-F3 | 帧退回"按行读" | CAUGHT | 6：水位 6 条（六档/降档/域外/多行/探针/子读数） |
| M-F4 | 摘掉 `--no-remote` | CAUGHT | 2：`命令行逐字` + `默认闭包身份锁` |
| M-F5 | 只留末行免责 | CAUGHT | 1：`首行必须早于任何 pr= 行` |
| M-F6 | 零条在飞也退 2 | CAUGHT | 1：`none-open 与取不到列表不得同形` |
| M-F7 | 把水位实现改成整体 no-op | CAUGHT | 7：水位全部 7 条行为锁（结构锁与接线锁不依赖输出，故不在红集） |
| M-F8 | 读数退回从顶层取（无视 `baseline`） | CAUGHT | 3：`会红退 1`、`判据退 2 档`、`经真 mergedTreeEvidence 跑通` |
| M-F9 | 摘掉 empty-changeset 改判（把工具失明记成会红） | CAUGHT | 1：`变更集为空 ⇒ UNJUDGEABLE` |
| M-F10 | 把 `TRANSITION-CHECK` 当判决行抽 | CAUGHT | 1：`测量行不得冒充红因` |
| M-F11 | 摘掉本刀自己那条 `.gitignore` negation | CAUGHT | 1：`两个判据本体必须各自有 negation`（§1.1.11 指名） |
| M-F12 | 把 `runChecker` 的存在性前置改成恒假（评审 i6 的落点） | CAUGHT | 1：`合成合并里没有判据本体 ⇒ 归"判不了"`（§V 指名；其余 20 条不红，说明它测的是新那一格而非既有分支） |
| M-F13 | §1.1.12 的抽取正则换成永不命中的形态 | CAUGHT | 1：`CI 点名的每个测试，其同名实现…必须受跟踪`（由规模下界接手，证明"零违规"不是探针失明） |
| M-F14 | 摘掉 §1.1.12 的"未跟踪即红"那一格 | 由红**转绿** | 现场负控（一个在盘未跟踪的同名实现，且 `git status --porcelain` 看不见它）在判据在位时指名红、摘掉判据后转绿 ⇒ 那条红真来自这一格 |
| M-F15 | 把 `--only` 非法项的拒跑改成恒假（轮 4 i5 的落点） | CAUGHT | 1：`--only 只判圈定的号…`（§K 指名，含"一条都不许判"与"首尾两次免责"两条新断言） |
| M-F16 | 造一个悬空引用（把一处指向第 18 节的引用改指向一个不存在的小节号）再摘掉 §1.1.13 的判据 | 先指名红、后转绿 | 红时文案打印那个不存在的小节号；两个被改文件逐字还原、收尾两套锁 0 红 |
| M-F17 | 把 `runChecker` 的 `env:` 退回默认继承（轮 5 i2 的追加采纳） | CAUGHT | 1：`接线锁：runChecker 真的把裁好的 env 交给被执行的那份 PR 代码`；桩判据当场回吐 `SECRET=leak`，所以这条红测的是"口子重开"而不是语法坏 |

M-F11/M-F12 是两轮评审处置之后补的，各自单跑（驱动当时只登记了 M-F1..M-F10 那 10 轮），
判定方式相同：断言"动手前两套锁全绿 → 变异 → 只有指名那条红 → 还原 → 再跑全绿"。

红集互不相同（无两把锁给出完全相同的集合），但存在**包含关系必须如实披露**：M-F3 的 6 条 ⊂ M-F7 的 7 条 —— 后者是"整块实现被删"，前者是"切帧方式退化"，两者红集重叠是预期（no-op 覆盖了切帧的下游表现），不构成装饰；判别依据是 M-F3 不触发 `趋势行按 committer 分桶` 而 M-F7 触发。收尾重跑两套锁：水位 10/10、预览 19/19 全绿，且 10 轮 `restored=true`。

**M-G7 / M-G8（夹具闭包锁，驱动 `g-mutate.cjs`）是一条必须承认的例外**：两条变异的红集**逐字相同**
（都是那把新锁，`pass=10 fail=1`），因为两个缺陷由**同一把锁的两个断言分支**接住——
M-G7 摘掉清单里那条**懒 require**（真跑链不加载它，所以红集只有 1 条，这一隔离性是实测出来的，
不是推断），M-G8 把扫描正则换成永不命中的形态，红在"命中数 > 0"那一格。
区分依据只能是失败文案（前者点名缺哪个模块、后者报探针失明），**条数在这里没有信息量**——
所以"红集互不相同"这句上面写的口径，对本轮这两条不成立，照实缩小适用范围。
两轮 `restored=true`，启动前提与收尾复跑各 11/11 绿。
**但这两条测的是本刀后来撤回的那把锁**（#4347 先落地并带了一把同用途守卫，见「遗留」第 1 条与本节
上面那条 lesson）：这两组读数只构成"当时确实测过"的证据，**不构成最终产物的交付证据**。
最终产物里这条锁不存在，因此本节的"红集互不相同"口径对 M-F1..M-F17 与 M-G1..M-G6 成立，
对 M-G7/M-G8 不适用（且它们测的对象已不在 diff 里）。

### 遗留（不假装已闭合）

- **高危面 + 自扮演 = 没有机械出口（本刀把 11.5 那一格量到了行级）**：写回器五格合取只欠 `backend-matches`，
  而引擎在自扮演收口时恒写 `performedBy="self-play"`。三个修法候选写在 §D20 末段，全部属改「谁来守门」，
  **须人工过目**；本刀不实现任何一条，也**不手写 `tier`**（那既绕过合取③，又把"工具产不出 external"这个信号抹掉）。
- **5.3 在 11.5 被裁决之前不可能机械转绿**：`--mode=enforce` rc=1 的红因就是上一格，不是新缺陷，
  也不得靠删 `tier` 退回 unknown 来消（覆盖率读数会把它显出来）。
- **曾堵在本 PR 外面的那条主干红已经解除（本刀不再依赖它）**：主干 `40e1fb1ba(#4093)` 之后
  `Gate 2b11` 那批入口真跑锁对**每个** PR 都红（纯 main 复跑同一命令实测 `pass=4 fail=6`，与任何 PR
  改的东西无关），同一断链一度有四把独立止血刀在飞（#4347 / #4348 / #4349 / #4350）。
  **#4347 已先落地**，其余三把被关闭；本刀按"修复有主就别再开一刀"**撤回**自己那一版，
  该测试文件在 rebase 时整取主干 blob、只重放本刀真正需要的 ④ 加宽（两个被拒原因各测一格）。
  机制层面的缺口留在 learnings 第 1 条：**"主干红着"没有一处公共认领面**，四把刀并存是结构结果。
- **实现轴 QM-6 的 proposer 轴历史上就没跑通过**：opencode 的 7800 字符上限是硬墙，本刀的处置方式（认单轴）不是修法；`qm6-review-degradation-ladder` 那份 change 才是。
- **preview 未接进 CI**：本机实测单笔 68–141 秒（负载相关），30 条一轮约 35 分钟，本地跑不动第二遍。正解是接进既有的非 required `debt-baseline-recheck.yml` 分批跑；做之前必须先读 `blockingGateInputs`，否则会把测量步写成阻断步、连带拉长触发面（design §D14-4）。
- **水位在 CI 侧没有历史读数**（design §D12 否证了原计划的打印档）：承担方式是本地重取 + 读数写 PR 评论。
- **趋势今天只有一格**：`.ccg/reviews/` 的 667 笔加入全部落在 2026-10（该目录 2026-10 才存在），要到 11 月之后才有斜率可看（design §D11-i7）。
- **146 条无 tier 声明与 3 条野值不追溯**：它们不在任何在飞变更集里，判据按设计只看差量；要清是另一刀。
- **`.adversarial/` 已被 gitignore**，本轮设计评审的 critique/proposal 原文只存在本机（`critique-v1.md` / `family-snapshot.json`），仓内留痕是本节与 design §D11 的逐条处置。
- **`.gitignore` 里 23 处"第 106 行"式的行号引用**（`git grep -c '第 106 行' -- .gitignore` 现读 23）不在本刀差量里，改它属一次独立的收敛；本刀只把自己写的两处（测试注释 + 红文案）改成按模式名描述，并留一条**不依赖行号**的锁 §1.1.11。
- **EverOS 侧未写入**：本刀收尾时按当次可用性实测，不可达就记"未写入"，不谎报入库。

## CHANGELOG 条目

# feat(gates): QM-6 外部出处覆盖率有了可重取的水位计，"能不能翻 enforce"第一次有数可依（qm6-tier-watermark）

- 新增一条命令就能重取 QM-6 外部出处的全量覆盖率（实测：253 条已闭环双模型产物里只有 63 条即 24.9% 拿到工具产出的可核出处，146 条整段没有 tier 声明，3 条写着闭集外的野值），不再依赖临时探针，也不新增任何"每轮往文件追加"的写面。
- 假想 enforce 跑的是**被评估那个 PR 自带的**判据本体，父环境会被交进一段尚未评审的代码；现按键名形态剥凭证（令牌 / 密钥 / 会话类不下发，保留 `PATH` 与后端选择器），配两条锁：纯函数档 + 让桩判据自己回吐看见哪些键的**接线档**。
- 新增"假想 enforce 扫描"：在合成合并态里对每条在飞 PR 跑一次真判据，回答"今天把 CI 那一步转成阻断会红哪几条"。首轮实测 30 条在飞 = 4 条会红 / 19 条不会 / 7 条因冲突没有合并态可判，且每条红都自带归因。
- 工具的失明不再被读成结论：判据报"变更集为空或取证失败"时该条记为"判不了"，不进会红名单；覆盖率摘要行与转变核对行不再被当成红因贴出。
- 执行记录的"远程同步"与水位都不需要事后回填：前者由 merge-ledger 推导，后者每次现算。

### 追加：合取③ 的第二条出口（2026-10-24 用户裁决授权，design §D22）

裁决原文「授权我在本片里直接放宽合取③」。落地口径是**加一条窄出口**而不是拆闸：
`performedBy==="self-play"` 时还要同时满足「`reviewBackends.critic` 等于清单 critic」
「`confidenceWeight < 1`」「`blocking` 为空」「每条 finding 有 `verdict` + 非空 `rationale`」
「入口透传一条公开可核的 PR 评论 URL」，才写 `tier=external` + `tierBasis="adjudicated-self-play"` +
`adjudicationDigest`（把 URL 绑进 findings 哈希，任换其一即由判据降 `external-unverified`）。
**④⑤ 与直签档一字未动，且对新档同样适用**——否则一份手写好的 self-play 闭环记录
能绕开"本次驱动刚产出"这一格被签上章，那比原洞更糟。

放宽必须可见：`TIER-COVERAGE` 与水位行以 `[external(直签)=a external(自扮演+公开复核)=b]` 分档，
`a + b == external` 由判据侧构造保证、由两套锁各钉一次（判据测试 + 水位 §1.1.14），
水位侧另有一条"不等式破了就 WATERMARK-DEFECT 出声"的检查。未知 `tierBasis` 一律 `unrecognized`。

- 变异反证 M-G1..M-G6 逐条实跑（红集互不相同；M-G3"放行任意 performedBy"红 2 条，
  因为它同时被既有 ③ 那条锁和我为新档写的那条锁各抓一次）；六轮 restored 逐字相同、收尾复跑 29/142/15 全绿。
- **这条检查上线时自己先错了一次**：我用 `sum.external` 而不是 `sum.by.external` 比较，
  于是它恒真地喊 defect——被 §1.1.14 的"两子读数之和必须等于 external"当场抓回。
  记这条是因为它属本仓定型的形态：**新写的"防撒谎检查"本身最容易是第一句谎话**。
- 尚未自用（tasks 6.7）：本 PR 还没把 critique + 逐条处置贴成公开评论并用 `--evidence=<URL>` 让工具写自己的章。
  在那之前这一档只是"跑通并被变异反证过"，不是"被真实用过"。

# feat(gates): QM-6 写回器多了第二条合规出口——自扮演收口 + 公开可核复核可拿工具签名，且分档可见（qm6-tier-watermark）

- 高危面不再只有"某一轮零 Critical"这一条机械出口：`sh scripts/deep-review.sh --evidence <PR 评论 URL>` 在
  「本轮真调用过清单里的 critic、逐条裁决齐备、无未解除阻断项」时可写 `tier=external`，
  并以 `tierBasis="adjudicated-self-play"` 与直签档分开计数（`TIER-COVERAGE` 与水位行都打印分档，
  两子读数之和必须等于 external，否则读数自己喊 defect）。
- 缺任何一件都拒写并点名是哪一件：`no-adjudication-evidence` / `adjudication-evidence-form` /
  `backend-request-mismatch` / `confidence-weight-absent` / `blocking-not-empty` / `verdicts-incomplete`。
  「忘了传 URL」与"本轮没跑外部评审"不再共用一句文案——它们的修法相反。
- 授权来源与边界写进 AGENTS.md 的 QM-6 段与该 change 的 design §D22：这条出口不是签名，
  真正能被第三方核的是那条评论本身；不改仓外引擎的署名逻辑（属 vendor 制品，本仓惯例不私改副本）。

## learnings

### lesson: entry-fixture-copy-list-is-a-structural-edge-nobody-declares

**现场**：rebase 到 `c2c0bb085` 后复跑消费者并集，`deep-review-entry-rc.test.js` 红 6 条，
文案是 `⚠ 写回器自身未能运行 … Cannot find module './lib/exec-record-statuses'`，
读起来像我把写回器改坏了。归因三条都要：
`git show 33104c8ac:scripts/check-pr-exec-record.js | grep -c exec-record-statuses` = **0**、
`git show c2c0bb085:…` = **2**、`git log 33104c8ac..c2c0bb085 -- <该文件>` 唯一命中 `40e1fb1ba (#4093)`
⇒ 主干新增了一条依赖边，而 `SCRIPT_CLOSURE`（临时仓库复制哪些文件）是手抄清单，没人跟着改。

**第二个现场比第一个更值钱**：我把这条写进 PR 之前先查了在飞的刀，发现
**同一断链已有四把独立修复在飞**（#4347 / #4348 / #4349 / #4350，标题各写各的，
都只动 `scripts/deep-review-entry-rc.test.js` + 各自记录，均 OPEN / MERGEABLE）。
也就是说 Gate 2b11 对**所有** PR 红的那段时间里，四个会话各自撞上同一颗雷、
各自止血、互相不知情。这条不是八卦，它指出一个真实缺口：**"主干红着"这件事没有一处
公共的认领面**——每个会话只能靠自己查在飞 PR 来避免开第三刀，而查的动作发生在
各自的红出现之后，所以重复是常态而不是意外。

**可复用的 N 条**：

1. **手抄的依赖边清单必须有自己的执行体**。AGENTS 那条「门禁断言随平台/实现迁移同步」
   列的是**语义级**消费者（谁断言 workflow 结构、谁钉 step 名），而 `SCRIPT_CLOSURE` 是
   **结构级**依赖边：它不写在任何规格里，只存在于"某文件恰好 require 了某文件"这个事实里。
   这类边上游一新增，任何只跑"我自己那两个文件"的验证都看不见；真跑锁的失败点又在
   **子进程**里，错误经一层 shell 包装，指不到"清单少一行"。正解是把清单覆盖性变成
   本文件第一条锁（缺哪个点哪个），代价从"6 条红 + 误导性文案"降到"1 条红 + 直接点名"。
2. **补清单要连懒 require 一起补**。`lib/exec-record-audit.js` 只在 `--audit` 档加载，
   所以它压根没让那 6 条真跑红——只补第一项就是把同一颗雷原地留下。
   这条锁上线后**当场又抓到这一项**，即"只补看得见的那半"会被机械判据拒绝。
3. **止血片要先查在飞刀，再动手**（本仓既有纪律）；查的代价是 4 分钟 `gh pr list`，
   不查的代价是第五、第六把刀。本次的实际结局：#4347 先落地（还带了一把同用途守卫，解析面比
   我那版宽），#4348/#4349/#4350 被关闭 ⇒ 本刀**撤回**自己那一版，该测试文件在 rebase 时整取主干
   blob、只重放本刀真正需要的 ④ 加宽。留在记录里的是**两把守卫防的格子不同**这一差异：
   主干那把在"整表命中 0 条"时照样通过，我那半的 `hits > 0` 防的正是那一格，**未合入、登记为未做**。
   "写进 PR 描述的自带修复"与"最终产物里的修复"是两件事，中间那次撤回本身也要留痕——
   否则下一个会话会以为这条锁是本刀交付的。

### lesson: qm6-review-payload-eats-its-own-disposition-table

**现场**：实现轴连跑五轮真外部评审（critic=claude，minScore 依次 3 / 3 / 3 / 3 / 2），每轮都含 Critical。
轮 4 的 i2/i3 与轮 5 的 i3 指控的是同一段"`.gitignore` 注释引用行号"。当场量
`git diff HEAD^ HEAD -- .gitignore` 的 `+` 侧对 `第 106 行` 的命中数 = **0** —— 本刀新增侧一处也没有；
它读到的是同一 hunk 里的**上游上下文行**（该文件同款说法 23 处）与执行记录里那句**取证现场引文**。

**根因**：深审载荷是 committed diff，而 diff 自带上下文行；同时我把每轮的处置表也写进 design.md，
随下一笔提交再次进入载荷。于是"如实记录已修 / 已否证"这件事本身成为下一轮的发现来源
—— 评审循环不会因为我更诚实而收敛。

**可复用的 N 条**：

1. 归因"某串是不是本次引入"必须按 **`^+` 侧**取，不能按"diff 里是否出现过"取；这与
   `check-branch-merged.js` 的"我的新增行 / 删除行"同一口径，也是 AGENTS「禁令与存在性判据必须按语义位置切」
   在**评审归因**这一侧的镜像。
2. 判据若把上下文与既有记录当新增，就会诱导人**少写处置记录**来让评审变绿——那是把锁换成沉默。
   正解是把这条机制量化后交给守门侧裁决（§D20 两句"交给下一刀"），而不是美化文档。
3. 裁决填完后再跑一次入口走的是复用档：零模型调用、秒级出终值，且 `status` / `blocking` /
   `externallyReviewed` 全部由工具写；手写这三格反而是假的。

### lesson: soft-reset-target-moved-underneath-me

**现场**：`git reset --soft origin/main` 之后 `git status` 突然列出 20 多条 `D`/`M`，其中包括
`apps/desktop/src/composables/useInAppLink.js`（判为删除）与 `Publish.vue`（判为修改）——
读起来像"我在反向撤销别人刚合并的文件"。真实成因不是索引坏了：两次操作之间又发生一次 fetch，
`origin/main` 从 `a626b0b38` 前进到 `cb55292ad`，而我索引里的树属于旧基线，
于是"索引 vs 新 HEAD"整个读成了回退。

**可复用的 N 条**：

1. 折叠提交的软重置目标**不得用活引用**：先 `BASE=$(git rev-parse HEAD~N)` 把 SHA 取进变量、
   再 `git reset --soft "$BASE"`，并当场断言 `BASE == origin/main`（不等就先 rebase 再重取）。
2. 软重置之后、提交之前必须跑一次**白名单自检**：staged 名单与本刀声明的差量文件集求差，
   差集非空立即停手。这是唯一能在"提交前"发现反向撤销上游的那一步。
3. 出现这种读数时**不要** `git reset --hard`（会吃掉自己的工作树）；正解是
   `git reset --soft <我自己的那一笔提交>` 退回原状再重排顺序。恢复动作一律按精确路径。

### lesson: qm6-tier-water-gitignore-swallows-the-judge

**现场**：三笔提交、`commit-rc=0`、本地 29 条锁全绿；`git diff --name-only <merge-base> HEAD` 却只有两个 `.test.js` 和文档 —— `scripts/qm6-tier-watermark.js` 与 `scripts/qm6-enforce-preview.js` 一次都没进版本库。取证命令：`git check-ignore -v scripts/<名>.js` → `.gitignore:106:scripts/*.js`。

**根因**：`.gitignore` 里 `scripts/*.js` 这条默认忽略吞新建脚本，而通用例外 `!scripts/*.test.js` 又把测试兜住 ⇒ 只漏一条 negation 的结果是"测试入库、判据不入库"。`git add -- <被忽略路径>` 会报错，但**不影响后面的 `git commit` 成功**，所以整条链路上没有任何一环会因此停下；我只核了 `commit-rc`，没读 `add-rc`。

**可复用的 N 条**：

1. 同一目录里"本体被忽略、测试被通用例外放行"是不对称设计，它制造的失败模式恰好是**本地全绿**：判据不在盘上时测试仍能在盘上的文件里 require 到。新写 `scripts/*.js` 必须同 PR 补 `!scripts/<name>.js`，并按既有惯例在注释里写明这条为什么存在。
2. `git add` 的 rc 是交付判据，不是装饰：提交前跑一次 `git diff --name-only <merge-base> HEAD` 与"我改了哪些文件"的清单对目，比事后靠 CI 的 `Cannot find module` 便宜两个数量级。
3. 本仓这条坑已在 `.gitignore` 注释里写过两次（#3011 家族、`debt-baseline-recheck` 那一刀），仍然第三次兑现 —— 说明"把教训写进注释"对**没有被机器判定**的环节不生效；要 Stops 就得有判据（这里缺的是"新脚本必须入库"的门禁，属另一刀，本刀先登记）。

### lesson: qm6-tier-water-fixture-decided-the-others-key

**现场**：预览工具 15 条锁全绿，本机第一次真跑（`--max=1`）却把每条 PR 都归成 `UNJUDGEABLE reason=unexpected-exit-undefined`。取证：读 `scripts/lib/debt-recheck-live.js` 的 `mergedTreeEvidence` 源码 —— 它返回 `{built, dir, baseline: inspect(dir), aTxt}`，把 `inspect` 的结果挂在 `baseline` 键下，而我的替身把它摊平到了顶层。

**根因**：替身**替对方决定了返回值放在哪个键**。这与"替对方剥壳""替对方算数""替对方改签名"是同一族，本仓记过前三次；判据读的是替身承诺的形状，而不是真实实现的形状，于是形状错在单测里结构性不可见。

**可复用的 N 条**：

1. 消费别的模块返回值时，回归锁里必须有一条**调用真实现**的（本刀是 §N 断言键集含 `baseline`、§O 让整条链经真 `mergedTreeEvidence` 只假 git 跑通），并把替身改成与真实现逐字同形；只改注释不算修。
2. 端到端"用真实现"的锁本身也会因替身不完整而假失败：§O 第一版红在"没答 `rev-parse` ⇒ 提前收口"，那不是形状问题而是夹具缺装配。要区分"生产错"与"夹具没装配到被测那一步"，方法是让锁失败时打印它实际读到什么（本刀照此在红文案里带完整 stdout）。
3. 任何"注入替身 + 默认闭包"的模块，必须有一条身份锁断言默认值**就是**那个既有函数引用（`===`），否则"复用了既有实现"这句话没有执行体。

### 驱动自己的一条如实修正

收尾那一格（"还原后再跑一次被测锁"）最初把绿判成失败：它复用了变异轮的 `kind` 语义，
而"无红"在变异轮叫 MISSED、在收尾轮才叫绿 —— 于是打印 `kind=MISSED fail=0` 并被记成不通过。
**实质证据不受影响**（两套锁的 `fail=0` 与 10 个 `restored=true` 都是真的），但驱动的输出确实说过一句假话；
同一条"同一个分类值在两个语境里语义相反"的错，本刀在同一个驱动里犯了两次（启动前提那次也是它）。
