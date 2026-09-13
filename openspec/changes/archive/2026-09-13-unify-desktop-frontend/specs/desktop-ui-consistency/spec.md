# desktop-ui-consistency Specification

## Purpose

桌面端渲染层的 UI 一致性契约：保证所有视图共享同一套设计 token 来源、危险操作必须经过确认门禁、同类交互使用唯一实现、IPC 访问走单轨出口、用户可见文案进入 i18n 体系。目标是消除"每个页面一种写法"的漂移，并为 CI 提供可机械校验的一致性卡点。

## ADDED Requirements

### Requirement: 设计 token 单一来源

渲染层 SHALL 以唯一的 token 文件作为颜色/字号/间距/圆角/阴影变量的单一来源；主色 SHALL 定标为 `#5048e5`。任何样式文件不得重新定义与 token 同语义的变量（如另设主蓝），不得以 hex 字面量新增主题色。

#### Scenario: 新增主色引用

- **WHEN** 视图或组件需要引用主色
- **THEN** 它通过 token 变量获取 `#5048e5`，且全库扫描不存在第二种主蓝色字面量

#### Scenario: 暗色模式主色不被覆盖

- **WHEN** 应用切换到暗色模式
- **THEN** 主色保持 `#5048e5` 可辨识度，不得被局部覆盖为浅灰等低对比色

### Requirement: 危险操作确认门禁

删除类破坏性操作（含批量删除发布记录、删除项目、删除音色及未来新增的不可逆操作）SHALL 先展示确认对话框并获得用户明确确认后才执行；确认框文案 SHALL 说明操作后果。

#### Scenario: 批量删除发布记录

- **WHEN** 用户在发布历史中触发批量删除
- **THEN** 出现列出影响条数的确认框，取消则不删除任何记录，确认后才执行

#### Scenario: 删除项目或音色

- **WHEN** 用户删除单个项目或音色
- **THEN** 出现确认框，取消则资源保留

#### Scenario: 确认框实现统一

- **WHEN** 任意需要确认的交互触发
- **THEN** 使用统一的确认原语呈现，全库不存在原生 `window.confirm` 等并行实现

### Requirement: 反馈原语统一

操作成功/失败提示、页面加载态、空数据态 SHALL 各自由唯一封装提供；空态 SHALL 引导下一步动作（CTA 或说明）。禁止视图自造 spinner/empty 样式副本。

#### Scenario: 接口失败必有反馈

- **WHEN** 任一视图的数据加载或提交请求失败
- **THEN** 用户看到统一的错误提示（文案遵循 user-facing-messages 的 formatUserError 映射），不允许静默吞错

#### Scenario: 列表为空时的空态

- **WHEN** 列表类视图查询结果为空
- **THEN** 展示带说明与引导按钮的统一空态，而非空白区域或裸文本

### Requirement: IPC 渲染端访问单轨制

Vue 组件与 composable SHALL 通过 api 桥接层函数访问 Electron IPC，禁止直接调用 `window.electronAPI`；需要静默降级的 channel SHALL 在桥接层显式声明 fallback 行为。

#### Scenario: 组件调用 IPC

- **WHEN** 视图需要读取发布历史等 IPC 数据
- **THEN** 经由桥接层导出的函数调用，CI 卡点对渲染层直调 `window.electronAPI` 报告违规即失败

#### Scenario: fallback 语义不丢失

- **WHEN** 某 channel 原有静默降级行为并被迁移到桥接层
- **THEN** 迁移后该 channel 在异常时仍返回原有降级结果而非抛出未处理错误

### Requirement: 视图层 i18n 覆盖

路由注册的视图 SHALL 通过 i18n 词条渲染用户可见文案；zh/en locale SHALL 成对更新（遵循 i18n-content-sync）。新增硬编码中文文案被 CI 基线扫描拦截时 MUST 修复后才能合入。

#### Scenario: 未接入视图迁移

- **WHEN** 一个此前硬编码中文的视图完成迁移
- **THEN** 其模板中的用户可见字符串来自 `$t()` 词条，zh/en 两语言均可正确显示

#### Scenario: 巨石视图延后不阻塞基线

- **WHEN** CreateView/ResultView 尚未完成词条迁移
- **THEN** CI 中文基线只允许持平或下降，任何新增硬编码中文导致门禁失败

### Requirement: 死代码不留存量

不可达的路由页面、零使用的全局组件、从未挂载的功能模块 SHALL 被删除或显式接入；同功能重复文件 SHALL 合并为单一实现并保留一份测试。

#### Scenario: 不可达页面清理

- **WHEN** 路由重定向已使某页面不可达
- **THEN** 该页面文件与其专属测试一并删除，构建与测试全绿

#### Scenario: 双实现合并

- **WHEN** 存在两个职责相同的历史面板文件
- **THEN** 仅保留一个实现，引用方与测试同步收敛到该实现
