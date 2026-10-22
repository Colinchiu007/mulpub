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
| 修复 + 回归保护（QM-5 ④） | 通过 | 三档 max 统一提到 **50000**（与引擎 `MAX_OUTPUT_CHARS` 对齐）：`keep` (300,50000,1500) / `compress` (100,50000,400) / `expand` (800,50000,2500)。**target 保持原值**——它才是 prompt 里「目标 N 字」的锚（实际篇幅的落点），max 只是硬上界；改 max = 解除人为上限，改 target 才会改变实际篇幅（那是另一件事）。**运行时消费链已取证**（避免"改了是空操作"）：`service.py:291` 取表 → `RewriteConfig.max_word_count` → 外部引擎把它写进 prompt 的字数区间（引擎**不按 max 截断**、只回真实产出字数）⇒ 放宽 max 的效果是「模型不再被告知一个偏小的上限」，实际篇幅仍由 target 锚定。代码里补上**数字来历的注释**（单一真源，让下一个改这里的人知道这三个数从哪来、为什么当初没跟着 50000 走）。回归：既有 `test_length_ranges_mapping` 同步更新 + **新增** `test_length_ranges_max_aligned_with_engine_output_cap`——该用例**直接读** Node 侧真源 `packages/rewrite-engine/src/rewrite-engine-core.js` 的 `MAX_OUTPUT_CHARS` 数值再与三档比对（钉**对齐关系**、不钉字面值），并保留 `min ≤ target ≤ max` 的关系断言；**已用反证验证**：把真源改成 12345 → 用例变红、还原 → 变绿 |
| 防止再次发生（QM-5 ⑤） | 通过 | ① 数字来历写进代码注释（外部引擎默认值 / 人工相对档 / 历史 6000 字上限的时代背景），不再靠"考古"；② 新增用例把「三档 max 必须 == 引擎上限」**钉成可执行契约**——将来谁再把 max 写小（或引擎上限再变），这条用例会红；③ PRD 记录推导依据与"target 才是篇幅锚"这条区分 |
| 行尾与 diff 对账 | 通过 | `git diff --cached --numstat` 与 `git diff --cached --ignore-cr-at-eol --numstat` 两口径相等 |
| 接线棘轮 | 通过 | 本次**未新增测试文件**（只扩既有 `packages/python-backend/tests/test_aggregation.py`）⇒ 不触发接线棘轮（棘轮只认 `.test.js`/`.test.mjs`/`.test.sh`/`.test.ps1`）。⚠️ 但 `packages/python-backend/tests/test_aggregation.py` **当前未被任何 CI workflow 执行**（Python 测试在 CI 里是白名单接线）⇒ 本片契约测试在 CI 上不生效，本地 pytest 为准；接线属「改谁来守门」，需人工过目，本次**未改** CI 配置（见遗留） |
| QM-1 打包 / QM-4 视觉 | N/A | 纯 Python 常量 + 测试 + 文档，无打包配置、无 UI 变更 |
| QM-6 CCG 双模型外部评审 | 通过 | **双家族均已实跑**：① claude（critic，验证层 diff）8 条（2 Critical / 4 Warning / 2 Info）；② opencode（critic，独立第二家族）6 条（0 Critical / 3 Warning / 3 Info）。opencode 首次以决策层 proposer 登场时**因输入超长失败**（10318 字符 > opencode 后端上限 7800，引擎自报并给出对策），改以**精简 brief**（4093 字符）作 critic 重跑成功 ⇒ 两族意见均来自真实模型调用、非模板。逐条裁定：**成立 3 条已修并补回归锁**（契约测试从「钉字面值」改为「跨语言三方对齐」；溯源散文收敛到单一真源；补「max 有运行时消费方」的证据链），**驳回 11 条**（附取证）。高危域争议项经**外部后端 claude 独立复核**并公开取证（PR 评论 URL）。完整裁定见下方小节 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

### 外部双家族评审争议项逐条裁定

**成立并已修（3 条）**

