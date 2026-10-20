## ADDED Requirements

### Requirement: 去发布浮窗提供流水线与配置的选择

「去发布」浮窗（`components/PublishDestinationModal.vue`）的视频创作分支 SHALL 在既有「流水线选择」之外提供「配置选择」控件，列出**所选流水线**已保存的配置档案。流水线选项 SHALL 默认覆盖全部**文案型**视频创作流水线（与创作页「带文案进入时灰显非文案型」同一判据），素材型、录屏型、内部冒烟与独立页流水线 SHALL NOT 出现。配置档案 SHALL 取自设备级配置库（主进程 `story2video:config-profile-list`），按 `pipelineId` 过滤、按 `updatedAt` 倒序。

#### Scenario: 流水线选项覆盖文案型全集

- **WHEN** 用户打开「去发布」浮窗的视频创作分支
- **THEN** 流水线下拉包含 `story2video-compose`、`talking-head`、`localization-dub`、`animated-explainer`、`documentary-montage`、`animation`、`character-animation`、`hybrid`、`avatar-spokesperson`，且不包含 `clip-factory`、`cinematic`、`framework-smoke`、`video-clone`、`film-engineering`

#### Scenario: 配置选项按流水线过滤

- **WHEN** 配置库中存在当前流水线的配置档案与其它流水线的配置档案
- **THEN** 配置下拉只列出当前流水线的档案，按更新时间倒序

#### Scenario: 非法配置档案被丢弃但不连坐

- **WHEN** 配置库返回的数组中混有 id 非法、名称为空或 `pipelineId` 形态非法的条目
- **THEN** 这些条目不出现在下拉中，其余合法条目照常列出

### Requirement: 没有配置时显示默认且下拉内容为空

当所选流水线没有任何配置档案时，配置选择控件 SHALL 在框内显示文字「默认」，SHALL 不可展开，且其展开内容 SHALL 为空。控件 SHALL 同时给出一行可见说明，告知用户该流水线尚未保存过配置以及去哪里创建。配置列表加载失败 SHALL 与「没有配置」区分呈现，SHALL NOT 伪装成「没有配置」。

#### Scenario: 无配置时的显示

- **WHEN** 当前流水线在配置库中没有任何档案
- **THEN** 触发器显示「默认」、处于不可展开状态、下拉菜单节点不存在，且说明行提示该流水线还没有保存过配置

#### Scenario: 加载失败如实呈现

- **WHEN** 配置库 IPC 返回非零返回码、抛错或返回结构非法
- **THEN** 触发器仍显示「默认」，说明行显示加载失败文案，且不被呈现为「没有配置」

#### Scenario: 加载中不误导

- **WHEN** 配置库请求尚未返回
- **THEN** 说明行显示加载中文案，控件不可展开

### Requirement: 配置选择与流水线联动

切换流水线 SHALL 立即替换配置选项列表，并 SHALL 作废此前选中的配置档案（回到「默认」）。选中的配置档案若已从库中消失，SHALL 回落为「默认」，SHALL NOT 保留指向不存在档案的选中态。浮窗每次打开 SHALL 重新读取配置库。

#### Scenario: 切换流水线清空旧选择

- **WHEN** 用户在 A 流水线选中一条配置后切换到 B 流水线
- **THEN** 配置控件显示「默认」，且选项列表为 B 流水线的档案

#### Scenario: 配置消失不留悬空选中态

- **WHEN** 选中的配置档案在配置库中不再存在
- **THEN** 配置控件显示「默认」

### Requirement: 去发布的视频去向携带所选配置

「去发布」浮窗的 `publish-video` 事件 SHALL 继续以流水线 id 作为第一个参数（保持既有调用方兼容），并 SHALL 以 `{ configProfileId, configProfileName }` 作为第二个参数。未选择配置档案时两个字段 SHALL 为空串。

#### Scenario: 提交携带配置档案

- **WHEN** 用户选择了某条配置档案并点击「生成视频」
- **THEN** 事件第一个参数是所选流水线 id，第二个参数的 `configProfileId` 是该档案 id、`configProfileName` 是其名称

#### Scenario: 未选择配置时不携带档案

- **WHEN** 用户未选择配置档案并点击「生成视频」
- **THEN** 事件第二个参数的 `configProfileId` 与 `configProfileName` 均为空串

### Requirement: 交接查询键名单一真源

跳转到视频创作页的查询参数 SHALL 由一处纯函数构造：`draft`（草稿 id）、`pipeline`（流水线 id）、`configProfile`（配置档案 id）。值为空或形态非法时 SHALL NOT 携带对应键，SHALL NOT 携带空串。改写页、采集页、热门选题页三个入口 SHALL 共用该构造入口。

