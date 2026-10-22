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
| opencode i1 / i6 | 契约测试硬编码 `50000` 却声称「与引擎上限对齐」；引擎上限合法上调时会先红且报错指向档位而非真因 | **已修**：改为**直接读**仓内权威源再比对，钉的是**对齐关系**而非字面值。**且补到三方**：① 引擎真源 `packages/rewrite-engine/src/rewrite-engine-core.js` 的 `MAX_OUTPUT_CHARS`、② 渲染层镜像 `apps/desktop/src/utils/rewrite-engine-limits.js` 的 `REWRITE_ENGINE_MAX_OUTPUT_CHARS`、③ Python 三档 `_LENGTH_RANGES[*][1]` —— 少钉一处 = 留一处新暗上限（JS 侧结构锁只保证 ①②，本片把 ③ 纳入）。读法与仓库既有先例同构（`rewrite-engine-limits.test.js:31`）。**双向反证**：改 ① ⇒ 变红、改 ② ⇒ 变红、还原 ⇒ 变绿 |
| opencode i4 | 溯源散文在代码注释与测试 docstring **双份**，必然漂移 | **已修**：完整溯源只留 `service.py` 的 `_LENGTH_RANGES` 注释一处（单一真源），测试 docstring 与 PRD 只引用它 |
| claude i4（第一轮）/ opencode i2 | 需补「`max` 有运行时消费方」的证据链，否则改动可能是空操作 | **已修**：`service.py` 注释补上消费链（`max` → `RewriteConfig.max_word_count` → 引擎 prompt 的字数区间；引擎**不按 max 截断**、只回真实产出字数） |

**驳回（11 条，附取证）**

