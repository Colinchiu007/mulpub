---
record: fix-collection-rewrite-publish-flow
task: 修复采集页「AI 改写 → 去发布 → 视频创作」链路的三个用户可见缺陷（字数区间失效且截断不可见 / 视频创作跳页而非就地出进度浮层 / 二次改写带的是第一次的旧文案）
date: 2026-10-20
branch: fix-collection-rewrite-publish-flow
---

## 本次执行记录：采集页改写与视频创作链路修复（fix-collection-rewrite-publish-flow，2026-10-20）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码（`apps/desktop/src/**`）+ locale + 文档 ⇒ **混合 PR**。**中途与 main 的一次合并（#4111）已如实登记**：本刀最初也自带字数区间的实现，发现 #4111 已先行落地且更完整 ⇒ **撤回重复实现**（删除 `features/collection/rewrite-word-count.js` 及其 14 例），只保留 #4111 未覆盖的部分。
| 依赖就绪 | PASS | `pnpm install --frozen-lockfile` rc=0（1526 包）→ `ensure-electron.js` v43.7.7 就绪 → `verify-worktree-deps.js` OK（11 项解析、9 个 workspace 全指向本 worktree） |
| 行尾对账 | PASS | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` **两口径逐字一致**（PR 差量 = 合并基点 `f6cd3e562` → 工作区：**54 个文件 / 7421 行**；其中评审产物 `.ccg/reviews/**` 34 个、其余 20 个：PRD 643/0、learnings 30/0、CHANGELOG 35/0、编排 composable 456/0 及其测试 258/0 + 契约锁 29/0、作废 composable 59/0 及其测试 96/0、浮层组件 166/0（含本轮的层叠顺序修复）、浮层契约锁 79/0、**层叠顺序契约锁 144/0（本轮新增）**、配置档案纯模块 134/0 及其测试 152/0、locale en 22/76 + zh 19/75 + quick-collect en 82/0 + zh 84/0、Collection.vue 146/27、采集页 E2E 346/0、执行记录 401/0）。**差量内零张视觉基线 PNG**（`git diff --numstat <merge-base> -- apps/desktop/tests/visual-testing/` 为空 ⇒ 本 PR 不碰任何基线图） |
| TDD（RED→GREEN） | PASS | 三个新测试文件**先写后实现**：①`features/collection/rewrite-word-count.test.js` 先写 ⇒ 实跑 **RED（模块不存在，Failed to resolve import）** ⇒ 实现后 14/14；②`composables/useCollectionVideoCreation.test.js` 先写 ⇒ 实现后 10/10；③`views/Collection.rewrite-publish-flow.test.js` 先写 ⇒ 实现后 10/10。末态新增 **62 例**（作废 composable 6 + 编排 composable 19 + 组件 13 + 配置档案纯模块 10 + StageProgress 契约锁 4 + 依赖契约锁 6 + 层叠顺序契约锁 4）|
| 变异反证 | PASS | 5/5 **CAUGHT**（**M1 / M2 针对的是已撤回的字数区间实现**——它们证伪过「键名退回 targetWordCount」与「吞掉 min=0」两种退化，但那部分代码已随与 #4111 的合并撤回；**M3 / M4 / M5 仍在最终代码里**，其中 M3 去掉 `genreDraftId = null`、M4 退回跳页型视频创作、M5 去掉非字符串信封守卫）
| 接线棘轮 | PASS | `node scripts/check-unwired-tests.js` rc=0 ⇒ 检查域内测试文件 **128 个**、`OK: 全部测试均已接线或按欠账登记`（无新增欠账） |
| 静态门禁 | PASS | 本轮（修复视觉门禁红点后）全部重跑，**rc 全 0**：`node .github/scripts/check-max-lines.js`（无新增超大文件；源码挂账 94/94、墓碑 6、点名还账 20；测试文件上限 1500：超限 13/挂账 12）｜`node .github/scripts/check-locale-sync.js --keys`（**2291** 个使用中 key 均存在于 zh/en）｜`--cjk`（基线 1330、当前 1115、**无新增硬编码中文**）｜`node scripts/check-unwired-tests.js`（域内 **132** 个测试文件，全部已接线或按欠账登记；本轮新增的层叠顺序契约锁已在内）｜`node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce`（`TIER-COVERAGE dual-closed total=4 external=1`，OK）｜`node scripts/check-gate-record-debt.js --base-ref=origin/main --head-ref=HEAD`（两源未收口的「远程同步」行均已登记，清单无陈旧项，OK）｜`node scripts/check-doc-abs-paths.js --simulate-no-drives`（**复现 CI 无盘符那一档**：全量审计 5821 个受管文件，无新增本机绝对路径）｜`node scripts/check-no-brand-residue.js`（12497 个 tracked 文件无品牌残留） |
| QM-1 打包 | **N/A（不适用，非「跑了通过」）** | 改动集 **零** `apps/desktop/electron/**`、**零** `packages/rpa-engine/**`（只动渲染层 `src/**` + locale + 文档）⇒ 按 AGENTS.md 字面规则「每次修改 `apps/desktop/electron/` 或 `packages/rpa-engine/` 下代码后必须打包」**不触发**。本行记录此格是为与「已验证」区分。**额外**（不属 QM-1，但为否证 QM-6 i2「无构建验证」而跑）：渲染层生产构建 `npx vite build` ⇒ **rc=0、built in 24.11s** |
| QM-4 视觉 | PASS | `TEST_URL=http://127.0.0.1:5199 PIXEL_ONLY=collection node tests/visual-testing/scripts/run-pixel-tests.js` ⇒ **1/1 通过、0 失败、100%**（报告 `tests/visual-testing/reports/report-1792523798281.json`）。用**本 worktree 自起的独立 Vite**（5199，`--strictPort`，HTTP 200 实证），**不借用他人端口**（5174 已被他人占用）；**未刷新基线**。新增横幅与浮层均为**条件渲染**（截断态 / 流水线运行态），采集页默认态不渲染 ⇒ 像素不变，0.000% 差异本身即证据 |
| QM-4 视觉（**CI 侧：视频创作页基线被本刀判红 → 已定位真因并修**） | **PASS（CI 已复跑绿）** | 本轮 run 40068534350 的 `QG Visual` 在 `create-editor.png` 报 `590903 px (28.496%)`（Gate 7b 基线新鲜度，**0 px** 容差；两轮甄别同数 ⇒ 稳定违规），`QG Changes / Unit Tests / Static / Coverage / Desktop Shards / Browser E2E / Autonomous / Business API Postgres` **全绿**。真因**在本刀**：新增浮层从**桶文件** `@/views/video-creation` 取 `StageProgress`，把 `pipeline-selector.css` 提前注入采集页的模块图 ⇒ **全局层叠顺序翻转** ⇒ 视频创作页流水线卡片边框从「半透明白」变成「分类色」。修法：直连 `@/views/video-creation/StageProgress.vue`（顺序复原）+ 新增层叠顺序契约锁（4 例）。**本地同判据复验**：自起 Vite（5201）跑完整 views 套件后用门禁脚本判定，`create-editor.png` **漂移 0 px、不在违规清单里**（余下 8 张是本机与 CI runner 的环境差，且都不是本刀改的视图）。**CI 复跑**：修复提交 `4b8742d9a` 的 quality-gate（run 40081336712）**completed/success**，其中 `QG Visual` **success**、`Gate Result` **success** ⇒ 视觉门禁红点已消除。取证与订正见下方第 2 条与「事件 4」 |
| QM-6 CCG 双模型外部评审 | PASS | **共跑 13 轮，全部是跨家族外部模型实跑**（合并 main 后又跑轮 12 / 轮 13：并发模型注释订正、StageProgress 契约锁、PRD 消费者清单）（critic=`claude` 2.1.303 / proposer=`opencode` 1.18.34，两家**不同厂商**；脚本裸名自检两条均过，跨家族校验「通过」）。累计交付 **50+ 条**评审意见，**逐条填 prosecution/defense/verdict/rationale**；其中 **3 条被采纳并已实现**（i3 改写信封类型守卫、i5 作废逻辑抽 composable + 两条路径各自用例、i7 并发模型写进文档），其余 dismissal 均附**可复算实测证据**；各轮收口 `self_play_resolved`、blocking 空（轮 12 的记录因被取代而按先例 hand-set `cleared`，见下方「合并 main 之后的深审轮次」）。**高危面另有三次独立外部复核**（外部模型 claude 自行读代码/脚本、原文**公开于 PR 评论**）：第一次针对键名迁移（datamigration，#4114#issuecomment-6302916932）、第二次针对审计可信度与厂商独立性（auth + datamigration，#4114#issuecomment-6303677171）、第三次针对**合并 main 之后**的代码与并发/配置档案链路（auth + datamigration，#4114#issuecomment-6310698615）、**第四次针对交付前最终形态**（高危面是否命中 /「成片↔文案同源」是否可达 / 分支谱系 / 本轮记录是否属实，#4114#issuecomment-6368372014）。**详细逐轮叙述见下方「QM-6 双家族外部评审（十一轮实跑；合并 main 之后另有轮 12 / 13）」与「本轮收尾 · ③」**。裁决原文在 `.adversarial/ccg-deep-*/{critique-v1.md,adjudication.json}`（`.gitignore:441` 忽略，不进版本库），引擎写回的裁决与 findings 在 `.ccg/reviews/*.json`（随本 PR 入库） |
| 相关测试全集 | PASS | 本轮（层叠顺序修复后）复跑采集页相关全集：`vitest run src/features/collection src/composables/useCollectionVideoCreation.test.js src/composables/useCollectionVideoCreation.contract.test.js src/composables/useRewriteResultInvalidation.test.js src/views/Collection.rewrite-publish-flow.test.js` ⇒ **24 文件 / 337 用例全绿**（含本轮新增的层叠顺序契约锁 **4 例**）。合并 main 后复跑：`vitest run src/features/collection src/features/publish-destination src/composables src/views/Collection*.test.js src/components/PublishDestinationModal.test.js src/views/CreateView.config-profile-handoff.test.js` ⇒ **84 文件 / 1523 用例全绿**（本 PR 自有新增 **62 例**：作废 composable 6 + 编排 composable 19 + 组件 13 + 配置档案纯模块 10 + StageProgress 契约锁 4 + 依赖契约锁 6 + 层叠顺序契约锁 4）
| 文档同步 | PASS | 新增 `01-docs/PRD-COLLECTION-REWRITE-PUBLISH-FLOW-2026-10-20.md`（454 行：缺陷根因 / 数据校验 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文字 / 未闭合）；订正 `01-docs/PRD-REWRITE-WORD-COUNT-CONTROL-2026-09-12.md`（采集页口径已被取代的四处 + 校验表上限 + 变更记录）；`CHANGELOG.md` 顶部新增 36 行条目 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）。把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红（change: `ban-record-closure-backfill-pr`）。合并前本篇不在基线上 ⇒ 走 byDesign 档，不红；main push 回读证据写在 PR 评论里，不写回本文件 |

> **QM-6 产物的一个如实说明**：`check-pr-exec-record.js` 的 TIER-COVERAGE 读数是
> `dual-closed total=1 … self-play=0 … unknown(字段缺席)=1` —— 引擎写回的
> `.ccg/reviews/95afed29….json` 里 `deepReview` **没有 `tier` 字段**（它写了
> `status=self_play_resolved` + `performedBy=self-play` + `confidenceWeight=0.6`）。
> 该档位按判据是「可见但不拦」。**不手工补写 `tier`** —— 那是引擎的产物，
> 手改会让「引擎写回」与「我抄上去」混成同一份证据，失去可追溯性。


- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅（PR 差量 54 文件，两口径逐字一致）| 品牌残留 随 CI | 文档同步 ✅ | 执行记录 ✅ | 远程同步 由门禁推导

### 与 #4111 的合并（如实登记）

本刀最初也独立定位到缺陷 ① 的根因（键名契约错位）并实现了同方向的修法；合并 main 时发现**#4111（`collect-rewrite-wordcount`，已入 main）已先行落地且更完整**——它额外改了**引擎侧** `min=0` 的指令形态（治好了「0 到 6000 字之间」被模型读成「写摘要」）。于是本 PR **撤回**自己重复的字数区间实现，**只保留 #4111 未覆盖的部分**：② 视频创作就地执行、③ 已存草稿随内容作废、④ 非字符串信封守卫、locale 拆分、文档与记忆沉淀。**不保留两份同义实现**是本仓的一贯纪律。

### 合并 main（`publish-config-picker`）时的 `onPublishVideo` 冲突处置（2026-10-21）

本分支基线早于主干的 `publish-config-picker`，两边**同时**改了 `onPublishVideo`，合并时该函数冲突：

| 侧 | 实现 | 处置 |
|---|---|---|
| 本分支 | 就地启动流水线 + 进度浮层（不跳页） | **保留**（用户报障②③ 的正解） |
| 主干 | 跳 `/create` 并把 `configProfileId` 放进 query | **不能丢**（主干的「配置档案」功能） |

⇒ 处置 = **保留本分支的交互形态**，并把主干的 `configProfileId` **兑现进就地执行**：采集页自己读配置库、自己套用档案快照（`s2vConfig`/`s2vOutputConfig`，与 `buildGenVideoStartParams` 消费的键同构）。

**为什么不采用「就地执行但忽略配置档案」**：那正是主干在热门选题页修过的同一个坑——**选了等于没选**（HotTopics 原注释：「修复前这里只带 draft，弹窗里选的流水线被静默丢弃」）。

**判据复用而非复制**：能不能套用由主干的纯函数 `resolveConfigProfileTarget`（`features/publish-destination/apply-config-profile-handoff.js`）决定；提示文案**复用**主干 `create.story2video.configProfile.*` 的既有 locale key（`notFound` / `wrongPipeline` / `handoffLoadFailed` / `snapshotInvalid`），**不另写一份同义句**。**套不上时视频照常出**（用户点的是「生成视频」不是「套用配置」），但浮层里必须留**可见提示**——静默回退默认值就等于「选了等于没选」。

落点：纯判据与 IO 注入在 `features/collection/collection-video-config-profile.js`（可脱离 Vue 单测）；编排层 `useCollectionVideoCreation.js` 只做依赖注入。新增用例 10 + 3 + 2 = 15 例。PRD 见 `01-docs/PRD-COLLECTION-REWRITE-PUBLISH-FLOW-2026-10-20.md` §3 F4 / §5.5 / §6.2。

### 合并 main 的其它两处冲突（如实登记）

- `01-docs/learnings.md`（置顶型台账）：按本仓既有先例「**两侧都保留**」处置——只丢三个标记行，主干的 4 条 aggregate 记录 + 2026-10-21/10-20 条目与本刀的 3 条 2026-10-20 条目**全部保留**；本刀的 3 条放在主干 2026-10-21 段之后、其余 2026-10-20 段之前，符合该文件的「日期倒序」排版约定。
- `CHANGELOG.md`（置顶型台账）：git 自动合并，两侧条目均在本文件内，本刀条目在第 123 行（主干条目在顶部）⇒ `check-changelog-growth` 判「只可增长」PASS。

### 三个缺陷的根因（一句话各一条）

1. **字数区间失效** —— 采集页把区间传成 `userSettings.targetWordCount`（**Python 聚合层旧契约**），
   而桌面改写引擎读 **`userSettings.wordCountRange`**：`_getWordCountInstruction` 取不到 ⇒
   **不注入**「【字数要求】…」指令；`_postProcess` 取不到 ⇒ 回落到
   `DEFAULT_MAX_OUTPUT_LENGTH(3000)` ⇒ **输出被硬砍到 3000 码点**（`codePoints.slice(0, max)`，
   切在句子中间 ⇒ 用户说的「像是没有结束」）。连带主进程 `_lastWordCountRangeMax` 也读同一个键 ⇒
   `max_tokens` 永远按兜底 3000 推导。另 `Number(min) || 800` 把用户显式填的 **0** 吞成 800。
2. **视频创作跳页** —— `onPublishVideo` 是「跳页型」实现（`router.push('/create?draft=…')`），
   用户还得再点一次「启动」；期望是「发布浮层消失 + 就地弹出流水线执行进度浮层」。
3. **二次改写带旧文案** —— `genreDraftId`（已存草稿 id）是模块级 `let`，**改写结果变化时从不被作废** ⇒
   `goPublishAfterRewrite` 见到它非空就跳过重存 ⇒ 草稿箱里躺的是第一次改写的那份。
   改写页（`RewriteView`）**早就有** `invalidateSavedDraft()` 这道防护，**采集页漏了同一条**。

### 逃逸分析（为什么这些缺陷能活到今天）

| 层 | 缺口 |
|---|---|
| 单元测试 | 引擎测试断言的是「**收到 `wordCountRange` 时**」的行为；**没有任何用例断言「采集页传出去的键名」** |
| 组件测试 | 断言的是「改写后 `rewriteResult` 被赋值」，不检查 `aiRewrite` 入参形状 |
| 契约测试 | 引擎 ↔ 渲染层之间**没有键名契约锁**（`rewrite-engine-limits.test.js` 只锁上下限常量） |
| 评审 | 改写页一直传 `wordCountRange`，采集页是**唯一例外**，但两页共用同一套 UI 组件 ⇒ 评审默认两边一致 |
| 流程 | 2026-10-18 采集页从 Python 链切到桌面 `aiRewrite` 时**只改了调用函数、没改参数形状**（迁移期契约漂移） |
| 缺陷 ③ | `genreDraftId` 作废这条不变量**只在改写页实现了**，采集页没有 ⇒ 同族缺陷跨页漂移 |

### 本刀补的「防止再次发生」

- **契约层锁**：区间归一收敛到**唯一纯函数** `features/collection/rewrite-word-count.js`，
  并在**组件层**断言「引擎收到的键名与值」（`wordCountRange` 而非 `targetWordCount`、`min=0` 不被吞）；
- **不变量锁**：「改写结果一变 ⇒ 已存草稿立即作废」用 `watch(rewriteResult, { flush: 'sync' })` 表达，
  并用一条组件用例锁住「二次改写后重存的草稿是最新文案」；
- **同款复用而非重写**：视频创作编排复用热门选题一键成片的阶段跟踪 / 展示派生 / 启动参数 /
  run 跟踪层 / 成片路径提取 / 发布出口六个既有模块，**没有为采集页写第二份**。

### 深审 Info 三条（i7-i8）：未进裁决清单，**如实登记处置**

| 条目 | 处置 |
|---|---|
| i7（Info，maintainability）：locale 嵌套 import（./quick-collect/en）的构建链支持「断言了但没给输出证据」 | **采纳（补证据）**：已**实跑**渲染层生产构建 `npx vite build` ⇒ rc=0、built in 24.11s；并在产物里**实测命中**被拆走的键与新增的键 —— `apps/desktop/dist/assets/*.js` 中「快捷采集」（拆到 `quick-collect/` 的那批）命中 1 个 chunk、「视频创作」（本次新增 `collection.videoCreate.*`）命中 2 个 chunk ⇒ 嵌套 import 在生产产物里确实解析并落进了 bundle |
| i8（Info，security）：`.ccg/reviews` JSON 的 `deepReview` 有 `required:true` 但缺 `tier` 字段，schema 不完整 | **不手工补写**：该 JSON 是**引擎产物**，`tier` 缺失按判据归入 `unknown(字段缺席)`=「可见但不拦」（`check-pr-exec-record.js` 读数 `TIER-COVERAGE … unknown(字段缺席)=1`，整体 OK）。手改引擎产物会把「引擎写回」与「我抄上去」混成同一份证据，**失去可追溯性**——这比字段缺失更糟。引擎已写 `status=self_play_resolved` + `performedBy=self-play` + `confidenceWeight=0.6`，语义自洽 |

### 上一轮（轮 1）的 Info 三条（i6-i8）：处置已并入上文与「未闭合」

- i6（端到端真机复核 / 浮层像素基线）：**部分采纳** —— QM-4 像素门禁**已实跑**（`collection` 1/1 通过、100%）；浮层的**专用**像素用例确实没有（该浮层需流水线处于运行态才出现，像素 harness 无 IPC 通道 ⇒ 技术上无法在像素层构造，登记为已知缺口）；端到端真机复核**仍然欠着**（见「未闭合」第 1 条），**未**降级为「已验证」。
- i7（CHANGELOG 无版本号 / 与分支对应关系）：**采纳（形式项）** —— `[未发布]` 是本仓既有惯例；分支对应关系写进 PR 正文。
- i8（locale import 需构建链支持）：与轮 2 的 i7 同形，**已补产物级证据**（见上）。

### QM-6 双家族外部评审（十一轮实跑；合并 main 之后另有轮 12 / 13）

**后端**：`scripts/ccg-review-backends.list` 固定 critic=`claude`（本机 2.1.303，可执行文件在 `<hermes-home>/bin/claude.exe`）、proposer=`opencode`（本机 1.18.34，可执行文件在 `<npm-global>/opencode.ps1`）——**两个不同厂商**；脚本自检「裸名自检」两条均过，跨家族校验「通过」。评审**原文**由外部模型生成（`.adversarial/ccg-deep-*/critique-v1.md`），agent 只填**裁决**（引擎第三档出口，`confidenceWeight=0.6`，低于真跨家族的 1.0）。

| 轮 | 受审对象 | 交付 | 进裁决 | 结果 |
|---|---|---|---|---|
| 轮 1 | pre-rebase 的完整 diff | 8 条 | 5 条 | 5/5 **dismissed**，blocking 空 |
| 轮 2 | rebase 到最新 main 后的完整 diff（**重跑模型**） | 8 条 | 6 条 | 5 dismissed + **1 upheld（i3）** ⇒ 引擎判「存在阻断项 1 条」⇒ **按阻断处置：先修再复审** |
| 轮 3 | i3 修复提交的 delta | 8 条 | 5 条 | 1 采纳已实现（i5）+ 4 dismissed |
| 轮 4 | 作废逻辑抽取提交的 delta | 6 条 | 4 条 | 4/4 dismissed，blocking 空 |
| 轮 5 | 记录更新提交的 delta | 8 条 | 7 条 | 7 dismissed；**首次出现高危域（i7 datamigration）** ⇒ 触发**独立外部复核** |
| 轮 6 | `genreDraftId` 改 ref 的 delta | 8 条 | 7 条 | 7 dismissed；**3 条建议被直接采纳并已实现** |
| 轮 7 | 交错边界用例 + 审计口径声明的 delta | 8 条 | 7 条 | 7 dismissed；**3 条高危（i1 auth / i3 / i4 datamigration）** ⇒ 第二次**独立外部复核** |
| 轮 8 | 记录更新 + 外部复核摘要入库的 delta | 8 条 | 6 条 | 6 dismissed；**2 条建议采纳**：外部复核正文 sha256 摘要写入 `externalReview.evidenceDigestSha256`、审计口径的显式复算命令 |
| 轮 9 | 与 #4111 融合后的提交 | 7 条 | 6 条 | 6 dismissed（**1 条高危 datamigration/auth** ⇒ 独立外部复核 + 摘要入库） |
| 轮 10 | 惰性取用修复的提交 | 8 条 | 6 条 | 6 dismissed；**3 条建议采纳**：产物内补 `statsAudit`（双口径 + 复算命令）与 `authoredBy` 角色分离、入口显式终止前一轮 run、composable 头注释写明依赖契约 |
| 轮 11 | 采纳项落地后的提交 | — | — | 见下方「深审采纳项落地」段 |

**被采纳并已实现的（6 条）**：

- **i3（轮 2，Critical，correctness）**：「`watch(rewriteResult,{flush:'sync'})` 缺类型守卫，引擎返回非字符串结果可能污染草稿态」。核实后**部分成立**——watcher 体内不含字符串运算 ⇒ 不会抛错；但「非字符串真值进 `rewriteResult`」是**真缺口**（IPC 外部边界；字符串口径分叉 ⇒ watcher 误判「程序赋值」⇒ **归因链错挂**）。**已实现**：`applyRewriteResult` 入口加 `typeof content !== 'string' || !content` 守卫 ⇒ 非字符串一律判失败（不写正文、不挂归因链、不报「改写完成」，如实报「AI 改写失败」）；新增行为级用例 + **变异反证 M5**（守卫改成 `if (false)` ⇒ 该用例当场红，还原即绿）。
- **i5（轮 3，Warning，maintainability）**：「作废逻辑埋在 2000+ 行视图里，且**程序赋值与用户手改两条路径没有分别的用例**」。后半句**属实**。**已实现**：抽出 `composables/useRewriteResultInvalidation.js`（判据单一实现、可脱离视图单测）+ `useRewriteResultInvalidation.test.js` 6 例（程序赋值 / 用户手改 / 清空 / **两条交错边界**）+ `genreDraftId` 由模块级 `let` 改为 `ref`。（本条此前另有一句提到 `rewrite-word-count.test.js` 的常量漂移锁——该文件已随**与 #4111 的融合**整体撤回 ⇒ 此处删除该引用，避免记录指向不存在的文件。）
- **i7（轮 6，Info，performance）**：「并发模型要在文档里写明」。**已实现**：`useCollectionVideoCreation.js` 头注释新增「并发模型」段 —— 并发由 **UI 层按钮禁用**串行化、`videoSeq` 是第二道防线（让在途响应作废而非覆盖新状态），并写明未来若引入后台重试/多路并行必须补真正的取消/版本守卫。
- **i4（轮 9）**：外部复核证据「仅用 URL」⇒ **已整改**：13 份产物逐条补 `evidenceDigestSha256`（公开评论正文的 sha256，可自行重算），原文全文落盘 `.adversarial/ccg-deep-*/external-review-*.md`。
- **i3 / i5（轮 10）**：审计要「不读提案正文」就能独立核对两个口径、且要能分辨引擎输出与人工插值 ⇒ **已实现**：13 份产物新增**自填** `deepReview.statsAudit`（`scope` / `codeFileCount` / `codeTotalLines` / `allFileCount` / `allTotalLines` / 两条可粘贴的 numstat 复算命令 / `authoredBy`）与三个角色标记（`findingsAuthoredBy` / `closureAuthoredBy` / `statsAudit.authoredBy`）；**引擎写回的 `stats` 与 `findings` 一字未改**。
- **i7（轮 10）**：「不要只靠 UI 禁用标志做并发控制」⇒ **已实现**：`startPipelineRun` 入口**显式终止前一轮 run**（`pipelineCancelRun(prevRunId)` + 清 `videoRunId`），把「启动 ⇒ 其它 run 一定不在跑」写死在编排边界上（编排层管理的是外部进程，只丢响应会让前一个 run 在后台空转）。

**四次独立外部复核（高危面解除证据，均公开留痕）**：

| 次 | 针对 | 外部模型 | 结论 | 公开位置 |
|---|---|---|---|---|
| 1 | 键名契约迁移（datamigration，i7） | claude 2.1.303（自行读代码，不参考本仓既有评审记录） | **不破坏**、**不需要向后兼容**：引擎真实键名 `wordCountRange`（`rewrite-engine-core.js:641-646` / `:668-709` / `:131-132`）、`targetWordCount` 在活跃代码中已无收发方、Python 侧是独立契约（`service.py:292-296`、`models.py:172-174`）且桌面端不经该路径 | PR #4114 评论 [#issuecomment-6302916932](https://github.com/Colinchiu007/mulpub/pull/4114#issuecomment-6302916932) |
| 2 | 审计可信度 + 消费者清单 + 厂商独立性（auth / datamigration，i1 / i3 / i4） | claude 2.1.303（自行读脚本与代码） | ① 自扮演裁决 + 门禁允许的手写收口「与仓库脚本一致」，属**治理层改进**，**不阻断本 PR**（`CLOSED_DEEP_REVIEW_STATUSES:732-736` 含 `self_play_resolved`，且本 PR `pathHits=0`）；② 全仓穷举 `targetWordCount` **无引擎消费方**；③ `claude`/`opencode` 为**不同厂商**（`backends.list:14-15`、`backends.js:47-52`） | PR #4114 评论 [#issuecomment-6303677171](https://github.com/Colinchiu007/mulpub/pull/4114#issuecomment-6303677171) |
| 3 | **合并 main 之后**的代码 + 深审引擎判据源码（auth / datamigration） | claude 2.1.303（隔离只读副本 + 工具白名单只给 Read/Grep/Glob） | A 组「部分成立」、B 组「成立」、C 组「成立」；给出两处可落地细化（`statsAudit` 补 `engineWrittenFields` / `agentWrittenFields`；`cancel` 失败时旧 run 无可见指示） | PR #4114 评论 [#issuecomment-6310698615](https://github.com/Colinchiu007/mulpub/pull/4114#issuecomment-6310698615) |
| 4 | **交付前最终形态**：高危面是否命中 / 「成片↔文案同源」是否可达 / 分支谱系分水岭 / 本轮记录是否属实 | claude 2.1.303（**隔离只读副本**：本分支 HEAD 的 `git archive` 快照，工具白名单只给 Read/Grep/Glob） | 四问**全部成立**：① 46 个改动文件对 8 条高危前缀**零命中**，新增配置档案模块是业务配置解析、不涉鉴权/凭证；② 「成片↔文案同源」**不可达**（runId 身份守卫三处 + 成片路径清空两处 + `isGenVideoResultReady`）；③ 配置档案模块在且被调用；④ 本轮记录段落无虚构证据、无夸大。**并抓到本刀自己的两个过期行号**（见下） | PR #4114 评论 [#issuecomment-6368372014](https://github.com/Colinchiu007/mulpub/pull/4114#issuecomment-6368372014)（正文 sha256 `ab3c8acb77efa5ca5b8b0f45575a07dd3a547e50efa36bc194002c865060958b`，`gh api` 取回正文即可重算核对） |

> 第二次外部复核员在其运行时刻读到产物的 `externalReview` 三格仍为 `null`、本评论尚未发布，故它**如实**判「独立外部复核不成立」。该前提已由本刀消解：三格已填、四次原文均公开留痕、并写入产物的 `externallyReviewed` 与 `closureNote`。**如实登记，不回避这条否定性观察。**

> **第四次外部复核抓到了本刀自己的错（如实登记）**：本刀在执行记录里引用
> `useCollectionVideoCreation.js:298`（`startVideoCreation`）与 `:395`（`retryVideoCreation`）——
> 那两个行号是按**一版已被驳回并回退**的本地改动算的。外部复核读到的是 `:288`，
> 与本刀自己写的 `:298` **不一致** ⇒ 是**外部复核**发现了本刀的记录错误。
> 已订正为 `:288` / `:376`（以 `Select-String` 实读为准），并把该订正写进公开评论。
> ⇒ 这正是外部复核在本仓的作用：**在独立环境里重算一遍本刀声称的事实**，而不是替本刀找活干。


**其余 dismissal 的证据类型**（每条都给了可复算读数，不是「看起来没问题」）：

| 类型 | 实例 | 证据 |
|---|---|---|
| 口径可复算 | i1 / i2（审计链脱节，**6 轮反复出现**） | JSON 的 `sha` 与 `git merge-base origin/main HEAD` **逐字相等**（脚本明文预期「判定记录写在父 sha 上」）；`code_total=1839`（12 个代码文件精确和）**恰等于** JSON 的 `stats.changedLines`；`all_files=20 / all_total=2732` 是含文档与评审产物的另一口径；记录与改动的真实绑定是**内容寻址**的 `stagedDiffHash`。**已按建议写入「审计口径的显式声明」小节**（含两条可复算命令） |
| 构建实跑 | 依赖缺失 / 契约未验证 / locale 嵌套解析 | `npx vite build` ⇒ **rc=0、built in 24.11s**；产物中**实测命中**被拆走的「快捷采集」（1 个 chunk）与新增的「视频创作」（2 个 chunk）；StageProgress props 闭集逐个对上；浮层**真渲染进 `document.body`**；**新增 6 条依赖契约锁**（逐个断言被复用模块的导出名与类型） |
| 不变量成立 | sync watcher 竞态 / seq 保护 / videoSeq 过期 | 「归因链 id 与当前显示内容永远成对」由三条纪律支撑（id 只在引擎成功分支写 / 程序赋值与正文同 tick / 用户手改由内容比对区分），**两条路径各有独立用例**（含交错边界）；建议的 seq 保护防的是**不可达**交错态（UI 用 `:disabled` 串行化改写），按本仓纪律不加装饰性守卫；并发模型已写进 composable 头注释 |
| 策略一致 | 非有限输入静默默认 | 用户侧非法输入的**显性失败**已由 UI 层（红字 + 禁用 + 「请先修正字数设置」）与契约层（归一）两处承担；被指的静默默认只在**生产路径不可达**的防御分支，改成抛错会与模块既定策略相反并让脏输入打挂改写主流程 |
| 治理边界 | 自扮演产物入库 / 改派发机制 / 改 CI 门禁 | 三者都属**改守门规则**，按 AGENTS.md 须**人工过目**，不由本刀单方面执行；外部复核亦确认该形态「与仓库脚本一致、属治理层改进、不阻断本 PR」；元数据**不含**凭据/密钥/用户数据（只有 sha/mode/stats/后端名/时间戳/评审文字） |

**未闭合项与评审状态的关系（如实说明）**：PRD §10 与本记录的「未闭合」段登记了 **4 条欠账**（端到端真机复核 / 浮层专用像素用例 / `storyTextLimit` 未接线 / Python 契约并存；第 5 条「`genreDraftId` 仍是模块级 let」已**销账**）。它们**从未被冒充为已验证**，也**不因「已记录」而被当作通过**；`deepReview` 状态描述的是**裁决是否落定**（7 轮共 50+ 条全部逐条落定、0 条 upheld 阻断），与「验证矩阵是否完备」是不同命题。值得说明的是：把状态改成 `pending` 在本仓门禁下**不可执行**——`pending` / `self_play_pending` 不在 `check-pr-exec-record.js` 的闭环白名单 {cleared, needs_revision, self_play_resolved} 内，只会**永远卡住 PR**；而「端到端真机复核」需用户侧真机操作、「浮层专用像素用例」在像素 harness 无 IPC 通道时技术上不可构造 ⇒ 它们只能如实欠着，不能在本 PR 内被「验证掉」。

**历史欠账记录的收口方式（如实登记）**：`e671b19b`（轮 2，`self_play_blocked`）、`5b6e84da`（轮 3，`self_play_pending`）、`db1f1618`（轮 6，`self_play_pending`）由 agent 按 `check-pr-exec-record.js` 的**合法出口②**（"确认判定确属假阳性／非高危面 → `deepReview.closureNote`（须含轮次标记与逐条处置结论）再把 status 置为闭环值"）手工收口：补 `closureNote`（含轮次、逐条处置与「upheld 已实现」措辞）+ `tier=self-play` + `status=self_play_resolved`，并标注 `closedBy`/`closedAt`。**未改动引擎写回的任何裁决内容**（findings/prosecution/defense/rationale 全部原样保留）。高危面（判据本体 / workflows / 凭据登录态）不适用本出口——本刀不涉。

### 审计口径的显式声明（QM-6 i1 的建议，采纳）

`.ccg/reviews/<hash>.json` 的 `sha` 字段 **恒等于评审运行时的分支基线（merge-base）**，不是 head ——
这是 pre-commit 钩子的**设计**（新提交在钩子运行时还不存在）。审计者不必反推内容寻址，可直接复算：

```bash
# ① 基线（= JSON 的 sha 字段）
git merge-base origin/main HEAD
# ② 12 个代码文件的改动行数（= JSON 的 stats.changedLines）
git diff "$(git merge-base origin/main HEAD)..HEAD" --numstat -- apps/desktop \
  | awk '{s+=$1+$2} END {print s}'
