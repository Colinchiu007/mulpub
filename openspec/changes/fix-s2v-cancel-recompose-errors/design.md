## Context

见 proposal.md - Why。现状链路：`ResultView.recomposeProject()` 的 catch 直接 `showStory2VideoOperationFailure()` 丢弃 IPC 返回的真实错误 message；`_scenesForCompose` 对 video1/video2 素材缺失抛「视频N素材不存在」无场景号；通知归一化缺少视频素材缺失类别；结果页底部「重新合成」与「再次合成视频」两个按钮功能 100% 重复。

## Goals / Non-Goals

**Goals**
- recompose 失败时用户看到具体可读原因（素材缺失/余额/限流/API Key 等），不再固定「当前操作未能完成」。
- 素材缺失错误带场景号定位，归一化到新 `scene_video_missing` 类别。
- 合并重复按钮，消除「重新合成」vs「再次合成视频」文案混淆。

**Non-Goals**
- 不修改 compose 引擎内部（`story2video-compose-engine.js` 零改动）。
- 不新增 IPC 通道、不改权限域、不改 preload 契约。
- 不针对「已取消」状态做特殊拦截——已取消项目若素材完好仍可正常重新合成，仅素材缺失时失败并给出具体提示。

## Decisions

### D1: recompose 失败透传真实错误走通知归一化

**选择**：`recomposeProject()` catch 改为 `showStory2VideoNotification({ error: error?.message || '' })`，与 `retrySegment`/`generateSceneImage`/`pausePipelineRun` 等既有路径一致。

**理由**：`resolveStory2VideoNotification` 已实现「已知类别 → 本地化文案，未映射 → operation_failed」的归一化。透传后已映射类别自动显示具体原因，未映射仍回退通用文案，行为与 spec `story2video-retry-error-transparency` 一致。这是最小改动，复用既有机制。

**备选**：为 recompose 单独写错误分支——重复逻辑，且会遗漏未来新增类别，否决。

### D2: 素材缺失错误带场景号 + 新增 SCENE_VIDEO_MISSING 类别

**选择**：`_scenesForCompose` 的 map 回调补 `index` 参数，video1/video2 缺失抛「第 N 个场景的视频素材不存在、不可读或超出限制」；通知归一化新增 `SCENE_VIDEO_MISSING` key + pattern + locales 文案，并扩展 `SCENE_IMAGE_MISSING`/`SCENE_AUDIO_MISSING` pattern 覆盖 compose 引擎英文错误。

**理由**：场景号帮助用户定位问题分段；新类别让用户看到「该场景的视频素材不存在或不可读，请重新生成视频素材后再合成」的可操作提示。compose 英文错误归一化避免把内部英文直接暴露给用户。

**备选**：在 recomposeProject 主进程开头对已取消项目做前置校验——但已取消项目素材完好时本可正常合成，前置拦截会误伤；素材缺失由 `_scenesForCompose`/compose 自然抛出，透传即可。否决前置拦截。

**匹配顺序**：`SCENE_VIDEO_MISSING` 判定置于 `SCENE_IMAGE_MISSING` 之后、`SCENE_SLOT_EMPTY` 之前；`SCENE_IMAGE_MISSING` pattern 扩展覆盖「scene media path is not allowed or unreadable」（compose 对图片缺失的返回），避免与视频类别误归。

### D3: 合并两个重复按钮

**选择**：删除 `recompose-final-button`，仅保留 `recompose-button`（「重新合成」），把原 `recomposeFinalHint` 提示内容并入新 `recomposeHint`。

**理由**：两个按钮 `@click` 都调 `recomposeProject`，功能完全重复，保留两个只会继续混淆。合并后单一入口语义清晰，`recomposeHint` 保留「使用当前选定的素材与已有旁白、字幕、背景音乐重新生成成片」的操作说明。

**备选**：保留两个按钮但改写文案区分——但功能相同的情况下任何文案区分都是误导，否决。

## Risks / Trade-offs

- [compose 引擎英文错误归一化可能误归] → pattern 精确匹配「Scene media path is not allowed or unreadable」/「Scene audio path is not allowed or unreadable」固定短语，且 `SCENE_VIDEO_MISSING` 判定在图片/音频之后，互不重叠。
- [删除 recomposeFinal 文案 key 影响其他引用] → 已全仓检索，仅 ResultView.vue 引用；测试同步更新。
- [并发 worktree 修改 ResultView.vue] → 本次改动范围（recomposeProject catch、底部按钮、注释）与并发会话的滚动高亮改动（onSegmentScroll 等）不重叠，合并冲突风险低。

## Migration Plan

- 部署：随常规 PR 合并，无数据迁移、无配置变更。
- 回滚：revert PR 即可恢复旧行为；文案 key 删除为纯前端，无兼容负担。

## Open Questions

无。
