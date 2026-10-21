# PRD：发布进度全局反馈面板与后台运行（publish-progress-ux）

- **日期**：2026-09-28
- **状态**：实施中（openspec change：`openspec/changes/publish-progress-ux/`）
- **修订**：2026-10-01 publish-progress-fix（`01-docs/PRD-PUBLISH-PROGRESS-FIX-2026-10-01.md`）——修复 registerSession 与孤儿事件先到的会话登记竞态（重复会话/幽灵排队任务）+ 上传等待真实百分比/自适应预算；本文件 §5.2「registerSession 新建会话」语义自该日起为「收养合并优先，找不到才新建」
- **修订**：2026-09-29 publish-progress-panel-refine（openspec change：`openspec/changes/publish-progress-panel-refine/`）——面板视觉/UE 精化 + `cancelled` 相位 + 取消入口 + 自动收敛；本文件契约表已同步修订（§5.1/§5.2/§6.1/§7/§8.1-§8.4/§12），专题 PRD 见 `01-docs/PRD-PUBLISH-PROGRESS-PANEL-REFINE-2026-09-29.md`
- **关联**：`01-docs/PRD.md` §六（发布流程）新增 6.7；`01-docs/PRD-OVERLAY-VIEW-SUSPENSION-2026-09-23.md` §5 通查清单补登；先例合同：`01-docs/PRD.md`「视频创作后台运行与并发合同」§3a.2
- **一句话**：点击发布后，用户在任何页面都能看到「到了什么环节、进展如何」，可以最小化让发布后台继续（明确提示勿关应用），失败可见可重试，关窗转托盘不丢任务。

---

## 1. 背景与问题（实证缺口清单）

> 全部缺口经只读侦察实证，路径:行号以 `origin/main@878a111d` 为基线。

| # | 缺口 | 实证 | 性质 |
|---|------|------|------|
| G1 | **单篇进度监听器毫秒级死亡**：`usePublishFlow.js:399-414` 注册 `publish:progress` 监听（注释与 `:411-413` 条件注销表明意图是「全部完成才注销」），但 `:438-441` `finally` 在 `await publishBatch` 返回后**无条件 `off()`**；而 `publish:batch` IPC 同步入队后毫秒级返回（`ipc-handlers/publish.js:282-293`）。任务执行期间全部事件无人接收，用户只见「任务已加入队列」，**不知道发布是否成功** | `usePublishFlow.js:399-441` | **Bug**（QM-5 反思循环见 §13） |
| G2 | 批量模式阶段级监听同样短命（`useBatchPublish.js` finally 无条件注销）；批量监听与轮询随组件卸载清除（`:121-123`），切页即失明 | `useBatchPublish.js` | Bug/架构 |
| G3 | percent 全链路丢弃：`rpa-view-manager.js:39-47` 的 `rpa:progress` 含 percent 但渲染层零消费；`bootstrap.js:100` 转发只解构 `{ stage }` | `bootstrap.js:100` | 缺陷 |
| G4 | ApiPublisher 直连轨（bilibili/baijiahao，ROUTE_TABLE `publisher-router.js:35-36`）**完全不发进度事件** | `publisher-router.js:448-503` | 缺陷 |
| G5 | `rpaViewManager.onProgress` 单槽回调，maxConcurrent=3 并发任务互相覆盖，进度跨归属 | `rpa-view-manager.js:38` | 缺陷 |
| G6 | 阶段文案英文硬编码直出中文用户（`'navigating...'` 等）；两引擎阶段模型不一致（RPA 按平台 10+ 阶段 vs API 固定 4 阶段） | `rpa-view-platforms.js` / `base-adapter.js` | UX |
| G7 | 无任务开始边界事件（对照账号批量检测 start/done 双边界先例 `account.js:644/734`），渲染层无法知道「当前正在发布哪个平台/还剩几个」 | `bootstrap.js:82-109` | 缺陷 |
| G8 | **发布失败不落历史**：`phase4-events.js:91-111` task:failed 只发事件，不调 `history.addRecord`——失败结果在任何页面都查不到，重试入口形同虚设 | `phase4-events.js` | 缺陷 |
| G9 | 窗口关闭不保护发布任务：`window.js:136-154` 托盘隐藏判据只查 `pipelineEngine.hasRunningOrchestration()`；发布中关窗走退出链，运行中任务被标记 cancelled | `window.js:136-154` | UX/数据安全 |
| G10 | 频控等待/重试事件为纯文本 payload（无结构化字段），无法渲染倒计时/进度 | `phase4-events.js:113-131` | 缺陷 |

**既有可复用资产**（本 PRD 全部复用、零新基建）：`publish:progress` 事件通道与 preload 映射（`preload/publish.js:115-119`）、`queue:status`/`queue:retry`/`queue:cancel` IPC、TaskQueue `deserialize` 跨重启恢复（`task-queue.js:284-342`，运行中被中断任务重排队）、托盘隐藏基建（`window-close-policy.js`）、全局浮层宿主模式（App.vue + UpdateNotification/PipelineBackgroundToast）、云同步弹窗「后台继续/停止」语义先例（`AccountCloudSyncDialog.vue`）。

## 2. 目标与非目标

### 目标
1. 用户点击发布后，**任何路由**都能看到全局进度（会话×平台×步骤状态 + 百分比 + 汇总 N/M）。
2. 进度面板**可最小化**为常驻胶囊（后台运行语义），首次隐藏有一次性教育 toast，胶囊常驻「请勿关闭应用」提示。
3. 修复 G1-G5、G7、G8、G10 链路缺陷（加法式，不动编排语义）。
4. 发布运行中关窗 → 托盘后台继续 + 气泡提示（G9）。
5. 失败可见（面板红标 + 错误消息 + 落历史）可重试（会话级「重试失败项」）。
6. 阶段/状态文案全部走 locales（zh/en 成对），状态文字+图标双通道。

### 非目标
- 不改 TaskQueue 编排语义（并发 3、自动重试 2、超时 180s/视频 30min、失败不中断整批——全部保持）。
- 不做跨重启断点续跑新增能力（`deserialize` 恢复已存在；本 PRD 只如实呈现其语义）。
- 不做阶段级实时日志尾部流、发布排队调度器、定时/云端发布流程改造。
- 不改 ROUTE_TABLE 与两引擎内部阶段序列。

## 3. 术语

| 术语 | 定义 |
|------|------|
| **会话（session）** | 一次发布动作产生的任务集合：单篇轨以 taskIds 登记，批量轨以 batchId 登记；渲染层重载领养的孤儿任务也成会话 |
| **相位（phase）** | 事件生命周期边界：`start`/`progress`/`success`/`failed`/`retry`/`blocked` |
| **阶段键（stageKey）** | 稳定的规范步骤枚举（9 值），由主进程映射表从引擎原始阶段串归一 |
| **胶囊（pill）** | 面板最小化后的常驻紧凑指示器（右下角） |
| **孤儿任务** | 渲染层未登记、但队列中存在（运行/排队）的任务（典型：渲染层重载后） |

