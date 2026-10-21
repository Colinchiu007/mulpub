# PRD：发布进度「无更新」看门狗（阶段 1.8 / change: ux-audit-progress-watchdog）

日期：2026-10-21 · 范围：`apps/desktop` 渲染层 · 关联：`01-docs/UX-AUDIT-2026-10-17.md` 阶段 1.8、
`openspec/changes/ux-audit-progress-watchdog/`

## 1. 问题与根因

**用户侧现象**：发布卡在某个阶段后（主进程不再发进度事件），进度面板永远显示「进行中」，
右上角的 × 一直是灰的，鼠标移上去说「发布进行中，可先最小化到后台」。用户只能继续等，
或者重开应用 —— 而重开应用并不会让那次发布变得更可信。

**代码级根因**（不是"缺一个计时器"，而是"有一条观测没人读"）：

| 位置 | 事实 |
| --- | --- |
| `src/stores/publishProgress.js:104` | 任务结构里声明了 `lastEventAt: null` |
| `:166` / `:173` / `:213` | 三处写入 `task.lastEventAt = Date.now()`（终态后迟到的非终态事件、常规事件、`task-complete` 兜底） |
| 渲染层消费方 | **0 处**（`git grep lastEventAt -- apps/desktop/src` 只命中 store 自身与其测试） |
| `PublishProgressPanel.vue:36`（改前） | `:disabled="store.hasRunning"` —— 只看「有没有运行中的会话」，不看「还有没有动静」 |

于是「主进程沉默了」这个信息**已经在数据里了，但没有出口**。这正是阶段 5 计划里
「死观测字段」门禁（审计 §5.4）要收敛的形状；审计 §12 明确写了 **5.4 不得早于 1.8**，
否则 `lastEventAt` 会在门禁启用当场判红 —— 本 PR 就是为了让那条门禁上线时基线是干净的。

## 2. 判据口径（单一实现：`src/utils/publish-progress-staleness.js`）

```
computeStaleInfo(sessions, now, staleAfterMs = DEFAULT_STALE_AFTER_MS)
  → { stale: boolean, minutes: number, lastEventAt: number | null }
```

| 编号 | 规则 | 为什么这样定（不是随手选的） |
| --- | --- | --- |
| R1 | 射程只含 `status === 'running'` 的会话里的**非终态**任务 | 已结束的会话不必再"催更"；把 done 会话算进来会让面板在完成态也亮红 |
| R2 | 终态集合 = `success \| failed \| cancelled`，与 store 的 `TERMINAL_PHASES` 同语义 | 漏掉 `cancelled` 会把用户主动取消的任务说成"卡住了" |
| R3 | 锚点取**全局最近一次事件**（跨会话、跨任务取最大） | 面板回答的是"还要不要等下去"这个集合级问题；逐任务判会造出"有的任务在动、面板说没动静"的自相矛盾 |
| R4 | 任务 `lastEventAt` 缺席（登记了但一个事件都没来过）⇒ 回落 `session.createdAt` | "从没动过"不等于"刚刚才动"。回落成 `now` 会让 `lastEventAt` 继续是个死字段 |
| R5 | 连 `session.createdAt` 都取不到 ⇒ **不产出结论**（`stale=false`，`lastEventAt=null`） | 无判据时不得凭空给用户一个"可点"的解禁按钮，也不得谎报分钟数 |
| R6 | 阈值默认 `180000`（3 分钟），非法取值（非有限正数）回落默认 | 坏阈值若不回落，会被当成 0 用 ⇒ 面板从"永不解禁"翻成"恒解禁"，两个方向都不可接受 |
| R7 | `elapsed >= 阈值` 即陈旧（边界含等号） | 与审计原文"无事件 3 分钟后"一致；`>` 会让"恰好 3 分钟"这一格永远不亮 |
| R8 | `minutes = max(1, floor(elapsed / 60000))` | 阈值被改到小于 1 分钟时，不钳位就会输出"已 0 分钟无更新"这种自相矛盾的文案 |
| R9 | `now < 锚点`（时钟回跳）⇒ 不陈旧、分钟数 0 | 本仓有"本机时间跳变"的既有事实（`clockAnomaly`），判据不得因用户改系统时间而谎报 |
| R10 | 脏输入（非数组、`null` 会话、`tasks` 非对象）一律按"无结论"处理且不抛错 | 判据挂在渲染路径上，抛错会让整块面板消失（比停滞更坏） |

**刻意不做环境变量覆盖**：渲染层没有可用的 env 通道（Vite 生产构建把 `process.env` 替换成空对象桩，
实测 `src` 下只有被静态替换的 `process.env.NODE_ENV` 能成立）。加一个用户设不动的旋钮
= 一条装饰性防线。将来要可调，走设置页真持久化。这条决定由一条结构锁钉住：判据本体的**代码行**
里不得出现 `process.env`（注释里允许，因为"为什么不做什么"是写给读者的证据）。

## 3. 交互逻辑

### 3.1 计时器归属

沿用 `usePublishProgressAutoCollapse` 已确立的分工：**store 保持纯状态、不持计时器**，
计时器由组件侧的 `usePublishProgressStaleness` 申请与清理。

| 事件 | 行为 |
| --- | --- |
| 面板挂载且 `hasRunning` 为真 | 立即取一次当前时刻（不等满一个周期），并起 15s 轮询 |
| 轮询触发 | 只更新 `nowTick`，陈旧判定仍由共享实现算 |
| `hasRunning` 落 false | 停表，并刷一次读数（此后不再有轮询，读数必须是当下的） |
| 组件卸载 | 停表（`onBeforeUnmount`） |

