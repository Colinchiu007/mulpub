# mimo-tts-voice-clone Specification

## Purpose

MiMo TTS 预置音色列表与本地样本注入式音色复刻，语音模型下拉隐藏，voicedesign 移除。

## Requirements

### Requirement: MiMo 预置音色列表

mimo-v2.5-tts MUST 支持列出 9 个官方预置音色（mimo_default/冰糖/茉莉/苏打/白桦/Mia/Chloe/Milo/Dean），音色 ID 下拉可选择，默认 mimo_default。

#### Scenario: 列出预置音色
- **WHEN** 调用方请求 mimo-v2.5-tts 音色目录
- **THEN** 返回 9 个官方预置音色，默认选中 mimo_default

#### Scenario: 预置音色合成
- **WHEN** 用户选择预置音色（如 冰糖）合成文本
- **THEN** 请求体 audio.voice 为 冰糖，模型为 mimo-v2.5-tts

### Requirement: MiMo 音色复刻（克隆）

mimo-v2.5-tts-voiceclone MUST 支持语音样本上传与管理（USER_CLONE + desktop_upload）。MiMo 无远端 voice_id——每次合成时把样本 Base64 直接放 audio.voice 字段（data:{mime};base64,...，≤10MB，仅 mp3/wav）。样本由 tts-voice-clone-service 持久化，合成时 asset-generator 读取样本注入 cloneSampleData。

#### Scenario: 克隆音色创建
- **WHEN** 用户上传 mp3/wav 样本创建克隆音色
- **THEN** 返回本地 voice_id（mimo-clone-<uuid>），样本持久化，不调用远端 API

#### Scenario: 克隆音色合成
- **WHEN** 用户选择克隆音色合成文本
- **THEN** 请求体模型为 mimo-v2.5-tts-voiceclone，audio.voice 为样本 data URI

#### Scenario: 克隆音色缺样本
- **WHEN** 克隆音色合成但本地样本缺失
- **THEN** 抛 INVALID_CONFIG（fail closed），不静默回退默认音色

### Requirement: MiMo 语音模型下拉隐藏

语音生成器为 MiMo TTS 时，「语音模型」下拉 MUST NOT 显示。mimo-v2.5-tts 与 mimo-v2.5-tts-voiceclone 由「语音 / 音色 ID」下拉区分。

#### Scenario: MiMo 下语音模型下拉隐藏
- **WHEN** 语音生成器为 mimo-tts
- **THEN** 语音模型下拉不渲染，音色 ID 下拉显示预置 + 克隆音色

#### Scenario: 其他 provider 语音模型下拉保留
- **WHEN** 语音生成器为 minimax-tts 等
- **THEN** 语音模型下拉正常显示

### Requirement: 移除 mimo-v2.5-tts-voicedesign

mimo-v2.5-tts-voicedesign（文本设计音色）项目用不到，MUST 从模型种子、adapter 静态列表、能力表与运营中心预设移除。

#### Scenario: voicedesign 不在模型列表
- **WHEN** 调用 listModels 或查询能力
- **THEN** mimo-v2.5-tts-voicedesign 不在列表中，能力查询返回 model_not_whitelisted
