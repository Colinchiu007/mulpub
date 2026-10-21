---
record: collect-rewrite-wordcount
task: 采集页「字数」区间真实生效——修契约键（targetWordCount→wordCountRange）+ min=0 语义 + 结果字数与截断可见化
date: 2026-10-20
---

## 本次执行记录：采集页 AI 改写字数区间真实生效（collect-rewrite-wordcount，2026-10-20）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 通过 | 运行时代码：隔离 worktree `<仓库父目录>/mp-worktrees/mp-fix-collect-rewrite-wordcount` + 裸分支 `fix-collect-rewrite-wordcount`（经 `scripts/start-mp-task.ps1 -TaskName fix-collect-rewrite-wordcount` 建，共享主目录始终留在 main 且 clean）；文档随同一 PR 落地，未直推 main |
| 第一性原因（QM-5 ①） | 通过 | 采集页 `rewriteViaEngine()` 下发 `userSettings.targetWordCount`，而引擎（`packages/rewrite-engine`）只读 `userSettings.wordCountRange`——`targetWordCount` 在整个引擎包内 **0 处引用**。同一错键让三处下游同时失效：`_getWordCountInstruction()` 返回空（prompt 无【字数要求】）、`_postProcess()` 截断上限回落策略 `postProcess.maxLength`（用户设的 6000 变 1500）、主进程桥接层 `max_tokens` 推导回落 3000 口径。叠加第二处：`Number(min) \|\| 800` 把合法下限 **0** 吞成 800（0 是假值）。第三处：引擎把 `min=0` 渲染成「0 到 6000 字之间」——把"不设下限"说成"可以任意短"，模型照着下限写，改写被做成摘要 |
| 逃逸分析（QM-5 ②） | 通过 | ① `/rewrite` 页传的是 `wordCountRange`，天然正确 ⇒ 缺陷只在采集页出现，表现为"同一功能两页行为不一致"，第一直觉易归因为"模型抽风"；② 引擎对未知键是**静默降级**（无指令 + 策略上限兜底），不报错、不抛异常 ⇒ 用户与开发者都拿不到失败信号；③ 该缺陷当时已被登记在 `openspec/records/rewrite-segment-contract.md` 的「遗留」节，但只记了**症状**（「max_tokens 回落 3000 口径」），没记**机制**（区间从未送达），也没记 `min=0` 语义 ⇒ 挂着没修；④ `useWordCountValidation` 的红字校验与调用方自行折算（`\|\| 800`）是两套口径，"校验的值"与"下发的值"可以分家 |
| 修复 + 回归保护（QM-5 ④） | 通过 | 五处修复：① 采集页改下发 `wordCountRange` 并删除死键 `targetWordCount`；② 区间改从 `useWordCountValidation` 新增的 `range` computed 取（与红字校验同源，合法下限 0 原样透传，非法区间 ⇒ 早退不发 IPC）；③ 引擎 `min=0` 指令由「0 到 N 字之间」改为「不得超过 {max} 字。目标篇幅约 {target} 字（与原文篇幅相当）；不要把原文压缩成摘要，不得省略原文的信息点」，`target = min(原文码点数, max)`，`min>0` 形态逐字不变；④ 采集页新增「改写后 N 字（原文 M 字）」字数行 + 引擎砍尾/模型侧截断**分型**横幅（复用 `utils/rewrite-truncation.js`，不复制实现）；⑤ **结构债拆分**（CI 实测 LEDGER_GREW 触发）：新增 `word-count-instruction.js` 与 `structure-headings.js` 两个独立模块，核心文件 797 → **750 行**（天花板 778），区间校验与两个上限常量按渲染层结构锁要求留在核心文件。回归：引擎新增 9 例（核心 W7-W11 + 新模块 4 例）、采集页新增 9 例、composable 新增 8 例；引擎全量 279 例、桌面端采集/改写相关 280 例全绿 |
| 防止再次发生（QM-5 ⑤） | 通过 | ① 把"用户设的区间"收敛成**单一真源**：`useWordCountValidation` 同时产出红字结论与可下发值，调用方不再自行折算 ⇒ 「合法 0 被 `\|\| 800` 吞掉」这类静默走样在结构上不再可能；② 引擎侧补**整数性**防御（浮点区间不注入指令），使非 UI 调用方（Python 旁路/插件/未来新入口）绕过 UI 校验时也不会把「1.5 到 6000 字之间」注入 prompt；③ 契约键写进测试断言（`userSettings.wordCountRange` 必须存在、`targetWordCount` 必须不存在）⇒ 再有人改键名当场红；④ 页面派生值形状用 `toEqual` 锁住 ⇒ 横幅不会因字段漂移而静默失效；⑤ 旧 PRD（2026-09-12）已加勘误横幅，指明采集页一节过时、合法域已改为 0-49999/1-50000 |
| 行尾与 diff 对账 | 通过 | `git diff --cached --numstat` 与 `git diff --cached --ignore-cr-at-eol --numstat` **两口径逐行相等**；新建的文件（PRD / 采集页测试 / composable 测试 / 两个引擎模块 / 引擎测试）已统一为 CRLF，与全仓工作副本约定一致（`attr=text=auto` 的 checkout 转换），无行尾噪声 |
| 接线棘轮 | 通过 | 新增 `apps/desktop/src/views/Collection.rewrite-wordcount.test.js` 与 `packages/rewrite-engine/tests/word-count-instruction.test.js`，均落在 workspace 覆盖域（`scripts/check-unwired-tests.js` rc=0：域内 114 份测试均已接线，workspace 由 `pnpm -r run test` 覆盖） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（改动只涉及改写参数下发、引擎字数指令、结果区元信息与 locale 文案，无打包配置、无视觉基线变更；采集页结果区新增的是纯文本行与横幅，不改布局断点） |
| QM-6 CCG 双模型外部评审 | 通过 | **三轮**真跑，双家族（opencode proposer + claude critic）跨家族校验均通过。① 第一轮（首笔提交 367 行，判 `mode=dual`）：critic 给出 4 维度评分（correctness 7 / security 9 / performance 9 / maintainability 6）与 6 条争议项，5 条进自扮演裁决 ⇒ **upheld 2 条（i1 引擎整数性、i6 派生物形状）、dismissed 3 条（i2 mock 路径、i3 计数口径、i5 locale 命名空间）**，两条成立项已修并补回归锁。② 第二轮（依赖升级那笔 78 行，判 `mode=single`）：3 条争议项 ⇒ upheld 1（i2 评审产物未闭环，本轮即处置）、dismissed 2（i1 依赖混入、**i3 数值插值的注入面——高危域，由外部 claude 复核后驳回**，出处 PR #4111 评论 #6301282403）。③ 第三轮（模块拆分那笔 244 行，判 `mode=dual`）：4 条争议项 ⇒ upheld 1（i2 记录与宣称不符，本轮即处置）、dismissed 3（i1 过度碎片化、**i4 派生物形状无运行时验证——高危域，由外部 claude 复核后驳回**，出处 PR #4111 评论 #6301488908）。两条高危域项**均走外部后端复核并留下可点开的公开出处**，没有自扮演豁免。逐条 prosecution/defense/verdict/rationale 已回填进 `.ccg/reviews/1084bfc1….json` / `3237a70a….json` / `6e8ed085….json`（`status=needs_revision`、`tier=self-play`、含 `closureNote`），`scripts/check-pr-exec-record.js --mode=enforce` rc=0 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

