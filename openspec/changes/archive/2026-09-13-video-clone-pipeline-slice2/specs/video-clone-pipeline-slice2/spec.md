## ADDED Requirements

### Requirement: 本地文件 ingest 校验与元数据探测
`createLocalFileIngest` SHALL 校验本地输入（存在且为文件、≤500MB、扩展名 ∈ {mp4,mov,webm,mkv,avi}、ffprobe 时长 ≤30min），成功后将 {path,sizeBytes,durationSec,width,height,fps,hasAudio,format} 写入 artifacts.media 并回填 report.meta；失败按错误码映射（FILE_NOT_FOUND / FILE_TOO_LARGE / FILE_FORMAT / FILE_TOO_LONG / PROBE_FAILED(retryable)）。

#### Scenario: 合法本地文件
- **WHEN** 输入存在的 mp4，大小/时长均在限制内且 ffprobe 成功
- **THEN** artifacts.media 与 report.meta（durationSec/resolution/fps）填充，返回 'ingest:local'

#### Scenario: 校验失败映射
- **WHEN** 文件不存在 / 目录 / 超 500MB / 扩展名不支持 / 时长超 30min / ffprobe 失败
- **THEN** 分别抛 FILE_NOT_FOUND / FILE_TOO_LARGE / FILE_FORMAT / FILE_TOO_LONG / PROBE_FAILED（PROBE_FAILED 可重试）

### Requirement: 链接下载与错误分类
`createUrlIngest` SHALL 经 downloadRunner（默认 yt-dlp）下载到临时目录，hintPlatform 识别平台提示（诊断用，不阻断），下载失败按 stderr 文本分类映射（私密→LINK_PRIVATE、会员→LINK_MEMBERSHIP、地区→LINK_REGION、反爬→LINK_ANTI_BOT、其余→LINK_UNAVAILABLE），产物超 500MB → FILE_TOO_LARGE。

#### Scenario: 下载失败分类
- **WHEN** downloadRunner 抛错且 stderr 含 "private video" / "members-only" / "not available in your country" / "confirm you are not a bot"
- **THEN** 分别映射 VIDEOCLONE_LINK_PRIVATE / LINK_MEMBERSHIP / LINK_REGION / LINK_ANTI_BOT

#### Scenario: 下载成功
- **WHEN** downloadRunner 成功且产物 ≤500MB
- **THEN** artifacts.media（source=url + platform 提示）与 report.meta.source/platform 填充

### Requirement: ffprobe analyze 与场景检测
`createFfprobeAnalyze` SHALL 补探链接来源元数据（probeRunner）、执行场景检测（sceneRunner 默认 ffmpeg scene filter，threshold 0.3）生成 shots 时间轴、组装 7 层报告骨架（aspect 由分辨率派生）；场景检测失败 SHALL 降级为合成均匀分段并记录 provenance.synthetic=true（不 fail-closed）。

#### Scenario: 场景切点 → 时间轴
- **WHEN** sceneRunner 返回切点 [3,7]，视频 10s
- **THEN** narrative.timeline = [{0,3},{3,7},{7,10}]，visual.shots 同步

#### Scenario: 场景检测失败降级
- **WHEN** sceneRunner 抛错
- **THEN** 生成均匀分段（如 4s/段），artifacts.analysis.scene.synthetic=true 且 method='synthetic-uniform'，流水线继续

### Requirement: ASR 与改写契约
- ASR：注入 sttRunner 时填充 script（fullText/lines/language）；未注入 SHALL script 留空且 asr=skipped（不失败）；`options.requireTranscript=true` 且 stt 失败 SHALL 抛 VIDEOCLONE_ASR_FAILED（retryable）。
- 改写：`options.rewriteScript=true` 且注入 llmRunner 时改写 script.fullText（失败抛 VIDEOCLONE_REWRITE_FAILED retryable）；未注入 → rewrite=skipped；inspiration 模式清空风格类字段与文案（仅借结构）。

#### Scenario: requireTranscript fail-closed
- **WHEN** options.requireTranscript=true 且 sttRunner 抛错
- **THEN** 流水线停止于 analyze，错误码 VIDEOCLONE_ASR_FAILED

#### Scenario: 改写成功/跳过
- **WHEN** llmRunner 注入并成功 → script 改写 + rewrite=ok；未注入 → 原文保留 + rewrite=skipped（不失败）

### Requirement: 切片 2 集成
`createSlice2Pipeline` SHALL 组合真实 ingest/analyze/plan 与 fail-closed 的 generate/compose/publish；真实 ffprobe/ffmpeg 可用时 SHALL 能对本地样例视频完成 ingest+analyze（报告含时长/分辨率/镜头时间轴），并在注入 stub 后全链路 ok 且产出 F4 相似度。

#### Scenario: 默认管线停在 generate
- **WHEN** 本地样例视频走 createSlice2Pipeline
- **THEN** 返回 ok:false、error.code=VIDEOCLONE_STAGE_NOT_IMPLEMENTED、phase=generate；report.meta 已填充（duration/resolution/aspect）、narrative.timeline 非空

#### Scenario: 注入 stub 全链路
- **WHEN** generate/compose/publish 注入 stub
- **THEN** ok:true，F4 相似度已计算（结构=1、时长通过、verdict∈{pass,needs_review}、confidence≥0.5）

### Requirement: 场景-测试映射
以上场景 SHALL 由 `packages/video-clone-engine/test/adapters/*.test.js` 覆盖（ingest-local 7 / ingest-url 4 / analyze-ffprobe 7 / plan-script 6 / slice2-integration 2，真实 smoke 在工具缺失时 skip）。

#### Scenario: 回归断言
- **WHEN** 运行 `node --test`（67 用例）
- **THEN** 全部通过且 exit code 0
