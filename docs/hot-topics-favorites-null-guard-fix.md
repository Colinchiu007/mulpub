# 热文收藏删除兼容损坏数据修复

- PR: #1798 `codex/hot-topics-favorites-null-guard`
- 关联问题: HotTopicsFavorites 取消收藏按钮在收藏数据损坏时无法清理条目

## 根因

取消收藏按钮原先直接 `$emit('remove-favorite', fav.topic?.id)`。当收藏条目数据损坏
（`fav.topic` 为 `null`，例如反序列化失败或历史脏数据）时，`id` 为 `undefined`，
`removeFavorite` 无法定位条目，用户无法清理该收藏。

## 修复

改为 `onRemove(fav)`：优先取 `fav.topic.id`，缺失时回退 `String(fav.favoritedAt)` 作为备用
ID，确保损坏条目仍可被删除。父组件 `props` / `emit` 契约未变。

## 验证

- 单文件改动（`HotTopicsFavorites` 组件），+8 / -2
- 核心 CI（QG Unit / Static / Browser E2E 等）全绿
- 文档同步硬门禁：本说明随 PR 提交，满足「代码变更须同步文档」规则
