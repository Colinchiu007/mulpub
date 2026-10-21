# 桌面 UI 一致性 — 本次变更增量

## ADDED Requirements

### Requirement: 发布进度面板必须把「长时间没有事件」呈现为可见状态

运行中的发布若连续 `DEFAULT_STALE_AFTER_MS`（默认 3 分钟）没有任何进度事件到达，
面板 MUST 显示「已 N 分钟无更新」徽标，并把该判据建立在**已有观测**（`task.lastEventAt`）
之上；措辞 MUST 只陈述观测事实，MUST NOT 断言任务已失败或已停止。

#### Scenario: 停滞超过阈值时徽标出现

- **WHEN** 会话仍为 `running`，其非终态任务的最近一次事件距今 ≥ 3 分钟
- **THEN** 标题区出现 `data-testid="publish-progress-stale"` 徽标，文本为「已 N 分钟无更新」
- **AND** N 为已过去的完整分钟数且至少为 1（MUST NOT 出现「已 0 分钟无更新」）

#### Scenario: 刚有事件时不得谎报停滞

- **WHEN** 任一运行中任务在 3 分钟内产出过事件
- **THEN** 徽标不出现
- **AND** 同一份会话数据仅改变 `lastEventAt` 就能使徽标出现/消失（证明判据读的就是这个字段）

#### Scenario: 已结束的任务不再被催更

- **WHEN** 会话状态为 `done`，或其全部任务处于 `success|failed|cancelled`
- **THEN** 陈旧判据射程为空，徽标不出现

#### Scenario: 徽标对屏读用户同样可见

- **WHEN** 徽标由「无」到「有」发生跃迁
- **THEN** 该元素带 `role="status"` 与 `aria-live="polite"`（WCAG 4.1.3）
- **AND** 徽标本身不可聚焦，不新增 tabindex

### Requirement: 陈旧态必须解禁关闭入口，且该入口不得是死按钮

关闭按钮的可用性判据 MUST 是「有运行中任务 **且** 未陈旧」。陈旧态下点击 × MUST 产生
真实的界面变化，且 MUST NOT 丢弃运行中的会话数据（否则后来到达的成功/失败事件会变成
看不见的孤儿）。

#### Scenario: 运行中且新鲜时保持原语义

- **WHEN** 有运行中任务且 3 分钟内有过事件
- **THEN** × 仍为 disabled，tooltip 为「发布进行中，可先最小化到后台」

#### Scenario: 陈旧时解禁并如实说明动作语义

- **WHEN** 面板处于陈旧态
- **THEN** × 可点击，tooltip 改为说明「收起」并声明「任务可能仍在后台进行」
- **AND** 点击后依次执行 `clearFinished()`（清掉已完成会话）与 `minimizePanel()`（收进胶囊）
- **AND** 运行中的会话仍在 store 内，可经胶囊一键重新展开

#### Scenario: 空闲态不得渗漏陈旧文案

- **WHEN** 没有任何运行中任务
- **THEN** × 的 tooltip 回到「关闭」，徽标不出现

### Requirement: 陈旧判据只有一份实现，且计时器归组件所有

阈值与判定逻辑 MUST 收敛于 `apps/desktop/src/utils/publish-progress-staleness.js` 单一实现；
store MUST 保持纯状态（不持计时器）；轮询 MUST 只在存在运行中任务时存在，并在任务全部结束
或组件卸载时停止。阈值 MUST NOT 通过环境变量配置（渲染进程无可用 env 通道）。

#### Scenario: 消费方不各自抄阈值

- **WHEN** 检查组合式、面板、store 三份源码的可执行行
- **THEN** 均不出现 `180000` 字面量，判定一律调用共享实现

#### Scenario: 阈值取不到合法值时回落默认而不是恒陈旧

- **WHEN** 传入 `NaN / -1 / 0 / 'abc' / null / undefined` 作为阈值
- **THEN** 判据按默认 3 分钟生效（既不永不解禁，也不恒解禁）

#### Scenario: 轮询生命周期可归因

- **WHEN** 面板挂载且有运行中任务
- **THEN** 现场只存在这一张轮询表（假时钟正控 `getTimerCount() === 1`）
- **AND** `hasRunning` 落 false 或组件卸载后该表被清除（计数回到 0）

#### Scenario: 时间路径自己走通

- **WHEN** 挂载时数据新鲜，随后假时钟推进 3 分 15 秒
- **THEN** 无需任何外部触发，徽标自行出现且分钟数为 3
