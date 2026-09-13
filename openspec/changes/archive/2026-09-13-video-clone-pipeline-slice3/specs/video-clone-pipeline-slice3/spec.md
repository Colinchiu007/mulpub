## ADDED Requirements

### Requirement: generate 资产规划与 provider 契约
`createGenerateAssets` SHALL 按 `createAssetPlan` 逐镜头派生资产规格（kind：full 模式且镜头 type=video → video，否则 image；promptSeed 含 palette/tone/person/plot 锚点），逐镜头调用 assetGenerator；未注入 assetGenerator SHALL 抛 VIDEOCLONE_PROVIDER_UNAVAILABLE（fail-closed，retryable）；生成失败 SHALL 抛 VIDEOCLONE_ASSET_GENERATION_FAILED（retryable）；产物缺 path SHALL 失败。成功时 artifacts.assets.scenes 按镜头序填充。

#### Scenario: 未注入生成器
- **WHEN** assetGenerator 未注入且报告有镜头
- **THEN** 流水线停在 generate，error.code=VIDEOCLONE_PROVIDER_UNAVAILABLE

#### Scenario: 生成成功
- **WHEN** assetGenerator 返回 {path,kind}
- **THEN** artifacts.assets.scenes 长度=镜头数，含 durationSec 与 path

### Requirement: ffmpeg compose 纯函数构建与真实合成
`buildComposeCommand` SHALL 纯函数返回 ffmpeg args：每镜头图片输入（-loop 1 -t dur -i）、scale/pad 到目标尺寸（resolution 优先，其次 aspect 映射）、concat 视频、可选音频/字幕（buildAssScript → ASS）/水印、`-t` 总时长、输出路径；无镜头或素材不足 SHALL 抛 VIDEOCLONE_COMPOSE_FAILED。`createFfmpegCompose` SHALL 执行并 ffprobe 校验输出，写 artifacts.output{path,durationSec,width,height,sizeBytes}；执行失败抛 COMPOSE_FAILED（retryable）。

#### Scenario: 命令结构
- **WHEN** 2 镜头 + 音频 + 水印 + 字幕
- **THEN** args 含 4 个 -i、concat=n=2、subtitles=、overlay=、scale=WxH、-t 总时长、输出路径

#### Scenario: 真实合成（ffmpeg 可用时）
- **WHEN** 2 张 PNG + 音频 + ASS 字幕走 createFfmpegCompose
- **THEN** 输出 mp4 存在，ffprobe 时长≈预期、分辨率=目标、hasAudio=true

### Requirement: 可选发布
`createPublish` SHALL：未注入 publisher 或 enabled=false → publishResult={status:'skipped',reason:'no-publisher'}（不失败）；publisher 成功 → publishResult 透传；publisher 抛错 → VIDEOCLONE_PUBLISH_FAILED（retryable）。

#### Scenario: 跳过
- **WHEN** 未配置 publisher
- **THEN** 流水线成功且 publishResult.status='skipped'

#### Scenario: 发布失败
- **WHEN** publisher 抛错
- **THEN** 流水线停在 publish，error.code=VIDEOCLONE_PUBLISH_FAILED

### Requirement: 切片 3 集成
`createSlice3Pipeline` SHALL 组装六阶段（ingest/analyze/plan 真实 + generate/compose/publish 契约）；注入 assetGenerator/publisher 且 ffmpeg 可用时，对本地样例视频 SHALL 产出成片（artifacts.output 存在、时长≈源、F4 相似度已计算）；未注入 assetGenerator 时停在 generate（PROVIDER_UNAVAILABLE）。

#### Scenario: 全链路产出成片
- **WHEN** 本地 2s 样例 + stub 生成器（真实 PNG）+ 真实合成 + stub 发布
- **THEN** ok:true，output 存在且时长≥1.5s，publishResult.published=true，similarity.metrics.structure=1 且 confidence≥0.5

### Requirement: 场景-测试映射
以上场景 SHALL 由 `packages/video-clone-engine/test/adapters/{generate-assets,compose-command,compose-integration,publish,slice3-integration}.test.js` 覆盖（真实合成/全链路在 ffmpeg 缺失时 skip）。

#### Scenario: 回归断言
- **WHEN** 运行 `node --test`（86 用例）
- **THEN** 全部通过且 exit code 0