## 4. 总体流程

### 4.1 事件流（主进程 → 渲染层）

```
TaskQueue executor（bootstrap.js）
  ├─ 取任务 → emit phase:'start'（stageKey=prepare, percent=0）
  ├─ RPA 轨：rpaViewManager._emitProgress(platform, stage, percent)
  │    └─ 全局 onProgress 回调（bootstrap 装配期注册一次）
  │         └─ platform→taskId 路由 → emit phase:'progress'（stageKey+percent）
  ├─ API 直连轨：ApiPublisher(options.onProgress) → publishViaApi(onProgress)
  │    └─ (pct, msg) → emit phase:'progress'
  └─ 终态（phase4-events，单一来源）
       ├─ task:success → emit phase:'success'（percent=100, result）+ 历史记录 + 监控/追踪
       ├─ task:failed  → emit phase:'failed'（error）+ 历史记录（新增）+ 风控挂起
       ├─ publish:blocked → emit phase:'blocked'（remainingWait）
       └─ task:retry → emit phase:'retry'（retriesLeft）
```

### 4.2 渲染层状态流

```
usePublishFlow / useBatchPublish
  └─ 发布 IPC 返回 taskIds/batchId → store.registerSession() → 面板自动展开
store（App 级订阅，永随组件卸载而死）
  ├─ handleProgressEvent：taskId→会话（无则 batchId→会话，再无则建孤儿会话）
  ├─ handleBatchEvent：batch-complete/task-complete（批量轨兜底）
  ├─ init()：queue:status 快照领养孤儿任务（渲染层重载恢复）
  └─ 会话全部任务终态 → session.status='done'
       ├─ 页面结果卡（watch 会话终态）→ 成功/失败汇总
       └─ 面板（展开态）→ 汇总 + 「重试失败项」；（最小化态）→ 胶囊变完成态 + 汇总 toast
```

### 4.3 任务状态机（store 内 TaskState.phase 迁移）

```
queued ──start──► start ──progress──► progress ⇄ retry（重试）/ blocked（频控等待）
                     │                        │
                     └──────终态──────────────┴──► success | failed
（终态后不再迁移；retry 事件把 phase 拉回 retry，随后新 start/progress 事件继续）
```

校验规则：终态（success/failed）是**吸收态**——终态后到达的 `progress`/`start` 事件（迟到事件）不回退状态，仅更新 `lastEventAt`；`success` 后到达 `failed`（同 taskId）以先到者为准并记 warn 日志（正常不应发生）。

## 5. 功能逻辑（分层）

### 5.1 主进程事件富化层（`electron/services/publish-progress-events.js`）

**单一实现三件套**：

1. `mapStageToKey(stage)`：封闭映射表 + 前缀规则（见 §6.3）。未知串 → `'detail'`。
2. `createPublishProgressEmitter({ getMainWin })`：`emit(taskId, platform, phase, extra)` → 组装完整 payload → `win.webContents.send('publish:progress', payload)`。守卫：win 为空/已销毁 → 跳过；`taskId`/`platform` 非非空字符串 → 跳过并 `log.warn`；`percent` 非 0-100 有限数 → 归 `null`。
3. `createTaskProgressRouter()`：`register(platform, taskId)` / `unregister(platform, taskId)`（仅当当前映射仍指向该 taskId）/ `resolve(platform)`。last-write-wins（同平台并发近似归属，见 §14）。

**接线点**：
- `bootstrap.js` 装配期：创建 emitter + router；`rpaViewManager.onProgress` **全局注册一次**：`(data) => { const taskId = router.resolve(data.platform); if (taskId) emitter.emit(taskId, data.platform, 'progress', { stage: data.stage, percent: data.percent }) }`。
- executor：开始时 `router.register(platform, task.id)` + `emitter.emit(task.id, platform, 'start', { stage: '准备发布...', stageKey: 'prepare', percent: 0 })`；finally `router.unregister(platform, task.id)`；向 `publisher.publish(task, { signal, onProgress })` 传入 `(pct, msg) => emitter.emit(task.id, platform, 'progress', { stage: msg, percent: pct })`（仅 ApiPublisher 消费）。
- 删除 executor 内 `emitProgress('✓ 发布成功')`（`bootstrap.js:103`）——终态单一来源是 phase4-events 的 `task:success`（现状两处重复发送，收敛为一处）。
- `phase4-events.js`：四事件改走 emitter（payload 见 §7）；`task:failed` 补 `history.addRecord({ platform, title: task.article?.title || '', taskId: task.id, status: 'failed', result: null, error: task.error }, task.owner_subject)`。
- `phase4-events.js`（panel-refine 修订）：`task:cancelled` → `emitter.emit(taskId, platform, 'cancelled', { stage: '⊘ 已取消', batchId })`——TaskQueue 取消任务（pending 移除/running 协作中止两路径）都发该事件，但此前无人转发，页面级取消后浮窗永远「进行中」；取消不落历史、不触发风控挂起（取消不是失败）。

### 5.2 渲染层全局 store（`src/stores/publishProgress.js`，pinia）

**State**：
```
sessions: Session[]            // 上限 5，超出裁剪最旧已完成会话
panelVisible: boolean          // 展开浮卡
panelMinimized: boolean        // 最小化胶囊（与 panelVisible 互斥）
firstHideToastShown: boolean   // localStorage: 'mp-publish-first-hide-toast-shown'
_listenersBound: boolean       // init() 幂等
```
**Session**：
```
{ id, batchId: string|null, title: string, createdAt: number,
  status: 'running'|'done', finishedAt: number|null,
  tasks: { [taskId]: TaskState }, taskOrder: string[],
  log: { time, text, type }[] }   // 事件日志（页面时间线/调试用）
```
**TaskState**：
```
{ taskId, platform, phase, stageKey, stage, percent: number|null,
  result, error, remainingWait, retriesLeft,
  startedAt, endedAt, lastEventAt }
```

