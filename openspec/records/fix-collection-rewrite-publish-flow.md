---
record: fix-collection-rewrite-publish-flow
task: 修复采集页「AI 改写 → 去发布 → 视频创作」链路的三个用户可见缺陷（字数区间失效且截断不可见 / 视频创作跳页而非就地出进度浮层 / 二次改写带的是第一次的旧文案）
date: 2026-10-20
branch: fix-collection-rewrite-publish-flow
---

## 本次执行记录：采集页改写与视频创作链路修复（fix-collection-rewrite-publish-flow，2026-10-20）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码（`apps/desktop/src/**`）+ locale + 文档 ⇒ **混合 PR**，走完整质量节拍。隔离 worktree `D:/Data/projects/mp-worktrees/mp-fix-collection-rewrite-publish-flow`（**D 盘，非 C 盘**），裸分支 `fix-collection-rewrite-publish-flow`（`rev-parse --abbrev-ref HEAD` 实证），基线 = `origin/main`。入口：Git for Windows Bash 跑 `scripts/session-init.sh fix-collection-rewrite-publish-flow`（`gwm-task.sh start` 建 worktree + 装 hooks + 备依赖，rc=0）。共享根全程保持 `main` + clean，**未在其运行时路径落盘、未执行任何 git 写操作**（add/commit/checkout/stash 均未在共享根运行） |
| 依赖就绪 | PASS | `pnpm install --frozen-lockfile` rc=0（1526 包）→ `ensure-electron.js` v43.7.7 就绪 → `verify-worktree-deps.js` OK（11 项解析、9 个 workspace 全指向本 worktree） |
| 行尾对账 | PASS | `git diff --cached --numstat` 与 `git diff --cached --ignore-cr-at-eol --numstat` **两口径逐文件一致**（14 个文件：PRD 454/0、旧 PRD 29/3、CHANGELOG 36/0、composable 392/0、composable 测试 152/0、浮层组件 149/0、纯函数 131/0、纯函数测试 119/0、locale en 24/78、locale zh 25/79、quick-collect en 82/0、quick-collect zh 84/0、既有测试 13/1、新组件测试 270/0、Collection.vue 214/26） |
| TDD（RED→GREEN） | PASS | 三个新测试文件**先写后实现**：①`features/collection/rewrite-word-count.test.js` 先写 ⇒ 实跑 **RED（模块不存在，Failed to resolve import）** ⇒ 实现后 14/14；②`composables/useCollectionVideoCreation.test.js` 先写 ⇒ 实现后 10/10；③`views/Collection.rewrite-publish-flow.test.js` 先写 ⇒ 实现后 10/10。末态新增 **34 例** |
| 变异反证 | PASS | 4/4 **CAUGHT**（每个变异都被指名用例擒获，还原后全绿、`MUTATION` 残留 0）：**M1** 引擎契约键退回 `targetWordCount` ⇒ **4 例红**（组件 2 + 纯函数 2）；**M2** 区间归一吞掉 `min=0` ⇒ **6 例红**（组件 2 + 纯函数 4）；**M3** 已存草稿 id 不作废（去掉 `genreDraftId = null`）⇒ **1 例红**（「二次改写后重存的草稿是最新文案」）；**M4** `onPublishVideo` 退回跳页型实现 ⇒ **3 例红**（「不再跳转」「带最新文案」「浮层有阶段」） |
| 接线棘轮 | PASS | `node scripts/check-unwired-tests.js` rc=0 ⇒ 检查域内测试文件 **113 个**、`OK: 全部测试均已接线或按欠账登记`（无新增欠账） |
| 静态门禁 | PASS | `node .github/scripts/check-max-lines.js` rc=0（**无新增超大文件**，挂账清单与现实一致）；`check-locale-sync.js --keys` rc=0（198 个使用中 key 均存在于 zh/en）；`check-locale-sync.js --cjk` rc=0（基线 1330、当前 1125、**无新增硬编码中文**）；`eslint` 改动文件 `--quiet` rc=0 |
| QM-1 打包 | **N/A（不适用，非「跑了通过」）** | 改动集 **零** `apps/desktop/electron/**`、**零** `packages/rpa-engine/**`（只动渲染层 `src/**` + locale + 文档）⇒ 按 AGENTS.md 字面规则「每次修改 `apps/desktop/electron/` 或 `packages/rpa-engine/` 下代码后必须打包」**不触发**。本行记录此格是为与「已验证」区分。**额外**（不属 QM-1，但为否证 QM-6 i2「无构建验证」而跑）：渲染层生产构建 `npx vite build` ⇒ **rc=0、built in 24.11s** |
| QM-4 视觉 | PASS | `TEST_URL=http://127.0.0.1:5199 PIXEL_ONLY=collection node tests/visual-testing/scripts/run-pixel-tests.js` ⇒ **1/1 通过、0 失败、100%**（报告 `tests/visual-testing/reports/report-1792523798281.json`）。用**本 worktree 自起的独立 Vite**（5199，`--strictPort`，HTTP 200 实证），**不借用他人端口**（5174 已被他人占用）；**未刷新基线**。新增横幅与浮层均为**条件渲染**（截断态 / 流水线运行态），采集页默认态不渲染 ⇒ 像素不变，0.000% 差异本身即证据 |
| QM-6 CCG 双模型外部评审 | PASS | pre-commit 判定 **mode=DUAL**（变更 1839 行 > 200 行阈值）。后端对 `scripts/ccg-review-backends.list`：critic=`claude`（本机 2.1.303，`C:\hermes-home\bin\claude.exe`）、proposer=`opencode`（本机 1.18.34，`D:\Program Files\npm-global\opencode.ps1`）—— **两个后端均实测可跑**（`--version` 有读数，脚本自检「裸名自检」两条均过）。深审跑出 **8 条**（correctness 5 / security 6 / performance 6 / maintainability 4，最低分 4），其中 Critical 3 + Warning 2 进入**自扮演裁决**（confidenceWeight 0.6，跨家族校验 proposer=opencode「通过」）。逐条填 prosecution/defense/verdict/rationale 后**5/5 dismissed、blocking 空**，引擎收口 `deepReview.status=self_play_resolved`、note「自扮演裁决：全部指控不成立」。**每条 dismissal 都附可复算证据**：① i1（元数据脱节）—— 实测 JSON 的 `sha` 与 `git merge-base origin/main HEAD` **逐字相等**（最终态基线 `99365bd5…`；脚本明文预期「pre-commit 时新 commit 尚未生成，判定记录写在父 sha 上」），且 `code_total=1839`（12 个代码文件精确和）**恰等于** JSON 的 `stats.changedLines`（rebase 前后**逐字节未变**），记录与改动的绑定是**内容寻址**的 `stagedDiffHash`（深审首行「判定记录按内容寻址命中」）；② i2（依赖缺失/无构建验证）—— 被 import 的 7 个模块全部已存在于仓库，且**实跑渲染层生产构建** `npx vite build` ⇒ **rc=0、built in 24.11s**；③ i3（StageProgress 未确认）—— 该组件 props 闭集与本组件传的 5 个 prop 逐个对上，另有行为级断言（浮层真渲染进 `document.body`）与构建 rc=0；④ i4（sync watcher 竞态）—— 不变量「归因链 id 与当前显示内容永远成对」有三条纪律支撑（id 只在成功分支写 / `lastProgrammaticRewrite` 先写后赋 / 同一同步 tick），建议的 seq 保护防的是不可达交错态，按本仓纪律不加装饰性守卫；⑤ i5（模块级 let / 未停跟踪）—— `videoSeq`/`videoSourceText` 实为**函数体内闭包变量**（每实例一份），并发由 `videoBusy` 早退 + `videoSeq` 守卫，`resetVideoState` 第一件事即 `stopGenVideoTracking()`。裁决全文 `.adversarial/ccg-deep-8ace8f2f/adjudication.json`（该目录由 `.gitignore:441` 忽略，不进版本库）；引擎写回的裁决与 findings 在 `.ccg/reviews/*.json`（**随本 PR 入库**） |
| 相关测试全集 | PASS | `vitest run src/views/Collection* src/features/collection src/composables/useCollection* src/locales` ⇒ **31 文件 / 473 用例全绿**（含既有 `Collection.test.js` / `Collection.cancel.test.js` / `Collection.rewrite-input-limit.test.js` / `Collection.viral-contract.test.js` 与全部 features/collection 用例） |
| 文档同步 | PASS | 新增 `01-docs/PRD-COLLECTION-REWRITE-PUBLISH-FLOW-2026-10-20.md`（454 行：缺陷根因 / 数据校验 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文字 / 未闭合）；订正 `01-docs/PRD-REWRITE-WORD-COUNT-CONTROL-2026-09-12.md`（采集页口径已被取代的四处 + 校验表上限 + 变更记录）；`CHANGELOG.md` 顶部新增 36 行条目 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）。把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红（change: `ban-record-closure-backfill-pr`）。合并前本篇不在基线上 ⇒ 走 byDesign 档，不红；main push 回读证据写在 PR 评论里，不写回本文件 |

