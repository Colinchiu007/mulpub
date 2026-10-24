## ADDED Requirements

### Requirement: 单场景 AI 视频生成的参数契约与模块归属

单场景 AI 视频生成 SHALL 由 `electron/services/scene-video-generator.js` 导出的 `generateSceneVideo` 承担（原位于 `story2video-stages.js`）。该函数 SHALL 保持既有返回形状 `{ success, path }` / `{ success: false, error }` 与既有错误文案语义。

`generateSceneVideo` 的入参 SHALL 扩展为：`{ manager, providerId, model, prompt, index, seconds, size, fps, runDir, pollIntervalMs, providerRunContext }`（既有）**加上** `{ mode, images, audios, videos, firstFrame, lastFrame, aspectRatio, seed, onProgress }`。

扩展参数的透传规则：
- `mode`（`text` / `keyframe` / `reference`）、`images[]`、`audios[]`、`videos[]`、`firstFrame`、`lastFrame`、`aspectRatio`、`seed` SHALL 在**有值时**写入提交给 provider 适配器的 `generateVideo` 参数；无值时 SHALL NOT 写入该键。
- `firstFrame` SHALL 同时写入 `firstFrame` 与 `image`（后者供只认单张 `image` 的旧版适配器使用）。
- `seconds` SHALL 优先于由 `numFrames` / `frameRate` 推导的时长：显式传入 `seconds` 时 SHALL 以其为准。

`onProgress` 为可选回调，SHALL 接受 `(percent, stage)` 两参；生成过程中的阶段推进 SHALL 经该回调上报。

`story2video-stages.js` SHALL 保留对 `generateSceneVideo` 的 re-export，使既有调用方与既有测试的引用路径保持不变。

#### Scenario: 既有调用方零改动

- **WHEN** 既有调用方以原有入参形状调用 `generateSceneVideo`
- **THEN** 行为与扩展前一致：不传扩展参数时，提交给适配器的参数集与扩展前相同

#### Scenario: 媒体参数透传

- **WHEN** 调用 `generateSceneVideo` 时传入 `mode='reference'` 与 2 张 `images`
- **THEN** 适配器收到的 `generateVideo` 参数含 `mode='reference'` 与长度为 2 的 `images` 数组

#### Scenario: 无值不写键

- **WHEN** 调用时未传 `audios` / `seed` / `aspectRatio`
- **THEN** 提交给适配器的参数中 SHALL NOT 出现 `audios` / `seed` / `aspectRatio` 这三个键

#### Scenario: 显式 seconds 优先

- **WHEN** 调用时同时传入 `seconds=8` 与 `fps=30`
- **THEN** 提交给适配器的时长语义为 8 秒，SHALL NOT 被 `fps` 推导出的帧数覆盖

#### Scenario: 进度回调

- **WHEN** 调用时传入 `onProgress`
- **THEN** 该函数在提交、排队/生成、下载、完成各阶段被调用，且最后一次调用携带完成态

#### Scenario: re-export 保持引用路径

- **WHEN** 从 `story2video-stages` 引入 `generateSceneVideo`
- **THEN** 得到的是 `scene-video-generator` 导出的同一实现