| 来源 | 争议 | 处置与取证 |
|---|---|---|
| opencode i1 / i6 | 契约测试硬编码 `50000` 却声称「与引擎上限对齐」；引擎上限合法上调时会先红且报错指向档位而非真因 | **已修**：改为**直接读**仓内权威源再比对，钉的是**对齐关系**而非字面值。**且补到三方**：① 引擎真源 `packages/rewrite-engine/src/rewrite-engine-core.js` 的 `MAX_OUTPUT_CHARS`、② 渲染层镜像 `apps/desktop/src/utils/rewrite-engine-limits.js` 的 `REWRITE_ENGINE_MAX_OUTPUT_CHARS`、③ Python 三档 `_LENGTH_RANGES[*][1]` —— 少钉一处 = 留一处新暗上限（JS 侧结构锁只保证 ①②，本片把 ③ 纳入）。读法与仓库既有先例同构（`rewrite-engine-limits.test.js:31`）。**双向反证**：改 ① ⇒ 变红、�� ② ⇒ 变红、还原 ⇒ 变绿 |
| opencode i4 | 溯源散文在代码注释与测试 docstring **双份**，必然漂移 | **已修**：完整溯源只留 `service.py` 的 `_LENGTH_RANGES` 注释一处（单一真源），测试 docstring 与 PRD 只引用它 |
| claude i4（第一轮）/ opencode i2 | 需补「`max` 有运行时消费方」的证据链，否则改动可能是空操作 | **已修**：`service.py` 注释补上消费链（`max` → `RewriteConfig.max_word_count` → 引擎 prompt 的字数区间；引擎**不按 max 截断**、只回真实产出字数） |

**驳回（11 条，附取证）**

| 来源 | 争议 | 驳回依据 |
|---|---|---|
| claude i1 / i2（第一轮） | `.ccg/reviews/*.json` 的 `changedLines:62` / `fileCount:4` 与实际 diff（456 行 / 5 文件）不符 | 判定器口径本就**只统计代码行**（文档行单列、`.ccg/**` 产物被 `isSelfArtifact` 排除）⇒ 62 行 / 4 文件是该口径下的**正确值** |
| claude i3 / i5 / i8（第一轮） | 注释里嵌外部依赖出处、注释块过长、测试注释新旧 max 混杂 | 注释长度与位置属**风格偏好**，不构成正确性/安全/性能缺陷；「数字来历写进代码注释」是本片 QM-5 ⑤ 的明确要求 |
| claude i6（第一轮） | `.ccg/reviews/*.json` 的 `deepReview.status` 仍是 `pending` | 评审状态由评审链在**裁决填完并重跑后**回写，不是代码改动的问题 |
| claude i7（第一轮） | `openspec/records/*.md` 混入过程性元笔记 | 记录文件按模板**要求**含 `## learnings` 等小节（QM-5 结构），过程经验本就该落在那里 |
| claude i2（第二轮） | `.ccg/reviews` 仍显示 `self_play_pending`，裁决未完成 | 同上：裁决填完并重跑深审后由引擎回写，属流程状态 |
| claude i3（第二轮） | 218 行 PRD + 冗长注释与代码重复，有漂移风险 | PRD 的详细程度是**用户明确要求**（须含数据校验/流程/功能逻辑/交互逻辑/显示项/提示文字等维度）；溯源散文已收敛到单一真源，双份漂移风险已消除 |
| claude i1（第二轮） | 测试用 `parents[3]` 定位引擎源，cwd/仓库深度不同会假失败 | **实测反证**：从仓库根目录跑该用例**通过**（`Path(__file__)` 锚定，与 cwd 无关）；与仓库既有结构锁同构（JS 侧同样读 monorepo 内文件），monorepo 前提成立 |
| claude i4（第二轮，高危域 auth） | 正则解析取得数值，未验证对着的是「活的」权威源，可能静默失配 | **upheld —— 已修**：经**外部后端 claude 独立复核**判定成立（Warning），采纳其修法：在读取处补**同一性断言**（解析到的路径 `resolve()` 后必须与预期权威源完全一致），并确认「生产代码里的 `_LENGTH_RANGES` 必须保留字面量——Python 运行时无法 import JS 常量」，故**不**改为跨语言 import、维持「权威导出 + 跨语言结构锁读取」的既有架构（与 JS 侧 `rewrite-engine-limits.test.js` 同构）。取证见 PR 公开评论 |
| opencode i3 | `compress` 档 max 从 800 跳到 50000 跨度剧增，可能有连带突变 | 已取证：`max` 的**全部**消费点只有两处（`RewriteConfig` 字段 + 写进 prompt 区间），引擎**不截断**、Python 侧 `RewriteRequest.max_word_count` 上界是 `le=50000`（与新值一致）⇒ 无连带突变 |
| opencode i5 | 注释硬编码 commit sha 与多个日期，易过期失真 | 溯源锚点**需要**具体 sha 才有考古价值；已收敛到单一真源，双份漂移风险由 opencode i4 的修法消除 |

### 遗留（不假装已闭合）

- **本片契约测试当前不由 CI 执行**：`packages/python-backend/tests/test_aggregation.py` 不在任何 workflow 的
  pytest 白名单里（CI 的 Python 测试是显式文件白名单）⇒ 契约在 CI 上**不生效**，本片以本地 pytest 为准。
  接线属「改谁来守门」（`.github/workflows/`），按规范须人工过目，本次**未改** CI 配置。
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