**Actions**：
- `init()`：幂等绑定 `onProgress`/`onBatchProgress` 全局订阅（返回的 unsubscribe 不保存——App 级永驻）；读 localStorage 恢复 firstHideToastShown；调 `getQueueStatus()` 领养孤儿任务（见 §9 R2）。
- `registerSession({ taskIds?, batchId?, title?, platforms? })`：创建会话（tasks 初始 `phase:'queued'`）；`panelVisible=true, panelMinimized=false`（自动展开）；taskIds 为空且无 batchId → no-op。
- `handleProgressEvent(data)`：校验（§6.4）→ 定位会话（taskId 命中 → batchId 命中 → 建孤儿会话）→ 更新 TaskState（相位迁移按 §4.3 吸收态规则）→ 追加 log → 会话终态判定（全部任务 success/failed → `status='done'`）→ 若面板最小化且会话刚终态 → 汇总 toast（§8.4 T7）。
- `handleBatchEvent(data)`：`batch-complete` → 对应会话补终态兜底（以事件计数为准，不覆盖已有任务终态）；`task-complete` → 更新对应任务（与 progress 事件冗余容错）。
- `retryFailed(sessionId)`：收集会话内 `phase==='failed'` 任务 → 逐个 `retryTask(taskId)`（IPC）→ 成功的以返回的新 taskId 替换原条目（`phase:'queued'`，清 error/result）→ 会话 `status='running'`；返回 `{ ok, fail }` 计数。进行中防重入（`retrying` 标志）。
- `retryOne(sessionId, taskId)`（panel-refine 新增）：单任务级重试——与 retryFailed 共享 `_retryOne` 路径与 `retrying` 防重入；失败行内联「重试此任务」入口。
- `cancelRunning()`（panel-refine 新增）：对全部会话内非终态任务逐个 `cancelTask(taskId)`（IPC `queue:cancel`，`Promise.allSettled`）→ 返回 `{ ok, fail }`；`cancelling` 防重入；无在途任务 no-op。任务状态更新以转发的 `phase:'cancelled'` 事件为单一来源——本动作只发取消请求与汇总计数，不自行改写任务相位（不自造第二份真相）。
- `minimizePanel()` / `expandPanel()` / `dismissSession(id)` / `clearFinished()`。
- `consumeFirstHideToast()`：首次最小化时返回 true 并持久化标志（供面板组件弹一次性 toast）。