> **QM-6 产物的一个如实说明**：`check-pr-exec-record.js` 的 TIER-COVERAGE 读数是
> `dual-closed total=1 … self-play=0 … unknown(字段缺席)=1` —— 引擎写回的
> `.ccg/reviews/95afed29….json` 里 `deepReview` **没有 `tier` 字段**（它写了
> `status=self_play_resolved` + `performedBy=self-play` + `confidenceWeight=0.6`）。
> 该档位按判据是「可见但不拦」。**不手工补写 `tier`** —— 那是引擎的产物，
> 手改会让「引擎写回」与「我抄上去」混成同一份证据，失去可追溯性。


- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅（14 文件两口径一致）| 品牌残留 随 CI | 文档同步 ✅ | 执行记录 ✅ | 远程同步 由门禁推导

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

### 深审 Info 三条（i6-i8）：未进裁决清单，**如实登记处置**

| 条目 | 处置 |
|---|---|
| i6（Info，maintainability）：PRD §10 列了「端到端真机复核未执行」与「浮层未做视觉回归」，但未设为阻塞验收项 | **部分采纳**：① QM-4 像素门禁**已实跑**（`collection` 1/1 通过、100%）；② 浮层的**专用**像素用例确实没有 —— 该浮层需流水线处于运行态才会出现，而像素 harness 无 IPC 通道 ⇒ 技术上无法在像素层构造，登记为已知缺口（见「未闭合」第 2 条）；③ 端到端真机复核**仍然欠着**（见「未闭合」第 1 条），**未**降级为「已验证」 |
| i7（Info）：CHANGELOG 标 `[未发布]` 且无版本号，与分支对应关系未在 PR 描述中明确 | **采纳（形式项）**：`[未发布]` 是本仓既有惯例（主干顶部条目同样形态）；分支对应关系写进 PR 正文 |
| i8（Info）：locale 用 `import` + 对象展开引入子模块，需构建链支持 | **不成立（事实误读）**：「装配文件 import 子模块后展开」是本仓**既有范式**（`locales/zh.js` 已 import 30+ 个同形态子模块）；且 `check-locale-sync --keys` 用的是与运行时同源的装配求值器（`resolveLocaleSpec` + `evalLocaleModule`，明确支持嵌套相对 import）⇒ PASS（198 个 key）；另有 `vite build` rc=0 证明打包链解析通过。建议「在门禁里加 locale 构建验证」**不在本刀范围**（属改门禁 ⇒ 须人工过目） |

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
5. **`genreDraftId` 仍是模块级 `let`**：本刀用 `watch(rewriteResult, sync)` 保证作废，
   但它不是响应式的（视图不读它，只有 `goPublishAfterRewrite` / `onPublishArticle` 读）。
   若将来出现第二个消费点，应改为 `ref`。
