## ADDED Requirements

### Requirement: 发布历史列表的渲染上限必须出声

发布历史页在筛选命中条数超过渲染上限（200）时，SHALL 只渲染前 200 条，并 MUST 同时显示一条
`role="status"` 的提示，说明「本次只渲染前 N 条、另有 M 条未显示」。系统 MUST NOT 以静默少画的方式
让用户把「列表到此为止」读成「我的记录只有这些」。

#### Scenario: 命中超过上限
- **WHEN** 筛选命中 250 条
- **THEN** 列表渲染 200 张卡片，提示行出现且其中的 M 等于 50

#### Scenario: 未超过上限
- **WHEN** 筛选命中 3 条
- **THEN** 渲染 3 张卡片且提示行不存在

### Requirement: 筛选输入回显与列表收敛分离

发布历史页的筛选输入框 SHALL 立即回显用户输入，而列表收敛 MUST 读防抖快照。
防抖作用域 MUST NOT 扩到输入框本身（否则用户看不见自己敲的字）。

#### Scenario: 键入即刻回显
- **WHEN** 用户在关键词框输入「需要」
- **THEN** 该输入框的值立即为「需要」，而列表在防抖窗口内仍是全部命中条
- **AND** 窗口过后列表收敛到匹配条目

### Requirement: 首屏独立数据源必须并行且失败隔离

发布页、采集页、播客频道页在挂载时 SHALL 将互不依赖的数据源放在同一个 `Promise.allSettled` 批中发起，
任一源失败 MUST NOT 阻断其余源或导致整页报错；被拒的源 MUST 逐条留下可归因的告警。

#### Scenario: 快源不等慢源
- **WHEN** 频道元信息接口耗时远大于单集列表与端点列表
- **THEN** 后两者的请求开始时刻早于前者的结束时刻

#### Scenario: 一个源抛错
- **WHEN** 频道接口抛异常
- **THEN** 单集列表与端点目录照常渲染，页面无未处理拒绝

### Requirement: 封面取数不得冻结主进程且不得为未渲染行发起

`cover:read-data` 的读盘实现 MUST NOT 使用同步文件读原语（含同步存在性检查），
渲染层 MUST 只为进入视口（含预取带）的卡片发起封面请求。
在无 IntersectionObserver 能力的环境中，渲染层 SHALL 退回立即加载以保证「看得见就有图」。

#### Scenario: 未进入视口不请求
- **WHEN** 某卡片已渲染但尚未进入视口 ±240px
- **THEN** 该卡片的本地封面不产生任何 IPC 请求
- **AND** 进入视口后恰好请求一次，重复可见不重复读盘

#### Scenario: 卸载不留观察者
- **WHEN** 发布历史页被卸载
- **THEN** 观察者被 disconnect，后续任何绑定都不再发出请求

### Requirement: 聚合进度必须同时给出百分比与计数

发布进度聚合 SHALL 提供两套互不混淆的口径：`done` 只统计终态（success/failed/cancelled），
`progressPercent` 按软权重把运行中任务自身上报的阶段百分比计入且 MUST NOT 达到 100（上限 95），
运行中任务的 `percent` 缺失或非法时 MUST 按「已开始的最小可见量」计而非 0，也 MUST NOT 反推为满值。
存在运行中任务时界面 MUST 显示「第 N / 共 M 项」这一计数；全部落终态后该行 MUST 消失。

#### Scenario: 单任务全程不再 0%
- **WHEN** 唯一任务处于运行中且上报 percent 40
- **THEN** `done` 为 0，`progressPercent` 为 40，计数行为「第 1 / 共 1 项」

#### Scenario: 跑满但未结束
- **WHEN** 任务运行中且上报 percent 100
- **THEN** `progressPercent` 为 95（条子不贴满），`done` 仍为 0

#### Scenario: 百分比缺失
- **WHEN** 任务处于运行中但 `percent` 为 null 或非法值
- **THEN** `progressPercent` 为 5，且结果恒为有限数（不出现 NaN）