| 来源 | 争议 | 驳回依据 |
|---|---|---|
| claude i1 / i2（第一轮） | `.ccg/reviews/*.json` 的 `changedLines:62` / `fileCount:4` 与实际 diff（456 行 / 5 文件）不符 | 判定器口径本就**只统计代码行**（文档行单列、`.ccg/**` 产物被 `isSelfArtifact` 排除）⇒ 62 行 / 4 文件是该口径下的**正确值** |
| claude i3 / i5 / i8（第一轮） | 注释里嵌外部依赖出处、注释块过长、测试注释新旧 max 混杂 | 注释长度与位置属**风格偏好**，不构成正确性/安全/性能缺陷；「数字来历写进代码注释」是本片 QM-5 ⑤ 的明确要求 |
| claude i6（第一轮） | `.ccg/reviews/*.json` 的 `deepReview.status` 仍是 `pending` | 评审状态由评审链在**裁决填完并重跑后**回写，不是代码改动的问题 |
| claude i7（第一轮） | `openspec/records/*.md` 混入过程性元笔记 | 记录文件按模板**要求**含 `## learnings` 等小节（QM-5 结构），过程经验本就该落在那里 |
| claude i1 / i2（第三轮） | 评审状态仍是 `self_play_pending`；测试用 `parents[3]` 定位会因包结构变化失效 | 驳回：前者是**流程状态**（裁决填完 + 深审重跑后由引擎回写）；后者**已实测**——`Path(__file__)` 与 cwd 无关（从仓库根跑通过），与仓库既有结构锁同构，且定位失败时 fail-closed 且打印路径 |
| claude i3（第三轮） | `.ccg/reviews` 过程产物被提交进代码 diff | 驳回：`.ccg/**` 是本仓**被跟踪**的评审链产物目录（主干 2977 个文件），门禁正是从版本库读它来判定债务闭合 ⇒ 入库是机制要求 |
| claude i4（第三轮） | `service.py` 注释块 23 行嵌完整溯源散文，易与代码漂移 | 驳回：注释承载的是**不变的历史事实**；真实漂移载体「同一段散文写两处」已消除（溯源只在 `_LENGTH_RANGES` 上方一处），且「数字来历写进注释」是 QM-5 ⑤ 的明确要求 |
| claude i1（第二轮） | 测试用 `parents[3]` 定位引擎源，cwd/仓库深度不同会假失败 | **实测反证**：从仓库根目录跑该用例**通过**（`Path(__file__)` 锚定，与 cwd 无关）；与仓库既有结构锁同构（JS 侧同样读 monorepo 内文件），monorepo 前提成立 |
| claude i4（第二轮，高危域 auth） | 正则解析取得数值，未验证对着的是「活的」权威源，可能静默失配 | **upheld —— 已修**：经**外部后端 claude 独立复核**判定成立（Warning）。复核指出：正则解析不验证「解析到的文件就是当前指定的权威源」；且**生产代码里的 `_LENGTH_RANGES` 必须保留字面量**（Python 运行时无法 import JS 常量）⇒ 正确修法是保持「权威导出 + 跨语言结构锁读取」的既有架构并补强判据。**第二轮复核又指出**：原先那条「resolve 后与自身相等」的断言是**同义反复**（`src = expected` 后 `assert src == expected` 恒真，等于没有保护）⇒ 已改为**三条并列判据**：① 文件存在且 `is_file()`（fail-closed，不静默跳过）；② 数值正则可解析；③ **该常量必须被真正消费**——引擎侧断言 `MAX_OUTPUT_CHARS` 在文件内除定义外还有引用，渲染层侧扫描 `apps/desktop/src` 断言 `REWRITE_ENGINE_MAX_OUTPUT_CHARS` 确有消费点。取证见 PR 公开评论 |
| claude i5（第三轮） | 路径同一性断言依赖 `resolve()`，存在符号链接时行为不可预测 | **upheld —— 已修**：复核成立且**比指控更严重**——那条断言是**同义反复**（恒真、零保护），已按上一条的办法整体替换为「活的权威源」判据（见上）。反证复跑：改引擎真源 ⇒ 变红、改渲染层镜像 ⇒ 变红、还原 ⇒ 变绿 |
| claude i6（第三轮） | 新增测试引入隐式更严格的不变量 `min < target`，未在文档中说明 | **upheld —— 已修**：PRD §4.1 原写 `min ≤ target ≤ max`，测试断言 `0 ≤ min < target ≤ max` ⇒ 文档与实现口径不一致（读者按文档写出 `target == min` 会被测试拦下）。PRD 已更新为 `0 ≤ min < target ≤ max`，并写明**为何下界取严格不等号**（target 是「目标 N 字」的落点，等于 min 会让区间退化成一点、目标失去意义），同时列出三档实际值与契约测试的断言位置 |
| claude i4（第四轮） | 用 `text.count(const_name)` 证明「该常量被消费」是**弱代理**——注释/字符串里的出现会被误计 | **upheld —— 已修**：实测确认——引擎文件里 `MAX_OUTPUT_CHARS` 共 7 次，其中 1 次在**注释行**；旧口径下「定义 1 次 + 注释 1 次」即可凑够 `min_refs=2`，断言沦为假代理；且**子串匹配**还会被影子名字污染（`MAX_OUTPUT_CHARS_UNUSED` 仍包含 `MAX_OUTPUT_CHARS`）。已改为**只数非注释代码行** + **词边界正则** `\b<CONST>\b`；反证实测：把 4 处代码行消费点改名后用例正确变红（打印「在**代码行**里只出现 1 次（至少要 2 次）」），还原后变绿。渲染层消费点扫描同步同一口径 |
| claude i1 / i2 / i3 / i6 / i7（第四轮） | 契约测试不在 CI 白名单；`.ccg` 过程产物入库；跨语言正则依赖；模板路径用反斜杠；23 行历史注释 | 逐条驳回：① i1 **事实属实且已登记为遗留**（见「遗留」小节），但它非本 PR 引入（该文件一直是 CI 白名单外的手动执行文件，本 PR 只扩写既有文件），且接线属改 `.github/workflows/`、须人工过目；② i2 `.ccg/**` 是被跟踪的评审链产物目录（主干 2977 个文件），入库是门禁读债务的前提；③ i3 与仓库既有结构锁同构，且外部复核已确认「Python 无法 import JS 常量 ⇒ 结构锁读取是正确架构」，依赖是显式化而非隐藏；④ i6 该字段由 CCG 引擎自身写回，非本 PR 产物与范围；⑤ i7 注释承载的是**不变的历史事实**，双份漂移已消除，且「数字来历写进注释」是 QM-5 ⑤ 的明确要求 |
| claude i5（第四轮） | PRD 嵌入了完整的对抗评审审计轨迹（11 条被驳回项、opencode/claude 辩论） | 驳回：**实测 PRD 中并无该内容**——PRD 内检索 `upheld\|dismissed\|opencode\|claude\|争议\|驳回` 只命中 1 行，即「外部评审 \| CCG 双家族（opencode + claude） \| 详见执行记录」这一行**指向执行记录的引用**；评审明细全部在 `openspec/records/fix-length-range-max-50000.md` |
| claude i5（第五轮） | `compress` 档 max 提到 50000 后，没验证「压缩产出仍短于 keep/expand」——只测了静态映射，档位语义可能名不副实 | **upheld —— 已修**：三档 max 同值后，区分「精简/保持原文/扩写」语义的**唯一**依据就是 `target`，而此前没有任何断言守住 target 的**相对关系**——若把 `compress` 的 target 调到比 `keep` 还大（每档自身仍满足 `min<target≤max`），三档会名不副实且**现有断言一条都不会红**。已新增**三档 target 单调性**断言 `compress.target < keep.target < expand.target`，并在 PRD §4.1.1 写明该不变式与理由。反证实测：把 compress/keep 的 target 调乱（每档自身仍合法）⇒ 用例**由单调性断言自己**变红（打印「三档 target 的单调关系被破坏」），还原后变绿 |
| claude i1 / i2 / i3 / i5（第六轮） | 未完成的评审记录入库；`parents[3]` 路径脆弱；23 行溯源注释；`rglob` 解析多个 JS 文件增加 I/O | 逐条驳回：① i1 属**流程状态**（裁决填完 + 深审重跑后由引擎回写），且 `.ccg/**` 入库是门禁读债务的前提；② i2 **已实测** cwd 无关、失效时 fail-closed 且打印路径；③ i3 同前几轮取证（历史事实 + 双份漂移已消除 + QM-5 ⑤ 要求）；④ i5 **已实测**——`pytest --durations=3` 显示本用例不在最慢三项（全文件 52 passed 约 11.5s，与加固前持平），且跨目录读取是**有意的**跨语言对齐锁（不读对方源文件就无从判断脱钩） |
| claude i4（第六轮，高危域 auth） | 契约校验靠「读 JS 源码文本 + 正则 + `\bCONST\b` 计数」作为「活的权威源」的**代理**；无编译值检查；影子名字或注释仍可能误计 | **upheld —— 已按外部复核建议处置**：经**外部后端 claude 独立复核**判定成立（Warning）。复核给出的边界：「在『Python 运行时无法 import JS 常量』的硬约束下，当前『引擎源→渲染镜像→Python 三档』三副本对齐 + fail-closed 正则已是本仓最优解」，并明确**不引入** JSON 收敛文件（要改两边读取路径、新增同步点，收益低于成本，且仍解决不了「谁读谁」的活源问题）。处置：① 契约测试 docstring 明确写出「这是**文本级代理**，不是编译值验证」，并列三道补偿（本用例 fail-closed + 剔注释 + 词边界 + 只认生产代码消费点；JS 侧既有结构锁 `rewrite-engine-limits.test.js` 作**第二道闸**——它在 Node 侧真正 import 那个模块、验证的是「值本身」；反证逐条实测）；② **额外加固**：消费点扫描原先会把 `*.test.js` 也算作消费方（证明力会退化成「有个测试在用它」），现已排除测试文件、**只认生产代码消费点**。取证见 PR 公开评论 |
| claude i5（第五轮） | `compress` 档 max 提到 50000 后，没验证「压缩产出仍短于 keep/expand」——只测了静态映射，档位语义可能名不副实 | **upheld —— 已修**：三档 max 同值后，区分「精简/保持原文/扩写」语义的**唯一**依据就是 `target`，而此前没有任何断言守住 target 的**相对关系**——若把 `compress` 的 target 调到比 `keep` 还大（每档自身仍满足 `min<target≤max`），三档会名不副实且**现有断言一条都不会红**。已新增**三档 target 单调性**断言 `compress.target < keep.target < expand.target`，并在 PRD §4.1.1 写明该不变式与理由。反证实测：把 compress/keep 的 target 调乱（每档自身仍合法）⇒ 用例**由单调性断言自己**变红（打印「三档 target 的单调关系被破坏」），还原后变绿 |
| claude i1 / i2 / i3 / i4 / i6（第五轮） | 路径深度假设；评审状态未回写；跨语言正则会静默失效；23 行注释；opencode 输入超限 | 逐条驳回：① i1 **已实测** cwd 无关、失效时 fail-closed 且打印路径；② i2 属流程状态，由本轮裁决 + 深审重跑闭合；③ i3 JS 重构会触发正则**失配 ⇒ 显式变红**，不是静默失效，且架构已由外部复核确认；④ i4 同前几轮取证（历史事实 + 双份漂移已消除 + QM-5 ⑤ 要求）；⑤ i6 第一次失败已被如实记录并按引擎建议用精简 brief 重跑成功，opencode 输入上限是该**后端**的既知约束，非本 PR 缺陷 |
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

