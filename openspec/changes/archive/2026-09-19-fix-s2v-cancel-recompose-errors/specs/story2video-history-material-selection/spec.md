# story2video-history-material-selection Delta Specification

## MODIFIED Requirements

### Requirement: 再次合成视频（recompose-project）

【重新合成】SHALL 复用既有 `story2video:recompose-project`（`composeEngine.compose({scenes: _scenesForCompose(project.segments)}, options)`），使用当前选定素材与既有 TTS 语音音频、字幕文本、背景音乐音频生成新成片；成功后 `dirty` 置 false。结果页底部操作条 SHALL 仅保留一个【重新合成】按钮（2026-09-18 合并功能重复的「再次合成视频」入口），按钮 hover 提示 SHALL 说明「使用当前选定的素材与已有旁白、字幕、背景音乐重新生成成片」。recompose 失败 SHALL 把真实错误 message 交给通知归一化处理：命中已知失败类别（余额/限流/API Key/素材缺失等）SHALL 显示对应本地化文案，未命中 SHALL 回退 operation_failed 通用文案；SHALL NOT 固定显示「当前操作未能完成」而丢弃错误文本。

#### Scenario: 再次合成成功

- **WHEN** 用户更换素材后点击【重新合成】
- **THEN** 以当前选中素材组合重新合成成片，结果视频替换输出，`dirty=false`，toast 提示成功

#### Scenario: 重新合成失败透传真实原因

- **WHEN** 用户点击【重新合成】且 recompose 失败，错误文本命中已知失败类别（如「第 N 个场景的视频素材不存在、不可读或超出限制」）
- **THEN** 弹窗显示对应本地化文案（如「该场景的视频素材不存在或不可读，请重新生成视频素材后再合成」），不显示「当前操作未能完成」通用文案

#### Scenario: 未映射错误回退通用文案

- **WHEN** recompose 失败且错误文本不匹配任何已知失败类别
- **THEN** 弹窗回退 operation_failed 通用文案，不暴露内部路径或堆栈

#### Scenario: 底部操作条仅一个重新合成入口

- **WHEN** 结果页底部操作条渲染
- **THEN** 恰好显示一个【重新合成】按钮（data-testid `recompose-button`），不再显示「再次合成视频」按钮（`recompose-final-button` 不存在）

### Requirement: 合成映射（_scenesForCompose）

服务端 SHALL 提供 `_scenesForCompose()` 将每个 segment 按选中态映射为 compose 输入：`selectedMaterial === 'video'` 且存在 `videoPath` → 仅传 `videoPath`；否则传选中图片（image1 → `imagePath`，image2 → `alternateImages[0].path`）并置空 `videoPath`；`selectedMaterial` 缺失 → 遗留语义（有 `videoPath` 用视频，否则 `imagePath`）。`composeEngine.compose` 与 `renderSegment` SHALL 保持零改动，【重新合成】【生成视频】均经此映射。显式选中 `video`/`video1`/`video2` 但对应素材不可读时 SHALL 抛出带场景号的可读错误（「第 N 个场景的视频素材不存在、不可读或超出限制」），不得抛出无场景定位的模糊错误，也不得让缺失的视频素材落到 compose 的二义性 media path 错误（该错误会被误归为图片缺失）。

#### Scenario: 三态映射

- **WHEN** 选中 video 且有视频 → **THEN** 合成输入仅含 `videoPath`
- **WHEN** 选中 image2 → **THEN** 合成输入含 `alternateImages[0].path` 且 `videoPath` 为空
- **WHEN** 选中 image1 → **THEN** 合成输入含 `imagePath` 且 `videoPath` 为空
- **WHEN** 字段缺失 → **THEN** 与现状一致（视频优先，否则图 1）

#### Scenario: 视频素材缺失错误带场景号

- **WHEN** 选中 video/video1/video2 且对应素材文件不存在、不可读或超限
- **THEN** 抛出错误包含「第 N 个场景的视频素材不存在、不可读或超出限制」，N 为该 segment 在数组中的序号（1 起）

#### Scenario: 显式选中视频不静默降级图片

- **WHEN** 选中 `video` 且 `videoPath` 不可读（即使 `imagePath` 可读）
- **THEN** 抛出视频素材缺失错误，不静默降级为图片合成（遗留语义分支保持「视频不可读、图片可读→降级图片」的既有行为）