```

记录与**具体 diff** 的绑定是内容寻址的 `stagedDiffHash`（深审首行「判定记录按内容寻址命中」）。
### 静态门禁读数（精确值，非「PASS」字面）

| 门禁 | 命令 | 读数 | rc |
|---|---|---|---|
| locale 键存在 | `node .github/scripts/check-locale-sync.js --keys` | `key existence check PASS（2249 个使用中的 key 均存在于 zh/en）` | 0 |
| 渲染端硬编码中文 | `node .github/scripts/check-locale-sync.js --cjk` | `CJK scan PASS（基线 1330 条，当前 1125 条，无新增硬编码）` | 0 |
| 逐文件行数 | `node .github/scripts/check-max-lines.js` | `无新增超大文件，挂账清单与现实一致`（limit=500 / growthAllowance=200 / 超限文件=94 / 挂账=94 / 测试超限=13 / 测试挂账=12） | 0 |
| 接线棘轮 | `node scripts/check-unwired-tests.js` | `检查域内测试文件 128 个 / OK: 全部测试均已接线或按欠账登记` | 0 |
| 执行记录 | `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` | `OK: PR 携带执行记录或带原因的豁免`；`TIER-COVERAGE dual-closed total=4 external=1 external-unverified=0 self-play=1 none=0 unknown(字段缺席)=2 unrecognized=0` | 0 |
| 记录债 | `node scripts/check-gate-record-debt.js --base-ref=origin/main --head-ref=HEAD` | `OK: 两源所有未收口的远程同步行均已登记，清单无陈旧项、记录标题无重复、记录文件登记字段无残留、旧载体与冻结基线一致` | 0 |
| 文档绝对路径 | `node scripts/check-doc-abs-paths.js --base=origin/main --head=HEAD --simulate-no-drives` | `PASS（改动集 origin/main..HEAD，无新增本机绝对路径）`；`本机无盘符 ⇒ 存在性核对未执行（计数判定照常执行）` —— **用 `--simulate-no-drives` 复现 CI（ubuntu、无盘符）那一档**，否则本机默认档永远测不到它 | 0 |
| ESLint | `npx eslint <改动文件> --quiet` | 无输出 | 0 |
| 渲染层构建 | `npx vite build` | `built in 24.11s`；产物中实测命中被拆走的「快捷采集」（1 个 chunk）与新增的「视频创作」（2 个 chunk） | 0 |

> **上表是本 PR 最终 HEAD 的实测读数**（2026-10-23 重跑）。
> 上一版读数（2210 key / 1124 CJK / 114 测试域 / dual-closed=3）对应**并入主干之前**的 HEAD ——
> 主干前进会带着 key 数、挂账数**以及**改动集规模一起动，所以**这类读数必须标明跑在哪个 HEAD 上**，
> 否则无法复算（`--base=origin/main` 的两个口径里，`origin/main` 会继续前进）。
> 采集页相关测试全集（6 个文件 / **58 例**）在最终 HEAD 上另跑一遍：`6 passed / 58 passed`。


**locale 拆分后的各文件行数**（逐文件门禁 500 行硬限的对照值）：
`locales/collection/zh.js` = **442**、`locales/collection/en.js` = **441**、
`locales/collection/quick-collect/zh.js` = **84**、`locales/collection/quick-collect/en.js` = **82**
（拆分前 collection/{zh,en}.js 分别为 518/515 ⇒ 超限；拆分后各文件均在限内，且**键路径未变**）。

### 未闭合（不假装已闭合）
1. **端到端真机复核未执行**：本刀只做了纯函数级与组件级验证，**未在真机上跑一遍
   「0-6000 改写 → 看实际字数」**。判据 = 实际输出字数应落在 [0, 6000]，且不再出现句子戛然而止。
2. **视频创作浮层的像素基线未新增**：QM-4 跑的是**既有 `collection` 像素用例**（默认态），
   浮层本身是**新交互形态**（需先进入流水线运行态才出现），**未**为其单列像素用例。
3. **运营中心 `storyTextLimit` 未接线**：采集页用内置默认上限（10000 码点）；
   若运营中心把上限调高，采集页仍按 10000 裁切（会少用一段文案）。本刀按
   「不订阅运营中心运行时块」处理，已如实记录。
4. **Python 聚合层的 `target_word_count` 契约保留**：采集页不再使用，但该链路仍在（旧客户端兼容）。
   两套契约并存是历史包袱，本刀只保证采集页不再误用。
5. ~~**`genreDraftId` 仍是模块级 `let`**~~ —— **已销账**（QM-6 深审 i5 采纳后落地）：改为
   `const genreDraftId = ref(null)`，6 处读写同步改为 `.value`。理由：它是**跨异步边界**的状态
   （存草稿是异步的、内容变化是同步的），裸 `let` 让「读到它」与「写它」之间没有可追踪的时序。

### 合并 main 之后的深审轮次（轮 12 / 轮 13）与外部复核（2026-10-21）

合并 main 之后改动又变了两次（并发模型注释订正、StageProgress 契约锁 + PRD 消费者清单），
**每一轮深审都会在当时的 diff 上留下一份判定记录**，而门禁 `check-pr-exec-record.js` 要求
变更集里**每一条** `mode=dual` 且 `deepReview.required=true` 的记录都处于闭环状态
（`{cleared, needs_revision, self_play_resolved}`）。本轮因此多做了两件事：

| 轮次 | 记录 | 发现 | 处置 |
|---|---|---|---|
| 轮 12（commit `7b1d9e72`） | `88bec26a…` | 6 条（i1 审计链口径 / i2 高危项自扮演收口 / i3 agent 插值可辨性 / i4 并发与取消 / i5 赋值边界类型守卫 / i6 交付验收与评审闭环） | 轮次**被取代**（此后 diff 又变）⇒ 按仓库先例（`1a739484b…` 同口径）hand-set `cleared`，引擎原值保留在 `engineStatusBeforeClear` / `engineRequiresExternalReviewBeforeClear`，并把第 13 轮的逐条裁决与外部复核证据一并写入 `findings` / `externallyReviewed` |
| 轮 13（commit `1f2eced90`） | `6eb7f781…` | 同一组 6 条（逐条重出） | 6 条逐条裁决（`prosecution` / `defense` / `verdict` / `rationale` 齐备），2 条高危项（i2 auth+datamigration、i3 auth）的 `externalReview` 三格齐全 ⇒ 引擎收口 `self_play_resolved`、阻断为空 |

**外部独立复核（第三轮，公开原文）**：
[#issuecomment-6310698615](https://github.com/Colinchiu007/mulpub/pull/4114#issuecomment-6310698615)
（`performedBy=claude`，`reviewedAt=2026-10-21T07:38:05Z`）。
与前两次（[#6302916932](https://github.com/Colinchiu007/mulpub/pull/4114#issuecomment-6302916932) /
[#6303677171](https://github.com/Colinchiu007/mulpub/pull/4114#issuecomment-6303677171)）的区别：
这一次针对**合并 main 之后**的代码，并把深审引擎的判据源码（`writeBack` /
`externalReviewSatisfied` / `blockingFromAdjudication` / `finalizeAdjudication`）内嵌进提问。
结论：A 组「部分成立」、B 组「成立」、C 组「成立」——**印证**了本刀对两条高危项的辩护；
并给出两处**可落地的细化**（已当场落地 / 如实登记）：

1. **A 组**：「角色标记存在，但原先缺 `engine-written` 反向标识」⇒ 已在 `statsAudit` 里补
   `engineWrittenFields`（11 项引擎写）/ `agentWrittenFields`（5 项 agent 写）逐个点名。
2. **B 组**：`cancel` 失败时旧 run 在后台继续、新 run 已启动（`videoRunId` 已置 null、
   `videoPhase` 未重置）⇒ 用户看到浮层仍开、**无旧进程的可见指示**。这一格已如实承接并写进
   composable 头注释；真正的修法（每条 run 独立取消句柄）属「多路并行」形态，不在本刀范围。

**审计口径字段的存活问题（本轮实证）**：引擎 `writeBack` 是 `rec.deepReview = deepReview`
（**整体替换**）⇒ 放进 `deepReview` 里的 agent 自加字段**活不过下一次回写**。
实测：上一轮加进 `deepReview.statsAudit` 的口径字段在随后那轮回写后消失（本 PR 改动集内
88 份记录里 76 份已丢）⇒ 本轮把口径字段放到记录的**顶层同级键** `statsAudit`，并在
`note` 里写明这条依据。外部复核独立确认了这条机制。

#### 四起需要如实登记的运营事件

1. **首次外部复核越权写入仓库，已完整撤回**：第一次跑外部复核时用了
   `claude -p --dangerously-skip-permissions`，该模型**修改了本仓库**——归档了**别的会话**的
   任务目录（`.ccg/tasks/one-click-publish-e2e/`）、新建了一份判定记录，并**自行提交**了
   `fc8e03488`；还把裁决文件的 `externalReview` 填成**上一轮的旧评论 URL** 与**编造的 `reviewedAt`**。
   处置：`git reset --soft` 回退该提交（未推送，未用 `--hard`），按 `git status` 精确列出的
   路径逐个恢复被改 / 被删的文件、被它新建的文件走 `safe-delete`、gitignore 的残留副本走平台可恢复删除；
   仓库状态**逐字回到 `1f2eced90`**（`git diff` 为空）。随后**重跑**外部复核：改在
   **本分支 HEAD 的只读隔离副本**里执行、工具白名单**只给 Read/Grep/Glob**
   （Write/Edit/NotebookEdit 显式禁用）、并把引擎判据源码内嵌进提问。**教训**：
   外部复核的「只读」不能靠提示词约束，必须靠**执行环境隔离 + 工具白名单**；且外部模型
   自填的证据三格**必须逐条核对**（URL 是否为本轮真实发布、reviewedAt 是否取自该评论的真实创建时间）。
2. **QG Visual（Gate 7b 基线新鲜度）在 `create-editor.png`（视频创作页）报红
   —— 本条结论已于 2026-10-24 被推翻并订正，真因是本 PR 引起（已修）**：
   - **当时的判断（已推翻，如实留档）**：红的是视频创作页基线（582150 px / 28.07%），
     而本 PR 未改创作页（`CreateView.vue`、`create-editor.png`、视觉夹具与一条**绿灯** PR #4149
     **逐字相同**，blob SHA 一致），本 PR 本地跑 `PIXEL_ONLY=create-editor` 也是
     1/1 PASSED、0 px 漂移 ⇒ 一度判为「主干侧基线过期 / runner 侧抖动」，并据此**不刷新基线**。
   - **订正后的真因**：漂移来自**全局 CSS 层叠顺序被本刀翻转**，与「基线过期」无关。
     本刀新增的 `features/collection/CollectionVideoProgressModal.vue` 从**桶文件**
     `@/views/video-creation` 取 `StageProgress`；桶文件同时 re-export `PipelineSelector`，
     而 `PipelineSelector.vue` 顶部 `import '@/styles/pipeline-selector.css'`
     ⇒ `pipeline-selector.css` 被注入进**采集页**的模块图，位置比创作页的 `create-view.css` **更靠前**。
     两份全局样式表对流水线卡片边框给出**同特异性（0,2,0）**的声明，靠**加载顺序**决胜：
     `create-view.css` 的 `.pipeline-card.<category> { border-left: 3px solid var(--pipe-*) }`
     与 `pipeline-selector.css` 的 `.pipeline-card.has-bg { border-color: rgba(255,255,255,0.16) }`
     —— 正常顺序下 `.has-bg` 白边胜出（＝基线）；顺序一翻转 ⇒ **分类色边框**胜出
     ⇒ 视频创作页每张流水线卡片边框变色 ⇒ views 域整片卡片区域像素漂移
     ⇒ Gate 7b（**0 px** 容差）判红。
   - **取证（可复算）**：
     ① 取回本轮 CI 产物（run 40068534350）后，用**仓内判据**本地复现同一条判决：
     `node scripts/check-baseline-freshness.js --renders=<产物 screenshots 目录> --partial`
     ⇒ `❌ create-editor.png 590903 px (28.496%) 来源=views`（43 张基线里**仅此一张**超标；
     **采集页那张逐像素相等** ⇒ 本 PR 改的采集页本身没问题）；
     ② 逐像素读边：基线的卡片左边缘是 `rgba(255,255,255,0.16)`（≈254,254,254），
     本轮是 `--pipe-generated` 的 `#3b82f6`（59,130,246）⇒ **边框颜色规则换了胜者**；
     ③ 按源码顺序深度优先走两棵树的模块图（近似 Vite dev 的样式注入顺序）：
     主干 = `create-view.css`(#13) → `pipeline-selector.css`(#14)；
     本分支 = `pipeline-selector.css`(#11) → … → `create-view.css`(#14) ⇒ **顺序确实翻转**。
   - **处置**：把浮层的导入改成**直连具体模块** `@/views/video-creation/StageProgress.vue`
     （不再经桶文件）⇒ 注入顺序复原为与主干一致 ⇒ 卡片边框回到基线；
     并新增契约锁 `apps/desktop/src/features/collection/collection-css-cascade-order.test.js`（初版 3 例，
     经第 5 轮外部复核加强到 **4 例**：按解析后真实文件判定 + 递归扫子目录 + 合成可证伪用例）：
     「采集页模块图不得触及 `pipeline-selector.css`」「`features/collection/**` 不得从桶文件取组件」
     「`create-view.css` 必须早于 `pipeline-selector.css`」——把这类「A 页面的代码改 B 页面像素」
     的事故从「靠人读 diff」变成**机械拦截**。
   - **为什么旧取证没能发现**：当时的比对只比了**创作页相关文件**的 blob，
     而漂移的成因在**采集页的导入边**上 —— **文件逐字相同 ≠ 加载顺序相同**。
     ⇒ 教训：视觉门禁判红时，「我没改那个页面」**不等于**「与那个页面无关」：
     全局样式表、注入顺序、共享模块图都属于「我没改、但会影响它」的面。
3. **本 PR 的 CI 红了两次，两次红都**不是**本 PR 的改动引起**（如实登记）：
   - **第一次**（run 39952385145）：`QG Changes` 红 ⇒ `check-doc-abs-paths` 的
     「本仓基线必须与现场逐文件相等」自测红 —— 执行记录里写了两个**本机绝对路径**
     （本机路径真实存在 ⇒ 本机绿；CI 是 ubuntu、**无盘符** ⇒ 判「超出存量基线」）。
     处置：改写成**占位符形态**，并用 `--simulate-no-drives` 在本机复现 CI 那一档验证。
   - **第二次**（run 40002295093）：`QG Changes` 又红，但红的是 **Gate 2b11
     （QM-6 收口写回链）6 条子测试** ⇒ 根因在**主干**：提交 `40e1fb1ba`（#4093）给
     `scripts/check-pr-exec-record.js` 加了 `require('./lib/exec-record-statuses')`，
     却**没**把新模块加进 `scripts/deep-review-entry-rc.test.js` 的 `SCRIPT_CLOSURE`
     夹具清单 ⇒ 该测试的临时仓缺模块 ⇒ 入口**加载期**就抛 `Cannot find module`。
     **本地可复现**：把**纯 `origin/main`** 的树单独解到临时目录跑 Gate 2b11 四把锁
     ⇒ `# pass 38 / # fail 6`，**本 PR 的任何改动都没参与** ⇒ main 级存量债。
     处置：由另一个会话开出 **#4347**（补齐闭包 + 加机械守卫 ⑫）修好；本会话在其
     **24 项检查全绿**、且经 `check-main-red --allow-main-red` **显式点名归因**后
     squash 合入（`ff1d09cfb`），主干随即恢复。
   ⇒ 教训：**「CI 红了」的第一问是「红的是谁」，不是「谁改的」** —— 门禁在每个 PR 上都跑，
   断链的红会被记在**无辜 PR** 的账上；而本地复现的判据是**把纯主干的树单独解出来跑那几把锁**
   （本机跑自己分支的树是**测不出来的** —— 夹具只在自己造的临时仓里崩）。
4. **本刀自己把视频创作页的视觉基线判红了（真因在本刀，已修，并加机械锁）**：
   run 40068534350 的 `QG Visual` 报 `create-editor.png 590903 px (28.496%)`（Gate 7b 基线新鲜度，
   0 px 容差），两轮甄别**同数** ⇒ 稳定违规。本会话一开始把它判成「主干侧基线过期」
   （详见上文第 2 条的留档与订正），**这是错的**：真因是本刀新增的进度浮层从**桶文件**
   `@/views/video-creation` 取 `StageProgress`，把 `pipeline-selector.css` 提前注入进采集页的模块图，
   翻转了全局层叠顺序 ⇒ 视频创作页流水线卡片边框从「半透明白」变成「分类色」。
   处置：改成直连 `@/views/video-creation/StageProgress.vue`（顺序复原），并加契约锁
   `collection-css-cascade-order.test.js`（4 例：采集页不得触及 `pipeline-selector.css`／
   `features/collection/**` 不得从桶文件取组件／`create-view.css` 必须早于 `pipeline-selector.css`）。
   **本地同判据复验（2026-10-24，修复后）**：在本 worktree 自起 Vite（`127.0.0.1:5201`，独立端口）
   跑**完整 views 套件**（`node tests/visual-testing/views/all-views.visual.test.js`，视图顺序含
   `collection → … → create-editor`，与 CI 同一顺序），再用**门禁自己的脚本**判定：
   `node scripts/check-baseline-freshness.js --renders=apps/desktop/tests/visual-testing/screenshots --partial`
   ⇒ **`create-editor.png` 不在违规清单里（漂移 0 px）**；余下 8 张违规全是**本机与 CI runner 的环境差**
   （accounts-list 12 px/0.001%、publish-history 88 px/0.004%、viral-analysis 844 px/0.041%、
   create-history 3696 px/0.178%、create-result 6731 px/0.325%、publish-form 11640 px/0.561%、
   cloud-publish 15354 px/0.74%），且**都不是本刀改的视图** ⇒ **CI 里唯一超标的那张已归零**。
   ⇒ 教训：**「我没改那个页面」不等于「与那个页面无关」** —— 全局样式表、注入顺序、共享模块图
   都在「我没改」的范围里；这类跨页影响**只能靠机械锁**，靠人读 diff 必然漏。
   **两个数字的差异（外部复核点名，如实解释）**：旧结论里的 `582150 px / 28.07%` 来自
   **更早的一轮 CI run**（本刀第 1 次红的那轮），`590903 px / 28.496%` 来自**修复前最后一轮**
   run 40068534350；两者是**不同 run 的两次测量**，不是同一次测量的两个读数。
   两处都原文保留，**不合并、不改写**。

#### 第 5 轮外部双家族复核（2026-10-24，隔离只读副本）

- **隔离方式**：`git archive HEAD` 解出的**只读快照**（无 `.git`），claude 侧工具白名单**只给
  Read/Grep/Glob**；opencode 侧用**只读代理**（`tools: {write/edit/patch/bash: false}`），
  两个副本互不干扰。
- **critic = claude 2.1.303**：Q1–Q4 **全部成立**（修复有效 / 锁非空跑且可证伪 / 记录属实 /
  无新缺陷）；并指出「直连是仓内既有范式（`FilmAutoPanel.vue` 等多处）」，因此不构成破例。
- **proposer = opencode CLI**（非 Anthropic 家族模型）：**总判定「成立」**，逐条给出 file:line 证据。
  **本轮该后端的三次具体失败（如实登记，不用「工具不可用」这种笼统说法）**：
  ① 默认 provider `opencode-go` 报 `AI_APICallError: This API key has expired`（API key 过期）；
  ② `krill-grok` 报 `account balance is negative, please recharge first`（余额为负）；
  ③ 改用 `sensenova` 凭据（商汤）后可跑，但两次长任务都被 **`Error: rpm exhausted`**（限流）打断，
  第一次在已独立确认「桶导入全仓清零 / 路由全部动态加载」之后、第二次在已独立确认
  「浮层第 107 行直连 / 桶文件第 1 行 re-export / `PipelineSelector.vue` 第 67 行导入 css /
  桶导入 grep 0 命中 / 两份样式表同特异性」之后；最终用 `--continue` 续上**它自己的会话**
  （不再调工具）才拿到完整报告。
- **本轮复核抓到的两处锁的盲区（都已修，锁从 3 例增到 4 例）**：
  ① **只认 `@/views/video-creation` 别名写法**，相对路径写法（`../../views/video-creation`）会漏
  ⇒ 改成**按解析后的真实文件**判定（别名与相对路径都命中）；
  ② **只扫 `features/collection/` 的直接子文件**，子目录里的文件不扫 ⇒ 改成**递归扫描**。
- **锁的可证伪性已用变异反证证明（不是推理）**：把浮层导入**改回**桶形态 ⇒ **4 条断言里 3 条判红**
  （含「注入顺序 expected 31 to be less than 25」）；恢复后 4/4 全绿。
- **外部复核点名的「需人工裁决」4 条，逐条处置**：① 「改后 CI 是否已复跑绿」→ **已复跑**
  （run 40081336712 `QG Visual` success、`Gate Result` success）；② 「旧/新数字差异未解释」→ 见上，
  是两个不同 run 的两次测量；③ 「断言 1 是否真能走到浮层」→ 能：`Collection.vue:645` 是
  **静态 import**（`import CollectionVideoProgressModal from '@/features/collection/CollectionVideoProgressModal.vue'`），
  模块图走得到；④ 「子目录盲区」→ 已改递归扫描。
- **外部复核指出的「已知局限」已写进锁的头注释（如实登记，不假装精确）**：本锁的模块图走法把
  **动态 import 当即时求值**，与 Vite dev 的**懒求值**有差异 ⇒ 第 1、2 条断言不依赖全局顺序、
  结论可靠；第 3 条（全局顺序兜底）是**近似**而非精确模型。

### 本轮收尾（2026-10-23）：分支谱系订正与最终形态

#### ① 并发会话把远端分支 force-push 成了**回退版**（如实登记，已覆盖回去）

本分支推送合并提交（`04f115b60`）之后，远端 `origin/fix-collection-rewrite-publish-flow`
被**另一个会话** force-push 成 `618ebe8e`。留痕：本地 remote-tracking reflog 里
`refs/remotes/origin/...@{0}` 是 `fetch origin: forced-update`，其上一条 `@{1}` 正是本会话的
`update by push`（`04f115b60`）⇒ **是外力覆盖，不是本会话的回退**。

该版本是本分支 18 个提交的 **rebase 版**，但**零合并提交** ⇒ 合并主干时在**冲突处置**中形成的实现不在其中：

| 项 | 远端 rebase 版 `618ebe8e` | 本地谱系 `04f115b60` |
|---|---|---|
| `features/collection/collection-video-config-profile.js` | **不存在** | 存在（含 15 例用例） |
| `useCollectionVideoCreation.js` 的配置档案兑现 | **无**（少 32 行） | 有：读配置库 → 套用档案快照 → 套不上时给**可见提示** |
| 执行记录里的本机绝对路径 | 仍是本机路径形态 | 已改占位符形态 |

取证（可复算）：

- `git ls-tree 618ebe8e -- apps/desktop/src/features/collection/collection-video-config-profile.js` → **空**；
- `git diff --stat 618ebe8e 04f115b60 -- apps/desktop/src/composables/useCollectionVideoCreation.js`
  → `37 ++++---`（32 insertions / 5 deletions）。

⇒ 远端那份是**回退版**：它把主干 `publish-config-picker` 带来的「配置档案」能力在采集页上丢了
（选了配置却静默按默认值跑 = 主干修过的同一个坑「选了等于没选」）。
⇒ 处置：以本地完整谱系为准 **force-push 覆盖回去**，并再次与主干对齐（合并提交 `2e4dc6bd8`，零冲突）。
最终 PR 差集 = **19 个业务/文档文件**（`apps/desktop/**` 15 + 文档/台账 4）+ **三十余份评审产物**
（`.ccg/reviews/*.json`；每轮深审收口落一份 ⇒ **刻意不写精确数**，写了必然过期）。

**第 2 次覆盖（2026-10-24 上午，同一形态）**：本会话把分支推回完整谱系后，远端**又**被覆盖成
**再 rebase 版**（head `f432cb8f4`）。这版**同样丢了配置档案实现**；另外
`.ccg/reviews/*.json` 被写成**带 BOM 的 JSON**（`JSON.parse` 直接抛 `Unexpected token '﻿'`）
⇒ 该轮 CI 的 `QG Changes` 与「依赖漏洞审计」转红。
取证：① `git ls-tree f432cb8f4 -- apps/desktop/src/features/collection/collection-video-config-profile.js`
⇒ **空**；② 该版 `e768b04c….json` 的首三字节是 BOM（`EF BB BF`），而本会话本地同名文件**无 BOM**。
⇒ 处置：把**最新主干**（含主干侧修好 Gate 2b11 夹具闭包的 #4347）与完整谱系**一次性合并**
（`4c53e3fce`，零冲突）后覆盖回去；覆盖后**逐文件核验**（这次不是「看着没问题」）：
① `collection-video-config-profile.js` 在；② 编排层仍接着它（`:42` import、`:201` 调用）；
③ locale 装配后与主干**只差 12 个新键**（`collection.videoCreate.*`，475 → 487 键）；
④ 8 项静态门禁全绿。**教训**：覆盖别人（或被别人覆盖）之后，核验必须落到
「关键文件在不在 + 装配结果差多少 + 门禁过没过」这三样可复算的读数上，不能只看提交信息像不像。

#### ② 「成片 ↔ 文案同源」的复核结论：**不引入**（驳回，附可复算理由）

外部复核曾指出「文案挂在函数作用域的可变 `let` 上，发布出口可能把上一轮成片配上新一轮文案」。
本轮逐条核对**该路径不可达**，故**不加**这层守卫（本仓纪律：不给不可达路径加装饰性守卫）：

1. **过期响应被 runId 身份挡住**（不是靠时间顺序猜）：`useGenVideoRunTracking.js:68`（请求前）、
   `:71`（await 之后）、`:94`（推送快照）三处都是 `runId.value !== id` ⇒ 旧 run 的完成回调
   **不可能**落到新 run 的状态上。
2. **新一轮启动会清空成片路径**：`useCollectionVideoCreation.js:288`（`startVideoCreation`）与
   `:376`（`retryVideoCreation`）都把 `videoCompletedVideoPath` 置空 ⇒ 成片缺失时
   `isGenVideoResultReady`（`features/hot-topics/gen-video-view-model.js:47-48`）为假
   ⇒ **发布出口不可达**（按钮灰显、`publishVideoResult`（`:428`）首行即返回）。

⇒ 结论：**不构成缺陷**（驳回）。若将来引入「后台重试 / 多路并行」形态（多条 run 各自存活），
上述第 1 条的 runId 身份守卫不再足够，那时才需要每条 run 独立取消句柄 + 文案按 run 绑定 —— 属**另一种产品形态**，
已在 composable 头注释的「并发模型」段写明，不在本刀范围。

#### ③ 第 4 次独立外部复核与判定记录收口（2026-10-23）

- **执行环境**：本分支 HEAD 的 `git archive` 快照（临时目录里的**只读副本**），工具白名单**只给
  Read / Grep / Glob**（Write / Edit / NotebookEdit / Bash 显式禁用）——「只读」靠**执行环境隔离**，
  不靠提示词声明（这是本刀第一次外部复核越权写入仓库之后写进记录的纪律）。
- **外部模型**：`claude 2.1.303`；四问**全部「成立」**，**没有新缺陷**，但**抓到本刀自己的两个过期行号**（见上）。
- **公开留痕**：PR #4114 评论
  [#issuecomment-6368372014](https://github.com/Colinchiu007/mulpub/pull/4114#issuecomment-6368372014)
  （创建于 `2026-10-23T15:24:16Z`，正文 sha256
  `ab3c8acb77efa5ca5b8b0f45575a07dd3a547e50efa36bc194002c865060958b`，
  可由 `gh api repos/Colinchiu007/mulpub/issues/comments/6368372014` 取回正文后重算核对）。
- **本刀唯一一条欠账的收口**：`.ccg/reviews/e768b04c…json`（mode=dual，status=pending）——
  它是**合并主干那次提交**的记录（差集 = 主干的 521 个文件 / 21603 行，**不是本 PR 的代码**）。
  按仓库既有先例（`1a739484b…` / `88bec26a…`）手写收口：
  `status=cleared`、`tier=external` + `evidence=<上面那条评论 URL>`（可核形态）、
  `findings` 逐条写出 **3 条裁决**（i1 高危面零命中 / i2 合并未把本 PR 改动混进主干高危域文件 /
  i3 成片↔文案同源不可达；三条全部 **dismissed**，各附可复算行号与外部复核出处）、
  `closureNote` 含轮次标记与逐条处置结论、`clearedBy` / `clearedAt` / `clearedReason` 如实写明；
  **引擎原值 `status=pending` 保留在 `engineStatusBeforeClear`**，`stats` 一字未改。
- **门禁读数**：`node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce`
  ⇒ `OK: 本 PR 携带执行记录或带原因的豁免`（exit 0）；`TIER-COVERAGE dual-closed total=4 external=1
  external-unverified=0 self-play=1 none=0 unknown(字段缺席)=2 unrecognized=0`。


