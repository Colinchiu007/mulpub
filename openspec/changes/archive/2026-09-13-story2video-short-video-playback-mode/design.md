# Design

## 配置数据流

~~~text
CreateView.s2vConfig.shortVideoHandling
  -> story2videoTextConfig.video.shortVideoHandling
  -> normalizeStory2VideoTextParams().videoConfig
  -> stageOptions.select_video_scenes.video / generate_assets.video / compose.shortVideoHandling
  -> Story2VideoComposeEngine._createVideoSegment()
~~~

配置使用稳定机器值：loop 与 stop-at-end。用户可见文案只存在 zh/en locale；UI 通过 data-testid=s2v-short-video-handling 暴露选择控件。

## 播放完停止合成算法

1. compose() 先探测每个场景旁白的真实时长，按现有 follow-audio 或 min-duration 计算 effectDuration/padTo。
2. _encodeVideoSegmentOnce() 探测 AI 视频真实时长。只有 shortVideoHandling=stop-at-end 且 videoDuration < targetDuration 时进入停止分支；无时长或非法时长时回退循环，避免错误地丢失画面。
3. 停止分支使用一次性 AI 视频输入，不使用 stream_loop。视频滤镜输出不超过源视频末尾；视频结束后通过 tpad=stop_mode=clone:stop_duration=tail 固定最后一帧，再应用 zoom-in 过程。为保证“最后一帧慢慢放大”，尾段使用 buildImageEffectFilter('zoom-in', ...) 同源的 25% 最大放大曲线；前段视频保持原画面，不使用用户选择的全场景图片动效。
4. 旁白音频继续作为唯一音轨并使用现有 -shortest/-t 规则结束；padTo 仍使用 apad 补齐。视频输入自带音频不映射。
5. 当源视频长度足够时不追加尾段，只按既有目标时长裁剪；当源视频时长探测失败时仍走现有循环分支。
6. renderSegment() 传递同一字段，确保结果页单段重试与完整合成一致。

## 数据校验

| 字段 | 合法值 | 默认 | 非法行为 |
|---|---|---|---|
| video.shortVideoHandling | loop / stop-at-end | loop | 抛出 video.shortVideoHandling 配置错误，不启动流水线 |
| video.mode | off / fixed / ai-judged | off | 既有校验不变 |
| 视频真实时长 | 有限数值 >0 | 无 | 探测失败按循环兼容回退 |
| 场景目标时长 | 有限数值 >0 | 既有音频/配置回退 | 走既有默认时长策略 |

未知 video 字段继续丢弃，敏感字段不进入运行配置。shortVideoHandling 只在 fixed/ai-judged 及场景携带 videoPath 时产生效果；其它模式即使通过旧调用方传入 stop-at-end 也必须保持原图片轮播语义。

## UI 交互

- 控件位于【高级】→【分句与时长】区域，标签为“单段视频短于分镜时长的处理”。
- 选项：“循环播放”（默认）与“播放完停止”。
- 提示文字说明：仅对“固定比例（成品前段AI视频）”和“AI智能选择（最精彩场景）”中的 AI 视频场景生效；选择“播放完停止”后，短视频结束时停在最后一帧并慢慢放大。
- 控件始终可见，便于用户预先设置；在 video.mode=off 时保存值但运行时忽略，避免因模式切换丢失用户偏好。
- 上次使用选项恢复时，旧快照缺失字段回退 loop；非法快照值回退默认，并且不出现空白下拉项。

## 测试策略

- normalizer：默认/两种合法值/非法值/旧扁平参数与未知字段。
- CreateView：高级控件、默认值、提交 payload、旧快照恢复和中英文显示。
- compose engine：循环分支仍含 stream_loop -1；停止分支不循环；短视频产生末帧尾段并包含 zoom-in/tpad；足够长/探测失败/纯图片模式回归。
- 真实 FFmpeg 临时 fixture：1 秒 AI 视频 + 4 秒旁白，输出时长约 4 秒且尾部帧变化可检测；测试目录使用 os.tmpdir() 隔离。

