# collection-ui 变更

## ADDED Requirements

### Requirement: 采集页批量采集区折叠分组

采集页「采集」页签内的批量采集区（RSS / URL 列表 / 知乎收藏夹）MUST 以互斥手风琴分组呈现：默认展开且仅展开一组；展开新组时 MUST 收起当前组；URL 单条采集工具条 MUST 保持常驻。分组标题 MUST 是可键盘操作（Enter/Space）的按钮元素并声明 `aria-expanded` / `aria-controls`。

#### Scenario: 默认态只展开一组
- **WHEN** 用户进入采集页「采集」页签
- **THEN** 批量采集区三个分组中恰好一组展开（默认 RSS），其余两组折叠并显示摘要行

#### Scenario: 互斥展开
- **WHEN** 用户点击折叠中的「知乎收藏夹」组标题
- **THEN** 知乎组展开且 RSS/URL 列表组同时收起，`aria-expanded` 相应翻转

### Requirement: 批量进度展示统一

RSS/URL 列表批量采集与知乎「采集并改写」的进度展示 MUST 渲染同一进度组件（标题 + 进度轨道 + done/total 文本 + 可选取消/明细展开），进度轨道颜色 MUST 使用 `--color-progress-track` / `--color-primary` 语义槽。

#### Scenario: 两种批量进度同构
- **WHEN** 分别触发 RSS 批量采集与知乎「采集并改写」
- **THEN** 两者进度区使用相同组件与相同视觉结构，知乎进度保留 `zhihu-fav-batch-progress` / `zhihu-fav-summary` 测试标识与逐条明细展开

### Requirement: 采集结果卡片信息层级

采集结果卡片与文案库卡片 MUST 按「标题/来源/时间 → 徽标 → 操作」三级排布；操作按钮 MUST 按使用频率分级（创建草稿/发布 primary，查看/视频创作/改写 secondary，删除 danger）。

#### Scenario: 操作分级
- **WHEN** 采集结果列表渲染 ≥1 张卡片
- **THEN** 创建草稿与发布按钮为 primary 样式，删除为 danger 样式

### Requirement: 采集页视觉 token 收编

采集页及其子组件的样式 MUST 使用 `tokens.css` 语义槽；新增语义槽 MUST 在亮色 `:root` 与 `[data-theme="dark"]` 各有定义且暗色值真覆盖，并登记进既有 tokens 契约测试。渲染层采集相关文件 MUST 无亮色硬编码 hex（测试文件除外）。

#### Scenario: 暗色模式可读
- **WHEN** 应用切换到暗色主题并打开采集页四页签
- **THEN** 页面底、卡底、文字、饰带全部来自语义槽，无浅底浅字/深底深字

#### Scenario: 硬编码门禁
- **WHEN** 运行 collection 样式契约测试
- **THEN** Collection.vue 与 features/collection/*.vue 中 hex 色值字面量为 0（白名单为空）

### Requirement: 采集结果空态

采集结果累计列表为空时 MUST 渲染统一空态组件（标题/描述/动作文案走 locale），动作点击 MUST 聚焦 URL 采集输入框。

#### Scenario: 空列表引导
- **WHEN** collectedItems 为空
- **THEN** 列表区显示空态而非空白，点击动作后 URL 输入框获得焦点
