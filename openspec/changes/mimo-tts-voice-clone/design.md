## 技术方案

### MiMo 克隆机制（与 MiniMax 不同）

- **MiniMax**：上传样本 → 平台生成 voice_id → 后续用 voice_id 合成。
- **MiMo**：每次合成时把音频样本 Base64 直接放 audio.voice 字段（data:{mime};base64,...，≤10MB，仅 mp3/wav）。无远端 voice_id。

因此 MiMo 克隆音色的 voice_id 为本地 ID（mimo-clone-<uuid>），样本由 tts-voice-clone-service 持久化到 {userData}/voice-clone-samples/<owner>/<storageId>/。

### 数据流

1. **克隆创建**：前端选本地 mp3/wav → tts-voice-clone-service.createSampleSelection → addCloneFromSelection → adapter.cloneVoice()（本地生成 mimo-clone-<uuid>，不调用远端）→ 样本持久化 + registry 写入（tts-voice-clones:v2:mimo-tts:mimo-v2.5-tts-voiceclone）。
2. **合成**：story2video-stages → asset-generator.generateTTS → _tryProviderTTS 检测 mimo-clone- 音色 → _resolveMimoCloneSample 读取本地样本转 data URI → ttsParams.cloneSampleData → adapter.synthesize 检测克隆音色自动切 voiceclone 模型 + 注入样本。

### 关键设计决策

- **能力表单一来源**：tts-voice-catalog.js 是 provider/model 能力唯一来源。mimo-v2.5-tts → BUILTIN（canListVoices），mimo-v2.5-tts-voiceclone → USER_CLONE（desktop_upload）。
- **语音模型下拉隐藏**：前端 s2vVoiceModelHidden computed 判断 provider 为 mimo-tts。catalog 请求固定用 mimo-v2.5-tts（预置音色），capability/克隆请求用 mimo-v2.5-tts-voiceclone。
- **偏好双键读取**：tts-voice-service._buildCatalogResponse 同时读 tts 与 voiceclone 偏好键，兼容预置与克隆音色选择。
- **克隆恢复模型兜底按 provider 区分**：story2video-stages/project-service 的 _voiceModel 兜底 MiMo→voiceclone，MiniMax→speech-02-hd。
- **纯本地克隆 provider 补偿**：_withRemoteCloneCompensation 对 mimo-tts 跳过远端删除，只做本地样本清理。

### 样本限制

MiMo 官方：单文件、mp3/wav、Base64 后 ≤10MB。本地校验按原始字节 ≤10MB 保守执行（LOCAL_CLONE_SAMPLE_LIMITS.mimo-tts）。
