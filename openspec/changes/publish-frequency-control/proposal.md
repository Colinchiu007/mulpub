# 作品发布频率控制机制接线与补齐（publish-frequency-control）

## Why

用户 2026-10-02 报告：通过 CDP 自动化测试发布功能时，相邻两次发布的间隔只有 1–2 分钟，
足以触发平台限流/风控处罚。调查发现**机制早已存在但从未生效**——不是"配得松"，是
一次都没运行过。三条独立断链：

1. **TaskQueue 从未收到 guard**：`apps/desktop/electron/core/container.setup.js:324`
   注册 `taskQueue` 时是 `new TaskQueue(options.taskQueue || { maxConcurrent: 3 })`，
   没有 `publishIntervalGuard` 字段 ⇒ `packages/shared-utils/src/task-queue.js:25` 的
   `this._publishIntervalGuard` 恒为 `null` ⇒ `_executeTask` 里两处
   `if (this._publishIntervalGuard)`（间隔检查、发布记账）永远短路。
2. **唯一逃生口也是死的**：`apps/desktop/electron/bootstrap.js:77` 调用
   `createContainer()` **不带任何参数**，`options.taskQueue` 永远是 `undefined`。
3. **guard 实例取了没用**：`apps/desktop/electron/bootstrap/phase3-services.js:95`
   `const _publishIntervalGuard = container.get('publishIntervalGuard')`，
   下划线前缀变量，全文件再无第二次引用。

实测反查（只读取证，非推断）：

- `recordPublish` / `canPublish` / `getRemainingWait` 的**生产调用点为 0**，仅出现在测试中；
- `publish_timeline` 表在 `shared-user-data/multi-publish.db` 与
  `Multi-Publish-debug-profile/multi-publish.db` 两个库里**都是 0 行**——持久化通道完好，
  从未有人写入；
- 三条发布入口全部直达队列且无任何节流：`ipc-handlers/publish.js:237`（`publish:wechat`）、
  `:302`（`publish:batch`）、`services/batch-manager.js:125/128`、`services/offline-manager.js:143/152`；
- 队列 `maxConcurrent: 3` ⇒ 一键发布多平台时**最多 3 个发布同时并发提交，间隔为 0**。

同族易混淆但**不构成**防线的三样东西（必须在文档里点名，否则后来者会误以为已受保护）：

- `api-usage-governor.js` / `rate-limit-self-check.js`：管 **LLM 供应商 RPM/额度**，与平台发布无关；
- `publish-contract.js:18` `DEFAULT_MIN_ACCOUNT_INTERVAL_MS`：**只是渲染层定时发布表单的输入校验**
  （`usePublishFlow.js:465`、`useBatchPublish.js:498`），不拦即时发布、不进主进程；
- `riskSuspender`（`bootstrap.js:106`）：**事后即停**（task:failed 命中风控才挂起），不做事前间隔。

关键结论：**用户点"一键发布"会复现同一问题，CDP 不是特殊路径**，只是把这颗雷显性化了。

## What Changes

范围收敛到"补齐真实断链"，**不新造第二套机制**。已核实消费链（进度事件与 UI 渲染）本就完整：
`phase4-events.js:186` 已在监听 `publish:blocked` 并转发为 `phase:'blocked'` /
`stageKey:'waiting'`（`publish-progress-events.js:87` 的 `⏳` 前缀规则），
`PublishProgressTaskRow.vue:13,38` 已渲染等待图标与剩余时间。**缺的只有生产者**，
因此本次不新增相位、不新增 stageKey、不改渲染层。

- **频率策略单一真源**：新增 `packages/shared-utils/src/publish-frequency-policy.js`，
  按平台持有两档最小间隔（账号维度、同平台跨账号维度），支持环境变量覆盖。
  **刻意不进 `publish-capabilities.json`**——该文件契约管的是内容能力
  （titleMode/字数限制/字段矩阵），且 2026-10-02 实测有 3 个在飞分支
  （`toutiao-timed-publish`、`fix-article-publish-image-platforms`、`platform-char-limits`）
  正在修改它及其 58 例测试，属高冲突面；调度节奏与内容能力是两类关注点。
- **Guard 扩展为双档 + 缺席也受控**：`PublishIntervalGuard` 保留
  `canPublish`/`recordPublish`/`getRemainingWait` 既有签名与语义（60+ 现存测试不破坏），
  新增按平台策略评估的 `check()`；`accountId` 缺席时**账号档跳过、平台档仍然生效**，
  关闭"`publish:wechat` 硬写 `accountId: null` 即绕过"的洞。
- **记账时机前移到提交之前**：现在只在 `task:success` 记账。发布实际已到达平台但应用侧
  报错/超时（视频上传 30 分钟预算尤其常见）时不记账 ⇒ 重试会**连发两条**。
  前移后还顺带消除一处宿主契约违反：`base-store.js:61-66` 明文要求
  "异步服务必须在开始时调用一次并持有快照，不能在回调或定时器中重新读取可变的登录态"，
  而原记账发生在 `await Promise.race(...)` **之后**，属于被禁止的那一类。
- **三处断链接线修复** + 死变量清理。

## Impact

- Affected specs: `publish-frequency-control`（新增 capability）
- Affected code:
  - `packages/shared-utils/src/publish-frequency-policy.js`（新增）
  - `packages/shared-utils/src/publish-interval-guard.js`
  - `packages/shared-utils/src/task-queue.js`
  - `apps/desktop/electron/core/container.setup.js`
  - `apps/desktop/electron/bootstrap/phase3-services.js`
- 风险与兼容：
  - **行为变化对用户可见**：同账号/同平台连发会被排队等待（决策 D1：全部排队，不拒绝），
    进度面板出现 `blocked` 相位与剩余等待时间。队列状态快照（`task_queue_state`）
    会把等待中的任务带过重启，重启后按剩余时间重新计时。
  - **默认间隔是工程保守估计，不是平台官方规则**，必须在 PRD 与代码注释里如实标注，
    并全部可经环境变量覆盖；不得声称"符合平台规定"。
  - 不改 `publish-capabilities.json`、不改渲染层、不新增 IPC 通道 ⇒ 无 locale 成对修改、
    无契约锁联动。
