---
record: gate9-ratchet
task: Gate 9（PRD/源码自主覆盖审计）判据改造——取消标题/label 命名豁免，覆盖失败只拦「可归因于本 PR」的那一种
date: 2026-10-15
sync_status: PENDING
sync_reason: 本 PR 合并后由后续 docs PR 按既有 PASS 口径回填 merge SHA 与时间，并在同一次提交删除 frontmatter 三字段与本记录对应的 ledger 登记项
sync_backfill_owner: agent 收尾链（回填 = 合并后第一笔 docs PR）
---

# Gate 9 判据改造（gate9-ratchet，2026-10-15）

> 分支 `gate9-ratchet`（worktree `D:/Data/projects/mp-worktrees/mp-gate9-ratchet`，非 C 盘），起点 `8e9109a556630fb4d0ad0cb714f737191a4914cd` = 当时 origin/main。
> 授权来源：#3617 被 required check `QG Autonomous` 拦住，用户在「本 PR 顺手改判据 / 另开一条带实测影响面的判据 PR / 交人处理」三选中明确选了**另开判据 PR**。
> 本篇记录同时是一次**前提被实测否证后改方案**的现场：授权时说的是「覆盖率棘轮」，读完审计器实现后那条路不成立，落成了「归属判据」。

## 这一片要解决的是「这条 required check 到底在说什么」

`QG Autonomous` 是 `Gate Result`（main 的必需检查）的承重项之一，实测日志逐字为证：`[GATE-RESULT] FAIL - blocking job(s): autonomous`。也就是说**它的红等于全仓停止合并**。而它对每个 PR 只有两种行为：

1. **标题命中 `fix|chore|docs|refactor|test` 前缀或带同族 label ⇒ `PR_MODE=report-only` ⇒ 审计器在第 147 行直接短路，一项都不审，Gate 9 绿。** 被审对象自己决定要不要被审：一个真实的桌面端改动只要把标题写成 `fix:` 就整步不跑（#3605 就是这个形状）。于是「这条 check 绿」的真实含义是「前缀命中，没跑」。
2. **没命中前缀 ⇒ 跑全量比对，结论由 LLM 自由裁。** 实测近 200 条 squash 主题里 **162 条（81%）命中第 1 类**，真正跑到审计的只有 45 条落前端源码目录的。

而第 2 类量到的那个数，**不是**一个可作判据的量。读实现得到的三条硬事实（不是推测，逐条给出处）：

- `coverageRate` 是**裁判自报**的字段：`agent-judge.js` 的输出 schema 里 `"summary": {..., "coverageRate": 0.0-1.0}`，`normalizeSummary()` 只做 `clampScore(s.coverageRate)`，没有任何一处由我们按实测项数重算。
- **被评估的项集也是裁判自己决定的**：`requirements-runner.js:113` 的 `details` 来自 `verdict.items`，不是 `facts.prdItems`。所以「分母」每次跑都可能不同——实测同一判据在 main push `367e1af4a`（run 38625943131 / job 116065246885）报 **0.34 / 41 项**，在 PR #3617（run 38646664947 / job 116135306680）报 **0.36 / 218 项**，#3372 报 0.374 / 227，#3413 报 0.31。
- **workflow 传的 `--threshold=0.5` 对覆盖判据是死参数**：`run-autonomous-e2e.js` 里 `COVERAGE_THRESHOLD` 只被第 289 行的 `VisualTestRunner` 消费（而 Gate 9 带 `--skip-visual`），`classifyCoverageResult()` 从头到尾只读 `verdict.decision`。

⇒ 授权时准备的「按 0.5 绝对阈值改棘轮基线」这条方案，**前提不成立**：它要棘轮化的那个数既不是我们算的，也没有稳定的分母。给一个「同一份代码两次跑落在不同结论两侧」的量设水位线，等于把掷硬币换成有记忆的掷硬币——required check 依旧不稳，只是换个说法。**因此本片落成的判据是「归属」而不是「水位」。**

