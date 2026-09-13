# story2video-short-video-playback-mode Specification

## Purpose
TBD - created by archiving change story2video-short-video-playback-mode. Update Purpose after archive.
## Requirements
### Requirement: 短视频处理配置契约
Story2Video SHALL accept story2videoTextConfig.video.shortVideoHandling with enum loop or stop-at-end, default loop. Missing/empty values SHALL normalize to loop; unknown explicit values SHALL fail closed with a field-specific error. The normalized value SHALL be passed to select_video_scenes, generate_assets, and compose without allowing arbitrary fields or secrets.

#### Scenario: legacy configuration remains looping
- WHEN a project has no video.shortVideoHandling field
- THEN normalization returns shortVideoHandling=loop and the compose path retains looping behavior

#### Scenario: invalid value is rejected
- WHEN a caller supplies video.shortVideoHandling=freeze
- THEN normalization fails with an error identifying video.shortVideoHandling and no pipeline stage starts

### Requirement: mode gating
The short-video setting SHALL affect only AI video scenes selected by video.mode=fixed or video.mode=ai-judged. video.mode=off, manual all-images, image-only scenes, and non-Story2Video pipelines SHALL retain their existing behavior regardless of the stored setting.

#### Scenario: off mode ignores stop-at-end
- WHEN video.mode=off and shortVideoHandling=stop-at-end
- THEN select_video_scenes returns no video scenes and compose uses the existing image carousel path

### Requirement: loop behavior
When the effective mode is loop, an AI video shorter than the scene target duration SHALL loop until the existing scene audio/target duration ends, preserving current output duration and TTS mapping.

#### Scenario: short AI video loops
- WHEN a 1-second AI video is used for a 4-second scene with shortVideoHandling=loop
- THEN the encoded scene is approximately 4 seconds and the video input uses a bounded-to-scene loop, with TTS as the only output audio

### Requirement: stop-at-end behavior
When the effective mode is stop-at-end and an AI video is shorter than the target scene duration, the scene SHALL play the AI video once, hold its final decoded frame for the remaining duration, and apply the existing zoom-in/“慢慢放大” motion to that held frame. It SHALL not repeat the AI video. When the source video is at least as long as the target, the scene SHALL be clipped to the target without adding a tail. If source duration probing fails, the implementation SHALL fall back to the legacy loop path.

#### Scenario: short AI video stops and zooms final frame
- WHEN a 1-second AI video is used for a 4-second scene with shortVideoHandling=stop-at-end
- THEN the output is approximately 4 seconds, contains one video playback followed by a cloned final-frame tail, and the tail uses the same zoom-in progression as image motion

#### Scenario: long AI video is clipped without tail
- WHEN the AI video duration is greater than or equal to the scene target duration
- THEN the output is clipped to the target and no final-frame tail is appended

#### Scenario: probe failure preserves availability
- WHEN the AI video duration cannot be probed
- THEN the composer uses the legacy looping path and does not fail the scene solely because the new option is selected

### Requirement: user-facing labels and localization
The video enhancement off option SHALL display “纯图片轮播” in Chinese and the locale-equivalent “Image carousel only” in English. The advanced short-video control, both choices, and hint SHALL have paired zh/en locale entries and remain absent from renderer hard-coded Chinese strings.

#### Scenario: localized advanced control
- WHEN the Story2Video advanced section is rendered in either supported locale
- THEN the label, options, hint, and off-mode label are translated from the matching locale file

