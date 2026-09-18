# mimo-tts-provider-contract Specification

## Purpose
确保 MiMo TTS 的音色列表、音色复刻（克隆）与模型选择行为符合官方 API 合同，并在桌面端提供与 MiniMax 一致的音色管理体验。

## Requirements

### Requirement: MiMo 预置音色列表

MiMo 普通 TTS 模型（mimo-v2.5-tts）MUST 支持列出 9 个官方预置音色（mimo_default/冰糖/茉莉/苏打/白桦/Mia/Chloe/Milo/Dean），音色 ID 下拉可选择。

#### Scenario: 列出预置音色
- **WHEN** 调用方请求 mimo-v2.5-tts 的音色目录
- **THEN** 返回 9 个官方预置音色，默认选中 mimo_default

#### Scenario: 预置音色合成
- **WHEN** 用户选择预置音色（如 冰糖）合成文本
- **THEN** 请求体的 audio.voice 为 冰糖，模型为 mimo-v2.5-tts

### Requirement: MiMo 音色复刻（克隆）

MiMo 音色复刻模型（mimo-v2.5-tts-voiceclone）MUST 支持语音样本上传与管理，能力表声明为 USER_CLONE + desktop_upload。

- MiMo 无远端 voice_id：每次合成时把音频样本 Base64 直接放在 audio.voice 字段（data:{mime};base64,...）
- 样本要求：mp3/wav、Base64 后 ≤10MB（本地校验按原始字节 ≤10MB 保守执行）
- 克隆音色 voice_id 为本地 ID（mimo-clone-<uuid>），样本由 tts-voice-clone-service 持久化
- 合成时由 asset-generator 读取本地样本注入 cloneSampleData 参数，adapter 自动切 voiceclone 模型

#### Scenario: 克隆音色创建
- **WHEN** 用户上传 mp3/wav 样本创建克隆音色
- **THEN** 返回本地 voice_id（mimo-clone-<uuid>），样本持久化到本地，不调用远端 API

#### Scenario: 克隆音色合成
- **WHEN** 用户选择克隆音色合成文本
- **THEN** 请求体模型为 mimo-v2.5-tts-voiceclone，audio.voice 为样本 data URI

#### Scenario: 克隆音色缺样本
- **WHEN** 克隆音色合成但本地样本缺失
- **THEN** 抛 INVALID_CONFIG（fail closed），不静默回退默认音色

### Requirement: MiMo 语音模型下拉隐藏

当「语音生成器」为 MiMo TTS 时，「语音模型」下拉选择栏 MUST NOT 显示。mimo-v2.5-tts 与 mimo-v2.5-tts-voiceclone 由「语音 / 音色 ID」下拉区分：选择预置音色走 tts 模型，选择克隆音色走 voiceclone 模型。

#### Scenario: MiMo 下语音模型下拉隐藏
- **WHEN** 语音生成器为 mimo-tts
- **THEN** 语音模型下拉不渲染，音色 ID 下拉显示预置 + 克隆音色

#### Scenario: 其他 provider 语音模型下拉保留
- **WHEN** 语音生成器为 minimax-tts 等
- **THEN** 语音模型下拉正常显示（MiniMax 克隆音色自动切换 speech-02-hd 模型）

### Requirement: MiMo 克隆音色 registry 绑定

MiMo 克隆音色的样本文件与相关信息（名称、ID 等）MUST 与 provider/model 绑定（tts-voice-clones:v2:mimo-tts:mimo-v2.5-tts-voiceclone），与 MiniMax 一致。

#### Scenario: 克隆音色偏好
- **WHEN** 用户选择 MiMo 克隆音色
- **THEN** 偏好保存到 voiceclone 模型键，catalog 回填时同时读取 tts 与 voiceclone 键

### Requirement: 移除 mimo-v2.5-tts-voicedesign

mimo-v2.5-tts-voicedesign（文本设计音色）项目用不到，MUST 从模型种子、adapter 静态列表、能力表与运营中心预设中移除。

#### Scenario: voicedesign 不在模型列表
- **WHEN** 调用 listModels 或查询能力
- **THEN** mimo-v2.5-tts-voicedesign 不在列表中，能力查询返回 model_not_whitelisted

### Requirement: MiMo 普通 TTS 使用官方默认音色

MiMo 普通 TTS 模型在音色参数未提供或为空字符串时 MUST 在发送给服务商的请求中使用官方内置音色 `mimo_default`。显式提供的非空音色 MUST 原样保留。

#### Scenario: 未选择音色
- **WHEN** 使用 `mimo-v2.5-tts` 合成文本且调用方未提供音色
- **THEN** 请求体的 `audio.voice` 为 `mimo_default`

#### Scenario: 音色为空字符串
- **WHEN** 使用 `mimo-v2.5-tts` 合成文本且调用方提供 `voice=''`
- **THEN** 请求体的 `audio.voice` 为 `mimo_default`，而不是 `default` 或空值

#### Scenario: 显式音色保持不变
- **WHEN** 调用方提供非空音色 ID
- **THEN** 请求体的 `audio.voice` 与调用方提供的音色 ID 完全一致

#### Scenario: 请求继续符合 MiMo Chat 兼容结构
- **WHEN** 适配器使用默认音色发起合成
- **THEN** 请求仍包含普通 TTS 模型 ID、assistant 消息、音频格式和 `stream=false`，且响应音频数据按既有路径解析