## 改了什么（三条，全部可单测）

| # | 落点 | 判据 | 为什么这样切 |
| --- | --- | --- | --- |
| ① | `scripts/gate9-classify.js` | 删除「标题前缀 / label ⇒ report-only」豁免；`mode` 只看**变更文件**（纯文档、未触任何前端源码目录仍可 report-only，那是真的没有标的） | 审计跑不跑不能由被审对象命名决定 |
| ② | `.github/scripts/agent-review-gate.js` | 覆盖 FAIL 分两档：报告带了 `exitCodes == ["COVERAGE_FAIL"]`（逐码判，不是看 `overall`）**且**本轮确实量出了项（`coverage.summary.total > 0`）**且**本 PR 没声明 `feat_` 特性 ⇒ `COVERAGE_BACKLOG_REPORT` / exit 0 / 令牌 `COVERAGE_BACKLOG`；只要 PR 声明了 `feat_` 特性，评估面就是按它收窄的（`filterPrdItemsByFeatureIds`），FAIL 即「你说要实现的东西没实现」⇒ `COVERAGE_FAIL` / exit 1 | 存量欠账不该决定本 PR 能否合并；但「声称实现却没实现」是全仓最该拦的一条，必须照旧当场红 |
| ③ | `.github/workflows/quality-gate.yml` | `$gateArgs` 追加 `--required-feature-ids=$env:REQUIRED_FEATURE_IDS`（与喂给审计器的是同一个值） | 归属判据的输入必须由调用方给；只喂审计器不喂门禁 ⇒ 门禁恒拿到空清单 ⇒ 可归因失败被当存量放行，那是拆闸门 |

**两处刻意收紧，不降级**（防止把「降级」写成第二道恒绿）：

- 审计器自己崩溃的返回形状（`run-autonomous-e2e.js` 的 catch 分支）`exitCodes` 同样只有 `COVERAGE_FAIL`，但 `summary.total` 是 0。只看失败码会把「审计没跑成」读成「审过了、欠账是别人的」，所以降级第二条前提必须是**真量出了项**（M4 变异实测：摘掉这条前提后指名用例变红）。
- `exitCodes` 缺失 / 空数组 / 非数组 / 含未知码 ⇒ 一律不降级（fail-closed）。既有那条 `writeJson(..., { overall: "FAIL" })` ⇒ `exitCode 1` 的历史形状锁**一字未改**，仍然绿，说明旧报告形状的行为没被动过。

## 实测影响面（两条都报，不只报好处）

近 200 条 squash 提交（`bash D:/Temp/impact-gate9.sh <worktree>` 现场读数）：

```
commits_scanned=200
maintenance_prefixed=162          // 过去：标题豁免 ⇒ 整步不跑
touch_frontend_src=45             // 变更真的落了 apps/desktop/{src,electron} 或 ops-center/{frontend,backend}
maintenance_prefixed_AND_touch_frontend=22   // 这些 PR 过去整步不跑，现在会跑审计
maintenance_prefixed_AND_no_frontend=140     // 仍 report-only，但理由换成「没有覆盖标的」
```

- **代价**：22/200（≈11%）的 PR 新增一次真实审计。`QG Autonomous` 作业整体实测 27 分 38 秒（`05:39:58Z → 06:07:36Z`，含装依赖与全量审计），它本来就在 `Gate Result` 的 `needs` 里并行跑，不占用别的 job；`docs-only` 通道仍在 `changes` job 层面短路整个 `autonomous` job，未变。
- **收益**：45 条真跑到审计的 PR 里，不再出现「LLM 自报一个分母不定的数 ⇒ required check 判红 ⇒ 全仓停摆」。可归因的失败（声明了 `feat_` 却没实现）判据反而**变严**：以前它和存量欠账混在同一个 FAIL 里，现在单独命名 `COVERAGE_FAIL`。
- **未量**：label 侧豁免的历史命中数无法离线取证（需要逐 PR 拉 labels），如实记为未量。

