# 基线差异审计

审计基线：origin/main / 731f37d2（2026-08-17）。

## 已交付能力

- story2videoTextConfig.video 已支持 off、fixed、ai-judged、provider/model、比例和场景数约束。
- select_video_scenes 已选择 AI 视频场景；generate_assets 已生成 videoPath，并在失败时回退图片。
- story2video-compose-engine.js 已支持 videoPath + imagePath 混合场景、TTS 显式映射、字幕/水印、转场和 BGM。
- 当前 AI 视频短于旁白时通过 _encodeVideoSegmentOnce() 的 -stream_loop -1 循环播放。
- 图片 zoom-in 动效已由 buildImageEffectFilter() 统一生成，且已有 d=总帧数回归测试。
- CreateView 已有高级区、图片动效配置、视频增强区和 videoMode 上次选项恢复框架。
- zh/en locale 已有视频增强和图片动效文案，但 off 选项仍在模板中直接写为“关闭（纯图片轮播）”。

## 本次待交付

- 新增 video.shortVideoHandling 的归一化/透传/恢复合同，默认 loop，非法值 fail closed。
- 高级区新增“单段视频短于分镜时长的处理”双语控件和提示；只在 AI 视频增强配置语义下有效。
- 将 AI 视频合成从无条件循环扩展为 loop 与 stop-at-end 两条分支；stop-at-end 对短视频播放一次、克隆末帧并用 zoom-in 填充尾段。
- 让完整 compose 与结果页 renderSegment 使用同一字段；补充短视频真实临时 FFmpeg 回归。
- 更新 PRD、视频生成分析/架构相关文档、CHANGELOG、learnings、OpenSpec 与 CCG 归档记录。

## 待确认/实现约束

- 视频真实时长探测失败时必须保留旧循环能力，避免新选项把可用成片变成失败。
- off、manual + all-images、图片场景和非 Story2Video 流水线不能被 stop-at-end 污染。
- 停止模式尾帧不能依赖用户为图片场景选择的全场景 imageEffect；必须固定使用既有 zoom-in 逻辑。