**Getters**：`hasRunning`（任一会话 running）、`aggregate`（全部会话合计 done/total/succeeded/failed/**cancelled**——panel-refine 新增 cancelled 计数，done=succeeded+failed+cancelled）、`activeSessions`、`sessionFailedCount(id)`。

### 5.3 全局面板（`src/components/PublishProgressPanel.vue`）

- **挂载**：App.vue 根级（与 UpdateNotification/PipelineBackgroundToast 同级，全壳态常驻）；组件 setup 调 `store.init()`。
- **形态**：Teleport to body；`position:fixed; right:var(--spacing-6); bottom:calc(var(--spacing-6) + 52px)`（避让 BackToTop 44px 按钮）；`z-index:1950`（BackToTop 1900 之上、UpdateNotification 2000 之下）；tokens.css 语义 token；`prefers-reduced-motion` 关闭动效。
- **非模态**：无遮罩、不阻塞交互；**不接入** `useEmbeddedViewSuspension`（按 PRD-OVERLAY-VIEW-SUSPENSION §6 口径，负向测试锁）。
- **数据渲染**：展开卡 = 头部（标题+运行徽标+最小化+关闭）+ 汇总行（N/M + 失败数 + 微型进度条）+ 会话列表（每会话：标题 + 状态徽标 + 任务行 + 会话级「重试失败项」）；胶囊 = 汇总 + 微型进度 + 常驻提示。
- **关闭按钮**：仅无运行任务时可用（清除已完成会话）；运行中最小化是唯一收纳动作。

### 5.4 页面 composables 改造

**usePublishFlow.js**：
- 删除 `:399-414` 本地 onProgress 块与 `:440` `finally off()`（G1 修复——订阅所有权上移 store）。
- `publishBatch` 成功后：`publishProgressStore.registerSession({ taskIds: activeTaskIds.value, title: data.title, platforms: targets.map(t => t.platform) })`。
- 新增 watch（会话终态）：全部成功 → `result.value = { success: true, message: t('publishPage.publishFlow.resultAllSuccess', {count}), url: 首个成功 url }` + 时间线成功条目；存在失败 → `result.value = { success: false, message: t('publishPage.publishFlow.resultPartial', {...}) }` + 时间线失败条目。`publishing` ref 语义不变（IPC 返回即复位，允许并发追加——现状语义）。
- `cancelPublish`/`retryPublish` 不变（activeTaskIds 仍来自 IPC 返回）。

**useBatchPublish.js**：
- 删除阶段级本地 onProgress 监听（`:375-381`，原本就收不到事件——阶段进度由全局面板承载）。
- `batchExecute` 成功后：`registerSession({ batchId, title: 批次名, expectedCount })`（任务条目由事件按 batchId 归属动态创建）。
- 既有 `batch:progress` 页面监听、`batchGet` 轮询、`failedBatchTasks`/`retryFailedBatch`、finishBatchProgress toast **全部保留**（页面卡与全局面板双轨呈现，互不依赖）。

### 5.5 关窗保护（托盘后台继续）

- `window-close-policy.js`：`shouldHideToTrayOnClose({ platform, hasRunningPipeline, hasRunningPublish, trayAvailable })` → 非 darwin 且 `(hasRunningPipeline || hasRunningPublish) && trayAvailable`。
- `window.js` `shouldHideToTray(context)`：`hasRunningPublish = (() => { try { const s = context.taskQueue?.getStatus?.(); return (s?.running?.length || 0) + (s?.queue?.length || 0) > 0 } catch { return false } })()`（守卫口径与流水线同款）。
- close 拦截分支：隐藏后若 `hasRunningPublish` → `systemTray.showBalloon('发布仍在后台进行', '发布任务正在后台继续执行，请勿退出程序。点击托盘图标可恢复窗口。')`；日志区分「流水线/发布」来源。
- `system-tray.js` 新增 `showBalloon(title, content)`：`process.platform === 'win32'` 且 tray 存活且 `typeof tray.displayBalloon === 'function'` 才调用，否则静默跳过（非 Windows 降级，见 §9 R5）。

### 5.6 失败落历史

`phase4-events.js` task:failed 分支补 `history.addRecord`（§5.1）。写入失败不阻塞发布主流程（addRecord 内建 try/catch，`publish-history.js:90-97`）。历史页 failed 过滤器（`PublishHistory.vue` 状态过滤）自此可见失败记录。

### 5.7 失败原因渲染收口（2026-09-29，publish-history-error-detail）

> G8 只打通了「失败落历史」的数据链路（executor → task:failed → addRecord(error) → JSONL → historyList API 原样返回 `error` 字段），渲染侧从未消费该字段——用户在历史页看到红色「发布失败」徽标与失败计数，但失败原因只能翻主进程日志。本节把 `error` 字段的展示钉进历史页合同。

**数据校验（渲染侧，`PublishHistory.vue` `recordErrorText(record)`）**：
- 仅 `normalizedStatusGroup(record) === 'failed'`（status ∈ {failed, error} 或 `success === false`）的记录参与；success/pending 记录一律返回空串、不渲染。
- `record.error` 非字符串或空白（trim 后空）→ 返回空串：**列表卡片不渲染失败原因行**（旧行记录可能无 error 字段，卡片保持原布局）；**详情弹窗显示占位文案**（见下），两处行为刻意不对称——卡片宁缺勿占行，详情必答「为什么失败」。
- `error` 为非空字符串 → trim 后原样透传（不截断、不转义、不翻译——错误文本来自引擎层，多为英文技术短语，翻译反而失真）。

**流程**：`historyList` IPC 返回记录（含 `error` 字段）→ 列表渲染时逐条经 `recordErrorText` 判定 → 卡片行/详情字段两处消费；用户点「详情」→ `historyGet` 取全量记录 → 详情弹窗按同一 `normalizedStatusGroup` 判定渲染失败原因格。

**功能逻辑**：
- 列表卡片：失败原因行渲染在 `.record-delivery`（状态徽标/发布方式/平台名）之后，`data-testid="record-error-{record.id}"`，`title` 属性携带全文（悬停可见）。
- 详情弹窗：失败原因格紧跟「状态」行，`data-testid="detail-error-reason"`；跨双列（`grid-column: 1 / -1`）。
- 成功/进行中记录：两处均不渲染失败原因（无占位、无空行）。

**交互逻辑**：
- 列表卡片行：单行截断（`text-overflow: ellipsis`），防长错误文本顶开卡片布局；悬停 `title` 显示全文。
- 详情弹窗格：允许换行完整展示（`word-break: break-all; white-space: pre-wrap`）——错误文本可能含长堆栈，截断不可读。
- 失败原因行/格与「重试」按钮（既有 `retry-{record.id}`）视觉相邻，构成「看原因 → 重试」闭环。

**显示项**：
| 位置 | 显示项 | 条件 | 样式 |
|------|--------|------|------|
| 列表卡片 | 失败原因文本（单行截断 + title 全文） | 失败组 且 error 非空 | `.record-error`：`#b42318`（与 status-badge.failed 同色系）、font-size-xs |
| 详情弹窗 | 「失败原因」标签 + error 全文（可换行） | 失败组（无论 error 有无） | `.record-detail-error`：跨双列、dd `#b42318` |
| 详情弹窗 | 占位文案「未记录失败原因」 | 失败组 且 error 空/缺失 | 同上格，文案走 locales |

**提示文字（locales `historyPage.*`，zh/en 成对）**：
| 键 | zh | en |
|----|----|----|
| `detailErrorReason` | 失败原因 | Failure reason |
| `errorUnknown` | 未记录失败原因 | Failure reason not recorded |

**验收标准**：
① 失败记录（含 error）在历史列表卡片显示失败原因单行，悬停可见全文；② 详情弹窗显示「失败原因」字段与 error 全文；③ 失败记录无 error 字段时详情弹窗显示「未记录失败原因」占位，卡片不渲染该行；④ 成功记录两处均不渲染失败原因；⑤ zh/en 文案成对（CI Gate 7）。回归锁：`PublishHistory.test.js` 5 个用例（卡片显示/成功不渲染/详情显示/无 error 占位/详情无 result 行既有用例不回归）。

## 6. 数据模型与校验

### 6.1 `publish:progress` payload 契约（向后兼容加法）

| 字段 | 类型 | 必有 | 校验规则 | 说明 |
|------|------|------|----------|------|
| `platform` | string | ✓ | 非空字符串 | 既有字段 |
| `taskId` | string | ✓ | 非空字符串 | 既有字段 |
| `stage` | string | ✓ | 非空字符串 | 既有字段；原始阶段文本（未知串透传给 UI 作明细行） |
| `phase` | enum | ✓ | `start`/`progress`/`success`/`failed`/`retry`/`blocked`/`cancelled`（panel-refine 新增终态） | **新增**；非法值按 `progress` 处理并 warn |
| `stageKey` | enum | ✓ | 9 值枚举（§6.3） | **新增**；非法值按 `detail` 处理 |
| `percent` | number\|null | ✓ | `null` 或 0-100 有限数 | **新增**；越界/NaN → `null` |
| `batchId` | string\|null | ✓ | 非空字符串或 `null` | **新增**；批量轨会话归属 |
| `timestamp` | number | ✓ | 正整数（Date.now()） | **新增** |
| `result` | object | success 时 | 任意 JSON | 既有字段（success 事件） |
| `error` | string | failed 时 | 非空字符串 | 既有字段（failed 事件） |
| `remainingWait` | number | blocked 时 | 正整数（ms） | 既有字段（blocked 事件） |
| `retriesLeft` | number | retry 时 | 非负整数 | **新增**（此前只在 stage 文本里） |

### 6.2 store 侧事件校验（fail-closed）

`handleProgressEvent(data)`：
1. `data` 非对象 / `taskId` 非非空字符串 / `platform` 非非空字符串 → **丢弃**（console.warn，不建会话）。
2. `phase` 非法枚举 → 按 `'progress'` 处理 + warn。
3. `stageKey` 非法枚举 → 按 `'detail'` 处理。
4. `percent` 非法 → `null`。
5. 终态吸收态规则（§4.3）：终态后迟到事件不回退。

### 6.3 stageKey 映射表（封闭清单，主进程单一实现）

**前缀规则（优先）**：`✓` → `done`；`✗` → `failed`；`⏳` → `waiting`；`⟳` → `waiting`；`Failed: ` / `Error: ` → `failed`。

**精确串表**（实现时以 `rpa-view-platforms.js` / `rpa-view-manager.js` / `base-adapter.js` grep 全量核对，新增串必须登记+测试锁）：

| 原始串 | stageKey | 原始串 | stageKey |
|---|---|---|---|
| `准备发布...` | prepare | `navigating...` | prepare |
| `starting browser...` | prepare | `navigating to draft` | prepare |
| `cookies restored` | prepare | `using API publish engine...` | prepare |
| `preparing declaration` | prepare | `preparing AI declaration` | prepare |
| `preparing category & copyright` | prepare | | |
| `uploading file...` | upload | `file uploaded` | upload |
| `uploading video...` | upload | `video uploaded` | upload |
| `waiting upload` | upload | `upload complete` | upload |
| `uploading cover...` | upload | `Uploading video...` | upload |
| `Uploading cover...` | upload | | |
| `filling title...` | fill | `filling content...` | fill |
| `filling desc...` | fill | `adding tags...` | fill |
| `checking agreement` | fill | `saving draft` | fill |
| `publishing...` | submit | `Publishing...` | submit |
| `clicking Create` | submit | `mass sending` | submit |
| `next step (elements)` | submit | | |
| `verifying...` | verify | `waiting for editor` | verify |
| `draft saved` | verify | | |
| `published!` | done | `Published!` | done |
| `done` | done | | |
| （其余任意串） | detail | | |

### 6.4 会话/任务数据校验

- `registerSession`：`taskIds` 数组元素须为非空字符串（过滤非法项）；`batchId` 非空字符串或 null；`title` 缺省回退 locale `sessionTitleFallback`；空会话（无 taskIds 且无 batchId）不创建。
- 会话上限 5：超出时从最旧**已完成**会话裁剪；全部 running 时不裁剪（允许超限，宁多勿丢）。
- `retryFailed`：仅 `phase==='failed'` 任务可重试；`retryTask` IPC 返回 `code!==0` → 该任务保持 failed 并计入 fail；新 taskId 已存在于会话 → 视为重复重试，跳过。

## 7. IPC 契约

| 通道 | 方向 | 变更 |
|------|------|------|
| `publish:progress`（`preload/publish.js:115` `onProgress`） | 主→渲染 | payload 富化（§6.1），既有字段不变；**无新通道** |
| `batch:progress`（`preload/system.js` `onBatchProgress`） | 主→渲染 | 不变（store 新增消费方） |
| `queue:status`（`getQueueStatus`） | 渲染→主 | 不变（store init 领养孤儿用） |
| `queue:retry`（`retryTask`） | 渲染→主 | 不变（面板「重试失败项」复用；返回 `{ taskId: 新id, retryOf }`） |
| `queue:cancel`（`cancelTask`） | 渲染→主 | 不变（panel-refine：浮窗 footer「取消全部任务」新增消费方；任务状态经 `task:cancelled` 转发收敛） |
| `publish:batch` / `batch:create` / `batch:execute` | 渲染→主 | 不变 |

## 8. 交互逻辑与显示项

### 8.1 面板状态机

```
（无会话）──registerSession──► 展开浮卡 ──点最小化──► 胶囊 ──点胶囊──► 展开浮卡
                                  │                      │
                                  │全部终态               │全部终态
                                  ▼                      ▼
                            展开浮卡（完成态）        胶囊（完成态）+汇总toast
                                  │点关闭/清除已完成      │点胶囊→展开→关闭
                                  ▼
                              （无会话）
```
- 自动展开仅发生在 `registerSession`（用户主动发布）；孤儿领养/事件到达**不**自动弹面板（不打扰），仅胶囊态下更新胶囊、或面板已展开时更新内容。
- 完成态浮卡保留汇总 + 「重试失败项」（有失败时）+ 关闭按钮。
- **自动收敛（panel-refine 新增）**：全部任务成功（`failed===0 && cancelled===0`）且面板展开时，完成跃迁（hasRunning true→false）后 5 秒无指针操作 → 自动最小化为胶囊（不弹首次隐藏 toast）；面板内任意 pointerdown、新会话开始（hasRunning 回 true）、组件卸载 → 取消收敛；用户事后手动展开完成态面板**不**触发（展开即被收回是骚扰）；存在失败/取消任务**不**收敛（不遮蔽恢复入口）。

### 8.2 显示项逐条（展开浮卡；panel-refine 修订版）

| 区域 | 显示项 | 数据源 | 说明 |
|---|---|---|---|
| 头部 | 标题「发布进度」+ 运行徽标 | store.hasRunning | 文字+图标 |
| 头部 | 最小化按钮（—）/ 关闭按钮（×） | — | 运行中关闭 disabled（tooltip 说明） |
| 汇总行 | `成功 {succeeded}/{total} · F 失败 · C 已取消` + 微型进度条 | aggregate | panel-refine：成功数直给（failed/cancelled 不计入「已完成」口径）；进度条填充按 done/total（已处理比例，含失败/取消） |
| 会话块 | 会话标题 + 状态徽标（点+文字） | session | **仅多会话**渲染（分组卡）；单会话扁平化（无卡中卡嵌套、无会话徽标——与头部徽标重复）；无标题会话 fallback 标题带创建时间「发布 · HH:MM」 |
| 任务行 | 固定网格：平台名 | 状态（图标+文字） | 步骤/明细/错误（flex） | 百分比（右对齐，仅运行行） | 操作 | task | panel-refine：列位稳定不跳动 |
| 任务行 | 状态文字承载「最具体状态」：运行行显示当前阶段词（如「上传」），非笼统「进行中」 | task.stageKey/phase | 消除「进行中+上传+40%」三重表达冗余 |
| 任务行 | dot-stepper：6 圆点+连线（过去实心灰、当前主色+脉冲、未来空心），仅当前步一个词 | task.stageKey | panel-refine：取代整链 6 词文字；queued 不预渲染步骤链；waiting/retry/blocked/failed/cancelled 以状态标签表达不进链 |
| 任务行 | percent（`NN%`，仅 start/progress 相位） | task.percent | panel-refine：success 不显示 100%（终态图标已表达，四重冗余去重） |
| 任务行 | 失败错误消息（红字，截断 120 字符 + title 全文） | task.error | 仅 failed |
| 任务行 | 内联操作：「重试此任务」+「复制错误信息」图标按钮 | task | panel-refine：仅 failed；复制完整错误文本入剪贴板（成功/失败 toast 反馈，不静默） |
| 任务行 | 频控等待提示（`等待 N 分钟`，由 remainingWait 换算） | task.remainingWait | 仅 blocked |
| 任务行 | 「已取消」中性态（图标 muted + 文字中性，非失败红态） | task.phase=cancelled | panel-refine |
| 会话块 | 「重试失败项（F）」按钮 | sessionFailedCount | 完成态且有失败；批量重试入口（与单任务重试并存） |
| 底部 footer | 警示条「发布后台进行中，请勿关闭应用」（warning-soft 底+图标+500 字重）+「取消全部任务」文本按钮 | store.hasRunning | panel-refine：操作约束从 xs/muted 脚注升为警示条（层级倒挂修正）；取消为两步内联确认（首次点击进入 4 秒确认窗口，再点执行；超时/运行结束退出确认态）；仅运行中显示 |

### 8.3 状态标签映射（phase → 标签+图标；panel-refine：图标着语义色，文字统一中性）

| phase | 标签（zh） | 图标 | 颜色语义（token，仅图标） |
|---|---|---|---|
| queued | 排队中 | ○ | `--color-text-muted` |
| start/progress | 当前阶段词（如「上传」） | ◐（旋转，reduced-motion 关闭） | `--color-primary` |
| retry | 重试中 | ⟳ | `--color-warning` |
| blocked | 等待间隔 | ⏳ | `--color-warning` |
| success | 成功 | ✓（pop-in 入场） | `--color-success` |
| failed | 失败 | ✗ | `--color-danger` |
| cancelled（panel-refine） | 已取消 | ⊘ | `--color-text-muted`（中性，非失败红态） |

### 8.4 提示文字全表（zh / en，locales `publishPage.publishProgressPanel.*`）

| key | zh | en |
|---|---|---|
| `title` | 发布进度 | Publish Progress |
| `minimize` | 最小化（后台继续） | Minimize (runs in background) |
| `expand` | 展开发布进度 | Expand publish progress |
| `close` | 关闭 | Close |
| `closeDisabledHint` | 发布进行中，可先最小化到后台 | Publishing — minimize to background first |
| `hintRunning` | 发布后台进行中，请勿关闭应用 | Publishing in background — keep the app open |
| `firstHideToast` | 发布将在后台继续进行，请勿关闭应用软件 | Publishing will continue in the background. Please keep the app running. |
| `pillRunning` | 发布中 {done}/{total} | Publishing {done}/{total} |
| `pillDone` | 发布完成 {done}/{total} | Done {done}/{total} |
| `pillFailedPart` | ，{count} 个失败 | , {count} failed |
| `summarySucceeded`（panel-refine，取代 summaryDone） | 成功 {succeeded}/{total} | {succeeded}/{total} succeeded |
| `summaryFailed` | · {count} 个失败 | · {count} failed |
| `summaryCancelled`（panel-refine） | · {count} 个已取消 | · {count} cancelled |
| `summaryPosition`（ux-audit-aggregate-progress，audit-14） | · 第 {index} / 共 {total} 项 | · item {index} of {total} |
| `sessionTitleTimeFallback`（panel-refine，取代 sessionTitleFallback） | 发布 · {time} | Publish · {time} |
| `recoveredTitle` | 恢复跟踪的发布任务 | Recovered publish tasks |
| `sessionRunning` | 进行中 | Running |
| `sessionDone` | 已完成 | Finished |
| `statusQueued` | 排队中 | Queued |
| `statusRunning` | 进行中 | In progress |
| `statusRetry` | 重试中 | Retrying |
| `statusBlocked` | 等待间隔 | Rate-limited |
| `statusSuccess` | 成功 | Succeeded |
| `statusFailed` | 失败 | Failed |
| `statusCancelled`（panel-refine） | 已取消 | Cancelled |
| `stagePrepare` | 准备 | Prepare |
| `stageUpload` | 上传 | Upload |
| `stageFill` | 填写 | Fill |
| `stageSubmit` | 提交 | Submit |
| `stageVerify` | 校验 | Verify |
| `stageWaiting` | 等待 | Waiting |
| `stageDone` | 完成 | Done |
| `stageFailed` | 失败 | Failed |
| `stageDetail` | 进行中 | Working |
| `retryFailed` | 重试失败项（{count}） | Retry failed ({count}) |
| `retrying` | 重试中… | Retrying… |
| `retryPartial` | {ok} 个已重新入队，{fail} 个重试失败 | {ok} re-queued, {fail} failed to retry |
| `retryTask`（panel-refine） | 重试此任务 | Retry this task |
| `copyError`（panel-refine） | 复制错误信息 | Copy error |
| `copied`（panel-refine） | 已复制到剪贴板 | Copied to clipboard |
| `copyFailed`（panel-refine） | 复制失败 | Copy failed |
| `cancelAll`（panel-refine） | 取消全部任务 | Cancel all tasks |
| `cancelConfirm`（panel-refine） | 确认取消？ | Confirm cancel? |
| `cancelling`（panel-refine） | 取消中… | Cancelling… |
| `cancelPartial`（panel-refine） | {ok} 个已取消，{fail} 个取消失败 | {ok} cancelled, {fail} failed to cancel |
| `clearFinished` | 清除已完成 | Clear finished |
| `emptyRunning` | 暂无进行中的发布 | No active publishes |
| `blockedWaitMinutes` | 等待 {minutes} 分钟后重试 | Retrying after {minutes} min |

页面结果卡新增（`publishPage.publishFlow.*`）：

| key | zh | en |
|---|---|---|
| `resultAllSuccess` | 发布完成：{count} 个平台全部成功 | Published successfully to all {count} platforms |
| `resultPartial` | 发布完成：{succeeded} 个成功，{failed} 个失败 | Finished: {succeeded} succeeded, {failed} failed |

主进程托盘气泡（硬编码中文，主进程既有先例允许）：标题「发布仍在后台进行」；内容「发布任务正在后台继续执行，请勿退出程序。点击托盘图标可恢复窗口。」

### 8.5 首次隐藏 toast

- 触发：用户点击最小化且 `firstHideToastShown === false`。
- 形态：ElMessage info，6 秒，可关闭；文案 `firstHideToast`。
- 持久化：localStorage key `mp-publish-first-hide-toast-shown` = `'1'`；仅提示一次（跨会话记忆）。
- 之后每次最小化不重复 toast（胶囊常驻提示承担持续提醒）。

### 8.6 聚合进度条的软权重口径（2026-10-21，ux-audit-aggregate-progress / audit-14）

> 本节修的是 audit-14：**发 1 篇要 3 分钟，头部「成功 0/1」+ 进度条恒定 0%**，用户判断不了「在跑」还是「卡了」。
> 根因不是「少渲染了一个数」，而是**进度语义被定义成"终态占比"**——运行中的任务对进度条的贡献被硬性记为 0。

#### 8.6.1 数据校验（输入资格与归一口径）

| 输入 | 归一 | 为什么 |
|---|---|---|
| `task.percent` 为 0..100 的有限数 | 取用，但**封顶 0.95** | 主进程事件带的就是真完成度；不封顶会出现「条子满格但还没成功」，比「条子不动」更误导 |
| `task.percent` 为 `null`/`undefined`/`NaN`/负数/>100 | 退回 `stageKey` 软权重（负数夹到 0、超 100 夹到 0.95） | store 已有 `normalizePercent` 把非法值归一为 `null`；纯逻辑再兜一层，不信任上游 |
| `task.phase === 'queued'` | 权重 **0** | 排队中的任务没开始，不能替它编进度 |
| `stageKey` 不在权重表里（新增阶段） | 中位值 0.3 | 「未知 = 0」会让任何新阶段一上线就退化成"条子不动"，正是本条要消灭的症状 |
| 任务对象为 `null`/非对象 / 数组非数组 | 权重 0 / 全零形状，**不抛错** | 进度显示不是关键路径，不能成为新故障源 |

阶段软权重表（`publishProgressWeight.js` 的 `STAGE_WEIGHTS`，唯一真源）：`prepare 0.05 · detail 0.1 · upload 0.35 · fill 0.55 · submit 0.8 · verify 0.85 · waiting 0.9 · released 0.92`，终态 `done/failed` 为 1。取值口径 = **「用户此刻离结果还有多远」的单调刻度**，不是阶段数量占比；`waiting`/`released` 排在提交之后是因为频控等待与验证码放行确实发生在 `submit` 后。表由一条**单调不减**断言钉住（`prepare → released` 逐个比较，且末值 <1）——倒挂会让进度条倒退，是比"不动"更难解释的现象。

#### 8.6.2 功能逻辑（百分比怎么算）

```
weighted = Σ taskWeight(每个任务)        // 终态记 1，运行中记 0..0.95，排队记 0
percent  = total === 0 ? 0
           : running === 0 ? 100          // 只有"全部终态"才配 100%
           : min(99, round(weighted / total * 100))
```

三条不可破：
① **`done/succeeded/failed/cancelled` 的口径一字未改**——软权重只进 `weighted`/`percent`，不进终态计数。汇总行的「成功 N/M」是用户核对结果的依据，把它换成小数等于毁掉唯一的确定性读数（本条有专项锁）。
② **还有非终态任务时百分比严格 <100**（封顶 99）。四舍五入自己够到 100 的那一档（99 个终态 + 1 个 0.95 ⇒ 99.95 → 100）必须被夹回 99，这条有专门用例，不是靠"通常算不到"过关。
③ **单一实现**：纯逻辑在 `apps/desktop/src/stores/publishProgressWeight.js`（零依赖、可脱离 pinia 单测，与 `publishProgressSessionMerge.js` 同例外置）；store 只负责「按会话顺序摊平任务数组」，面板只读 `store.aggregate.percent`。**渲染层不得再自己 `done / total`**（结构锁双向：正向断言读 `aggregate.percent`，反向断言模板里不出现除法）。

#### 8.6.3 显示项与交互逻辑（用户看到什么）

| 显示项 | 何时出现 | 内容 | 交互 |
|---|---|---|---|
| 进度条填充宽度 | 面板可见时常驻 | `aggregate.percent`% | 无交互（纯观测） |
| `aria-valuenow` | 同上 | **与条宽取同一个数**（同一个 `progressPercent` computed） | 读屏播报与视觉不得各算一份 |
| 「第 N / 共 M 项」 | `M>0` 且 `N>0`（= 还有非终态任务） | `publish-progress-position` 段，M=全部任务数，N=**第一个非终态任务的 1-based 序号**（含排队中） | 无交互 |
| 「第 N / 共 M 项」 | 全部终态时 | **不出现** | 那时汇总行已有「成功 N/M」，再显「第 0/共 5 项」是噪声 |

序号语义刻意包含 `queued`：批量发布时用户关心的是"排到第几个"，而不是"第几个真的在传"。M 的口径与进度条分母一致（同一个摊平数组的长度），两处不得分别计数。

#### 8.6.4 退化行为（aggregate 形状缺字段）

`progressPercent` 对 `percent` 做 `Number.isFinite` 检查，缺字段时取 0。测的不是"真源会缺字段"这种正常态，而是**缺字段时的视觉后果**：`undefined%` 是非法 CSS，条子会停在任意位置并被读成"进度显示错乱"；`0%` 至少与"刚开始"一致。该场景由一条专项用例钉住（不是装饰性 guard：`summarize` 之外的消费者若自带一份 aggregate 就会撞上）。

#### 8.6.5 回归与反证

- `src/stores/publishProgressWeight.test.js`（17 条）：权重表/边界/单调性/`summarize` 形状/接线结构锁（store 走 summarize、面板不自己除、两个读数同源、zh/en 成对）。
- `src/stores/publishProgress.test.js` 新增 1 条**接线行为锁**：真实事件驱动真实 store，断言 `percent` 65→90（旧口径在这里只能给 50→100）。
- `src/components/PublishProgressPanel.test.js` 新增 4 条：条宽与 `aria-valuenow` 取 `percent` 且**不是** `done/total` 的那个值、「第 N/共 M」出现与消失两档、en 档文案、缺字段退化为 0%。  同文件 10 处 aggregate 夹具改用 `mkAggregate()` 补全四个新字段——**夹具缺字段会让面板静默渲染 0%，"零回归"读起来像通过**（缺省值刻意沿用旧口径，好既有用例断言不动）。
- 六道变异各自指名红、红集互不相同：M1 面板退回 `done/total`（4 红）｜M2 `taskWeight` 忽略 percent（6 红）｜M3 去掉 99 夹取（1 红）｜M4 「第 N/共 M」不渲染（2 红）｜M5 去掉缺字段 guard（1 红）｜M6 序号退回 0-based（2 红）。跑完三份文件 md5 回原值。
- **Gate 7 的成对校验对拆分 locale 文件是装饰性的（本轮现场复测）**：摘掉 `publish-page/en.js` 里的 `summaryPosition`，`check-locale-sync.js --pair-base origin/main` 照打 PASS（它只对根级 `zh.js`/`en.js` 是否"变更"做门控）；  真正拦住它的是本批新增的那条「zh/en 成对」结构锁（摘 en 键 ⇒ 该用例当场红）。**引用一条门禁前必须先做"摘掉我新增的东西它是否变红"的反证**，否则会把没有牙的门禁当防线。

#### 8.6.6 未覆盖（如实登记）

1. **会话内单任务行**的百分比仍走各自 `task.percent` 直显，不参与软权重（它本来就是单任务口径，无需二次加权）。
2. audit-15（陈旧看门狗：`lastEventAt` 全仓零读取）**不在本批**——它需要定「N 分钟无更新」的中性态阈值与解禁关闭按钮的产品口径，属独立决策。
3. 阶段权重表的数值是**序数校准**（单调、边界正确），不是耗时实测分布；若将来主进程给每个 stage 带上真实耗时统计，应改用实测比例而不是这张表（届时 `STAGE_WEIGHTS` 的锁要跟着改口径，不得只删表）。


## 9. 异常态矩阵

| # | 场景 | 行为 |
|---|------|------|
| R1 | 主窗口销毁时发射事件 | emitter 跳过发送，不抛错 |
| R2 | 渲染层重载错过事件 | init() 经 `queue:status` 领养孤儿任务建「恢复跟踪」会话（任务状态按队列 status 映射：running→进行中、pending→排队中；无阶段细节——如实显示，不伪造） |
| R3 | 未知 taskId/batchId 事件 | 自动创建孤儿会话收纳（标题 recoveredTitle） |
| R4 | 终态后迟到 progress 事件 | 不回退状态（吸收态），仅刷新 lastEventAt |
| R5 | 非 Windows 托盘气泡 | 静默跳过（showBalloon 守卫） |
| R6 | 同平台并发任务 | last-write-wins 近似归属（§14 已知限制） |
| R7 | `queue:status` IPC 失败 | init 领养降级跳过（warn），不影响事件订阅 |
| R8 | `retryTask` IPC 失败 | 该任务保持 failed，汇总 `{ok, fail}` 反馈 |
| R9 | 事件 payload 非法（缺 taskId/platform） | store 丢弃 + warn，不建会话 |
| R10 | 发布中用户再点发布（并发追加） | 语义不变（共享 3 并发队列）；新会话入列，面板多会话并列显示 |
| R11 | 应用退出（发布中，托盘不可用或用户从托盘真退出） | 走既有 shutdown 链：运行中任务标记 cancelled；下次启动 `deserialize` 重排队（既有语义，面板如实呈现「进程中断恢复」） |
| R12 | 会话超上限 | 裁剪最旧已完成会话；全 running 不裁剪 |

## 10. 日志与可观测

- 主进程：emitter 跳过（win 不可用/非法参数）→ `log.warn('PublishProgress', ...)`；router 未命中平台 → debug 级（并发窗口期正常）。
- 渲染层：store 丢弃非法事件 → `console.warn('[publishProgress]', ...)`；会话终态 → info 级汇总（便于排障）。
- 既有 `rpa:progress` 直发通道保留（调试用途），渲染层仍不消费。

## 11. 验收标准

1. 点击「一键发布」→ 面板自动展开，逐平台显示步骤链 + 百分比 + 当前阶段中文标签；切到任意路由进度持续更新。
2. 最小化 → 首次弹一次性 toast；胶囊在任何路由常驻（N/M + 勿关提示）；点击胶囊恢复展开。
3. 单篇发布完成后，页面结果卡显示「N 个平台全部成功」或「N 成功 M 失败」（G1 修复的可见结果）。
4. 人为使某平台失败 → 面板红标 + 错误消息；发布历史页 failed 过滤器可见该记录；「重试失败项」重发后继续跟踪至终态。
5. 发布运行中点窗口 ✕ → 窗口隐藏到托盘、发布继续、气泡提示；托盘点击恢复窗口；全部完成后关窗恢复正常退出。
6. bilibili/baijiahao（API 直连轨）发布中面板显示上传/提交进度（不再静默）。
7. 渲染层重载（Ctrl+R）→ 面板/胶囊恢复显示运行中任务（恢复会话）。
8. zh/en 双语完整；`check-locale-sync` 三项门禁 PASS。
9. 回归锁全绿（§12 测试清单）；QM-1 打包 + 启动 8 秒验证通过。

## 12. 测试策略

| 层 | 文件 | 关键断言 |
|---|---|---|
| 单元（主） | `electron/services/publish-stage-map.test.js` | 全量已知串映射、前缀规则、未知→detail、封闭清单锁 |
| 单元（主） | `electron/services/publish-progress-events.test.js` | payload 形状、win 销毁/非法参数守卫、router 登记/注销/last-write-wins |
| 单元（主） | `electron/bootstrap/phase4-events.test.js`（扩展） | 四事件富化字段；task:failed 落历史（**反证：摘 addRecord 必红**） |
| 单元（主） | `electron/services/window-close-policy.test.js`（扩展） | hasRunningPublish 三变量矩阵 |
| 单元（渲染） | `src/stores/publishProgress.test.js` | §5.2 全动作/getter + §9 异常态 R2-R4/R7-R9/R12 |
| 单元（渲染） | `src/components/PublishProgressPanel.test.js` | 两态渲染、首次 toast 一次性、常驻提示、重试按钮、非模态负向锁；panel-refine 扩展：dot-stepper 结构/queued 无链/success 无 100%/cancelled 中性态/汇总成功口径/单会话扁平/多会话分组/fallback 标题带时间/footer 取消两步流（fake timers）/自动收敛触发与豁免（失败/取消/交互/手动展开）/复制错误 toast |
| 单元（渲染） | `src/composables/usePublishFlow.test.js`（改写） | **不再订阅 onProgress**（G1 回归锁）+ registerSession + 终态驱动结果卡 |
| 单元（渲染） | `src/composables/useBatchPublish.test.js`（改写） | 阶段监听已删 + registerSession(batchId) + 页面卡不回归 |
| 单元（主） | `electron/bootstrap.test.js`（panel-refine 扩展） | taskQueue.on 注册 5 事件（含 task:cancelled） |
| 视觉 | 既有像素基线 | /publish 等既有视图无回归；浮窗为 Teleport 动态浮层不在基线内（按口径如实登记） |
| 打包 | QM-1 | electron-builder --win --dir + asar 清单含新模块 + 启动 8 秒 |

**反证矩阵（变异测试，每条实跑后还原）**：① 摘 phase4-events 的 addRecord → failed 落历史测试红；② mapStageToKey 未知串改抛错 → detail 透传测试红；③ store 终态吸收态守卫摘除 → 迟到事件回退测试红；④ 面板引入 suspendEmbeddedViewsForOverlay → 非模态负向锁红；⑤ window-close-policy 摘 hasRunningPublish → 矩阵红；⑥ usePublishFlow 恢复本地 onProgress 订阅 → 「不再订阅」锁红。

## 13. Bug 反思循环（QM-5 五步，G1 监听器死亡）

1. **第一性原因**：`usePublishFlow.js:438-441` `finally` 无条件 `off()` 与 `:411-413` 条件注销意图矛盾——引入点与意图经 git blame 取证（实施时回填 commit hash）；形态是「清理逻辑写在了错误的生命周期层」（IPC 往返 ≠ 任务生命周期）。
2. **逃逸链**：单元层 `usePublishFlow.test.js:758-782` 只断言「unsubscribe 被调用一次」（锁的是**清理机制**而非**用户可见结果**）——把「监听器短命」钉成了契约；集成/E2E 层无「发布后进度事件到达渲染层」的断言；视觉层无法覆盖时序行为。
3. **系统性漏洞**：类型 B（测试质量不足）——断言实现细节而非行为结果；类型 D（流程缺失）——发布进度反馈从未有 PRD 契约（本 PRD 首次建立）。
4. **修复 + 回归保护**：订阅所有权上移 store（§5.2）；回归锁 = `usePublishFlow.test.js` 新契约（不再订阅）+ `publishProgress.test.js`「IPC 返回后到达的事件仍更新状态」。
5. **预防措施**：本 PRD §6.1 契约 + AGENTS.md QM-2 新增「发布进度事件双边界与富化契约」条目 + learnings 置顶条目。

## 14. 已知限制与后续

1. **同平台并发归属近似**（D2）：同平台不同账号并发时进度事件 last-write-wins，面板可能互串；影响显示层，不影响发布正确性。后续如需精确，给 rpaViewManager 增加会话级回调穿透。
2. **恢复会话无阶段细节**（R2）：queue:status 只有 running/pending 状态，恢复会话显示状态级而非步骤级——如实呈现，不伪造。
3. **日志尾部未做**：失败详情以 error 消息呈现；阶段级日志流留后续。
4. **队列恢复的重复发布风险**（既有语义）：运行中任务重启后重排队，若中断前平台侧实际已发布成功，重跑可能重复发布——既有 `deserialize` 语义，本 PRD 不改，提示文案如实（「重启后自动重新排队」）。
5. **与 PR #2562 的文件交集**：本变更不改 Publish.vue 模板；合并前 rebase origin/main。
