---
record: feat-zhihu-fav-batch-wordcount
task: 知乎收藏批量改写支持字数区间 + 显示改写稿实际字数（并修 Python 目标篇幅中点语义）
date: 2026-10-21
---

## 本次执行记录：知乎收藏批量改写支持字数区间（feat-zhihu-fav-batch-wordcount，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 通过 | 运行时代码（新功能 + 一处语义修正）：隔离 worktree `<仓库父目录>/mp-worktrees/mp-feat-zhihu-fav-batch-wordcount` + 裸分支 `feat-zhihu-fav-batch-wordcount`（经 `scripts/start-mp-task.ps1` 建，基线 = `origin/main` = `05e83ddf1`）；共享主目录始终留在 main 且 clean。**未直推 main** |
| 第一性原因（QM-5 ①） | 通过 | 知乎收藏批量与采集页**不是同一条改写链路**：面板 → `zhihuFavBatchRun` IPC → `zhihu-fav-batch:run` → `rewriteOne()` → **Python** `POST /aggregation/rewrite`，请求体固定 `{content, style, length:'keep', llm}`——**不含任何字数** ⇒ Python 走 `_LENGTH_RANGES['keep']` = (300, 3000, 1500)，长度**写死**、用户改不了；且 Python 的 `max_word_count` 只是 prompt 里的软指令（`content_aggregator_shared._parse_response` **不按 max 截断**）⇒ 用户既改不了长度、也看不见结果多长。这是 #4111 修好采集页后**唯一**遗留的「改写不可控且不可见」链路 |
| 逃逸分析（QM-5 ②） | 通过 | ① 该面板**从来没有**字数入口 ⇒ 「设置不生效」不成立（是「压根没这个设置」），第一直觉容易误判成又一个 #4111 同型 bug；② 长度由 `length:'keep'` 在**主进程**写死、**Python** 回落三档，两处各自合法、拼起来才形成不可控；③ 用户看不到是因为**结果区只显示原文字数**（`item.wordCount`），改写稿字数从未回传（`rewriteOne` 只取 `result_content`，把 Python 已有的 `word_count` 丢了）；④ 顺带发现：面板的摘要调用 `collection.zhihuFav.progressSummary`（**不存在的 key**）⇒ 批量摘要行一直是空的 |
| 修复 + 回归保护（QM-5 ④） | 通过 | 五处：① 面板加字数区间（复用 `WordCountRangeInput` + `useWordCountValidation`，口径单一），非法即禁用按钮 + 早退不发 IPC；② 主进程区间归一后透传为 Python 的 `min_word_count`/`max_word_count`，**缺省/非法则不带字段** ⇒ Python 回落 length 三档（旧行为不变）；③ Python 新增 `_resolve_target_word_count`：`min==0`（不设下限）⇒ 目标 = `min(原文长度, 上限)`（原先用区间中点 ⇒ 短文被要求写 3000 字、长文被砍四成），`min>0` 与 length 三档**完全不动**；④ 改写稿实际字数回传（主进程取 Python 的 `word_count`，码点口径）→ 映射层 → 卡片显示「改写 N 字」（与原文字数**并排**）；⑤ 超出上限的条数计入摘要（**不截断**，只告知——截断=静默丢内容）。回归：主进程/渲染层/映射层/Python 四层共 **12 例**新增（含「非法区间不得下发」「min=0 目标=min(原文,上限)」「min>0 目标仍是中点」「派生值形状」）；既有套件：Python 聚合 **53 例**、桌面端相关 **90 例**、新增文件 **43 例** 全绿 |
| 防止再次发生（QM-5 ⑤） | 通过 | ① 区间**三层各司其职**（渲染层给红字 / 主进程降级旧行为 / Python 裁决越界），失败后果不同、不是两份语义；② 目标篇幅语义抽成 `_resolve_target_word_count` 纯函数并**直接单测**（不再靠整条 service + mock `_lazy_import` 才能测）；③ 主进程 handler 当时 498 行、距 500 天花板只剩 2 行 ⇒ 把「单条改写 + 诊断脱敏 + 区间归一」整体搬成独立模块 `services/zhihu-fav-rewrite.js`（纯搬迁，行为逐字不变），handler 降到 463 行；④ 两个 collection locale 文件**未登记**在 max-lines 账本（>= 500 即阻断）⇒ 新 key 只能并到既有行（496/495 → 498/496）；⑤ 面板区间非法时**既禁用按钮又早退**，程序化调用也带不出去 |
| 行尾与 diff 对账 | 通过 | `git diff --cached --numstat` 与 `git diff --cached --ignore-cr-at-eol --numstat` 两口径相等；新建文件统一 CRLF（与全仓工作副本约定一致） |
| 接线棘轮 | 通过 | 新增 3 个测试文件（`electron/services/zhihu-fav-rewrite.test.js`、`electron/ipc-handlers/zhihu-favlist.wordcount.test.js`、`apps/desktop/src/features/collection/BatchCollectPanel.wordcount.test.js`）均在 workspace 覆盖域（`pnpm -r run test`），`scripts/check-unwired-tests.js` rc=0（域内 114 份测试均已接线）；另扩 2 个既有测试文件（`collection-batch.test.js`、`test_aggregation.py`） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触打包配置；UI 改动只是在既有分组内多一行输入 + 卡片元信息多一段文字，无布局断点变化、无新视觉基线 |
| QM-6 CCG 双模型外部评审 | 见下方「外部评审」小节 | pre-commit 判 mode=dual（变更 > 200 行）⇒ 走 `sh scripts/deep-review.sh`（critic=claude / proposer=opencode 双家族实跑）；逐条处置见下 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

