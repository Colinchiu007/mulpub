# desktop

## ADDED Requirements

### Requirement: 发布类型入口合并

新建发布类型选择弹窗 SHALL 提供且仅提供 2 个类型入口：视频发布（video）与图文文章发布（article）。图文发布（image）、文章发布（article）、公众号（wechat）三个历史入口 SHALL 合并为统一的"图文文章发布"入口。

#### Scenario: 类型选择弹窗展示 2 个入口

- **WHEN** 用户从发布历史页点击"新建发布"
- **THEN** 类型选择弹窗显示 2 张卡片：视频发布、图文文章发布
- **AND** 图文文章发布卡片展示合并后支持平台集合（原图文与文章入口平台列表的并集）

#### Scenario: 合并入口的平台集合

- **WHEN** 渲染图文文章发布卡片的平台图标列表
- **THEN** 平台集合包含原 image 与 article 入口 id 列表的并集（去重）

#### Scenario: 旧类型链接向后兼容

- **WHEN** 用户通过旧链接进入编辑页（`/publish?type=image` 或 `/publish?type=wechat`）
- **THEN** 页面正常渲染图文文章编辑器（activeMode=article）
- **AND** 标题栏类型标签显示"图文文章发布"，不显示空值或原始 query 值

#### Scenario: 视频入口行为不变

- **WHEN** 用户选择视频发布入口
- **THEN** 进入视频编辑器（activeMode=video），行为与合并前完全一致
