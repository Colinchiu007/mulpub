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
| 修复 + 回归保护（QM-5 ④） | 通过 | 四处修复：① 采集页改下发 `wordCountRange` 并删除死键 `targetWordCount`；② 区间改从 `useWordCountValidation` 新增的 `range` computed 取（与红字校验同源，合法下限 0 原样透传，非法区间 ⇒ 早退不发 IPC）；③ 引擎 `min=0` 指令由「0 到 N 字之间」改为「不得超过 {max} 字。目标篇幅约 {target} 字（与原文篇幅相当）；不要把原文压缩成摘要，不得省略原文的信息点」，`target = min(原文码点数, max)`，`min>0` 形态逐字不变；④ 采集页新增「改写后 N 字（原文 M 字）」字数行 + 引擎砍尾/模型侧截断**分型**横幅（复用 `utils/rewrite-truncation.js`，不复制实现）。回归：引擎新增 5 例（W7-W11）、采集页新增 9 例；引擎全量 268 例、桌面端采集/改写相关 116 例全绿 |
| 防止再次发生（QM-5 ⑤） | 通过 | ① 把"用户设的区间"收敛成**单一真源**：`useWordCountValidation` 同时产出红字结论与可下发值，调用方不再自行折算 ⇒ 「合法 0 被 `\|\| 800` 吞掉」这类静默走样在结构上不再可能；② 引擎侧补**整数性**防御（浮点区间不注入指令），使非 UI 调用方（Python 旁路/插件/未来新入口）绕过 UI 校验时也不会把「1.5 到 6000 字之间」注入 prompt；③ 契约键写进测试断言（`userSettings.wordCountRange` 必须存在、`targetWordCount` 必须不存在）⇒ 再有人改键名当场红；④ 页面派生值形状用 `toEqual` 锁住 ⇒ 横幅不会因字段漂移而静默失效；⑤ 旧 PRD（2026-09-12）已加勘误横幅，指明采集页一节过时、合法域已改为 0-49999/1-50000 |
| 行尾与 diff 对账 | 通过 | `git diff --cached --numstat` 与 `git diff --cached --ignore-cr-at-eol --numstat` **两口径逐行相等**；新建的 2 个文件（PRD / 采集页测试）已统一为 CRLF，与全仓工作副本约定一致（`attr=text=auto` 的 checkout 转换），无行尾噪声 |
| 接线棘轮 | 通过 | 新增 `apps/desktop/src/views/Collection.rewrite-wordcount.test.js` 落在 `apps/` 工作区域内，由 `pnpm -r run test` 的 workspace 跑覆盖（`scripts/check-unwired-tests.js` rc=0：域内 113 份测试均已接线）；新增引擎用例落在 `packages/rewrite-engine/tests/`，同一 workspace 跑覆盖 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（改动只涉及改写参数下发、引擎字数指令、结果区元信息与 locale 文案，无打包配置、无视觉基线变更；采集页结果区新增的是纯文本行与横幅，不改布局断点） |
| QM-6 CCG 双模型外部评审 | 通过 | pre-commit 判 mode=dual（变更 367 行 > 200 行阈值）⇒ `sh scripts/deep-review.sh` 实跑 **opencode(proposer) + claude(critic)** 双后端（`--check-deps` 体检：两个后端裸名自检均通过）。critic 给出 4 维度评分（correctness 7 / security 9 / performance 9 / maintainability 6）与 6 条争议项，5 条进入自扮演裁决并**逐条回源码核对**后裁定：**upheld 2 条（i1 引擎整数性、i6 派生物形状）、dismissed 3 条（i2 mock 路径、i3 计数口径、i5 locale 命名空间）**。两条成立项已修并补回归锁；驳回依据逐行可查（`api/publisher.js:44`→`api/electron-bridge.js:113`→`:41-45`；`utils/rewrite-engine-limits.js:23-25`；`locales/zh.js:311` + `i18n/index.js:89-94`），写在 `.adversarial/ccg-deep-1a01a306/adjudication.json` 与 PRD §10 |
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
