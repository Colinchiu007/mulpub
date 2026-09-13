# 设计：切片 3 — generate / compose / publish adapter

## 架构

```
generate-assets.js   createAssetPlan(report) → [{index,t0,t1,durationSec,kind,promptSeed}]
                     createGenerateAssets({assetGenerator})：逐镜头生成 → artifacts.assets.scenes
compose-ffmpeg.js    resolveTargetSize / buildAssScript / buildComposeCommand（纯函数）
                     createFfmpegCompose({ffmpegRunner, ffprobeRunner, outputDir, fps})：执行+校验 → artifacts.output
publish.js           createPublish({publisher, enabled})：可选发布 → publishResult
index.js             createSlice3Pipeline(opts)：六阶段组装
```

## 关键决策

1. **generate fail-closed**：未注入 assetGenerator → PROVIDER_UNAVAILABLE（可重试）；生成失败 → ASSET_GENERATION_FAILED；产物必须含 path。
2. **compose 纯函数构建**：buildComposeCommand 返回 ffmpeg args（可单测不依赖二进制）；scale/pad 统一目标尺寸（resolution 优先，其次 aspect 映射表），concat 图片序列，字幕/水印可选叠加，`-t` 总时长。
3. **字幕 ASS**：script.lines → Dialogue（{\an2} 底部居中白字描边）；路径转义用 fromCharCode 构造（规避 Windows 反斜杠/冒号）。
4. **publish 可选**：未配置 publisher 或 enabled=false → publishResult{status:'skipped'}（不失败）；配置后失败 → PUBLISH_FAILED（可重试）。
5. **真实集成验证**：ffmpeg 生成 2s 样例 → 纯色 PNG 素材 → 真实合成 → ffprobe 校验输出时长/分辨率/音轨 → F4 相似度。
6. **独立流水线铁律**：全部改动限于 packages/video-clone-engine 与文档，不触碰既有管线。