#### Scenario: 有选择时三个键齐备

- **WHEN** 三个入口各自构造跳转到创作页的查询
- **THEN** 查询包含 `draft`、`pipeline` 与 `configProfile` 三个键

#### Scenario: 未选配置时不带配置键

- **WHEN** 用户未选择配置档案
- **THEN** 查询中不存在 `configProfile` 键

#### Scenario: 非法配置 id 不带配置键

- **WHEN** 配置档案 id 形态非法
- **THEN** 查询中不存在 `configProfile` 键

### Requirement: 创作页自动套用带过来的配置

视频创作页 SHALL 在选中流水线之后套用查询参数带来的配置档案，复用既有的配置快照套用语义（枚举归一化、失效服务商回退、分辨率按当前能力上限归一）。套用成功后 SHALL 记录已应用的配置名并提示「已应用配置」。查询未带配置档案时 SHALL NOT 套用且 SHALL NOT 提示。

#### Scenario: 套用成功

- **WHEN** 创作页以 `?draft=<id>&pipeline=<pid>&configProfile=<profileId>` 打开，且该档案属于当前流水线
- **THEN** 表单字段被该档案的快照覆盖，已应用配置名被记录，界面提示「已应用配置」

#### Scenario: 未带配置不套用

- **WHEN** 创作页打开时查询未带 `configProfile`
- **THEN** 不套用任何配置、不读取配置库、也不显示任何提示

#### Scenario: 配置已删除

- **WHEN** 查询带来的配置档案在配置库中不存在
- **THEN** 界面提示该配置不存在或已被删除，并按流水线默认参数继续，不静默失败

#### Scenario: 跨流水线配置被拒绝

- **WHEN** 查询带来的配置档案属于另一条流水线
- **THEN** 界面提示该配置属于其他流水线，无法在当前流水线应用，且不套用任何配置

#### Scenario: 无法确定流水线时放弃套用

- **WHEN** 创作页打开时没有选中任何流水线
- **THEN** 界面提示未能确定流水线，无法套用所选配置

#### Scenario: 套用失败不阻断创作

- **WHEN** 配置快照套用执行失败
- **THEN** 界面提示配置应用失败，并继续允许用户按流水线默认参数创作

#### Scenario: 配置列表载入失败时不伪装成「配置不存在」

- **WHEN** 创作页载入配置库时出错（IPC 通道未注册、用户目录数据损坏等）
- **THEN** 界面提示未能载入配置列表、无法套用所选配置，并按流水线默认参数继续；**SHALL NOT** 把该情形呈现为「配置不存在或已被删除」；且该失败**SHALL NOT** 以未捕获异常的形式冒泡

### Requirement: 配置档案的套用优先于上次选项的恢复

视频创作页的「恢复上次选项」与「套用配置档案」写入同一份表单。系统 SHALL 保证配置档案在两者并发时**后写**，即配置档案的最终生效值 SHALL 覆盖「恢复上次选项」的结果。

#### Scenario: 并发时配置档案胜出

- **WHEN** 选中编排型流水线时「恢复上次选项」与「套用配置档案」同时在途
- **THEN** 最终表单等于配置档案快照的值，而不是上次选项的值

### Requirement: 配置选择控件的键盘可达

配置选择控件 SHALL 声明 `role="combobox"` 与 `role="listbox"`，因此 SHALL 配得上与该声明相符的键盘操作：SHALL 支持在触发器上用方向键展开菜单、用方向键与 `Home` / `End` 移动焦点、用 `Enter` 或空格**选中当前焦点项**、用 `Esc` 关闭菜单、用 `Tab` 关闭菜单但不抢占焦点。鼠标点击、键盘选中 SHALL 走同一份「焦点项 → 配置档案」的映射。

#### Scenario: 键盘可完成选中

- **WHEN** 菜单已展开且焦点位于某条配置档案上，用户按 `Enter` 或空格
- **THEN** 该配置档案被选中、菜单关闭、焦点回到触发器

#### Scenario: 「默认」项同样键盘可达

- **WHEN** 菜单已展开，用户用 `Home` 把焦点移回「默认」项后按 `Enter` 或空格
- **THEN** 选中态回到「默认」（即不套用任何配置）

#### Scenario: 方向键与关闭键行为

- **WHEN** 菜单已展开
- **THEN** `↑` / `↓` 在选项间移动焦点且循环，`Home` / `End` 跳到首项 / 末项，`Esc` 关闭菜单并把焦点还给触发器，`Tab` 关闭菜单但**SHALL NOT** 把焦点抢回触发器（否则破坏浏览顺序）
