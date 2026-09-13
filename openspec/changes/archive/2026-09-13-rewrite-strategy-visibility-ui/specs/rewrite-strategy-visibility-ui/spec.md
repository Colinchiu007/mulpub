## Purpose
桌面端「文案改写」页（RewriteView）的改写策略可见性：用户能看到、能选择、发起前能预览自动匹配结果。

## ADDED Requirements

### Requirement: 策略选择区块
RewriteView 配置区必须提供「策略选择」：自动匹配（默认选中）与手动选择两种模式；选择手动时渲染策略下拉框，列出所有启用策略（内置 + 远程下发）。

#### Scenario: 默认自动匹配
- **WHEN** 用户打开文案改写页
- **THEN** 策略选择默认为「自动匹配」，策略下拉不渲染

#### Scenario: 切换到手动选择
- **WHEN** 用户点选「手动选择」
- **THEN** 出现策略下拉，含占位项与所有启用策略名称

#### Scenario: 策略列表加载失败
- **WHEN** IPC 返回失败或不可用
- **THEN** 下拉仅含占位项，改写仍可发起（走自动匹配）

### Requirement: 自动匹配预览
自动模式下，页面必须在发起改写前显示当前 userSettings 将匹配的策略名（推荐列表第一名）；目标平台变化时自动刷新。

#### Scenario: 挂载后预览
- **WHEN** 页面加载完成且推荐接口可用
- **THEN** 策略区块显示「将匹配策略：X」

#### Scenario: 平台切换刷新
- **WHEN** 用户切换目标平台
- **THEN** 预览策略名随新 userSettings 刷新

#### Scenario: 预览失败降级
- **WHEN** 推荐 IPC 失败
- **THEN** 预览显示占位「--」，不报错、不阻塞改写

### Requirement: 改写传参契约
发起改写时：手动模式传所选 strategyId（未选传 null）；自动模式显式传 null。引擎收到 null 走 StrategyMatcher 自动匹配。

#### Scenario: 手动选择后发起
- **WHEN** 用户手动选中策略 S 并发起改写
- **THEN** aiRewrite 参数含 strategyId=S

#### Scenario: 自动模式发起
- **WHEN** 自动模式下发起改写
- **THEN** aiRewrite 参数含 strategyId=null

### Requirement: i18n 成对
新增用户可见文案必须 zh/en 成对写入 locales，渲染端不新增硬编码中文字符串。

#### Scenario: locale 同步
- **WHEN** CI Gate 7 检查 locale 同步
- **THEN** zh.js 与 en.js 的 rewritePage 新增 key 一一对应
