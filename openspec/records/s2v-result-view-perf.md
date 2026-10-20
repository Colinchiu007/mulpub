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
| QM-6 CCG 双模型外部评审 | ➖ N/A（按触发条件判定） | 非 M+/中高风险（无主进程服务/核心引擎/安全/状态机变更）；风险面集中在渲染端分批与懒加载，已由 28 条新用例守住 |
| 远程同步 | 由门禁推导 | 新 PR 不手写状态词，收口由 `scripts/lib/merge-ledger.js` 按主干历史推导 |

### 本轮自己踩到并修掉的四个坑（都写进了 PRD/测试，不是靠记忆）

1. **max-lines 的 targets 零容差第一版就拦下我**：把逻辑直接写进 ResultView.vue ⇒ 2062 行 > 点名目标 1890（`TARGET_GREW` 红）。正解不是申请抬基线，而是把分段编辑区整块抽成组件——抽完反而降 119 行，从「还账对象」变成「有空间的普通文件」。
2. **抽组件抽出一连串契约断裂**：`sceneMaterialSlots`/`segmentStatusReason`/`subtitleBlocksText`/`segmentVoiceSpeedText` 被 5 条既有用例直接调用。修法不是改测试迁就实现，而是把这些逻辑搬进 composable、两边共用薄包装。
3. **`v-model="segment.xxx"` 撞 `vue/no-mutating-props`**：卡片内引入 `segmentDraft` 浅拷贝 + `watch(segment, deep)` 同步。（`_draft` 命名又撞 `vue/no-reserved-keys`，已改名。）
4. **CSS 搬运差点整块丢失**：PowerShell 数组索引拼接把 scoped CSS 变成单行巨串，我的拆分脚本两轮都把规则清空。最终从 `git show HEAD:ResultView.vue` 重新提取原始 CSS 按选择器前缀分类搬移，并用「编辑器剩 2 条」这个异常读数发现丢失。

### 遗留（不假装已闭合）

- **IPC 次数本身未降**：本 PR 是「按需申请」（首屏 20 段 + 视口内懒加载），单段仍 5 次 IPC。彻底方案是服务端批量签 URL，需改 IPC 契约 + preload + 三层测试，超出本轮范围，已记入 PRD §9。
- **窗口步长固定 20**：未按视口高度动态估算；169 段约需 8 次追加展开完。
- **`segmentDraft` 是浅拷贝**：嵌套对象（`alternateImages`/`videoMeta`）共享引用。当前编辑只改顶层字段故安全；若未来改嵌套字段需换深拷贝或结构化 emit。
- **未做实机 wall-time 复测**：量化结论来自 IPC 次数静态推算 + 单测计数。真实 169 段失败任务的进页耗时需实机复测（属外部验收）。
- **QM-4 视觉回归未跑**：本机 QG Visual 基线此前已仓库级失效（36/41 违规，见 `openspec/records/result-view-back-btn-style.md` 的同一结论），本轮不重建基线。改动集中在「无成片时多一个占位区块」与「分段区分批渲染」，建议在基线修复任务后统一重建。
