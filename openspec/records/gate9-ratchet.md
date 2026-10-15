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

## 变异反证八条（全部 CAUGHT，escaped=0；逐条还原后 md5 与变异前相同）

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

M6 与 M7 最初红集逐字相同——退出码与令牌压在一条用例里，读起来像其中一条没牙。已拆成两条独立用例，现各 Own 一条指名红；CLI 端到端用例对二者**共同**变红是刻意保留的双保险（它同时断言 rc 与 note）。

PowerShell 侧另做了一次真实解释器校验（`D:/Temp/check-gate9-ps.ps1`，pwsh 7 与 Windows PowerShell 5.1 各一遍）：从 yml 里抽出该步 `run:` 正文喂 `Parser::ParseInput` ⇒ `PARSE_ERRORS=0`；`Invoke-Expression` 展开 `$gateArgs` ⇒ 8 个元素、含 `--required-feature-ids=feat_a,feat_b`；**未设置该 env 时展开成 `--required-feature-ids=`（空串）**，即 advisory 路径。这一步不是形式主义：注释若误插进数组字面量内部，YAML 侧完全合法、js-yaml 判据全绿，只有 PowerShell 解析会炸，而它的炸法是整个 required check 消失。

## 基线与回归

- 阶段①（只改测试）实测 4 条指名红 / 8 条既有绿：`scripts/gate9-classify.test.js`。
- 阶段② 补实现后：classify 12 passed / 0 failed；`agent-review-gate.test.js` 21 passed / 0 failed（拆条后）；`workflow-contract.test.js` 37 passed / 0 failed。
- 静态门禁本机实跑：`check-workflow-structure.js` files=14 violations=0；`check-unwired-tests.js` 86 个测试文件全接线；`check-step-failfast.js` 35 个多命令步骤全 fail-fast；`.github/scripts/check-max-lines.js` 无新增超限（测试文件上限是 1500，不是 500——`DEFAULT_TEST_LIMIT`，本轮当场纠正了「500 通杀」这个口径）。
- ESLint 不适用：Gate 11 的作用域是 `apps/desktop/{electron,src}`，本片未触（`pnpm exec eslint` 在仓库根无 config，报的是配置缺失而不是代码问题）。
- 消费者并集（按 `git grep -l` 取，不按"我改的文件"取）：`.github/scripts/{agent-review-gate,workflow-contract}.test.js`、`scripts/gate9-classify.test.js`、`.github/workflows/{quality-gate,agent-judge,autonomous-loop}.yml`、`.ccg/reviews/gate3failfast-mutate.driver.js`。逐个核过：`agent-judge.yml` 走的是 `mode=agent-judge` 另一条决策函数，`autonomous-loop.yml` 只在注释里提了 `PROMPT_REVIEW_REQUIRED` 语义对齐、自己读 `autonomous-loop-report-*.json`——两者均不受本次签名变更影响（新参数有默认值 `""`）。
- QM-1 / QM-4：N/A。未触 `apps/desktop/electron`、`packages/rpa-engine`、任何渲染层文件；变更面是 CI 判据 + 工具脚本。
- 行尾（按实测重写，不按印象）：`git ls-files --eol` 对六个变更文件一律报 `i/lf w/crlf attr/text=auto` ⇒ **入库 blob 是 LF、工作副本是 CRLF**，那是 git 的 checkout 转换，不是本片改的（此前那条「某些文件是 LF 文件」的写法按的是工作副本印象，已作废）。补丁驱动一律按「当前文件自己的多数行尾」插入（`eolOf()`），禁止 split/join 整份回写。两口径 `git diff --cached --numstat` 只在 `.github/scripts/agent-review-gate.test.js` 差 1 行（160/1 vs 159/0），**逐因验证过与行尾无关**：该文件 HEAD blob 末行 `});` 原本没有结尾换行（diff 正文含 ` No newline at end of file`），本片在其后追加内容 ⇒ git 把末行记成 1 增 1 删。决定性证据取索引 blob：六个文件 `git show :<path>` 的 CR 计数**全为 0**，入库内容与基线同为纯 LF，没有幽灵行进入提交。

## 遗留（不假装已闭合）

1. **LLM 判分的随机性本体没修**，本片只做到「不拿它当闸门 + 让没跑成可见」。要真把覆盖做成可复现判据，得换成确定性匹配（按 testid/路由/注册表），那是另一个专项。
2. **report-only 的两种原因仍然同形**：`PR_MODE=report-only` 与「声明了 feat_ 但 PRD 里一条都没匹配上」都返回 `skipped/filtered` + `PASS`，Gate 9 看起来一样。后者是空集恒真，应单独出声；本片没做，因为那要动审计器返回形状，超出「判据」范围。
3. **`AUTONOMOUS_GATE` 这个 env 未被任何消费方读取**（实测只有 `AUTONOMOUS_VERDICT_NOTE` 被 Gate Result 消费），存量降级时它仍写 `PROMPT_REVIEW_REQUIRED`。改它属于另一处清理，本片刻意不动以免扩大 diff。
4. **PRD 357 项的状态标注仍未回填**（上一条记录 gate9-scope-fix 的同条欠账，状态不变）：分层只对新写条目生效，存量规划项仍进分母。
5. `#3617` / `#3376` 依赖本片合并按判据放行；本片合并后需确认二者 `QG Autonomous` 由红转绿，再走各自的收尾链。

## 远程同步

| 远程同步 | PENDING | 本 PR 未合并，merge SHA 尚不存在；本片合并后由第一笔 docs PR 按 PASS 口径回填，并在同一次提交删除 ledger 登记项与 frontmatter 三字段 |
