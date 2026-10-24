# Proposal: 发布进度「无更新」看门狗（UX 审计阶段 1.8）

## 为什么现在做

`01-docs/UX-AUDIT-2026-10-17.md` 阶段 1.8 记录的现象：发布进度面板在任务卡住后**永远停在
「进行中」**，关闭按钮永远禁用，用户只能等或重开应用。

代码层面的根因不是「缺一个计时器」，而是**一条被写入却从未被读取的观测**：
`apps/desktop/src/stores/publishProgress.js` 在三处写 `task.lastEventAt`
（`:166` 终态后迟到的非终态事件、`:173` 常规事件、`:213` `task-complete` 兜底），
而 `git grep lastEventAt` 在渲染层的**消费方为零** —— 面板的可用性判据是
`PublishProgressPanel.vue` 的 `:disabled="store.hasRunning"`，只看「有没有运行中的会话」，
不看「还有没有动静」。于是「主进程不再发事件」这一事实，在界面上没有任何出口。

这同时是阶段 5 计划里的「死观测字段」类缺陷的第一个实例：**字段存在、写入正确、测试全绿，
但用户永远看不到它的效果**。

## 改什么

1. 新增单一判据实现 `apps/desktop/src/utils/publish-progress-staleness.js`：阈值常量
   `DEFAULT_STALE_AFTER_MS = 180000`（3 分钟）+ 纯函数 `computeStaleInfo(sessions, now, staleAfterMs)`。
2. 新增组件侧看门狗 `apps/desktop/src/composables/usePublishProgressStaleness.js`：
   只在有运行中任务时以 15s 轮询推进读数，卸载/完成即停表（计时器归组件所有，store 保持纯状态，
   与 `usePublishProgressAutoCollapse` 同源）。
3. 面板接入：标题区新增「已 N 分钟无更新」徽标（`role=status` + `aria-live=polite`）；
   关闭按钮的可用性判据从 `hasRunning` 改为 `hasRunning && !stale`；陈旧态下点 × 的语义是
   **收进胶囊**（不清空会话）；胶囊提示在陈旧态改说「已 N 分钟无更新」而非「请勿关闭应用」。
4. locales zh/en 成对新增 `staleBadge` / `staleCloseHint`。
5. 反证驱动 `scripts/publish-staleness-contract-mutate.js`（14 条变异，逐条要求变红）。

## 不改什么（范围边界）

- **不改主进程**：本 PR 只让「渲染层已知的停滞」可见并可退出，不探测主进程侧任务真实状态。
  「任务其实已经死了但 store 还留着 running」需要主进程证据，属阶段 5 的死观测字段门禁与
  后续独立变更，不在本批。
- **不做环境变量阈值**：渲染进程没有可用的 env 通道（Vite 在产物里把 `process.env` 打成空对象桩），
  加一个用户设不动的旋钮等于装饰性防线。将来若要可调，走设置页真持久化。
- **不改任务相位口径**：`TERMINAL_PHASES`、终态吸收、取消语义一律保持原状。

## 验收

- 陈旧判据（阈值/锚点/射程/取数口径）全部由纯函数用例覆盖，注入时钟、不依赖组件。
- 面板行为锁：徽标出现与消失**只由 `lastEventAt` 这一个变量决定**（证伪「字段仍没人读」）；
  时间路径（挂载新鲜 → 推进 3 分钟后自动出现）用假时钟验证。
- 14 条变异逐条实测变红，还原后逐字节一致。
- 无障碍：徽标是状态消息（WCAG 4.1.3），不新增可聚焦元素（不动 tabindex 基线）；
  颜色只用既有 token，浅暗两档对比按实测（14.36:1 / 13.79:1）。