### lesson: 契约测试的三种「假保护」（fix-length-range-max-50000）

**现场**：同一个契约测试被外部评审连续打回三次，每次都是**判据本身不成立**，
不是代码有 bug：① 第一版钉字面值 `max == 50000`；② 第二版加的「同一性断言」是
`src = expected` 后 `assert src == expected`（**恒真、零保护**）；③ 第三版用
`text.count(CONST)` 证明「常量被消费」，会被**注释里的提及**与**影子名字**（`X_UNUSED` 含 `X`）污染。

**根因**：这三种写法都**看起来**在守门，实际守不住；而**自己很难看出"这条断言等于没写"**
——每一轮都是真跑了外部模型评审才抓到的。

**可复用的四条**：
1. 钉**对齐关系**，不钉字面值：读权威源取数值再比对（引擎上限再变时，红的原因是"没跟上"而非"档位写小了"）。
2. 恒真断言是零保护：任何"看起来在验证同一性"的断言，先问「它可能恒真吗」。
3. 计数必须**只数非注释代码行** + 用**词边界正则** `\bCONST\b`。
4. 契约要覆盖**全部副本**（本仓一个上限就有引擎真源 / 渲染层镜像 / Python 侧三份），
   少钉一处 = 留一处新暗上限。

**配套纪律**：写完必须做**反证**（把被守护的事实改坏 ⇒ 用例必须变红 ⇒ 还原 ⇒ 变绿）。
但**反证脚本自己也会骗你**：我第一次反证把常量改名成 `MAX_OUTPUT_CHARS_UNUSED`，
被子串匹配糊弄过去，误判成"契约无效"，实则反证方法有问题 —— 改坏事实时要改成
**完全不含该名字**的标识符。

