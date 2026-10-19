## ADDED Requirements

### Requirement: 语音模型由程序按运营默许模型解析，不由用户选择

故事讲述流水线「声音选项」区域 MUST NOT 渲染「语音模型」下拉选择器。用户在「语音生成器」中选定的提供方所对应的具体语音模型（Model ID）SHALL 由程序按运营中心配置的默许模型解析得到，并以静默方式写入 `s2vConfig.voiceModel`，仅用于 IPC 下发与运行快照，不作为可见配置项。

#### Scenario: 选中 MiniMax 多模态后不出现「语音模型」下拉

- **GIVEN** 用户在「声音选项」的「语音生成器」中选择 `minimax-multimodal`（多模态，`capability_models.tts = speech-2.8-turbo`）
- **THEN** 界面不渲染 label 为「语音模型」的配置项
- **AND** 「语音 / 音色 ID」下拉正常渲染
- **AND** `s2vConfig.voiceModel` 被程序解析为 `speech-2.8-turbo`

#### Scenario: 选中 MiniMax TTS 单能力后同样不出现「语音模型」下拉

- **GIVEN** 用户在「语音生成器」中选择 `minimax-tts`（单能力，运营默许模型 `speech-2.8-turbo`）
- **THEN** 界面不渲染「语音模型」配置项
- **AND** `s2vConfig.voiceModel` 被解析为该提供方在 tts 能力类别下的默许模型

#### Scenario: MiMo TTS 的双模型区分逻辑保持不变

- **GIVEN** 「语音生成器」为 `mimo-tts`
- **THEN** 「语音模型」下拉不渲染（与全 provider 规则一致）
- **AND** 预置音色目录请求固定使用 `mimo-v2.5-tts`，克隆/能力请求固定使用 `mimo-v2.5-tts-voiceclone`

### Requirement: 能力默认模型的单一真源解析口径

桌面端与主进程 MUST 使用同一套「能力 → 默认模型」解析口径，优先级固定为：

1. 用户默认（`config.user_default_model`，桌面端模型设置中的用户选择，最高优先，且必须 ∈ `models`）；
2. 运营默许模型（`capability_models[type]`，运营中心按能力类别配置）；
3. 运营 provider 级默认（`config.default_model`，兼容存量字段，必须 ∈ `models`）；
4. **fail-closed**：以上均缺失时返回空串，调用方 MUST NOT 以 `models[0]` 兜底猜测（多模态 provider 的 `models[0]` 可能是 image/video/llm 模型）。

#### Scenario: 多模态 provider 未声明 tts 能力默认模型时 fail-closed

- **GIVEN** 存在一个 `category=multimodal` 的提供方，`capabilities` 含 `tts` 但 `capability_models.tts` 缺失或为空
- **WHEN** 解析其 tts 能力默认模型
- **THEN** 返回空串
- **AND** 调用方不得回退到 `models[0]`

#### Scenario: 用户默认优先于运营默许模型

- **GIVEN** 某提供方 `config.user_default_model = 'speech-2.8-hd'`，且 `speech-2.8-hd` ∈ `models`
- **AND** 运营默许模型为 `speech-2.8-turbo`
- **WHEN** 解析默认模型
- **THEN** 返回 `speech-2.8-hd`

#### Scenario: 用户默认失效时回退运营默许模型

- **GIVEN** 某提供方 `config.user_default_model = 'expired-model'`（不在 `models` 中）
- **AND** 运营默许模型为 `speech-2.8-turbo`
- **WHEN** 解析默认模型
- **THEN** 用户默认视为失效，返回 `speech-2.8-turbo`

#### Scenario: 单能力 provider 无任何默许模型配置时 fail-closed

- **GIVEN** 某 `category=tts` 提供方 `models = ['a', 'b']`，`user_default_model`、`capability_models.tts`、`default_model` 均为空
- **WHEN** 解析默认模型
- **THEN** 返回 `a`（`models[0]` 仅在**单能力** provider 上作为最终兜底，此为该口径的既有行为，不视为猜测）

### Requirement: 历史配置与运行快照的兼容归一

历史保存的 `voiceModel` 值若非当前提供方解析出的默许模型，SHALL 在下次装载时归一化为默许模型；不得因此中断装载或弹出错误。

#### Scenario: 恢复历史项目时归一陈旧语音模型

- **GIVEN** 某历史运行快照 `voice.provider = 'minimax-tts'`、`voice.model = 'speech-2.8-hd'`
- **AND** 当前运营默许模型为 `speech-2.8-turbo`
- **WHEN** 该项目的语音上下文被解析
- **THEN** 使用 `speech-2.8-turbo`
- **AND** 不产生用户可见错误

## MODIFIED Requirements

### Requirement: 故事讲述「声音选项」区域的配置项集合

「声音选项」区域的用户可配置项为：语音生成器、语音 / 音色 ID、背景音乐、背景音乐音量、旁白语速、旁白音量。「语音模型」不再作为用户可配置项存在。

#### Scenario: 声音选项区域的配置项集合

- **GIVEN** 用户进入故事讲述流水线配置面板并展开「声音」分组
- **THEN** 可见配置项包含「语音生成器」「语音 / 音色 ID」「背景音乐」「背景音乐音量」
- **AND** 不包含「语音模型」
#### Scenario: 折叠区摘要保留模型 ID 作为只读回显

- **GIVEN** 用户已选择「语音生成器」为 `minimax-multimodal`，程序解析出的模型为 `speech-2.8-turbo`
- **THEN** 「声音」分组摘要展示提供方名称 + 当前生效的模型 ID + 音色选择状态
- **AND** 该模型 ID 仅为**只读回显**（不存在任何可改变它的界面控件），且不参与「该分组是否仍为默认值」的判定