### 遗留（不假装已闭合）

- **知乎收藏批量改写**（`BatchCollectPanel` / `zhihuFavBatchRun`）**没有**字数区间 UI，因此不存在「设置不生效」的问题；
  它走引擎时按策略 `postProcess.maxLength` 兜底（800/1500/2000/3000）属既有设计，本次未改。
  若将来给它加字数区间入口，必须走 `wordCountRange` 真契约键（与本次同一处认知）。
- **Python 旁路**（`aggregationRewrite` / `AggregationService.rewrite`）仍用 `min_word_count` / `max_word_count`
  自有字段名与 `target_word_count = (min+max)//2` 中值语义，与桌面主链路的 `wordCountRange` 不是同一契约。
  桌面主链路早已 Node 化，本次未动 Python 侧；若该旁路重新成为主链路，须先对齐「min=0 的无下限语义」。
- 引擎 `min=0` 指令里的「目标篇幅约 {target} 字」是**软目标**（模型不必精确命中），
  平台/模型不同仍会有偏差；本次只保证"指令正确下发 + 结果字数与截断可见"，
  不做"自动把结果补长到目标字数"的二次生成（成本与语义风险都高，属独立需求）。
- 本次闭环**不等于**对最终 diff 的一次全新评审：外部评审针对的是 commit `1a01a3067` 的 diff，
  评审驱动的两处修复（i1/i6）由本 PR 的后续提交承载，用新增的 W11 与形状断言反证其正确性。