## 真实产物复跑——单测给不了的那一步，以及它当场抓到的一条缺陷

把 #3617 那次 CI 的 artifact（`autonomous-e2e-report-2026-10-14T22-23-17-517Z.json`，run 38646664947 / job 116135306680）原样喂给新门禁跑一遍（`D:/Temp/replay-gate9.cjs`）：

- 未声明 `feat_` ⇒ `rc=0` + 令牌 `COVERAGE_BACKLOG`；声明 `feat_` ⇒ `rc=1` + `COVERAGE_FAIL`。两条归属路径都在**真产品**上成立，不只是在夹具上成立。
- 但产物同时暴露我自己写错的一处：真实 `coverage.summary` 是 `{total:218, passed:218, failed:0}`，而 `coverageRate=0.36` 并存——因为 `requirements-runner.js:114` 把 `PARTIAL` 映射成 `PASSED`，**`failed` 恒为 0**。我最初拿它当「未覆盖数」写进注解，打出来会是「覆盖 36%，未覆盖 0」这种自相矛盾的句子。
- 正解：现场数字一律按 `coverage.details[].type` 自己数（实跑得 `in scope 227 / judged 218 / covered 88 / partial 130 / missing 0`），并加一条**反向锁** `assert.doesNotMatch(message, /not covered/)`，防止下一个人为图省事再把那个恒 0 的字段接回去。
- 夹具同步改成与产物**逐字段同形**：我原先写的 `failed: 144` 在真实产物里不可能出现——那是夹具替实现撒谎，属本仓「跨包契约夹具不得替对方剥壳」的同族形态。
- 顺手多记一条判据依据：产物里裁判自报 `_verdict.summary = {covered:82, partial:145, missing:0}`，与它**自己的** items 直方图（88 covered / 130 partial）都对不上。这不是"数据略偏"，是分母和分类都由裁判临场决定的又一处实锤，正面支持"这个数不能当阈值/水位"。
## 变异反证十二条（全部 CAUGHT，escaped=0，anchorfail=0；逐条还原后 md5 与变异前相同）

| 变异 | 指名变红的用例 |
| --- | --- |
| M1 从 `$gateArgs` 摘掉 `--required-feature-ids` | workflow-contract「两条降级路径都必须显式命名并各自接线」 |
| M2 PR 画像步骤不再把 `feat_` 清单写进 `GITHUB_ENV` | 同上（**与 M1 同一条用例内的不同 assert**，node --test 只能报到测试名粒度，如实记） |
| M3 降级不再逐失败码判 | 「降级判据只认「仅覆盖失败」：混进任何其它失败码一律阻塞」 |
| M4 摘掉「本轮确实量出了项」前提 | 「审计器崩溃形状（只有覆盖失败码但零项）不得降级为存量报告」 |
| M5 忽略本 PR 声明的 `feat_` 清单 | 「本 PR 声明了 feat_ 特性…仍然阻塞」+ CLI 端到端 |
| M6 存量 FAIL 退回阻塞 | 「存量覆盖 FAIL…降级为报告型」+ CLI 端到端 |
| M7 摘掉 `COVERAGE_BACKLOG` 令牌 | 「存量降级必须另打 COVERAGE_BACKLOG 可见性令牌」+ CLI 端到端 |
| M8 把标题豁免加回来 | classify 的 3 条（标题不变性 / 纯文档不变性 / 剥注释后的结构锁） |
| M9 把恒 0 的 `summary.failed` 当「未覆盖数」写回注解 | 「存量覆盖 FAIL…降级为报告型」（反向锁 `doesNotMatch(/not covered/)` 指名红） |
| M10 `countBy` 恒返 0（不再按 details 数） | 同上（`covered 88 / partial 130` 断言指名红） |
| M11 降级前提退回读 `summary.total`（由 details 派生的计数，跨文件约定） | 「降级前提读 details 这份直接物证，不读由它派生的 summary.total」 |
| M12 未知 type 不再归 `other`（静默丢掉，分项与总数对不上账） | 「注解的分项必须与 judged 总数对得上，未知 type 归入 other 而不是丢掉」 |