### 外部评审

见本记录 `## CHANGELOG 条目` 之后的「外部评审逐条处置」小节（判据记录与裁决全文落在 `.ccg/reviews/<内容寻址>.json`）。

### 遗留（不假装已闭合）

- **Python 侧不按 max 截断**（`content_aggregator_shared` 的行为，不在本仓）：本片选择**告知**（摘要 + 卡片字数）而非截断。
  若将来要在 Python 侧也做硬截断，必须同时做可见化标记（否则就是静默丢内容）。
- **`length:'keep'` 仍然在请求体里**：Python 的 `validate_length` 要求 length ∈ {keep,compress,expand}，且显式
  `min/max_word_count` 优先于它 ⇒ 留着不影响区间语义，但读者可能误以为它还决定长度（实际不）。
- **不做的**：单条粒度区间（一次批量一个区间）、文案库卡片的超限提示（`copy_library_rewrites` 跨批次持久化，
  把一次性的上限写进去会产生"上周的批次带着上周的上限"的怪味 ⇒ 超限只在当次批量摘要里说）。
- **知乎收藏的另一条通道** `zhihu-favlist:batch-rewrite`（无 UI 消费者）仍走自己的内联 Python 调用，
  **不带**字数区间——它没有 UI 也没有区间可传；若将来恢复 UI，需要同样接上。

## CHANGELOG 条目

# feat(collect): 知乎收藏批量改写支持字数区间，并显示改写稿实际字数（feat-zhihu-fav-batch-wordcount）

- **改前**：知乎收藏批量「采集并改写」的稿子长度**写死**（Python 的 `length:'keep'` → 目标 1500 字 / 区间 300-3000），
  面板**没有**字数入口，用户改不了；改写稿多长也**看不见**（结果区只显示原文字数）；
  而且批量摘要行一直是**空的**（调用了一个不存在的 locale key）。