## CHANGELOG 条目

# fix(rewrite): 采集页「字数」区间真实生效——修契约键（targetWordCount→wordCountRange）+ min=0 语义 + 结果字数与截断可见化（collect-rewrite-wordcount）

> 标题末尾按合同写 **record 名（= 分支名）**，不是 change slug：本 PR 两者不同（分支 `fix-collect-rewrite-wordcount`，record `collect-rewrite-wordcount`），正说明键只能有一个来源。
> 本条按 `changelog-record-carrier` 的新合同写在执行记录里，`CHANGELOG.md` 与 `01-docs/learnings.md` **零改动**（那两个是聚合器专属的归档写面）。

- **用户现场**：采集页把字数区间设成 **0-6000**，点「AI 改写」出来的稿子只有 **1229 字**，原文 **3515 字**，读起来像一份**摘要**、「像是没有写完」，且界面**零提示**（无字数、无截断、无异常）。按码点计数确认结果**不是被砍尾**（1229 不落在任何策略上限 800/1500/1500/2000/3000 上）⇒ 是模型自己写短了。
- **第一性原因（区间从未送达）**：采集页 `rewriteViaEngine()` 下发的是 `userSettings.targetWordCount`，而引擎（`packages/rewrite-engine`）只读 `userSettings.wordCountRange`——`targetWordCount` 在整个引擎包里 **0 处引用**。同一个错键让**三处**下游同时失效：① `_getWordCountInstruction()` 返回空 ⇒ prompt 里**根本没有【字数要求】**；② `_postProcess()` 的截断上限回落策略 `postProcess.maxLength`（用户设的 6000 变 1500）；③ 主进程桥接层 `max_tokens` 推导回落 3000 口径。引入于 `83ac2706a`（2026-09-13「length 下拉已移除」那次改造）。
- **逃逸分析**：① `/rewrite` 页（RewriteView）传的是 `wordCountRange`，**天然正确** ⇒ 缺陷只在采集页出现，表现为「同一个功能两个页面行为不一致」，第一直觉容易归因成「模型抽风」；② 引擎侧对**未知键**是静默降级（无指令 + 策略上限兜底），不报错 ⇒ 用户与开发者都拿不到失败信号；③ 该缺陷当时已被登记在 `openspec/records/rewrite-segment-contract.md` 的「遗留」节，但只记了**症状**（「max_tokens 回落 3000 口径」），没记**机制**（区间从未送达），也没记 `min=0` 语义 ⇒ 挂着没修。
- **修复（四处，缺一不可）**：① 采集页改下发 `wordCountRange: { min, max }`，**删除死键** `targetWordCount`（留着只会让人误以为设置生效）；② 区间改从共享 composable `useWordCountValidation` 新增的 `range` 取（与红字校验同一套判定）：合法下限 **0** 原样透传（旧写法 `Number(min) || 800` 会把 0 吞成 800），非法区间（浮点/非数字/max<min）⇒ 早退不发 IPC；③ 引擎 `min=0` 的指令形态由「0 到 6000 字之间」改为「**不得超过 {max} 字。目标篇幅约 {target} 字（与原文篇幅相当）；不要把原文压缩成摘要，不得省略原文的信息点**」——「0 到 N」是把「不设下限」说成「可以任意短」的坏指令，模型会照着下限写；`target = min(原文码点数, max)` 保证「目标篇幅」与硬上限**不自相矛盾**。`min>0` 的指令形态**逐字不变**（不回归 `/rewrite` 页）；④ 采集页此前**收进了**引擎的 `meta` 却**从不展示** ⇒ 新增「改写后 N 字（原文 M 字）」字数行，并复用 `utils/rewrite-truncation.js` 把**引擎砍尾**（调大字数上限有效）与**模型侧截断**（调大不一定有效）分型展示。
- **附带修正**：`collection.wordCountMinInvalid/MaxInvalid` 残留着旧上限「0-5999 / 1-6000」，与真实合法域（0-49999 / 1-50000，`rewrite-limits-50000` 起）不符 ⇒ 校正（`/rewrite` 页同款文案早已更新）。
- **顺带还了一笔结构债（CI 实测触发）**：`rewrite-engine-core.js` 的行数挂账（`check-max-lines.js` 的 LEDGER_GREW，登记值 578 + 容差 200 = **778 行天花板**）在主干上只剩 4 行余量，本次直接改核心文件 ⇒ 797 行 ⇒ LEDGER_GREW 红（这条红会卡住**别人**的 PR，因为门禁看文件当前行数而非本 PR 增量）。按门禁处方「拆分」：新增 `word-count-instruction.js`（字数指令措辞）与 `structure-headings.js`（结构标题剥离，原 `_stripStructureHeadings` 逐字搬出）两个独立模块，核心文件瘦回 **750 行**。**区间校验与两个上限常量必须留在核心文件**——渲染层结构锁直接读该文件源码，断言 `const MAX_OUTPUT_CHARS = (\d+)` 与字面串 `range.max <= MAX_OUTPUT_CHARS` 逐字存在。
- **顺带还了一笔全局安全债（CI 实测触发，非本 PR 引入）**：`依赖漏洞审计` 判红于**新发布**的公告——`follow-redirects` 两条 high（GHSA-8R9P-F939-6H3C / GHSA-Q3JH-WRC6-JGQ8，修复版 >=1.16.1），补做时又出现一条 `vite` moderate（GHSA-698v-4r3x-3vcv，修复版 >=6.4.4）。**本 PR 未动任何依赖**：同一判据在 `origin/main` 上当场复跑同样红，且该门禁卡的是**全部在飞 PR**（当时在飞 30 个）。两处都用**版本没动**的反证确认不是本 PR 引入（`follow-redirects@1.16.0`、`vite@6.4.3` 在 HEAD 的 lockfile 里就是这些版本）。处置按仓库先例（#2613「提升 undici/fast-uri 到安全修复版下限，解阻塞全部 open PR 的依赖审计红」）：`pnpm-lock.yaml` 与 `ops-center/frontend/package-lock.json` **两个域**的 `follow-redirects` 升到 1.16.1；`vite` 解析版本 6.4.3 → 6.4.4 并把**声明下限**抬到 `^6.4.4`（`apps/desktop` 与 `packages/ui`）防回退。门禁当场转绿（命中 28 = 挂账 28，基线与现实一致）。**没有**走"登记进基线挂账"那条路——那是把可修的公告写成欠账。
- **回归保护**：引擎新增 5 例（W7 `min=0` 不再出现「0 到 N」/ W8 目标篇幅=原文长度 / W9 目标篇幅=上限不与硬上限冲突 / W10 `min>0` 形态不变 / W11 浮点区间不注入）；采集页新增 9 例（契约键 + `min=0` 透传 + 非法区间不发 IPC + 浮点不发 IPC + 字数行 + 两条截断横幅**及其派生物形状** + 未截断不出现横幅 + 清空后元信息一并复位）；composable 新增 8 例（锁「校验口径与下发口径合一」）。引擎全量 268 例、桌面端采集/改写相关 116 例全绿。
- **外部双家族评审（QM-6）**：pre-commit 判 `mode=dual` ⇒ `sh scripts/deep-review.sh` 实跑 **opencode(proposer) + claude(critic)** 两个后端（`--check-deps` 体检：两个后端裸名自检均通过）。critic 给出 4 维度评分（correctness 7 / security 9 / performance 9 / maintainability 6）与 6 条争议项，5 条进入自扮演裁决并**逐条回源码核对**后裁定：**upheld 2 条、dismissed 3 条**。两条成立项已修并补回归锁：**i1** 引擎不校验区间整数性（浮点会注入「1.5 到 6000 字之间」）⇒ 引擎加 `Number.isInteger` 防御 + 前端改为从 `range` 取值；**i6** 页面派生值形状无锁（横幅会静默失效）⇒ 补 `toEqual` 形状断言。三条驳回项的取证依据（调用链逐行可查、计数口径逐字同源、locale 命名空间全局注册）见本记录下节与 PRD §10.2。
- **已知遗留（不在本次范围）**：知乎收藏批量改写（`BatchCollectPanel` / `zhihuFavBatchRun`）**没有**字数区间 UI，不存在「设置不生效」的问题，其引擎回落策略上限属既有设计；Python 旁路（`aggregationRewrite`）用自有字段名与中值语义，与桌面主链路不是同一契约（桌面主链路早已 Node 化）。