### lesson: 「主干红」会冻住你的 PR，而它常常不是你的错（fix-length-range-max-50000）

**现场**：本片两个 PR（#4165 / #4208）PR 侧检查全绿（#4165 的 24 项 pass、#4208 零非成功检查），
却连续数小时被判 `check-main-red.js` 的 `rc=2 STOP_MAIN_RED`，一个都合不进去。

**根因**：判据读的是**主干 tip** 的 check-runs —— 只要主干有一条检查是红的（哪怕那条红与你的改动无关、
哪怕 required 的 `Gate Result` 是绿的），它就拦下所有 PR。那条红是
`electron-tests` 的 `local-cover-generator.test.js`（sharp/libvips 在 runner 上返回 -1，
**本地同一份 sharp 渲染正常** ⇒ 环境性问题、非代码 bug），由他人 PR 引入且当时无人修。

**可复用的四条**：
1. rc=2 时**不要**用 `--allow-main-red` 硬闯 —— 该旗标的语义是「本 PR 正是去修那条红的」，
   滥用它等于把「主干红」变成「谁都能往红主干上合」。
2. rc=2 的唯一合法出口是「**有人修 main**」：通常表现为别人推了新 commit（新 tip 会重跑 CI，红可能自己好了）。
   不要自己动手改 workflow/依赖（改「谁来守门」须人工过目，且容易与别人的修复撞车）。
3. 轮询判据时**别在 rc=2 就退出**：rc=2/3/4 都该继续等，只在 rc=0（可合并）/ rc=1（本 PR 新增红）时停。
4. 等待期把自己的 PR 做到 **100% 绿**（CI 全绿、评审闭环、记录齐全），主干一绿就立刻合，
   **不要在等待期里又改代码**（那会让 CI 重跑一轮）。



### lesson: 写完长中文文档，先扫一遍 U+FFFD 再提交（fix-length-range-max-50000）

**现场**：本片执行记录里「改 ① ⇒ 变红、**改** ② ⇒ 变红」的「改」字被写成两个 U+FFFD，
**本地肉眼完全看不出**；是 CI 的 **Gate 12b（文本编码完整性）** 判红，QG Changes 与 Gate Result
连带红 —— PR 白跑了一轮 40 分钟 CI 才暴露。

**修法**（已在本 PR 内修）：补回正确汉字，并改用**一次替换两个**（损坏常是连续两个 U+FFFD，
一次替完）。随后对本次改动的**全部中文文件**扫了一遍 U+FFFD（record / PRD / service.py /
test_aggregation.py，均为 0），scripts/check-text-encoding-integrity.js rc=0。

**可复用的两条**：
1. 任何**长篇中文文档**写盘后、提交前，扫一遍 U+FFFD（用 node 脚本读字节最稳，别在 PowerShell 里硬塞转义）。
2. 编码门禁红且报「新增 1 处编码损坏」时，**先在本地扫对应文件** —— 本地能复现就不用等 CI 跑完 40 分钟。