- **改后**：
  - 面板出现「字数」区间（默认 800-2000，与采集页同一组件、同一校验口径）；非法即红字 + 禁用按钮；
  - 区间真的生效：透传为 Python 的 `min_word_count`/`max_word_count`，**缺省/非法则回落旧行为**（旧客户端不受影响）；
  - `min=0`（不设下限）时目标篇幅改为**与原文相当**（`min(原文长度, 上限)`）——原先用区间中点，
    用户设 0-6000 会让 300 字的短文被要求写 3000 字、5000 字的长文被砍掉四成；
  - 采集结果卡片显示「改写 N 字」，与原文字数**并排**（一眼看出改写后变长还是变短）；
  - 超出设定上限的条数在批量摘要里告知（**不截断**：截断=静默丢内容，本仓理念是可见化）。
- **顺带修掉**：批量摘要一直为空（`collection.zhihuFav.progressSummary` 指向不存在的 key，实际在 `zhihuFavlist` 下）。
- **结构债**：主进程 handler 当时 498 行、距行数门禁天花板只剩 2 行 ⇒ 把「单条改写 + 诊断脱敏 + 区间归一」
  整体搬成独立模块 `electron/services/zhihu-fav-rewrite.js`（纯搬迁），handler 降到 463 行。
- **回归**：四层新增 12 例（主进程区间透传/字数回传/超限计数、渲染层面板契约、映射层派生值、Python 目标篇幅语义）；
  既有套件 Python 53 例、桌面端 90 例全绿。

## learnings

### lesson: 「同一条能力的两条链路」要按**引擎**分，不按页面分（feat-zhihu-fav-batch-wordcount）

**现场**：采集页与知乎收藏批量都叫「AI 改写」，但前者走 Node 引擎、后者走 Python 后端。
#4111 修好采集页的字数区间后，知乎收藏批量成了**唯一**一条「长度写死、且看不见结果长度」的改写链路。

**根因**：把「改写」当成**一个功能**去修，而不是**两条实现**去查。同一个功能名下面可能藏着
不同的引擎、不同的参数契约、不同的长度语义（Node 引擎读 `wordCountRange`；Python 读
`min/max_word_count` 或 `length` 三档），**共用一套「用户设置 → 后端参数」的假设**就会漏掉其中一条。

**可复用的三条**：
1. 修某个功能前，先确认**有几条实现路径**（渲染层 → IPC → 引擎 → 后端），逐条核对参数契约；
   本仓的 `aiRewrite`（Node）与 `aggregationRewrite`（Python）就是两条。
2. 「不可控」和「不可见」是**两个**缺陷面，缺一不可：这次长度写死是「不可控」，字数没回传是「不可见」，
   只修前者，用户仍然不知道结果多长。
3. 面板上的**每个显示项**都要能回答「这个数从哪来」；`word_count` 在 Python 响应里躺着，
   主进程只取了 `result_content` 就把它丢了 ⇒ 显示项缺位往往不是「没做」，是「没接线」。

### lesson: 「目标篇幅」用区间中点，对宽区间天然失真（feat-zhihu-fav-batch-wordcount）

**现场**：显式区间一律用 `target = (min + max) // 2` 当目标篇幅。用户设 0-6000 ⇒ 目标 3000 字：
对 300 字的知乎回答是「要求写 3000 字」，对 5000 字的长文是「砍掉四成」。

**根因**：中点隐含假设「区间是窄的、用户在区间里选一个点」。而 `min=0` 表达的是**「不设下限」**，
不是一个可以取中点的窄区间——它的语义是「别砍我，但也别超过上限」。

**可复用的三条**：
1. 「无下限」这类**否定语义**必须单独设计取值，不能套用「区间中点」这类默认值算法；
   同一仓的 Node 引擎已经踩过同一形状（`min=0` 被渲染成「0 到 N 字之间」，模型照着下限写 → 摘要）。
2. 目标值的推导要**能被单独单测**：本次把它抽成 `_resolve_target_word_count` 纯函数，
   直接测 4 个数（短文/长文/未知长度/有下限），不必 mock 整条 service + `_lazy_import`。
3. 改一个共享函数的语义前，先列清**哪些路径会受影响**：本次只改「显式区间」路径，
   `length` 三档与 `min>0` 的中点语义**一行未动**（有既有测试钉住）。
