# mimo-tts-voice-clone 变更任务

## 1. Adapter 层（apps/desktop/electron/services/adapters/mimo-tts.js）

- [x] 1.1 listVoices() 返回 9 个官方预置音色（MIMO_PRESET_VOICES）
- [x] 1.2 cloneVoice() 本地生成 mimo-clone-<uuid>，校验 mp3/wav + ≤10MB
- [x] 1.3 synthesize() 检测克隆音色自动切 voiceclone 模型 + 注入 cloneSampleData
- [x] 1.4 移除 voicedesign 模型
- [x] 1.5 测试：listVoices/cloneVoice/克隆合成/能力协商

## 2. 能力表（tts-voice-catalog.js）

- [x] 2.1 mimo-v2.5-tts → BUILTIN（canListVoices: true, defaultVoiceId: mimo_default）
- [x] 2.2 mimo-v2.5-tts-voiceclone → USER_CLONE（desktop_upload）
- [x] 2.3 移除 voicedesign

## 3. 服务层

- [x] 3.1 tts-voice-service：mimo 下 catalog 合并 voiceclone 克隆、偏好双键读取、clear 双键
- [x] 3.2 tts-voice-clone-service：MiMo 样本限制（mp3/wav、≤10MB）、findCloneSamples 回退链扩展、纯本地补偿
- [x] 3.3 asset-generator：_resolveMimoCloneSample 读取本地样本注入 cloneSampleData
- [x] 3.4 story2video-stages/project-service：克隆恢复模型兜底按 provider 区分
- [x] 3.5 model-provider-seeds：移除 voicedesign
- [x] 3.6 container.setup：注入 ttsVoiceCloneService 到 assetGenerator

## 4. 前端（CreateView.vue）

- [x] 4.1 s2vVoiceModelHidden computed（mimo-tts 下隐藏语音模型下拉）
- [x] 4.2 s2vVoiceContextModel / getS2VVoiceContext 用 mimo-v2.5-tts
- [x] 4.3 getS2VVoiceCloneContext 用 voiceclone 模型
- [x] 4.4 守卫方法兼容 mimo 模型差异
- [x] 4.5 测试：语音模型隐藏 + MiniMax 保留

## 5. 运营中心（ops-center/backend/services/model_preset_service.py）

- [x] 5.1 移除 voicedesign 模型

## 6. 文档

- [x] 6.1 PRD 7.1.16.3 章节
- [x] 6.2 OpenSpec mimo-tts-provider-contract 更新
- [x] 6.3 CHANGELOG 条目
- [x] 6.4 learnings.md 经验沉淀
