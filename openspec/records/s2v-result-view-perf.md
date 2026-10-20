---
record: s2v-result-view-perf
task: 视频任务编辑页失败任务进入性能与占位优化（PRD-S2V-RESULT-VIEW-PERF-2026-10-20）
date: 2026-10-20
---

## 本次执行记录：失败任务编辑页「无限加载后空白」修复（s2v-result-view-perf，2026-10-20）

> 分支：`s2v-result-view-perf`；worktree：`<worktree>/mp-s2v-result-view-perf`（由 `scripts/start-mp-task.ps1 -TaskName s2v-result-view-perf` 创建，`verify-worktree-deps.js` OK：11 个 `@multi-publish/*` 全部解析到本 worktree）；基线 = `42ba5860f`（当时 origin/main）。
> 范围：🎨 UI/UX + 📊 性能优化（渲染端，无 IPC 契约变更）；判定 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=false（含 `apps/desktop/**`）。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 共享根 `git rev-parse --abbrev-ref HEAD` = `main` 且 `git status --porcelain` = 0 行才建 worktree；建后实证：`git worktree list` 列出该路径 + `rev-parse --abbrev-ref HEAD` = `s2v-result-view-perf`；`mp-worktree-health.ps1` ok=true（writeGuard taskRegistered=true running=true）。依赖 `pnpm install --frozen-lockfile` + `ensure-electron.js`（v43.7.7）+ `verify-worktree-deps.js` OK |
| 上下文与根因（Step ①） | PASS | 三个缺陷是同一条链路的三个表现：`loadProject()` 里 `await this.refreshSegmentImageUrls()` 对**全量 169 段**申请媒体 URL（每段 5 个媒体位 ≈ **845 次 IPC**），`loading` 要等它跑完才置 false；而失败任务 `videoPath` 为 null，`<video>` 因 `v-if="videoPath"` 不渲染 ⇒ 骨架挂很久后空白。`<img>` 无 `loading="lazy"` ⇒ 169 张同时请求，未完成时显示破图。判据不是猜的：逐行读 `ResultView.vue:1300-1345`（loadProject）、`952-1036`（refresh*Urls）、`story2video-media-server.js:137`（createUrl 每次做 realpathSync/lstatSync/statSync） |
| 测试先行（Step ② / QM-3） | PASS | 先写 `useResultPreviewMedia.test.js` 与 7 条 ResultView 行为用例，**先红**：① 模块不存在（`Failed to resolve import`）② 哨兵点击后 `expected 20 to be greater than 20`（窗口写成滑窗，丢了已渲染段）③ `focusScenes` 用例 `expected [] to have a length of 3`（80 段任务的场景 49/73/74 不在前 20 段 ⇒ 政策徽标被分批破坏）。三条红因都经原始输出核对，不是夹具自坏 |
| 实现（Step ③） | PASS | 四层：`composables/useResultPreviewMedia.js`（纯函数策略）+ `ResultSegmentCard.vue`（174 行）+ `ResultSegmentEditor.vue`（210 行）+ `ResultView.vue` 宿主接线（1741 行，**比原 1860 降 119 行**）。核心：无 `videoPath` 零预览 IPC、首屏 20 段、追加式渲染窗口 + IntersectionObserver 哨兵、`loading="lazy" decoding="async"`、预览占位区块与 `<video>` 同构 |
| 审查（Step ④） | PASS | 无新增依赖、无硬编码密钥、无 `console.log`、无 `waitForTimeout`。`hasFinalVideo` 双入口（`project.videoPath` + 纯文件预览模式的 `this.videoPath`）——单看 project 会破坏文件预览模式，本轮被既有 5 条用例当场抓出。`resolveSceneMaterialSlots` 收敛为宿主与卡片**同一真源**（两份实现的代价是「宿主放行、编辑器禁用」不对称缺陷） |
| 验证范围取消费者并集 | PASS | `git grep ResultView` 取并集后全跑：`ResultView.test.js` **122 passed**（原 115 + 新增 7）、`ResultView.model-info.test.js` **32**、`story2video-ue-contract.test.js` **5**、`views-deep.test.js` + `views-deep2.test.js` + `views-coverage.test.js` + `views-coverage2.test.js` + `CreateViewHistory.test.js` 合计 **76**、`CreateView.test.js` + `src/i18n` + `src/locales` 合计 **362**。合计 **577 passed / 0 failed** |
| 行尾与 diff 对账 | PASS | 改动文件 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐行相等（见下方提交前复跑） |
| 本地门禁 | PASS（逐条 rc=0） | `check-max-lines.js` rc=0（**无新增超大文件**；ResultView.vue 从 2062 → 1741，低于 targets 点名目标 1890）；`check-unwired-tests.js` rc=0（检查域 111 个测试文件，新测试加在已收文件的 `useResultPreviewMedia.test.js`，由 vitest workspace 自动收集）；`check-locale-sync.js --cjk` rc=0（基线 1331 / 当前 1138，无新增硬编码）；`--pair-base origin/main` rc=0（zh/en 成对）；`check-no-brand-residue.js` rc=0（10810 个 tracked 文件）；`check-debt-budget.js` rc=0；`check-gate-record-debt.js` rc=0 |
| eslint | PASS | 8 个改动文件 `pnpm exec eslint` **0 error 0 warning** |
| QM-1 打包 | ➖ N/A | 未触 `apps/desktop/electron/**`、`packages/rpa-engine/**`、preload 或 IPC 契约，纯渲染端 |
| QM-6 CCG 双模型外部评审 | ⚠️ 降级（后端截断，已如实登记） | pre-commit 判定器给出 `mode=dual`、`deepReview.required=true`（变更 2051 行 > 200 行阈值，`scripts/ccg-review-decider.js` 确定性判定）。**跑 `sh scripts/deep-review.sh` 时后端失败**：critic=claude 对 2051 行 diff 输出 20392 字符被单次输出上限砍断，JSON 括号配平但结尾不是 `}`，驱动按「模型输出被截断」判 `JSON解析失败` 并重试一次仍失败；opencode  proposer 侧未产出。按 AGENTS.md「子代理降级」规则降级为**主代理直派独立 subagent 做跨家族对抗审查**（12 条审查项：draft 同步 / 全量刷新的副作用 / 删除后下标一致性 / 双入口冲突 / IPC 计数主张 / 点名段漏解析或重复解析 / 跳转到未渲染段 / 死代码 / console.log 等），结论见下方「QM-6 降级审查结论」。**不得**因为跑不动就把 status 写成 `cleared` 假装通过 |
| 记忆三路沉淀 | PASS | ① **外部记忆（仓库文档）**：`01-docs/learnings.md` 置顶 **6 条**教训（append-only，`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致，CRLF 保真：改后 `loneLF=0`、`endsWith(before)=true`、无 BOM）；② **EverOS**（本机 v1.4.1 @127.0.0.1:8000，health 200 + cascade healthy）：`POST /api/v1/memory/add` 回 `{message_count:1, status:"accumulated"}` → `POST /api/v1/memory/flush` 回 **`{status:"extracted"}`** → **读回验证取落盘产物**：`~/.everos/default_app/default_project/users/agent/episodes/episode-2026-10-20.md`（2694 B）与 `.atomic_facts/atomic_fact-2026-10-20.md`（11631 B）均 grep 到哨兵词 `s2v-result-view-perf`（分别 4 / 39 处命中）。契约踩坑：`messages[]` 必填 `sender_id`、`timestamp` 为 **epoch 毫秒整数**（ISO 字符串报 422），`get` 端点只接受 POST 且 `memory_type ∈ {episode, profile, agent_case, agent_skill}`；③ **内置记忆**：本会话 DSH 会话档由 harness 自动落盘（无对外写 API），未手工伪造 |
| 远程同步 | 由门禁推导 | 新 PR 不手写状态词，收口由 `scripts/lib/merge-ledger.js` 按主干历史推导 |

### 本轮自己踩到并修掉的四个坑（都写进了 PRD/测试，不是靠记忆）

1. **max-lines 的 targets 零容差第一版就拦下我**：把逻辑直接写进 ResultView.vue ⇒ 2062 行 > 点名目标 1890（`TARGET_GREW` 红）。正解不是申请抬基线，而是把分段编辑区整块抽成组件——抽完反而降 119 行，从「还账对象」变成「有空间的普通文件」。
2. **抽组件抽出一连串契约断裂**：`sceneMaterialSlots`/`segmentStatusReason`/`subtitleBlocksText`/`segmentVoiceSpeedText` 被 5 条既有用例直接调用。修法不是改测试迁就实现，而是把这些逻辑搬进 composable、两边共用薄包装。
3. **`v-model="segment.xxx"` 撞 `vue/no-mutating-props`**：卡片内引入 `segmentDraft` 浅拷贝 + `watch(segment, deep)` 同步。（`_draft` 命名又撞 `vue/no-reserved-keys`，已改名。）
4. **CSS 搬运差点整块丢失**：PowerShell 数组索引拼接把 scoped CSS 变成单行巨串，我的拆分脚本两轮都把规则清空。最终从 `git show HEAD:ResultView.vue` 重新提取原始 CSS 按选择器前缀分类搬移，并用「编辑器剩 2 条」这个异常读数发现丢失。
5. **CJK 门禁把「从旧文件搬过来的硬编码中文」判成新增**：`分段编辑`/`旁白文字`/`画面提示词`/`替换旁白`/`下载图片·音频·视频`/`中文翻译`·`翻译` 这些在 ResultView.vue 里是存量基线，搬到新文件后算新增。正解是补 16 个 locale 键（zh/en 成对）收口，而不是 `--update-baseline` 掩盖。
6. **`v-for` 的局部 index 与全量下标脱钩**：分批后 `visibleSegments` 的局部 index 不再等于全量下标，而上移/下移/删除/导出命名/政策徽标全按全量下标寻址。改为每项携带 `absoluteIndex`（`indexById` 映射），否则会指错段。

### QM-6 降级审查结论

由独立 subagent 执行的跨家族对抗审查（12 条审查项全覆盖），逐条结论如下（详细证据见审查产出）：

| # | 审查项 | 结论 |
| # | 审查项 | 结论 |
| --- | --- | --- |
| A1 | `segmentDraft` 浅拷贝 + deep watch 能否跟上原地 URL 刷新 | 🔴→✅ **已修**。第一版（浅拷贝 + `watch(segment, deep)`）**不能**：宿主的 `refreshSegmentImageUrls()` 原地改 `segment.imageUrl/...`，宿主改的是自己 data 数组里的对象，卡片侧 deep watch 不触发，浅拷贝展开拿旧值 ⇒ 保存/重试/重新合成后显示旧图或空白。改为 `draft` getter 直接返回 prop，加回归锁 `ResultSegmentCard.test.js`（A1/A1c/A1d 三条；必须 `reactive()` 包裹才复现真实场景） |
| A2 | 全量 `refreshSegmentImageUrls()` 刷新未显示段的 URL 有无副作用 | 🟠→✅ **已修**（原判「非问题」太宽）。未显示段刷新本身无副作用（`loading="lazy"` 挡住请求），但**写后刷新对全量 169 段跑一遍**（上限 ~845 次 IPC）是派生性能债。缺省作用域改为 `renderedSegments`；未渲染段不在 DOM、用户改不到，其 URL 等进窗口时再取 |
| A3 | 删除/上移后 `indexById` 与 DOM refs 是否一致 | 🟠→✅ **已修**。`setSegmentItemRef` 按全量下标写、映射正确；错的是 `onSegmentScroll`：refs 是**稀疏数组**（点名段并入首屏后中间全是空洞），旧实现把 `refs.length` 当连续下标上界、遇空洞 continue ⇒ `activeSegmentIndex` 被设成「有 ref 的最大位次」而非用户实际看到的段。改 `Object.keys` 遍历实际挂上的 ref。回归锁：`refs[0]/refs[60]` 稀疏数组断言高亮落 60 |
| A4 | `hasFinalVideo` 双入口是否冲突 | ✅ 非问题。`loadVideoPath` 只写 `this.videoPath` 不改 `project`；任一非空即成片，语义并集。改名建议未采纳（牵动既有调用面，注释已写明） |
| A5 | 首屏真的只发 ~100 次 IPC 吗 | ✅ 主张成立，但**子代理「每段最多 4 位」有误**。逐位核对 `refreshSegmentImageUrls` + `refreshSceneMaterialUrls`：共 **5 个条件位**（image1/image2/video1/video2/audio），每位有路径才发（`resolveLocalUrl` 开头判空，audio 亦有 `if (segment.audioPath)`）。上限 169×5=845、首屏 20×5=100。断言改为从常量派生 |
| A6 | 点名段会不会漏解析/重复解析 | 🟠→✅ **发现真 bug 并已修**。点名段并入首屏不漏，但 `loadNextSegmentBatch` 用 `from = segmentRenderCount`（初始 0）⇒ `slice(0,20)` **把首批重复解析一遍**。根因是窗口公式 `to = rendered + step` 与「已渲染数」不一致、三处各算一次。统一为 `to = min(total, rendered > 0 ? rendered : step)`，让 `renderWindow.to` 同时是「已渲染上界」与「下次追加起点」 |
| A7 | 跳到未渲染段的行为 | 🟠→✅ **已修**。原判「可接受 MINOR」被否证：右侧 169 个数字全可点无 disabled；高亮跳了但视口不动，状态与视图矛盾比无响应更糟；`jumpSegmentBy` 会连环失效；恰是本 PR 核心场景。修法：`scrollToSegment` 一步扩窗到覆盖目标（不逐批循环），只解析新增段，`$nextTick` 后滚动。回归锁：169 段跳下标 149 后断言 DOM ≥150 项 |
| A8 | 删除分段后场景号对应关系 | ✅ 非问题。`policyFlagSceneNumbers` 由路由 query 一次性解析；徽标跟下标是唯一自洽选择（跟 `id` 走会在删段后指到内容完全不同的段） |
| A9 | `loadProject` 失败时占位区块显示什么 | 🟠→✅ **已修**。旧实现「加载失败」与「本来没有视频」共用空态「没有可预览的视频」，用户关掉弹窗后会以为任务本来就没视频——同一误导形态只修了一半。新增 `loadFailed` + 独立空态（`data-testid="result-load-failed"`，标题 + 重试），locale 键 zh/en 成对 |
| A10 | composable 死代码/未用参数 | 🟠→✅ **已清理**。删 `shouldRequestSegmentMedia`、`PREVIEW_LOADING_STATES`、`previewState`/`firstPaintMediaPaths`、`resolveSegmentMediaPlan` 的 `segments` 死参数、`firstBatch`/`deferred` 返回字段；`splitSegmentBatches` 降为内部函数；`segmentUrlBatchCursor`（三写零读）删除；编辑器 `clear-material-unavailable` 孤儿 emit、`voiceOptionIds`/`isSegmentBusy`；卡片 `voiceContext` 孤儿 prop。**`renderWindow` 反向保留**——现在有真实消费者（追加起点） |
| A11 | console.log / 硬编码等待 / 同步阻塞 | ✅ 非问题。新文件零 `console.*`、零 `waitForTimeout`、零同步阻塞原语 |
| A12 | 组件边界清晰度 | 🟠→✅ **已修关键项**。编辑器自持 `segmentRenderCount` 本地计数，而宿主「分段定位」也要改窗口 ⇒ **两份计数漂移**（宿主扩了窗口、编辑器按自己计数渲染 ⇒ 视口不动，正是 A7 现象）。改为受控 prop `renderedCount`，单一真源在宿主；`load-next-batch` 第二参上报新上界 |
| D12 | 「两组测试互斥」（子代理列为阻塞） | ✅ **不成立**。子代理自陈「读到的测试文件与实际执行的不一致」，它读的是修改过程中的中间版本。当前 `ResultSegmentCard.test.js:71` 断言 `segment.text` 被改写、`ResultView.test.js:2075` 断言 `segments[0].voiceId` 被改写——**两者一致**，都守护「编辑必须落到宿主对象」这一真实契约 |

### 遗留（不假装已闭合）

- **IPC 次数本身未降**：本 PR 是「按需申请」（首屏 20 段 + 视口内懒加载 + 写后刷新只刷已渲染段），单段仍最多 5 次 IPC。彻底方案是服务端批量签 URL，需改 IPC 契约 + preload + 三层测试，超出本轮范围，已记入 PRD §9。
- **窗口步长固定 20**：未按视口高度动态估算；169 段约需 8 次追加展开完（`scrollToSegment` 一步直达不受此限）。
- **`draft` 直接返回 prop**：嵌套对象（`alternateImages`/`videoMeta`）与宿主共享引用。当前编辑只改顶层字段故安全；若未来改嵌套字段需改结构化 emit（**不要回到浅拷贝 + watch**，那已被 A1 实测否证）。
- **未做实机 wall-time 复测**：量化结论来自 IPC 次数静态推算 + 单测计数。真实 169 段失败任务的进页耗时需实机复测（属外部验收）。
- **QM-4 视觉回归未跑**：本机 QG Visual 基线此前已仓库级失效（36/41 违规，见 `openspec/records/result-view-back-btn-style.md` 的同一结论），本轮不重建基线。改动集中在「无成片时多一个占位区块」「加载失败独立空态」与「分段区分批渲染」，建议在基线修复任务后统一重建。
- **原 A7 已修**（不再是遗留）：`scrollToSegment` 现在会把窗口一步扩到覆盖目标位次再滚动，回归锁见 `ResultView.test.js` 的「跳转到尚未渲染的分段时先把窗口扩到覆盖它」。
