# Design: 发布进度的「无更新」可见化（ux-audit-stale-watchdog）

## 1. 现场取证（动手前重取，不引用审计文档里的旧数）

```
git grep -na "lastEventAt" apps/desktop/src apps/desktop/electron
  store 写 4 处：publishProgress.js:104（初值 null）/ :166（终态吸收分支）/ :173（正常事件）/ :213（批量兜底）
  读：0 处（其余命中全是测试夹具里的构造数据 publishProgress.test.js:75、usePublishFlow.test.js:885/911/912）
PublishProgressPanel.vue:36  :disabled="store.hasRunning"
hasRunning = computed(() => sessions.value.some((s) => s.status === 'running'))
```

⇒ 关闭按钮的解锁条件与事件流是**同一个** truth source：没有终态事件就永不解锁。
这正是 audit-15 的机制描述，不是修辞。

## 2. 决策：派生层放在 store，不放组件

- 面板头部徽标、任务行、关闭按钮三处都要同一个答案；写在组件里就是三份口径
  （本仓「同一个三态映射被抄成三份」的同型事故）。
- store 已是发布进度渲染态的唯一承载（AGENTS「渲染层发布进度状态唯一承载是 `src/stores/publishProgress.js`」）。
  因此 `STALL_AFTER_MS / stalledTaskIds / hasStalledRunning / taskStallMinutes(taskId)` 全部由 store 导出。

## 3. 决策：只读派生，绝不改 phase

「没有新事件」不是负向证据。若把陈旧直接映射成 `failed`：
- 违反本仓「状态只被正/负证据改写」的既有口径（登录态那条是同型）；
- 会让一次 IPC 投递抖动变成用户可见的失败红态，而任务其实还在跑；
- 且 `aggregate.failed` 会跟着涨，发布历史里留下一条根本没失败的记录。

所以陈旧是**附加展示态**，与 `phase` 正交；`TERMINAL_PHASES` 一律不参与。

## 4. 时钟：同域 + 可注入 + 惰性 tick

三条硬约束（AGENTS「时钟判据必须同域比较」「全局单例事件监听器生命周期」）：

1. **同域**：比较的两条边都取 `Date.now()`（`lastEventAt` 本来就是 `Date.now()` 写的），
   不得掺 `performance.now()` 或事件里带来的主进程时间戳。
2. **可注入**：阈值与 `now` 都走参数默认值，测试用 `vi.useFakeTimers()` + `setSystemTime`
   推进；**禁止**在夹具里写死绝对时间戳配相对窗口（那是本仓已知的引信形态）。
3. **惰性单实例**：tick 只在有 running 任务时活着。
   ⚠ 最终实现与设计初稿不同（按代码更正，QM-6 i7 + 记录 §3.4）：句柄**不是模块级**，
   而是「按 store 实例缓存的 tracker 内私有」，启停由**面板**这一宿主调用：
   - `usePublishProgressStall(store)` 用 WeakMap 按 store 实例取 tracker ——
     模块级单例会让定时器跨实例泄漏（多次 `setActivePinia`、逐例测试、未来第二个消费方）；
   - `beginStallClock()` 先 `if (timer !== null) return` ⇒ 重复调用不叠加，并在真正起表前
     把 `nowTs` 重新盖一次章（面板「卸载→再挂载」后不补就会让首帧读数为旧）；
   - 面板 `watch(hasRunning)` 把它叫回来 + `onBeforeUnmount` 调 `endStallClock()` 交还句柄；
   - **不靠 watch 追踪会话内容**：本 store 的会话对象是按原始引用改写的，watch 恒不触发
     （PRD §8.1 实测），tick 内部改为「看到全部终态就自泊」。
   - tick 周期 15 s（比 3 min 阈值细一个量级，用户看到的分钟数不会跳变超过 1）；
   - 停止时 `clearInterval` 并把句柄置 null。

  这条必须有行为锁（断言活跃定时器恰好 1 个 / 全终态后为 0 个），
  因为「更快/更简单」的常驻 setInterval 在功能测试里完全看不出来。

## 5. 关闭按钮的解锁语义

`:disabled="store.hasRunning && !store.hasStalledRunning"`，其中
`hasStalledRunning = 存在 running 任务 且 所有非终态任务都已陈旧`。

- 部分陈旧 ⇒ 仍禁用（还有在动的任务，收起面板等于丢可见性）；
- 全部陈旧 ⇒ 解禁，`title` 换成「任务已 N 分钟无更新，可关闭面板」；
- 解禁只关面板，不取消任务（`handleClose` 现有语义不变：`clearFinished()` + 空则 `panelVisible=false`）。
  ⚠️ 现场核对：`handleClose` 走的是 `store.clearFinished()`，它只清终态会话 ⇒
  陈旧但仍是 running 的会话**不会**被这次点击清掉，面板在还有 running 会话时保持可见。
  因此本条要额外把「用户明确点关闭」落成 `panelVisible = false`（隐藏而非丢弃状态），
  否则解禁是装饰性的——按钮能点但点了没反应，与本批要修的缺陷同形。
  这条差异写进测试（W-closable：全陈旧时点击 ⇒ `panelVisible === false` 且 `sessions` 仍在，
  再次展开仍能看到原任务态）。

## 6. 文案与 locales

新增 3 个键（zh/en 成对，走 Gate 7；`publishPage` 域）：
- `stallBadge`：「{minutes} 分钟无更新」/ en `{minutes} min without updates`
- `stallSuffix`：「（{minutes} 分钟无更新）」（任务行内联，避免与状态词同行竞争宽度）
- `closeStalledHint`：「任务已 {minutes} 分钟无更新，可关闭面板（不会取消任务）」

渲染端 `src/` 非 locales 文件不得新增中文字面量（CI 基线扫描），所以全部走 `t()`。

## 7. 明确不做

1. 陈旧 ⇒ 自动取消/自动判失败：需要主进程侧任务存活判据（`task:cancelled`/watchdog），属另批。
2. 改 `aggregate` 的进度口径（audit-14 的软权重/「第 N / 共 M 项」）：另一条，成本 M。
3. 22 个未接 `useBatchPollGuard` 的轮询点：阶段 5.4 门禁的前置，不在本批。
4. 不动主进程与 IPC：本批纯渲染层 ⇒ 不触发 QM-1。

## 8. 风险与对策

| 风险 | 对策 |
| --- | --- |
| tick 常驻导致每条路由多一次唤醒 | §4 惰性启停 + 行为锁断言定时器计数 |
| 「无更新」被用户读成「失败」 | 中性色（`--color-text-muted` 档），不加红、不改 phase；文案用陈述句不用警示句 |
| 关闭按钮解禁后被误读成「可以安全关应用」 | `title`/hint 明确「不会取消任务」，且面板关闭 ≠ 应用关闭 |
| fake timers 与真实时钟混用造成引信 | 判据同域 + 测试一律 `vi.useFakeTimers()`，并在记录里附 `check-clock-shift-oracle` 读数 |