红集归属的三条如实记录：① M6 与 M7 最初红集逐字相同——退出码与令牌压在一条用例里，读起来像其中一条没牙，已拆成两条独立用例后各 Own 一条指名红，CLI 端到端对二者**共同**变红属刻意保留的双保险（它同时断言 rc 与 note）；② M1/M2 落在同一条测试的不同 assert 上；③ M9/M10 与 M6 共用「存量覆盖 FAIL…降级为报告型」这一条测试名（该用例现在同时断言退出码与注解现场数字）。后两组的粒度限制来自 `node --test` 只报到测试名、不报到 assert——不是锁没牙，是报告粒度就这么粗，写清楚以免下一个人把它当成重复覆盖删掉。

PowerShell 侧另做了一次真实解释器校验（`D:/Temp/check-gate9-ps.ps1`，pwsh 7 与 Windows PowerShell 5.1 各一遍）：从 yml 里抽出该步 `run:` 正文喂 `Parser::ParseInput` ⇒ `PARSE_ERRORS=0`；`Invoke-Expression` 展开 `$gateArgs` ⇒ 8 个元素、含 `--required-feature-ids=feat_a,feat_b`；**未设置该 env 时展开成 `--required-feature-ids=`（空串）**，即 advisory 路径。这一步不是形式主义：注释若误插进数组字面量内部，YAML 侧完全合法、js-yaml 判据全绿，只有 PowerShell 解析会炸，而它的炸法是整个 required check 消失。

## 基线与回归

- 阶段①（只改测试）实测 4 条指名红 / 8 条既有绿：`scripts/gate9-classify.test.js`。
- 阶段② 补实现后：classify 12 passed / 0 failed；`agent-review-gate.test.js` 21 passed / 0 failed（QM-6 后端轴 findings 落地后增至 **23 passed / 0 failed**）（拆条后）；`workflow-contract.test.js` 37 passed / 0 failed。
- 静态门禁本机实跑：`check-workflow-structure.js` files=14 violations=0；`check-unwired-tests.js` 86 个测试文件全接线；`check-step-failfast.js` 35 个多命令步骤全 fail-fast；`.github/scripts/check-max-lines.js` 无新增超限（测试文件上限是 1500，不是 500——`DEFAULT_TEST_LIMIT`，本轮当场纠正了「500 通杀」这个口径）。
- ESLint 不适用：Gate 11 的作用域是 `apps/desktop/{electron,src}`，本片未触（`pnpm exec eslint` 在仓库根无 config，报的是配置缺失而不是代码问题）。
- 消费者并集（按 `git grep -l` 取，不按"我改的文件"取）：`.github/scripts/{agent-review-gate,workflow-contract}.test.js`、`scripts/gate9-classify.test.js`、`.github/workflows/{quality-gate,agent-judge,autonomous-loop}.yml`、`.ccg/reviews/gate3failfast-mutate.driver.js`。逐个核过：`agent-judge.yml` 走的是 `mode=agent-judge` 另一条决策函数，`autonomous-loop.yml` 只在注释里提了 `PROMPT_REVIEW_REQUIRED` 语义对齐、自己读 `autonomous-loop-report-*.json`——两者均不受本次签名变更影响（新参数有默认值 `""`）。
- QM-1 / QM-4：N/A。未触 `apps/desktop/electron`、`packages/rpa-engine`、任何渲染层文件；变更面是 CI 判据 + 工具脚本。
- 行尾（按实测重写，不按印象）：`git ls-files --eol` 对六个变更文件一律报 `i/lf w/crlf attr/text=auto` ⇒ **入库 blob 是 LF、工作副本是 CRLF**，那是 git 的 checkout 转换，不是本片改的（此前那条「某些文件是 LF 文件」的写法按的是工作副本印象，已作废）。补丁驱动一律按「当前文件自己的多数行尾」插入（`eolOf()`），禁止 split/join 整份回写。两口径 `git diff --cached --numstat` 只在 `.github/scripts/agent-review-gate.test.js` 差 1 行（160/1 vs 159/0），**逐因验证过与行尾无关**：该文件 HEAD blob 末行 `});` 原本没有结尾换行（diff 正文含 ` No newline at end of file`），本片在其后追加内容 ⇒ git 把末行记成 1 增 1 删。决定性证据取索引 blob：六个文件 `git show :<path>` 的 CR 计数**全为 0**，入库内容与基线同为纯 LF，没有幽灵行进入提交。

