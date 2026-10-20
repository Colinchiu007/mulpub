---
record: s2v-result-view-perf
task: 视频任务编辑页失败任务进入性能与占位优化（PRD-S2V-RESULT-VIEW-PERF-2026-10-20）
date: 2026-10-20
---

## 本次执行记录：失败任务编辑页「无限加载后空白」修复（s2v-result-view-perf，2026-10-20）

> 分支：`s2v-result-view-perf`；worktree：`D:/Data/projects/mp-worktrees/mp-s2v-result-view-perf`（由 `scripts/start-mp-task.ps1 -TaskName s2v-result-view-perf` 创建，`verify-worktree-deps.js` OK：11 个 `@multi-publish/*` 全部解析到本 worktree）；基线 = `42ba5860f`（当时 origin/main）。
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
| --- | --- | --- |
| A1 | `segmentDraft` 浅拷贝 + deep watch 能否跟上原地 URL 刷新 | 🔴→✅ **已修**。第一版（浅拷贝 + `watch(segment, deep)`）**不能**：宿主的 `refreshSegmentImageUrls()` 原地改 `segment.imageUrl/...`，宿主改的是自己 data 数组里的对象，卡片侧 deep watch 不触发，浅拷贝展开拿旧值 ⇒ 保存/重试/重新合成后显示旧图或空白。改为 `draft` getter 直接返回 prop，并加回归锁 `ResultSegmentCard.test.js`（A1 用例，`reactive()` 包裹后才复现真实场景） |
| A2 | 全量 `refreshSegmentImageUrls()` 刷新未显示段的 URL 有无副作用 | ✅ 非问题。只改响应式对象的 URL 字段，不触发渲染窗口变化；未显示段下次进入窗口时直接拿到已刷新 URL，反而避免二次 IPC |
| A3 | 删除/上移后 `indexById` 与 DOM refs 是否一致 | ✅ 非问题。`indexById` 每轮 render 从 `this.segments` 重建，`setSegmentItemRef(el, absoluteIndex)` 按全量下标写入；`moveSegment`/`removeSegment` 已重置 `segmentItemRefs = []` 并 `$nextTick` 重算高亮 |
| A4 | `hasFinalVideo` 双入口是否冲突 | ✅ 非问题。`loadVideoPath` 只写 `this.videoPath` 不改 `project`；两者任一非空即「有成片」，语义并集而非冲突 |
| A5 | 首屏真的只发 ~100 次 IPC 吗 | ✅ 主张成立。每段 5 个媒体位，但**无路径的位不发起 IPC**（`shouldRequestSegmentMedia` + `refresh*Urls` 内层判空），最坏 20×5=100；`ResultView.test.js` 用 mock 计数断言 `≤ 40`（夹具中每段只有 image+audio 两个路径） |
| A6 | 点名段会不会漏解析/重复解析 | ✅ 非问题。点名段并入 `firstBatch`，`loadProject` 传 `pendingSegmentBatch`（= firstBatch）给 `refreshSegmentImageUrls`；哨兵推进取 `slice(renderCount, renderCount+step)` 且 `seen` 去重，不重复解析 |
| A7 | 跳到未渲染段的行为 | 🟢 MINOR（可接受，已记入遗留）。`scrollToSegment` 依赖 `segmentItemRefs[index]`，目标段未渲染时 ref 为空 ⇒ 静默不跳。用户体感：点数字没反应。缓解：右侧「上一条/下一条」与滚动本身会持续推进窗口；彻底修法需要「跳转前自动展开到目标 index」，记入 §遗留 |
| A8 | 删除分段后场景号对应关系 | ✅ 非问题。`policyFlagSceneNumbers` 由路由 query 一次性解析（1-based 场景号），删除分段后不再重算——与旧实现完全一致（旧实现也是静态 query 解析），无行为变化 |
| A9 | `loadProject` 失败时占位区块显示什么 | ✅ 非问题。失败走 `catch` 分支：`project=null`、`projectId=null`，占位区块的 `v-else-if="projectId && !loading"` 不成立 ⇒ 落到 `!videoPath && !hasEditableContent` 的既有空态（「没有可预览的视频」+ 去创作按钮），并弹操作失败通知 |
| A10 | composable 死代码/未用参数 | ✅ 非问题。`resolveSegmentMediaPlan` 的 `firstPaintMediaPaths` 与 `SEGMENT_RENDER_STEP` 均有消费者（宿主 `previewLayout` 与编辑器）；`splitSegmentBatches` 由 `resolveFirstPaintSegments` 内部复用并单测 |
| A11 | console.log / 硬编码等待 / 同步阻塞 | ✅ 非问题。三个新文件无 `console.*`、无 `waitForTimeout`、无 `pbkdf2Sync`/`scryptSync`/大输入 `createHash`；唯一同步原语是 `story2video-media-server.js` 既有的 `realpathSync`（不在本 PR 改动范围） |
| A12 | 组件边界清晰度 | ✅ 非问题。卡片纯展示 + emit（不调 IPC）；编辑器管列表/窗口/哨兵；composable 管策略；宿主管 IPC 与状态。跨组件共用的槽位解析/字幕文本/失败原因均收敛到 composable 单一真源 |

### 遗留（不假装已闭合）

- **IPC 次数本身未降**：本 PR 是「按需申请」（首屏 20 段 + 视口内懒加载），单段仍 5 次 IPC。彻底方案是服务端批量签 URL，需改 IPC 契约 + preload + 三层测试，超出本轮范围，已记入 PRD §9。
- **窗口步长固定 20**：未按视口高度动态估算；169 段约需 8 次追加展开完。
- **`segmentDraft` 是浅拷贝**：嵌套对象（`alternateImages`/`videoMeta`）共享引用。当前编辑只改顶层字段故安全；若未来改嵌套字段需换深拷贝或结构化 emit。
- **未做实机 wall-time 复测**：量化结论来自 IPC 次数静态推算 + 单测计数。真实 169 段失败任务的进页耗时需实机复测（属外部验收）。
- **QM-4 视觉回归未跑**：本机 QG Visual 基线此前已仓库级失效（36/41 违规，见 `openspec/records/result-view-back-btn-style.md` 的同一结论），本轮不重建基线。改动集中在「无成片时多一个占位区块」与「分段区分批渲染」，建议在基线修复任务后统一重建。
- **A7（🟢 MINOR，QM-6 审查提出）**：右侧「分段定位」数字跳到**尚未渲染**的分段时静默无效（`segmentItemRefs[index]` 为空）。缓解：滚动与「上一条/下一条」会持续推进窗口。彻底修法需「跳转前自动展开到目标 index」，未在本轮实现（不影响正确性，只影响直达体验）。
