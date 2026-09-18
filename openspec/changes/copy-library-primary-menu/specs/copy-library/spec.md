# 文案库规格增量

## ADDED Requirements

### Requirement: 一级菜单文案库入口

侧边栏一级导航在「采集」与「文案改写」之间显示「文案库」菜单项，点击进入 /copy-library 页面。

#### Scenario: 菜单渲染与路由
- WHEN 应用启动
- THEN 侧边栏一级导航顺序为 ...create, collection, copy-library, rewrite...
- WHEN 点击「文案库」菜单
- THEN 路由跳转 /copy-library，渲染 CopyLibraryView

### Requirement: 四来源聚合

文案库页面聚合采集正文、改写文案、草稿、视频创作文案四个来源，按 createdAt 倒序统一展示。

#### Scenario: 全部来源加载
- WHEN 4 个来源均有数据
- THEN 列表包含全部来源条目，统一卡片形状（来源徽标/标题/字数/时间）

#### Scenario: 单源失败不阻塞
- WHEN story2videoListProjects 失败
- THEN 其余 3 源正常展示，视频来源显示为空

#### Scenario: 视频文案预览截断
- WHEN story2video 项目 sourceText 超过 500 字
- THEN 列表预览只显示前 500 字

### Requirement: 来源筛选与搜索

文案库页面提供来源筛选按钮组和关键词搜索框，筛选与搜索可叠加。

#### Scenario: 按来源筛选
- WHEN 点击「视频创作」筛选按钮
- THEN 列表只显示 origin=video 条目

#### Scenario: 关键词搜索
- WHEN 输入关键词
- THEN 列表按标题+内容模糊匹配过滤

### Requirement: 双入口数据一致

一级文案库页面与采集页文案库 tab 共享同一数据层 composable，删除等写操作经磁盘重读保证最终一致。

#### Scenario: 采集页与一级页面共享数据层
- WHEN 在一级页面删除改写文案
- THEN 采集页文案库 tab 重新挂载后同步（readCurrent 磁盘重读）
