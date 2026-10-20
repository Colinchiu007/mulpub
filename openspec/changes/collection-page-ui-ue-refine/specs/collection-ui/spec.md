# collection-ui 变更

## ADDED Requirements

### Requirement: 采集页控件规范单一来源

采集页及其子组件的按钮、输入控件、卡片、徽标、横幅、页签 MUST 统一引用 `features/collection/collection-page.css` 定义的类族与 `--col-*` 变量组；同一语义的控件 MUST NOT 存在第二套视觉声明。被渲染层引用的 class MUST 在样式层有对应定义，不得消费未定义的类（`is-primary`、`primary`、`collection-tab-badge` 等历史死类 MUST 为 0 消费或已有定义）。

#### Scenario: 按钮三档分级可见

- **WHEN** 采集页任一区块渲染操作按钮
- **THEN** 每区至多一个 primary 档按钮，且 primary 与 secondary 档在底色/描边/文字色上可区分（由 CSS 契约测试断言「消费的类有定义且档位声明不同」）

#### Scenario: 消费未定义类被拦截

- **WHEN** 有人在采集域组件中引用一个域内命名空间的新 class 而未在样式层定义
- **THEN** CSS 契约测试失败并输出文件名、类名与缺失的规则

### Requirement: 采集页输入控件尺寸一致

采集域的 select / input / textarea MUST 共用同一基准高度（`--col-field-h`）与水平内边距（`--col-field-pad`）；行内小控件 MUST 使用 `--col-field-h-sm`。不同区块 MUST NOT 各自定义控件高度。

#### Scenario: 控件高度一致

- **WHEN** 对比采集页 URL 工具条、批量采集面板、知乎收藏夹区块、快捷采集卡内的输入控件
- **THEN** 它们的高度来自同一变量，差值为 0

### Requirement: 采集页徽标与角标规范

采集域徽标（凭据状态、类别标签、来源徽标、页签角标）MUST 使用统一圆角与字号槽；页签角标 MUST 有可见的底色与文字对比，计数超过 99 时 MUST 截断为 `99+`。

#### Scenario: 页签角标可读

- **WHEN** 草稿箱或博主监控页签的待处理数大于 0
- **THEN** 角标以主色底 + 白字渲染，数值大于 99 时显示 `99+`，而非无样式裸文本

### Requirement: 采集页视觉 token 收编（含新纳入文件）

采集页及其子组件的样式 MUST 使用 `tokens.css` 语义槽；`QuickCollectPanel.vue`、`QuickCollectCommandDialog.vue`、`CollectionDraftsPanel.vue` MUST 纳入 hex 硬编码门禁的扫描范围。新增 `--col-*` 槽 MUST 在亮色 `:root` 与 `[data-theme="dark"]` 各有定义且暗色值真覆盖。

#### Scenario: 硬编码门禁覆盖全采集域

- **WHEN** 运行采集域样式契约测试
- **THEN** 采集相关渲染层文件的 hex 色值字面量为 0，扫描范围包含快捷采集面板与指令弹窗

#### Scenario: 暗色模式可读

- **WHEN** 应用切换到暗色主题并打开采集页五个页签
- **THEN** 页面底、卡底、文字、徽标、页签 active 态全部来自语义槽，无浅底浅字/深底深字

### Requirement: 采集页信息架构与可达性

采集页页头 MUST 与内容区使用同一页面底色；页签 MUST 声明 `role="tab"` / `aria-selected` / `aria-controls`，且对应的内容面板 MUST 声明 `role="tabpanel"` 与被指向的 `aria-labelledby`。快捷操作区 MUST 按语义分组（新建 / 草稿 / 素材来源）并 MUST NOT 使用 emoji 作为功能图标。

#### Scenario: 页签与面板关联

- **WHEN** 用户切换到「文案库」页签
- **THEN** 该页签按钮 `aria-selected=true` 且 `aria-controls` 指向的 tabpanel 容器存在并渲染文案库内容

#### Scenario: 快捷操作区分组

- **WHEN** 采集页渲染快捷操作区
- **THEN** 六个入口按「新建」「草稿」「素材来源」三组呈现，各组有分组标题，图标统一为线性图标

### Requirement: 采集域操作分级一致

采集结果卡、文案库卡、草稿箱卡的操作按钮 MUST 按同一分级表渲染：主操作（创建草稿/发布/改写）为 primary 档，次级操作（查看/视频创作/编辑/存入草稿）为 secondary 档，删除为 danger 档。primary 档 MUST 有真实的主色样式，不得使用无定义的类名占位。

#### Scenario: 三卡分级一致

- **WHEN** 分别查看采集结果卡、文案库采集卡、草稿箱卡
- **THEN** 三者的主操作按钮视觉一致（同为 primary 档），删除按钮同为 danger 档
