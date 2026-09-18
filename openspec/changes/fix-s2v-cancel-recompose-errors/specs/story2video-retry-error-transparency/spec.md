# story2video-retry-error-transparency Delta Specification

## MODIFIED Requirements

### Requirement: 渲染层错误归一化展示

结果页 SHALL 把分段重试失败、场景图片生成失败以及 recompose（重新合成）失败的错误文本交给既有通知归一化处理（quota/rate-limit/API Key/权限/素材缺失等已知类别映射到对应本地化文案）；不得固定显示 operation_failed 而丢弃错误文本。未命中任何已知类别的错误 SHALL 回退 operation_failed 通用文案，且不得把内部路径或堆栈暴露给用户。

#### Scenario: 已知失败类别显示具体文案

- **WHEN** 重试图片失败，且错误文本命中余额不足（quota）模式
- **THEN** 弹窗显示 quota 类本地化文案，而非通用「当前操作未能完成」

#### Scenario: recompose 失败命中素材缺失类别显示具体文案

- **WHEN** 用户点击【重新合成】且失败，错误文本命中「第 N 个场景的视频素材不存在、不可读或超出限制」
- **THEN** 弹窗显示 `scene_video_missing` 本地化文案（「该场景的视频素材不存在或不可读，请重新生成视频素材后再合成」），而非通用「当前操作未能完成」

#### Scenario: compose 引擎英文素材错误归一化

- **WHEN** recompose 失败且错误文本为 compose 引擎英文错误（`Scene media path is not allowed or unreadable at index N` / `Scene audio path is not allowed or unreadable at index N`）
- **THEN** 弹窗分别归一化为 `scene_image_missing` / `scene_audio_missing` 本地化文案

#### Scenario: 未映射错误回退通用文案

- **WHEN** 重试图片失败或 recompose 失败，且错误文本不匹配任何已知失败类别
- **THEN** 弹窗回退 operation_failed 通用文案，不展示内部路径或堆栈

### Requirement: 视频素材缺失失败类别归一化（2026-09-18）

通知归一化 SHALL 提供 `story2video.scene_video_missing` 失败类别，覆盖「视频素材不存在/不可读/超出限制」类错误文本（含带场景号的中文文案与英文 `video material/asset missing|unavailable|unreadable` 模式）；该类别 SHALL 在 `scene_image_missing` 判定之后、`scene_slot_empty` 之前匹配，避免与图片素材缺失类别互相误归。文案 SHALL 写入 locales zh/en 成对。

#### Scenario: 中文视频素材缺失归一化

- **WHEN** 错误文本为「第 2 个场景的视频素材不存在、不可读或超出限制」
- **THEN** 归一化为 `story2video.scene_video_missing`，弹窗显示「该场景的视频素材不存在或不可读，请重新生成视频素材后再合成。」

#### Scenario: 英文视频素材缺失归一化

- **WHEN** 错误文本为 `no available video material` 或 `video asset is missing`
- **THEN** 归一化为 `story2video.scene_video_missing`，英文 locale 显示对应英文文案

#### Scenario: 图片与视频缺失类别互不误归

- **WHEN** 错误文本为「没有可用的图片素材」或 `Scene media path is not allowed or unreadable`
- **THEN** 归一化为 `story2video.scene_image_missing`，不得误归为 `scene_video_missing`

#### Scenario: locale 成对

- **WHEN** 新增 `scene_video_missing` 文案
- **THEN** zh/en 同键存在，CI check-locale-sync 通过