## learnings

### lesson: 参数契约键对不上时，失败形态是「静默降级」而不是报错（collect-rewrite-wordcount）

**现场**：用户在采集页把字数区间设成 **0-6000**，点「AI 改写」得到的稿子只有 **1229 字**（原文 **3515 字**），像一份摘要、「像是没有写完」，界面**零提示**。按码点计数确认不是被砍尾（1229 不落在任何策略上限上）⇒ 是模型自己写短了。

**根因（三层，缺一不可）**：
① **契约键错**：采集页下发 `userSettings.targetWordCount`，而引擎只读 `userSettings.wordCountRange`（前者 0 处引用）。一个错键让三处下游同时静默失效：`_getWordCountInstruction()` 返回空（prompt 无【字数要求】）、`_postProcess()` 截断上限回落策略默认（用户设的 6000 变 1500）、主进程 `max_tokens` 推导回落兜底口径。
② **假值吞边界值**：`Number(min) || 800` 把**合法下限 0** 吞成 800（0 是假值）——用户设的「0」根本没发出去。
③ **「无下限」被渲染成「可以任意短」**：引擎把 `min=0` 注入成「控制在 0 到 6000 字之间」，模型照着下限写 ⇒ 产出必然是摘要。**「0 到 N」是语法合法、语义有害的指令。**

