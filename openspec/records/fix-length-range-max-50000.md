---
record: fix-length-range-max-50000
task: 长度三档映射的 max 统一提到 50000（与引擎 MAX_OUTPUT_CHARS 对齐）
date: 2026-10-21
---

## 本次执行记录：长度三档上限统一到 50000（fix-length-range-max-50000，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 通过 | 运行时代码变更（Python 后端一个字数常量表 + 两条测试 + PRD/记录文档）：隔离 worktree `<仓库父目录>/mp-worktrees/mp-fix-length-range-max-50000` + 裸分支 `fix-length-range-max-50000`（由 `scripts/start-mp-task.ps1` 创建，基线 = `origin/main` = `8da929484`）；共享主目录始终留在 main，未直推 main |
| 第一性原因（QM-5 ①） | 通过 | `packages/python-backend/src/multi_publish/aggregation/service.py` 的 `_LENGTH_RANGES` 三档 max 是 **3000 / 800 / 5000**——它们是 2026-09-06 `d0a9b00ba`（Phase 1.4，随「长度下拉：保持/精简/扩写」一起进）时定的，那时的全局输出上限还是 **6000**；后来 `rewrite-limits-50000`（2026-10-19）把引擎 `MAX_OUTPUT_CHARS` 放到 50000，**这三档没跟着放大** ⇒ 今天的 `keep` 3000 成了整套体系里最紧的一道「暗上限」（比引擎允许的 50000 紧 16 倍）。数字来历逐条取证：① `keep` (300,3000,1500) = 外部引擎 `content_aggregator_shared` 的 `RewriteConfig` **默认值逐字**（`shared/rewriters/rewriter.py` 的默认字段 min=300 / max=3000 / target=1500）⇒ keep 档语义就是「用引擎默认配置」；② `compress`(100,800,400) 与 `expand`(800,5000,2500) 是该提交里**人工挑的相对档**（以 keep 为轴约缩 1/4、放大约 5/3），该提交**没有记录推导过程** |
| 逃逸分析（QM-5 ②） | 通过 | ① 三档 max **不经过** `RewriteRequest` 的 `ge/le` 校验（那是 `min/max_word_count` 字段的约束，length 是三档枚举）⇒ 3000/800/5000 长期无人拦；② 引擎侧 `MAX_OUTPUT_CHARS` 早在 2026-10-19 放到 50000，但**三档是另一处常量**（`service.py`），两处不同步 ⇒ 看起来"引擎支持 5 万字"、实际走 length 路径最多 3000；③ 用户侧无感（知乎收藏批量面板此前没有字数入口 ⇒ 走 length 路径），所以这条暗上限从未被暴露。**注意：这三档不是死路径**——`apps/desktop/src/views/AutoPipelineView.vue` 的「长度」下拉（保持原文 / 精简 / 扩写）直接下发 `keep`/`compress`/`expand`，是**有活 UI 的**用户选项 |
| 修复 + 回归保护（QM-5 ④） | 通过 | 三档 max 统一提到 **50000**（与引擎 `MAX_OUTPUT_CHARS` 对齐）：`keep` (300,50000,1500) / `compress` (100,50000,400) / `expand` (800,50000,2500)。**target 保持原值**——它才是 prompt 里「目标 N 字」的锚（实际篇幅的落点），max 只是硬上界；改 max = 解除人为上限，改 target 才会改变实际篇幅（那是另一件事）。代码里补上**数字来历的注释**（让下一个改这里的人知道这三个数从哪来、为什么当初没跟着 50000 走）。回归：既有 `test_length_ranges_mapping` 同步更新 + **新增** `test_length_ranges_max_aligned_with_engine_output_cap`（三档 max 均 == 50000，且 min ≤ target ≤ max 的关系不被破坏） |
| 防止再次发生（QM-5 ⑤） | 通过 | ① 数字来历写进代码注释（外部引擎默认值 / 人工相对档 / 历史 6000 字上限的时代背景），不再靠"考古"；② 新增用例把「三档 max 必须 == 引擎上限」**钉成可执行契约**——将来谁再把 max 写小（或引擎上限再变），这条用例会红；③ PRD 记录推导依据与"target 才是篇幅锚"这条区分 |
| 行尾与 diff 对账 | 通过 | `git diff --cached --numstat` 与 `git diff --cached --ignore-cr-at-eol --numstat` 两口径相等 |
| 接线棘轮 | 通过 | 本次**未新增测试文件**（只扩既有 `packages/python-backend/tests/test_aggregation.py`）⇒ 不触发接线棘轮 |
| QM-1 打包 / QM-4 视觉 | N/A | 纯 Python 常量 + 测试 + 文档，无打包配置、无 UI 变更 |
| QM-6 CCG 双模型外部评审 | 待读数 | 深审运行中（`sh scripts/deep-review.sh`），结论落地后回填本行并补「外部评审争议」小节 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

