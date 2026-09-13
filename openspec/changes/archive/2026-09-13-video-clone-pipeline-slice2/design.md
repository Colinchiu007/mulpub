# 设计：切片 2 — 真实 ingest / analyze / plan adapter

## 架构

```
src/adapters/
  runners.js         二进制解析(VC_*/FFPROBE_PATH/FFMPEG_PATH/YTDLP_PATH) + spawn + ffprobe 元数据 + ffmpeg scene 检测 + yt-dlp + classifyDownloadError
  ingest-local.js    createLocalFileIngest({fsImpl, probeRunner, limits})
  ingest-url.js      createUrlIngest({downloadRunner, fsImpl, tmpDir, limits}) + hintPlatform
  analyze-ffprobe.js createFfprobeAnalyze({probeRunner, sceneRunner, sttRunner, sceneThreshold, uniformSegmentSec})
  plan-script.js     createScriptPlan({llmRunner})
  index.js           createDefaultIngest / createSlice2Pipeline
```

## Runner 契约（依赖注入，默认真实实现）

| runner | 入参 | 出参 | 默认实现 |
|---|---|---|---|
| probeRunner | mediaPath | {durationSec,width,height,fps,hasAudio,format} | ffprobe -print_format json |
| sceneRunner | mediaPath, {threshold} | 切点时间数组 | ffmpeg select='gt(scene,0.3)',showinfo → pts_time |
| downloadRunner | url, targetPath | {targetPath} | yt-dlp --no-playlist |
| sttRunner | mediaPath | {fullText, lines[], language} | 未提供（切片 3 接 ModelProviderManager STT） |
| llmRunner | {sourceText, mode} | rewrittenText | 未提供（切片 3 接 prompt-engine/LLM） |

## 关键决策

1. **错误映射**：下载失败按 stderr 文本分类（classifyDownloadError：私密/会员/地区/反爬/不可用），映射到 PRD §14 错误码；新增 FILE_NOT_FOUND。
2. **场景检测降级**：ffmpeg scene filter 失败不 fail-closed，降级为合成均匀分段，provenance.synthetic=true 记录（诚实标注，避免假证据）。
3. **ASR 缺省跳过**：未注入 sttRunner 时 script 留空 + asr=skipped；仅 `options.requireTranscript=true` 时失败（fail-closed）。
4. **改写缺省保留**：rewriteScript=true 但未注入 llmRunner → rewrite=skipped（配置缺失≠失败）；改写失败才抛 REWRITE_FAILED（retryable）。
5. **画幅派生**：aspectFromResolution（9:16/16:9/1:1/4:5/3:4，容差 0.05）。
6. **集成验证**：真实 ffprobe/ffmpeg 生成 2s 样例视频冒烟（工具缺失自动 skip）。
