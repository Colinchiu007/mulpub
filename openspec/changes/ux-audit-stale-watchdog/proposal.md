# Proposal: 发布进度的「无更新」可见化 —— 给 lastEventAt 装上读者（ux-audit-stale-watchdog）

## Why

UX 审计 1.8 / audit-15（[major]）：`src/stores/publishProgress.js` 在四处写
`task.lastEventAt = Date.now()`（`:104` 初值 null、`:166` 终态吸收分支、`:173` 正常事件、`:213` 批量兜底），
**全仓零读取**（当场 `git grep -na lastEventAt apps/desktop/src apps/desktop/electron` 复核：
除 store 自身与测试夹具外无消费方）。后果是两处用户可见的死锁：

1. `PublishProgressPanel.vue:36` 的关闭按钮是 `:disabled="store.hasRunning"`。
   `hasRunning` 只看 `session.status === 'running'`，而 running 的唯一解除途径是**收到终态事件**。
   RPA 窗口挂死 / 主进程任务被杀而没发终态时，事件永不到来 ⇒ 面板转圈、
   「勿关应用」常驻、关闭按钮永久灰掉，用户只剩「取消全部」一条路（而取消也可能一起挂死）。
2. 头部「成功 0/1」+ 进度条恒定（audit-14 的另一半）期间，界面没有任何东西回答
   「它还在动吗」。用户无法区分「慢」与「卡」，只能反复重启应用排障 —— 这正是本仓
   多处 learnings 记录的「用重启排障」形态。

已写好的 `lastEventAt` 就是这个判断的唯一现成锚点，只是没人读它。
本批把它接成**可读的中性态**：无事件满 3 分钟 ⇒ 该任务显示「N 分钟无更新」，
并在**全部** running 任务都进入该态时解禁关闭按钮。

## What Changes

- **ADDED** `publishProgress` store 的陈旧派生层：
  `STALL_AFTER_MS`（默认 180000，测试可注入更短值）、`stalledTaskIds`、`hasStalledRunning`、
  `taskStallMinutes(taskId)`；判定**只读不改**——绝不把 running 改成 failed/cancelled，
  也不写任何持久化真源。
- **ADDED** 一个惰性 tick：有 running 任务时才启动定时器（默认 15s 一跳），
  running 清空即停；重复 `init()` 不得叠加定时器（进程级单例教训同 `autoUpdater` 那条）。
- **CHANGED** `PublishProgressPanel.vue`：
  - 头部徽标：存在陈旧任务时，`运行中` 之外加一条中性 `N 分钟无更新` 提示；
  - 关闭按钮：`:disabled="store.hasRunning && !store.hasStalledRunning"` ⇒
    **全部** running 都陈旧时解禁（部分陈旧仍禁，因为还有在动的任务）；
  - 任务行：陈旧任务的状态文案后追加「（N 分钟无更新）」，不改 phase 语义色。
- **ADDED** locales（zh/en 成对）：`stallBadge`、`stallSuffix`、`closeWhenStalledHint`。

## Impact

- 受影响规格：`desktop-ui-consistency`（新增 1 条 Requirement）。
- 受影响代码：`apps/desktop/src/stores/publishProgress.js`、
  `apps/desktop/src/components/PublishProgressPanel.vue`、
  `apps/desktop/src/components/PublishProgressTaskRow.vue`、`src/locales/publishPage/{zh,en}.js`。
- 不涉及主进程 / IPC 通道 / 授权白名单 ⇒ 不触发 QM-1 打包门槛（但改了 `src/` 仍跑视觉相关判定）。
- **非目标**（明确不做，见 design §7）：
  ① 不做「陈旧 ⇒ 自动取消/自动判失败」——那需要主进程侧的任务存活判据，属另批；
  ② 不引入新的观测字段，只用已有的 `lastEventAt`；
  ③ 不改 `aggregate` 的进度口径（audit-14 的软权重是另一条，成本 M，不在本批）；
  ④ 不动 22 个未接 `useBatchPollGuard` 的轮询点（阶段 5.4 的死观测字段门禁依赖本批先落地，
     顺序见审计 §新门禁上线三步序：「5.4 不得早于 1.8」）。
