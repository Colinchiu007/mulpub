## Purpose

Defines the failure-transparency contract for Story2Video segment retry (image/video) and scene image generation: real failure reasons must be preserved end-to-end, normalized into user-visible localized messages for known failure classes, and leave a log trail — never masked into a generic "operation failed" message.
## Requirements
### Requirement: 分段重试失败保留真实原因

服务端 SHALL 在分段重试（图片/视频）或场景图片生成失败时，把生成器返回的原始错误原因（如余额不足、限流、API Key 缺失、内容审核）原样上抛给调用方；不得因产物路径缺失等派生错误替换原始原因。失败时 SHALL 保留旧媒体、清理本次尝试产物，并把 failed 状态与原始错误持久化到分段。

#### Scenario: 图片生成器返回失败结果

- **WHEN** 用户点击「重试图片」，图片生成器返回 `{ code: -1, message: '余额不足' }`
- **THEN** IPC 返回的 message 包含「余额不足」，分段保留旧媒体且状态为 failed，原始错误持久化到分段 error 字段

#### Scenario: 图片生成成功但分段视频重渲染失败

- **WHEN** 图片生成成功且产物已复制，但分段视频重渲染返回非 0
- **THEN** 重试整体失败并上抛原始渲染错误，本次图片产物与部分视频被清理，旧媒体与旧视频保留

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

### Requirement: 主进程失败日志痕迹

主进程 SHALL 在分段重试 IPC 失败时记录 warn 级日志，包含错误 message，为故障诊断保留痕迹。

#### Scenario: 重试失败产生日志

- **WHEN** `story2video:retry-segment` 调用抛错
- **THEN** 日志出现 warn 级记录，且内容包含错误 message

### Requirement: 分段成功写回清除失败痕迹（2026-08-16）

服务端 SHALL 在任一素材写回路径把分段状态置为 `completed`（图片生成/重试、视频生成/重试、音频替换/重生成、优化词/字幕重生成等）时，清除该分段的 `error` 字段；分段 `status` 为 `failed` 时 SHALL 保留 `error`（既有契约）。禁止出现 `completed` 与 `error` 并存的误导状态。

#### Scenario: 重试图片成功后无残留错误

- **WHEN** 分段曾失败（error 记录「余额不足」）且用户重试图片成功
- **THEN** 分段 `status=completed` 且 `error` 为空/不存在

#### Scenario: 失败仍保留原因

- **WHEN** 图片生成失败
- **THEN** 分段 `status=failed` 且 `error` 保留原始错误文本

### Requirement: 分段状态本地化与失败原因内联展示（2026-08-16）

结果页/历史编辑页分段卡片 SHALL 以本地化标签展示分段状态（完成/失败/生成中），不得输出英文原值；`status=failed` 且存在 `error` 时 SHALL 内联展示一行可读失败原因（复用通知归一化分类映射本地化文案，未命中回退通用文案并截断）；`status` 非 `failed` 时 SHALL NOT 展示失败原因或失败样式，即使 `error` 字段存在残留。

#### Scenario: 失败分段显示原因

- **WHEN** 分段 failed 且 error 命中「额度/余额不足」模式
- **THEN** 卡片显示本地化「失败」标签与额度/余额类可读原因，用户可据此检查套餐或重试

#### Scenario: 完成分段不显示残留错误

- **WHEN** 分段 completed 但数据残留 error（旧版本数据或未清理路径）
- **THEN** 卡片仅显示「完成」标签，不渲染失败原因与失败样式

#### Scenario: 未映射错误回退通用文案

- **WHEN** 分段 failed 的 error 不匹配任何已知失败类别
- **THEN** 内联原因回退 operation_failed 通用文案，不暴露内部路径或堆栈

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