15s 是**采样周期**，不是阈值，两个量不许混：文案粒度是分钟，15s 采样的最坏落后是 15 秒；
再密只是多烧定时器。空闲应用（无运行中任务）不留常驻定时器。

### 3.2 关闭按钮的三态

| 状态 | `disabled` | tooltip（zh） | 点击 × 的效果 |
| --- | --- | --- | --- |
| 有运行中任务且新鲜 | 是 | 发布进行中，可先最小化到后台 | —— |
| 有运行中任务且陈旧 | **否** | 长时间没有收到更新，点击可收起面板（任务可能仍在后台进行） | `clearFinished()` → `minimizePanel()` |
| 无运行中任务 | 否 | 关闭 | `clearFinished()`；若无会话则隐藏面板（原语义不变） |

**为什么陈旧态的 × 是"收起"而不是"丢弃会话"**：`clearFinished()` 只清 `status==='done'` 的会话，
运行中的会话必然留下 ⇒ 若只把 `disabled` 翻掉，× 会变成一个**看得见、点不动的死按钮**。
另一条出路是把会话从 store 摘掉，但主进程稍后发来 `success/failed` 时，`handleProgressEvent`
会把它收纳成孤儿会话，而 `panelVisible` 已是 false ⇒ 用户看不到那次真实结果，等于为了
"能关掉"而牺牲证据。收进胶囊同时满足三件事：面板消失（用户诉求）、一次点击可回展开、
迟到事件照常落进同一会话。

### 3.3 胶囊态（最小化）

陈旧时胶囊的提示从「发布后台进行中，请勿关闭应用」换成「已 N 分钟无更新」。
转圈图标**保留** —— 任务确实可能仍在后台跑，去掉转圈就是在说一个更强的假话。

### 3.4 footer 的「请勿关闭应用」警示条

**刻意不改**。它约束的是"不要退出整个应用"，这与"这条发布是否还在出事件"是两个命题；
把 footer 一起改掉会让用户在任务真的还在跑时贸然退出应用。该判断写进代码注释与本节，
避免下一个会话当成"漏改"顺手收敛。

## 4. 显示项与提示文字（zh / en 成对，`src/locales/publish-page/`）

| 键 | zh | en | 出现位置 |
| --- | --- | --- | --- |
| `staleBadge` | 已 {minutes} 分钟无更新 | No update for {minutes} min | 面板标题区徽标；最小化胶囊提示位 |
| `staleCloseHint` | 长时间没有收到更新，点击可收起面板（任务可能仍在后台进行） | No updates for a while — click to collapse this panel (the task may still be running) | × 的 tooltip（仅陈旧态） |

措辞纪律：只陈述**观测事实**（多久没有事件），不断言结论（"发布已中断/已失败"）——
后者需要主进程证据，渲染层没有。

## 5. 无障碍与样式

- 徽标 `role="status" + aria-live="polite"`：状态跃迁对屏读用户同步可见（WCAG 4.1.3）。
- 徽标是文本容器，**不可聚焦**、不带 `tabindex` ⇒ 不动本仓的可聚焦元素基线。
- 颜色只用既有 token：`color: var(--color-text-strong)` / `background: var(--color-warning-soft)`，
  两档对比按 WCAG 公式现算（浅 `#1e1b4b` on `#fef3c7` = **14.36:1**，暗 `#f5f5f7` on `#33240c` =
  **13.79:1**），均远高于 AA 的 4.5:1。**不新增色槽**（避免与并行 PR 的 `--color-warning-ink`
  争抢同一处），样式块内除注释外不得出现十六进制字面量（有锁）。

## 6. 验收

1. 纯函数用例 **28 条**（实测 `Tests 28 passed`）：阈值、边界（含等号/差 1ms）、射程、终态集合、锚点回落与缺席、
   全局取最大、分钟钳位、非法阈值、脏输入、时钟回跳、导出面契约、"不得自带 env 旋钮"结构锁、
   三份消费方源码不得自带 `180000` 字面量。
2. 面板行为锁：本 PR 在 `PublishProgressPanel.test.js` 新增 **17 条**（该文件实测 `Tests 49 passed`，
   其余 32 条为既有用例未受影响）——含"同一份会话数据只改 `lastEventAt` 就能翻转徽标"这条
   "字段真的有读者"的可证伪形式、假时钟下的时间路径锁、定时器计数正控（`getTimerCount() === 1`）、
   三态 tooltip、× 的实际动作与"会话未被丢弃"、胶囊提示替换、en 无中文残留、locales 成对、
   样式 token 与两档覆盖、不新增可聚焦元素。
3. 变异反证 14 条（`node scripts/publish-staleness-contract-mutate.js`）逐条实测变红，
   还原后逐字节一致（驱动外另用 grep 独立回读三处被改文件）。
4. `pnpm exec eslint electron/ src/ --quiet`（CI 同款聚合命令）rc=0。

## 7. 边界与遗留（不假装已闭合）

- **本 PR 只做渲染层**：不探测主进程任务真实状态。「无事件」≠「已停止」，因此文案是观测事实；
  停滞后的自愈/重查属独立变更。
- **单任务级停滞被全局口径吃掉**（R3 的代价，见 design D1）：A 卡 10 分钟而 B 每 10 秒一动时，
  面板不徽标。任务行的百分比/阶段词仍在动，属另一条展示面。
- 阶段 5.4「死观测字段」门禁上线时，`lastEventAt` 已由本 PR 变成"写 4 读 ≥1"，
  该门禁的基线可以只含剩下的候选（审计 §12 的顺序约束由此满足）。
