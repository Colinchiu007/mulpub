# Proposal: publish-throughput-optimization

## Why

用户实测「发布 1 个图文到抖音，进度面板排队中」，排查确认三层慢因（代码取证 2026-10-04，工作目录 D:/Data/projects/mulpub）：

1. **RPA 抖音图文链固定 sleep 叠加**（`apps/desktop/electron/services/rpa-view-platforms.js` `_publish_douyin`）：
   图片注入后 `_sleep(4000)`（:930）+ 每个 tag `_sleep(1000)`（:980）+ 封面 `_sleep(1000+2000)`（:972）+ 提交兜底 `_sleep(5000)`（:992）。
   表单就绪轮询已存在（:934 `_waitForCondition` 30s），前面的固定 sleep 是**纯叠加浪费**，单任务约 10~15 秒无判据等待。
   视频上传已于 2026-10-01 完成同类改造（`upload-waiter.js` v4 自适应轮询），图文是同族反模式的漏网面。
2. **队列并发模型过粗**（`packages/shared-utils/src/task-queue.js` + `container.setup.js:335`）：
   全局 `maxConcurrent: 3`，不看「平台+账号」维度。10 个目标的批次要 4 波串行 ≈ 4-6 分钟纯排队；
   且同账号两条任务可同时各开一个浏览器窗口对同一创作者后台操作——风控隐患 + 进度串台
   （`publish-progress-events.js` 的 platform→taskId 路由是单键 last-write-wins，PRD §14 已文档化的已知近似）。
3. **每个任务冷启动整个浏览器会话**（`rpa-view-manager.js:124` `_createWindow` → `:156` `win.destroy()`）：
   每任务新建隐藏 BrowserWindow + cookies/auth 分区/browser storage 三段串行恢复（:128-131）+ 冷缓存导航，每任务固定 3~8 秒结构开销；批量场景浪费成倍。

频控缺口已由 PR #2773（publish-frequency-control）单独闭环（两档最小间隔 + 装配接线 + 九条变异反证），
本变更不重复其内容，**依赖其合并后的 main 作为基线**。

## What Changes

- **A2 固定 sleep → 事件驱动等待**（rpa-view-platforms.js `_publish_douyin`）：删 4 处纯叠加 sleep（4000/tag 1000/封面 1000+2000/兜底 5000→轮询）。
  就绪信号：图片上传后直接依赖既有 `_waitForCondition(表单, 30s)`（4s sleep 纯删除）；tag 就绪 = tag chip DOM 出现（新 `_waitForCondition` 探针，500ms 间隔，上限 5s/个）；封面就绪 = 封面缩略图 img 计数基线增加（头条先例 `_uploadToutiaoCover`）；提交兜底 = URL 变化 500ms 间隔轮询 5s（替代睡 5s 查一次）。等待超时走既有降级路径，**不新增失败分支**。
- **B 队列按 (platform, accountId) 通道调度**（task-queue.js）：`_processNext` 在并发上限内按通道键分发——同通道 FIFO 串行（防平台风控 + 消除同账号双窗竞争），跨通道并行吃满 `maxConcurrent`。键 = `platform + ':' + (accountId ?? '')`；`accountId` 缺席回退全局队列语义（向后兼容）。`maxConcurrent` 经 `MP_QUEUE_MAX_CONCURRENT` 环境变量覆盖（排障用，非法值回落 3 并出声告警，对齐 publish-frequency-policy 的覆盖纪律）。
- **C 窗口池 + 空闲 TTL**（rpa-view-session.js / rpa-view-manager.js）：按 `platform:accountId` 复用隐藏 BrowserWindow（上限 6 个，`MP_RPA_POOL_SIZE` 可覆盖），空闲 TTL 10 分钟（`MP_RPA_POOL_TTL_MS`）后台清理，复用前导航到 `about:blank` 清页面状态；`publish()` 结束不再 `destroy()` 而是归还池。登录态跨任务复用（同账号 cookie 本就持久在 partition），**复用前不重复做三段 cookie 恢复**（首次创建时恢复一次）。
- **D 抖音图文 API 直连链**（api-publish-engine）：新增 `publish/platforms/douyin-image.js`（多图 imagex 上传链复用 douyin-video.js 的 imagex 上传器 + item_type=image 提交，逐切片对照 W2 取证纪律），`adapters/douyin.js` 扩展图文分支（不再 fail-closed on `taskData.video.path`，图文走 `taskData.images[].path`），`rpa-view-manager.js` API-first 分支对 douyin 图文自动生效（`supportsApi` 现有判据）。RPA 图文链保留为 fallback（API 失败自动回退，现有行为）。

## Impact

- 代码：`packages/shared-utils/src/task-queue.js`（B）、`apps/desktop/electron/core/container.setup.js`（B 注入）、
  `apps/desktop/electron/services/rpa-view-platforms.js`（A2）、`rpa-view-session.js` + `rpa-view-manager.js`（C）、
  `packages/api-publish-engine/src/publish/platforms/douyin-image.js`（新文件，D）+ `adapters/douyin.js`（D）。
- 契约：TaskQueue 内部调度行为变更（对外 `add/add/cancel/getStatus` 形状不变，`getStatus().running/queue` 语义不变）；
  RpaViewManager 窗口生命周期变更（新增池化，`windows` 语义从「活动窗口」扩展为「活动+池化」）；
  api-publish-engine 对 douyin 图文新增 API 能力（`supportsApi('douyin')` 图文路径从 false 变 true）。
- 兼容：无 IPC 形状变化、无 locale 新增（A2/B/C/D 均无用户可见文案变化）、无 store schema 变化。
- 风险：B 与 #2773 都改 task-queue.js（rebase 顺序处理）；C 的窗口池需处理「任务失败后窗口残留状态污染下一任务」（归 blank 导航 + 失败任务仍销毁窗口兜底）；D 依赖抖音接口切片真实性（按 W2 纪律逐切片真机取证，本变更只交付链路 + dry-run/单测层验证，真机验证按 learnings「平台侧无法离线证伪」原则登记 PENDING）。
- 文档：`01-docs/PRD-PUBLISH-THROUGHPUT-OPTIMIZATION-2026-10-04.md`（本变更专题 PRD）+ `AGENTS.md` QM-2 补「窗口池生命周期」条目 + `CHANGELOG.md` 收口。

## 不做（显式排除）

- 不动 `publish-frequency-policy.js` 两档间隔（#2773 已交付）。
- 不做进度路由从 platform 单键升级为 (platform,accountId)（C 的同账号串行已消除串台根源，路由升级单独立项）。
- 不做 `publish-contract.js` 渲染层改动。
- 不做其他平台（快手/小红书等）的图文 API 链——只做抖音（用户场景 + W2 取证仅覆盖抖音）。