## QM-6 外部评审：后端交付 5 条、前端三试零交付 ⇒ 按单轴记账

先记一条**归因**：后端 `claude` 第一次跑满 80 分钟被 wrapper 判 `execution timeout`。判它是"没交付"而不是"还在跑"的依据不是时长——是那 27MB 日志里 `"type":"result"` 事件 **0 条**，且最后几行是 `InputValidationError: Bash failed due to the following issues` 反复出现。也就是说它**卡在命令类工具的参数校验上空转**。据此改的不是提示词长度而是**任务形态**（只读、明令禁止调用命令类工具、范围从 3 个文件收到 2 个），第二次就交付了 5 条 findings。这条差异本身就是证据：上一轮的成因是工具空转，不是提示词超长（本仓另有反例——提示词以 `-` 结尾却拿到完整载荷）。

前端 `opencode` 三次全败：第 1、3 次跑完只交散文式计划就停在 `SESSION_ID`（可解析 findings 数组为 0），第 2 次**根本没跑到模型**——我的提示词里写了示例 JSON，双引号触发 wrapper 的 stdin 分支、而 `|` 在 Windows 命令行把参数截断成一条以 `Warning` 开头的命令去执行。那是本仓明令禁止、且已记过至少四次的内联引号/管道违规，**这次仍是我自己犯的**，单独记在 `.ccg/reviews/gate9-ratchet-review-frontend.md`。

处置逐条见 `.ccg/reviews/gate9-ratchet-review-response.md`，摘要：

| # | severity | 处置 | 依据 |
| --- | --- | --- | --- |
| 1 | high | **内核采纳 / 修法拒绝** | 内核（判据不该架在派生计数上）成立：前提改读 `coverage.details`，两格 A/B 锁 + M11 指名红。修法要求「量出 missing 项才允许降级」被 L1 反例否证——#3617 真实产物正是 `missing=0 / partial=130 / decision=FAIL`，照它改本片一条也放不了。另纠正其一处定性：`coverage.summary` 是我们 `summarize(details)` 派生的，自报的是 `coverage._verdict.summary` |
| 2 | medium | **拒绝，登记遗留 6** | NEED_HUMAN 恒按报告型是本片之前就写死的口径；按它改会把「本轮无定论」当反证（与登录态、`AUDIT_NO_VERDICT` 的既有纪律冲突），并把非确定性重新引回 required check——正是本片要消灭的形态 |
| 3 | low | **采纳** | 新增 `other` 桶 + 「四个分项之和 == judged」断言，M12 指名红。其「去掉 inScope」的一半未采纳：缺字段打 `N/A` 是如实表达生产方没给，静默省略更糟 |
| 4 | medium | **修法拒绝 / 可见性采纳** | 两前缀作用域表是 2026-10-12 `gate9-scope-fix` 为修 #3413 建立的，本片未扩未缩；按它 fail-closed 走 full 会把 `packages/*` 送去审桌面端全量，即那次修复要消灭的错配。采纳其读者风险：已在记录与 PR 正文明写「取消标题豁免 ≠ 全仓都被审」，作用域是否扩列遗留 7 |
| 5 | low | **拒绝** | 其修法不闭合它自己举的例子：加了内容指纹后，塞进 `docs/` 前缀的源码仍落到「未触及前端目录 ⇒ report-only」那一格，洞只是换形状 |