### 遗留（不假装已闭合）

- **三档的 `target` 仍是固定值，与原文长度无关** ⇒ `keep` 档名为「保持原长」，实际却把 5000 字原文压到 1500、把 300 字短文撑到 1500。
  这是 `length` 三档的**语义错位**（遗留自 v1 引擎），修它要动 target 推导（需要原文长度），
  属独立排期；本片只解除**上界**这一处，不越界改篇幅语义。
- **显式区间路径不受影响**：用户设了区间时走 `min/max_word_count`（主 PR 的新面板），
  target 由 `_resolve_target_word_count` 推导（`min==0` ⇒ 与原文相当），与三档无关。
- **`compress` / `expand` 的档位推导无记录**：2026-09-06 的人工相对档没写下来源，
  本片只把「来历」补进代码注释，「为什么是 1/4 和 5/3」本身仍不可考。

## CHANGELOG 条目

# fix(deps): 长度三档映射的 max 统一提到 50000，与引擎输出上限对齐（fix-length-range-max-50000）

- **改前**：`_LENGTH_RANGES` 三档的 max 是 **3000 / 800 / 5000**——那是 2026-09（全局输出上限还是 6000 字时）定的，
  引擎在 `rewrite-limits-50000`（2026-10-19）把上限放到 50000 后**它们没跟着放大** ⇒
  走 length 路径的改写最多只能出 3000 字，成了整套体系里最紧的一道「暗上限」。
- **改后**：三档 max 统一 **50000**（与引擎 `MAX_OUTPUT_CHARS` 对齐）：
  `keep` (300,50000,1500) / `compress` (100,50000,400) / `expand` (800,50000,2500)。
  这三档是**有活 UI 的**用户选项（自动流水线视图的「长度」下拉：保持原文 / 精简 / 扩写）。
- **target 保持原值**：它才是 prompt 里「目标 N 字」的锚（实际篇幅的落点），max 只是硬上界——
  改 max 解除人为上限，改 target 才会改变实际篇幅（那是另一件事，本次不做）。
- **数字来历已写进代码注释**（免得下次再考古）：`keep` 的 (300,3000,1500) 是外部引擎 `RewriteConfig` 的
  **默认值逐字**；`compress`/`expand` 是 2026-09-06 `d0a9b00ba` 里人工挑的相对档（以 keep 为轴约缩 1/4 / 放大约 5/3），
  该提交未记录推导过程。
- **回归**：新增用例把「三档 max == 引擎上限」钉成可执行契约，将来谁写小就红。

## learnings

### lesson: 「多套上限」并存时，放宽一处不会自动放宽另一处（fix-length-range-max-50000）

**现场**：引擎的 `MAX_OUTPUT_CHARS` 在 2026-10-19 放到了 50000，但 Python 后端 `_LENGTH_RANGES`
三档的 max 还停在 3000/800/5000。看起来「系统支持 5 万字」，实际走 length 路径最多 3000 字。

**根因**：这两处是**不同的常量、不同的判据面**（一个是引擎的 RewriteConfig 字段上界，一个是 Python 侧按
length 枚举查表查出来的值），**没有一处判据检查它们是否同步**。上界放宽这类改动天然只改"权威那一处"，
而依赖它的地方要靠人去记得跟上。

**可复用的三条**：
1. 改「上界/上限/阈值」类常量时，**先找出所有消费它的表**（本仓：引擎常量 ↔ Python 三档 ↔ 渲染层 `rewrite-engine-limits.js`），
   逐个对齐；只改权威那一处 = 制造暗上限。
2. 把"必须同步"写成**可执行契约**：本片新增一条用例断言三档 max == 引擎上限，
   将来谁写小就红——比在文档里写"记得同步"可靠。
3. 区分**硬上界**与**实际落点**：max 是硬上界，target 才是篇幅的锚。
   放宽 max 解除人为上限；想让稿子真的变长，要动 target——两件事，别混。
