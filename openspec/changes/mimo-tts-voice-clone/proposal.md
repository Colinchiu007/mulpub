## Why

视频创作-故事讲述流水线「声音选项」区域，当「语音生成器」选择「Mimo TTS」、「语音模型」选择「mimo-v2.5-tts-voiceclone」时提示「当前语音模型暂不支持音色列表与克隆功能，已使用默认音色。当前模型没有可用音色。」但 MiMo 官方文档（speech-synthesis-v2.5）明确支持预置音色列表与基于音频样本的音色复刻。根因：能力表（tts-voice-catalog.js）把 mimo 三个模型全部声明为 UNSUPPORTED，adapter 未实现 listVoices/cloneVoice。

## What Changes

- **MiMo 预置音色列表**：mimo-v2.5-tts 能力改为 BUILTIN，adapter 新增 listVoices() 返回 9 个官方预置音色，音色 ID 下拉可选择。
- **MiMo 音色复刻（克隆）**：mimo-v2.5-tts-voiceclone 能力改为 USER_CLONE（desktop_upload）。MiMo 无远端 voice_id——每次合成时把音频样本 Base64 直接放 audio.voice 字段（data:{mime};base64,...，≤10MB，仅 mp3/wav）。克隆音色 voice_id 为本地 ID（mimo-clone-<uuid>），样本由 tts-voice-clone-service 持久化，合成时 asset-generator 读取样本注入 cloneSampleData，adapter 自动切 voiceclone 模型。
- **语音模型下拉隐藏**：语音生成器为 MiMo TTS 时隐藏「语音模型」下拉（模型由「语音/音色 ID」区分：预置→tts，克隆→voiceclone）；其他 provider 保留。
- **移除 voicedesign**：mimo-v2.5-tts-voicedesign（项目用不到）从模型种子、adapter、能力表、运营中心预设移除。
- **克隆恢复模型兜底按 provider 区分**：MiMo→voiceclone，MiniMax→speech-02-hd；findCloneSamples 回退链扩展。
- **纯本地克隆 provider 补偿**：MiMo 无远端 deleteVoice，克隆失败补偿跳过远端删除，只做本地样本清理。

## Capabilities

### New Capabilities

- `mimo-tts-voice-clone`: MiMo TTS 预置音色列表与本地样本注入式音色复刻。

### Modified Capabilities

- `mimo-tts-provider-contract`: 扩展预置音色列表、音色复刻、语音模型下拉隐藏、registry 绑定、voicedesign 移除。

## Impact

- 代码：apps/desktop/electron/services/adapters/mimo-tts.js、tts-voice-catalog.js、tts-voice-service.js、tts-voice-clone-service.js、asset-generator.js、story2video-stages.js、story2video-project-service.js、model-provider-seeds.js、core/container.setup.js、apps/desktop/src/views/CreateView.vue、ops-center/backend/services/model_preset_service.py。
- 兼容性：MiniMax 等其它 provider 行为不变；voicedesign 移除为破坏性（项目内无引用）。
- 测试：mimo-tts adapter 36 例、tts-voice 相关 139 例、story2video 268 例、CreateView 284 例全绿。
