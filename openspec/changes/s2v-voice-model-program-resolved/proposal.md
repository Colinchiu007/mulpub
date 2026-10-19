## Why

视频创作-故事讲述流水线页「声音选项」区域，当「语音生成器」选择了「MiniMax（多模态）」时，界面会额外渲染「语音模型」下拉，而该下拉在 MiniMax 多模态下**只有唯一候选** `speech-2.8-turbo`（`capability_models.tts`），在 MiniMax TTS 单能力下也只有唯一候选 `speech-2.8-turbo`。也就是说，用户面对一个"只能选一个值"的下拉，既没有任何信息增益，也构成了对「具体模型该由程序/运营决定」这一产品原则的违背。

更深一层的问题：**桌面端缺少一个统一的「能力 → 默认模型」解析入口**。目前散落三套逻辑：

1. `tts-voices-state.js` 的 `getS2VDefaultVoiceModel`（前端 TTS 域，自己读 `capability_models.tts` / `defaultModel`）；
2. `CreateView.vue` 的 `getS2VDefaultVideoModel`（前端视频域，复制了同一套逻辑）；
3. `model-provider-manager.js` 的 `resolveProviderDefaultModel`（主进程，双默认语义：用户默认 > 运营默认 > 能力默认 > `models[0]`）。

三者口径不一致：主进程的多模态 provider 在无 `capability_models[type]` 声明时 **fail-closed 返回 ''**，而前端两处会 fallback 到 `models[0]`（可能是 image/llm 模型）。这就是「多模态下语音模型下拉偶尔出现非 TTS 模型」这一同族 Bug 反复出现的结构性原因。

运营中心侧：`ModelPreset.capability_models` 已能表达「某能力用哪个模型」，但它只在 `is_multimodal=1` 时有输入框，且**仅覆盖多模态**——单能力 provider（category=tts/image/video）的「默认模型」只有一个 `default_model` 字段，语义是"provider 级默认"，没有与"能力类别"建立显式映射；同时缺少一个总览视角让运营一眼看出"每个能力类别下各提供方的默许模型"。

## What Changes

- **桌面端移除「语音模型」下拉**：故事讲述流水线「声音选项」区域不再渲染「语音模型」选择器（与 2026-09-18 MiMo TTS 已确立的 `s2vVoiceModelHidden` 同构，但升级为**全 provider 生效**）。`voiceModel` 不再由用户选择，改由程序按运营配置解析后静默写入 `s2vConfig.voiceModel`，仅用于 IPC 下发与运行快照。
- **新增单一真源解析函数** `resolveVoiceModelForProvider(provider)`：收敛"用户默认 > 运营默认 > 能力默认（`capability_models.tts`）> fail-closed"四级优先级，桌面端 TTS 域与主进程共用同一口径；多模态 provider 无 tts 声明时**不再猜 `models[0]`**。
- **运营中心：能力默认模型覆盖全类别**：`ModelPreset.capability_models` 从"仅多模态"扩展为**所有 provider 均可填写**，按该 provider 所属能力类别（category，多模态则按 capabilities 逐项）给出默认模型 ID；`upsert_model_preset` 增加"能力默认模型必须 ∈ models"的自洽校验；`default_model` 语义收窄为"展示用兼容字段"，解析时以 `capability_models[type]` 优先。
- **运营中心：新增「能力默认模型总览」视图**：在预设模型页面顶部提供一张矩阵表，按能力类别（llm/tts/image/video/speech_recognition）列出每个提供方的默许模型，缺省项高亮并可一键跳转到对应行编辑，让运营"一眼看出缺口"。
- **数据兼容**：存量 `default_model` 自动回填为对应类别的 `capability_models` 值（迁移幂等，不覆盖人工修改）。

## Capabilities

### New Capabilities

- `capability-default-model-registry`: 能力类别 → 提供方 → 默认模型 ID 的单一真源契约，覆盖运营中心（存储 + 校验 + 总览）与桌面端（解析 + 静默下发）。

### Modified Capabilities

- `s2v-pipeline-page-ux`: 「声音选项」区域移除「语音模型」下拉；摘要与配置档案不再展示用户可选模型。
- `mimo-tts-provider-contract`: 「语音模型下拉隐藏」从 `mimo-tts` 专属规则升级为全 provider 规则（MiMo 的 tts/voiceclone 双模型区分逻辑不变）。
- `model-preset-catalog`: `capability_models` 扩展至全类别 provider + 自洽校验 + 迁移回填。

## Impact

- **代码**：
  - 桌面端渲染层：`apps/desktop/src/views/video-creation/S2vConfigPanels.vue`（删除语音模型 UiField）、`s2v-panel-contract.js`（白名单）、`CreateView.vue`（摘要/默认装载/映射）、`composables/tts-voices-state.js`、`composables/tts-voices-shared.js`、`composables/useTtsVoices.js`。
  - 运营中心：`ops-center/backend/models.py`（docstring）、`services/model_preset_service.py`（校验 + 迁移 + 总览查询）、`routers/model_presets.py`（总览端点）、`frontend/src/views/ModelPresets.vue`（全类别能力默认模型输入 + 总览表）。
- **兼容性**：`s2vConfig.voiceModel` 字段保留（运行快照 / IPC 合同 / 历史项目恢复均依赖它），只是不再由用户编辑；历史快照里用户选过的语音模型值仍可解析，若已不在运营默许集合内则归一化为默许模型（fail-closed，不报错）。
- **测试**：`useTtsVoices.test.js`、`S2vConfigPanels.test.js`、`CreateView.test.js`（MiMo/MiniMax 两组既有用例需改为"下拉不存在"）、`tts-voice-catalog.test.js`、ops-center `test_model_presets_api.py`、`test_model_catalog_api.py`。
- **视觉回归**：`create-story2video-detail` 像素基线需按 QM-4 流程重取证（从 CI 渲染产物取，禁止本机截图当基线）。
