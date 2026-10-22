# desktop-ui-consistency — 发布进度的「无更新」必须是可见且可退出的状态（UX 审计 1.8）

## ADDED Requirements

### Requirement: 长时间无事件的运行中任务必须呈现为「无更新」中性态，并允许用户退出面板

渲染层 MUST 以已存在的 `task.lastEventAt` 为唯一时间锚判定「无更新」：
当某任务的 `Date.now() - lastEventAt` 达到阈值（默认 180 000 ms）且该任务尚未进入终态时，
MUST 在界面上以中性（非失败红）文案显示「N 分钟无更新」。

本判定 MUST 是**只读派生**：MUST NOT 修改 `phase`、MUST NOT 写入任何持久化真源、
MUST NOT 触发取消或重试。理由：「没有新事件」不是「失败」的证据，
把它当成负向结论会违反本仓「登录态/任务态只被正/负证据改写」的同一条口径。

#### Scenario: 无事件满阈值

- **WHEN** 一个 `running` 任务的 `lastEventAt` 距今 ≥ 阈值，且未收到终态事件
- **THEN** 该任务 MUST 被判为陈旧，任务行状态文案后 MUST 追加「（N 分钟无更新）」
- **AND** `phase` 与颜色语义 MUST 保持原值不得改为失败

#### Scenario: 收到新事件即解除

- **WHEN** 同一任务随后收到任意进度事件
- **THEN** `lastEventAt` MUST 被刷新，陈旧态 MUST 消失（不残留上一轮的分钟数）

#### Scenario: 终态任务不参与陈旧判定

- **WHEN** 任务已是 `success` / `failed` / `cancelled`
- **THEN** MUST NOT 显示「无更新」，即便其 `lastEventAt` 已超过阈值
- **AND** 它 MUST NOT 计入 `hasStalledRunning`

### Requirement: 全部运行中任务都无更新时，面板关闭按钮必须解禁

`PublishProgressPanel` 的关闭按钮 MUST 仅在「存在**未陈旧**的运行中任务」时禁用。
即：只要所有 `running` 任务的 `lastEventAt` 都已超过阈值，关闭按钮 MUST 可用。

不可退出的面板是本条缺陷的用户可见后果（RPA 窗口挂死时事件永不到来，
`:disabled="hasRunning"` 因此永不解锁，用户只剩「取消全部」，而取消同路也可能挂死）。
解禁 MUST NOT 取消任务、MUST NOT 改动队列状态——它只关闭一个已经无法再更新的面板。

#### Scenario: 部分任务仍在动

- **WHEN** 同时存在 1 个陈旧任务与 1 个未陈旧任务
- **THEN** 关闭按钮 MUST 仍禁用（还有在动的任务，收起面板会丢可见性）

#### Scenario: 全部陈旧

- **WHEN** 所有 `running` 任务都超过阈值
- **THEN** 关闭按钮 MUST 可用，且 `title` MUST 说明「任务已 N 分钟无更新，可关闭面板」

#### Scenario: 关闭不等于取消

- **WHEN** 用户点击解禁后的关闭按钮
- **THEN** MUST 只隐藏/清理面板可见性，MUST NOT 调用 `cancelTask` 或改动队列状态

### Requirement: 陈旧判定用的计时器必须是惰性且单实例

陈旧状态依赖墙钟推进，而事件不会替它推进，因此渲染层 MUST 有一个 tick；
该 tick MUST 只在「存在运行中任务」期间存在，运行中任务清空后 MUST 停止；
重复调用 `init()` MUST NOT 叠加第二个定时器。

理由：本仓已有「全局单例事件监听器在窗口重建时重复注册」的回归教训（`autoUpdater` 那条），
而常驻 15 秒定时器会让每条路由都付一份它用不到的唤醒成本。

#### Scenario: 无运行中任务

- **WHEN** 会话列表为空或全部终态
- **THEN** tick MUST 已停止（`setInterval` 计数为 0），MUST NOT 继续唤醒渲染

#### Scenario: 重复初始化

- **WHEN** `init()` 被调用两次（App 级订阅幂等路径）
- **THEN** 活跃定时器 MUST 恰好 1 个

#### Scenario: 时钟判据同域

- **WHEN** 判定「多久没更新」
- **THEN** 两条边 MUST 同取自进程时钟（`Date.now()` 对 `Date.now()`），
  MUST NOT 与文件 mtime 或事件里的主进程时间戳混用