**可复用的五条**：
1. 任何「用户设置 → 传给子系统」的参数，下发前**全仓检索该键名在消费方是否有引用**；0 处引用 ⇒ 键名就是错的。
2. **消费方对未知键不许静默回落默认值**——要么抛错，要么给显式的「参数未生效」提示。
3. 测试断言「下游收到的就是这个**键**」，不只断言「值对」——值对 + 键错是同一句话的不同写法。
4. 合法边界值 **0** 要单独对待：读值用显式有限数判断 + 先判空再取数（`Number('')` 是 0 不是 NaN）；下限为 0 要翻译成「不设下限」，**不能**写成「0 到 N」——否定语义必须单独设计指令形态。
5. 「**校验用的值**」与「**下发用的值**」必须同源：本次由 `useWordCountValidation` 同时产出 `error` 与 `range`，调用方不再自行折算，从结构上消灭「两套口径」这一类静默走样。

### lesson: 结果元信息「传了但从不显示」和「参数没生效」是同一族缺陷（collect-rewrite-wordcount）

**现场**：引擎早就会回传 `outputLength` / `outputTruncated` / `modelTruncated`，采集页的 `rewriteViaEngine()` 也**确实**把它们收进了 `meta`（评审 M5 的功劳），但**五个调用点没有一个读 `meta`** ⇒ 稿子被砍尾、稿子被模型截断，界面一律零提示。

**根因**：这类缺陷的共同形状是「**能力已具备，但最后一米没接上**」。它不会让 CI 变红（测试只断言信封透传，不断言界面消费），也不会让用户看到报错（静默退化）⇒ 只能靠「从用户结果倒推链路」的复盘发现。

**可复用的三条**：
1. 凡是引擎/后端已经产出、而某个界面**可能**要展示的字段，接线时要连**消费端**一起锁测试（断言渲染结果，不只断言信封字段）。
2. 分型要分到「用户能据此行动」的粒度：引擎砍尾 ⇒ 调大区间**有效**；模型侧截断 ⇒ 调大区间**不一定有效**——两种都叫「截断」，但给用户的建议相反。
3. 派生值要断言**完整形状**（`toEqual`），不能只断言渲染出的文案：纯函数自身有单测 ≠ 页面上的派生值形状被锁住了（两者之间还隔着写点那一层，字段名一漂横幅就静默失效）。
