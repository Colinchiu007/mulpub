# Navigation Shell Specification

## Purpose

定义 Multi-Publish 桌面端**应用壳**（左侧侧边栏 + 右侧工作区）的导航与用户入口契约：登录区位置与展开行为、底部区域层级顺序、系统级入口（设置 / 升级 Pro）归属、模块导航内容边界、键盘与无障碍契约、身份状态降级。

## Requirements

### Requirement: 登录区位置唯一且位于侧边栏底部

系统 SHALL 在侧边栏底部渲染唯一的用户入口 banner（`ProfileMenu`，面板向上展开），收起态只显示一条 banner。登录区 MUST NOT 出现在侧边栏顶部 header，也 MUST NOT 在页面内容区另设副本。

#### Scenario: 收起态只显示一条 banner
- **WHEN** 应用壳渲染且用户菜单未展开
- **THEN** 侧边栏底部 SHALL 显示单条 banner（头像 + 存在状态点 + 显示名 + 许可徽标 + 展开指示）
- **AND** 侧边栏顶部 header SHALL NOT 包含任何登录 / 账号入口

#### Scenario: 向上展开菜单
- **WHEN** 用户点击 banner 且身份状态不是 `signed_out` / `expired`
- **THEN** 菜单面板 SHALL 在 banner 上方展开（`bottom: calc(100% + 8px)`）并与 banner 等宽
- **AND** 面板宽度 MUST NOT 超出侧边栏宽度

#### Scenario: 未登录点击直接唤起登录
- **WHEN** 用户点击 banner 且身份状态为 `signed_out` 或 `expired` 且未在登录中
- **THEN** 系统 SHALL 直接发起登录
- **AND** 仅当登录失败时 SHALL 展开菜单并展示错误

### Requirement: 底部区域层级顺序

侧边栏 footer 的子元素顺序 SHALL 为 [0] 服务连接信息 → [1] 用户 banner。

#### Scenario: 服务连接信息位于 banner 上方
- **WHEN** 侧边栏渲染
- **THEN** footer 第一个子元素 SHALL 包含服务连接信息（`data-testid="yixiaoer-service-status"`）
- **AND** footer 第二个子元素 SHALL 是用户 banner 根节点（`data-testid="profile-menu"`）

### Requirement: 系统级入口归属（设置 / 升级 Pro）

设置入口 SHALL 只从侧边栏底部用户菜单进入；升级 Pro 入口 SHALL 只在该菜单中为非 Pro 用户提供，并复用菜单项统一版式。

#### Scenario: 设置入口不在主导航
- **WHEN** 侧边栏渲染
- **THEN** 主导航 SHALL NOT 包含设置项（`data-testid="yixiaoer-primary-settings"` 不存在）
- **AND** 展开用户菜单后 SHALL 存在设置菜单项（`data-testid="profile-menu-settings"`，文案取自 `nav.settings`）

#### Scenario: 点击设置先关菜单再抛事件
- **WHEN** 用户点击设置菜单项
- **THEN** 菜单 SHALL 先关闭
- **AND** 组件 SHALL 抛出 `open-settings` 事件（由侧边栏透传给 `App.vue` 打开设置弹窗）
- **AND** 设置项 SHALL 在任意身份状态下均可见

#### Scenario: 非 Pro 用户的升级入口
- **WHEN** `licenseStore.isPro` 为假且用户展开菜单
- **THEN** SHALL 显示升级菜单项（`data-testid="profile-menu-upgrade"`，文案取自 `memberCenter.upgradePro`，类名含 `profile-menu-action`）
- **AND** 点击后 SHALL 先关闭菜单并抛出 `upgrade` 事件

#### Scenario: Pro 用户不显示升级入口
- **WHEN** `licenseStore.isPro` 为真且用户展开菜单
- **THEN** 升级菜单项 MUST NOT 渲染
- **AND** 设置菜单项 SHALL 仍然渲染

### Requirement: 模块导航不含占位工具入口

模块导航 SHALL 只渲染左侧模块标签（含激活态），MUST NOT 渲染无真实能力的占位工具入口或其面板。

#### Scenario: 工具区零渲染
- **WHEN** 模块导航在任意路由渲染
- **THEN** `[data-testid="yixiaoer-module-tools"]`、`.yixiaoer-tool-button`、`[data-testid="yixiaoer-tool-panel"]` MUST NOT 存在
- **AND** 模块标签与其激活态下划线 SHALL 保持既有行为

### Requirement: 键盘与无障碍契约

用户 banner SHALL 提供菜单语义与完整键盘操作。

#### Scenario: 键盘操作
- **WHEN** banner 获得焦点且用户按 `↓`
- **THEN** 菜单 SHALL 展开并聚焦第一个菜单项
- **WHEN** 菜单已展开且用户按 `Esc`
- **THEN** 菜单 SHALL 关闭且焦点 SHALL 返回 banner
- **WHEN** 菜单已展开且用户按 `Tab`
- **THEN** 菜单 SHALL 关闭
- **WHEN** 菜单已展开且用户按 `↑` / `↓` / `Home` / `End`
- **THEN** 焦点 SHALL 在可聚焦菜单项之间循环移动

#### Scenario: 菜单语义
- **WHEN** banner 与面板渲染
- **THEN** banner SHALL 带 `type="button"`、`aria-haspopup="menu"`、`:aria-expanded`、`:aria-busy`
- **AND** 面板 SHALL 带 `role="menu"` 与 `aria-labelledby="profile-menu-trigger"`
- **AND** 菜单项 SHALL 带 `role="menuitem"`，分隔线 SHALL 带 `role="separator"`

### Requirement: 身份状态降级

身份状态异常时系统 SHALL 给出明确且可恢复的表现，不得误导用户。

#### Scenario: 身份服务未启用
- **WHEN** 身份状态为 `disabled` 且用户点击 banner
- **THEN** 菜单 SHALL 展开并显示「身份服务未启用」说明
- **AND** 系统 MUST NOT 发起登录
- **AND** 设置与升级入口 SHALL 仍然可用

#### Scenario: 未知身份状态归一
- **WHEN** 身份状态为枚举外的未知值
- **THEN** 状态点与状态文案 SHALL 归为错误档（橙点 + 错误文案）
- **AND** 系统 MUST NOT 抛出渲染异常

#### Scenario: 动作进行中防重复提交
- **WHEN** 登录 / 切换账号 / 退出登录进行中
- **THEN** 对应菜单项 SHALL 禁用并显示进行中文案
- **AND** 重复点击 MUST NOT 触发第二次动作