本轮还有一条过程事实值得留存：按 #1 改完判据后 **M4 的锚点当场失配**，驱动打印的是 `SKIP M4 锚点命中数 0` 并把 `anchorfail=1` 计入汇总——不是静默少跑一条。重接变异目标后再跑才得到 12/12。**改判据本体时必须连着看变异驱动的锚点是否还活着**，否则"全 CAUGHT"里可以藏着一条从没跑过的变异。

---

## 遗留（不假装已闭合）

1. **LLM 判分的随机性本体没修**，本片只做到「不拿它当闸门 + 让没跑成可见」。要真把覆盖做成可复现判据，得换成确定性匹配（按 testid/路由/注册表），那是另一个专项。
2. **report-only 的两种原因仍然同形**：`PR_MODE=report-only` 与「声明了 feat_ 但 PRD 里一条都没匹配上」都返回 `skipped/filtered` + `PASS`，Gate 9 看起来一样。后者是空集恒真，应单独出声；本片没做，因为那要动审计器返回形状，超出「判据」范围。
3. **`AUTONOMOUS_GATE` 这个 env 未被任何消费方读取**（实测只有 `AUTONOMOUS_VERDICT_NOTE` 被 Gate Result 消费），存量降级时它仍写 `PROMPT_REVIEW_REQUIRED`。改它属于另一处清理，本片刻意不动以免扩大 diff。
4. **PRD 357 项的状态标注仍未回填**（上一条记录 gate9-scope-fix 的同条欠账，状态不变）：分层只对新写条目生效，存量规划项仍进分母。
5. **NEED_HUMAN 在有 `feat_` 时是否应阻塞**（QM-6 后端轴 finding #2）：现在两条降级通道都不看 ids，声明了特性但裁判只给 NEED_HUMAN 的 PR 仍是 advisory。改它属于把非确定性请回 required check，需要先有「裁判输出可复现」的实测前提，不在本片顺手做。
6. **Gate 9 的作用域表只有两个前端前缀**（`apps/desktop/`、`ops-center/`）：`packages/*/src` 等渲染面改动一律 report-only。这是 2026-10-12 的既有决定，本片只删了标题豁免；表要不要扩、扩到哪些目录，是一次独立的判据决策（QM-6 finding #4/#5 指向的都是这张表，不是标题豁免）。
7. `#3617` / `#3376` 依赖本片合并按判据放行，但**合片不等于它们立刻变绿**，而「为什么不立刻」我没有实测过：GitHub 在 `pull_request` 事件里到底取 head 分支还是 merge ref 的那份 `.github/scripts/agent-review-gate.js` 与 workflow，属于平台行为，不在本仓任何测试覆盖内。所以收尾顺序按**产物**走，不按机制断言走：先 `gh run rerun <该 PR 的失败 run> --failed`（或直接等自动重跑），看 `QG Autonomous` 是否转绿；**仍红就把该分支 rebase 到含本片的 main 再推**，重跑后以 `gh pr checks <n> --json name,bucket` 的行数下界与逐行 bucket 为准，不得凭「主干已经有了」判定。#3617 当前 auto-merge 已 armed；#3376 另有 QM-1/QM-6 证据未齐（见任务 #29），不在本片责任范围。

## 远程同步

| 远程同步 | PENDING | 本 PR 未合并，merge SHA 尚不存在；本片合并后由第一笔 docs PR 按 PASS 口径回填，并在同一次提交删除 ledger 登记项与 frontmatter 三字段 |
