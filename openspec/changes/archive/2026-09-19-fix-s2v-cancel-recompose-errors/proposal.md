## Why

视频创作-历史记录-「已取消」标签的项目点击「编辑」进入详情编辑页后，点击底部【再次合成视频】报「当前操作未能完成，请稍后再试」。该提示过于模糊：`ResultView.recomposeProject()` 的 catch 分支直接调用 `showStory2VideoOperationFailure()`，把 IPC 返回的真实错误 message 完全丢弃，违反 `story2video-retry-error-transparency` 已确立的「失败原因必须端到端保留、归一化为可读文案、不得固定显示 operation_failed」契约。已取消项目再次合成时，选中素材文件可能缺失（`_scenesForCompose` 抛「视频N素材不存在」或 compose 返回英文内部错误），用户无法得知具体原因。

同时，结果页底部【重新合成】与【再次合成视频】两个按钮功能 100% 重复（都调用 `recomposeProject`），仅文案不同，用户难以区分，造成 UI 冗余与文案混淆。

## What Changes

- **渲染端 recompose 失败透传**（ResultView.vue）：`recomposeProject()` catch 改为把真实错误 message 交给通知归一化（`showStory2VideoNotification({ error })`），已映射类别（余额/限流/API Key/素材缺失等）显示具体原因，未映射回退 operation_failed；不再固定显示「当前操作未能完成」。
- **素材缺失错误友好化**（story2video-project-service.js）：`_scenesForCompose` 对 video1/video2 选中态素材缺失的抛错改为带场景号的中文文案（「第 N 个场景的视频素材不存在、不可读或超出限制」）。
- **通知归一化新增 SCENE_VIDEO_MISSING**（story2video-notifications.js + locales zh/en 成对）：新增 `story2video.scene_video_missing` 键与匹配模式，覆盖「视频素材不存在/不可读/超出限制」及 compose 引擎英文错误（`Scene media path is not allowed or unreadable`、`Scene audio path is not allowed or unreadable`）的归一化。
- **按钮去重**（ResultView.vue + locales）：合并功能重复的【再次合成视频】与【重新合成】为一个【重新合成】按钮，移除 `recomposeFinal`/`recomposingFinal`/`recomposeFinalHint` 文案 key，新增 `recomposeHint` 承载原「使用当前选定的素材与已有旁白、字幕、背景音乐重新生成成片」提示。
- **测试**：新增 recompose 失败透传归一化测试（ResultView.test.js）、SCENE_VIDEO_MISSING 归一化测试（story2video-notifications.test.js）、更新按钮合并断言与 `_scenesForCompose` 错误文案断言。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `story2video-history-material-selection`: 结果页底部操作条按钮合并（移除重复的「再次合成视频」入口，仅保留「重新合成」），recompose 失败错误透传与素材缺失归一化行为。
- `story2video-retry-error-transparency`: 错误透传契约从「分段重试/场景图片生成」扩展覆盖 recompose 失败路径；新增视频素材缺失失败类别归一化。

## Impact

- **代码**：`apps/desktop/src/views/ResultView.vue`、`apps/desktop/electron/services/story2video-project-service.js`、`apps/desktop/src/story2video/story2video-notifications.js`、`apps/desktop/src/locales/zh.js`、`apps/desktop/src/locales/en.js`。
- **测试**：`ResultView.test.js`、`story2video-notifications.test.js`、`story2video-project-service.test.js`、CI check-locale-sync。
- **文档**：`01-docs/PRD-video-creation.md`（错误提示与按钮交互小节）、`CHANGELOG.md`、本 change 的 specs/design/tasks。
- **不涉及**：compose 引擎内部、流水线阶段流、IPC 通道清单、数据库、第三方服务契约。
