## Why

"新建发布"类型选择弹窗提供 4 个入口：视频发布、图文发布、文章发布、公众号。经全链路追踪证实：图文发布（image）、文章发布（article）、公众号（wechat）三个类型值从选择那一刻起就完全等价——三者都落入 `activeMode='article'` 同一编辑分支，发布 IPC payload 不含类型值，主进程按平台 id 分发，历史/草稿零持久化。三个入口给用户的差异化暗示（"我要发公众号"）在后续流程中完全没有兑现：选"公众号"进入编辑页后并不会预选微信公众号平台，与选"图文发布"完全一样。这是蚁小二 UI 对齐时引入的纯展示性区分，选项数量与真实行为不一致。

## What Changes

- `PublishTypeDialog.vue`：类型卡片从 4 张减为 2 张（视频发布 + 图文文章发布）；合并后入口的平台集合取原 image 与 article 的并集。
- `Publish.vue`：`publishType` 白名单收敛为 `['video', 'article']`；`image`/`wechat` 作为兼容值归一化为 `article`（旧链接 `?type=image` / `?type=wechat` 不 404、不显示空类型标签）。
- locales（zh/en 成对）：新增合并入口标签 `typeArticleImage`；`typeImage`/`typeWechat` 键保留但不再被入口引用（避免破坏其他引用方）。
- 测试：`PublishTypeDialog.test.js`、`PublishHistory.test.js` 断言 4 卡片→2 卡片；`Publish.test.js` 新增兼容性用例（`?type=image`/`?type=wechat` 归一化为 article）。
- 文档：PRD 发布模块章节、CHANGELOG、learnings 同步更新。

## Capabilities

### Modified Capabilities
- `desktop`: 新建发布类型入口从 4 类收敛为 2 类（视频/图文文章）；旧类型 query 参数向后兼容归一化。

## Impact

- 修改：`apps/desktop/src/features/publish/components/PublishTypeDialog.vue`、`apps/desktop/src/views/Publish.vue`、`apps/desktop/src/locales/zh.js`、`en.js`、对应 *.test.js。
- 不触碰：主进程 IPC、任务队列、RPA 执行器、发布历史存储（类型值从未进入这些层，零迁移）。
- 风险：蚁小二 UI 对齐度下降（4 入口→2 入口），属有意的产品决策——选项数量与真实行为对齐优先于视觉对齐。
