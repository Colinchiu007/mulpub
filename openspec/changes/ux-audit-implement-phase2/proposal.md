## Why

审计 `01-docs/UX-AUDIT-2026-10-17.md` §5 的阶段 2 落在发布主链路上，五条 finding 的共同形态是
「机制存在但用户读不出确定性」：进度条按终态数算（单任务全程 0%）、历史列表每行约 20 次格式化调用
且无渲染上限（超过上限时静默少画）、首屏把互不依赖的接口排成一队、后台通知在加载期间整条丢失、
封面取数用同步读把主进程事件循环冻结。

其中 audit-34 按审计要求先做了**前置测量**（不得以乘法推导定级）：本机实测 `monitorEventLoopDelay` 显示
同步形态下 200 张 3MB 是一次 397ms 的不可中断冻结、1000 张接近 2s；异步化压到 168ms，
但 1000 并发仍 1373ms ⇒ 定级保持 major，且"别为看不见的行取数"才是承重步骤。

## What Changes

- **2.2 历史列表三项**：筛选读防抖快照；行内派生值收敛为按 `record.id` 的查表；新增 `RENDER_LIMIT = 200`
  并在超出时以 `role=status` 的提示行如实说出被收起的条数。展示值纯映射与状态判据分别抽到
  `composables/usePublishHistoryRowFormat.js` 与 `utils/publish-record-status.js`。
- **2.4 自动化页通知**：监听注册移到 `await load()` 之前。
- **2.3 首屏并行化**：`Publish.vue` / `Collection.vue` / `PodcastChannelView.vue` 的独立数据源同批发起。
- **2.1 ①③ 封面取数**：`cover:read-data` 的读盘改异步（并去掉同步 `existsSync`）；
  渲染侧改为 IntersectionObserver 可见区驱动，无 IO 环境退回立即加载。
- **2.5 聚合进度**：新增 `stores/publish-progress-aggregate.js` 单一实现，进度条走软权重（上限 95），
  「成功 x/y」保持终态口径，另加「第 N / 共 M 项」这一计数出口。

不做（明确排除）：2.1 ②（小图生成与缓存）、2.6 / 2.7 / 2.8 留待后续批次；
`cover:crop` 恒失败（自 PR #1174）另列任务，不与本批混在同一提交里，以免变异反证无法归因。

## Impact

- Affected specs: `desktop-publish-certainty`（新增能力）
- Affected code: `apps/desktop/src/views/{PublishHistory,Publish,Collection,PodcastChannelView,AutomationView}.vue`、
  `apps/desktop/src/composables/{usePublishHistoryRowFormat,useHistoryCoverThumbnails}.js`、
  `apps/desktop/src/utils/publish-record-status.js`、
  `apps/desktop/src/stores/{publishProgress.js,publish-progress-aggregate.js}`、
  `apps/desktop/src/components/PublishProgressPanel.vue`、
  `apps/desktop/electron/services/cover-cropper.js`、`apps/desktop/electron/ipc-handlers/publish.js`、
  `apps/desktop/src/locales/{history-page,publish-page}/{zh,en}.js`
- Risk: 中。改动集中在渲染层与一个 IPC handler 的读法；IPC 返回形状未变
- 回归锁：16 条变异反证（M1–M16）逐条实跑变红，详见 `01-docs/PRD-UX-AUDIT-PHASE2-PUBLISH-FLOW-2026-10-19.md` §6
