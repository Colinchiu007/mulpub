## Context

本变更横跨三处代码域，但都围绕同一件事：**把"具体用哪个模型"从用户决策变成程序/运营决策**。

- 桌面端渲染层（`apps/desktop/src/views/video-creation/`）：删除下拉 + 摘要适配 + 默认装载口径统一。
- 桌面端主进程（`apps/desktop/electron/services/`）：`resolveProviderDefaultModel` 已是既有四级口径，本变更把它确立为**唯一真源**，前端 TTS 域不再各自实现。
- 运营中心（`ops-center/`）：`capability_models` 扩到全类别 + 总览视图 + 自洽校验。

关键约束：

1. `s2vConfig.voiceModel` 字段**必须保留**——IPC `voice.model`、`s2v-config-snapshot.js` 运行快照、`ResultView.vue` 项目选项展示、`story2video-stages.js` 的 `voiceModel` 下发全都依赖它。
2. MiMo 的 tts / voiceclone 双模型区分（预置音色 → `mimo-v2.5-tts`，克隆音色 → `mimo-v2.5-tts-voiceclone`）是**能力 driven 的特殊分支**，与"用户不该选模型"正交，必须原样保留。
3. `s2v-panel-contract.js` 是父子白名单，删除模板字段时必须同步清理白名单，否则 `S2vConfigPanels.test.js` 的 `ARRAY_LIKE` 桩会因缺键渲染失败。

## Goals / Non-Goals

**Goals:**

- 移除「语音模型」下拉，全 provider 生效。
- 桌面端 TTS 域与主进程共用同一解析口径（消除三套并行实现）。
- 运营中心支持为**任意类别** provider 配置"每个能力的默许模型"，并提供总览。
- `capability_models` 值必须 ∈ `models`（自洽校验），防止运营填错导致运行期 fail-closed 却不知为何。

**Non-Goals:**

- 不改主进程 `resolveProviderDefaultModel` 的优先级语义（已正确，本变更只做"前端不再另写一套"）。
- 不动图片/视频生成器的模型下拉（用户仍可选择图片/视频模型；本变更只针对语音域）。
- 不做"音色目录也用默许模型"的额外抽象（`tts-voice-service` 已按传入 model 工作）。

## Decisions

### D1：删除下拉而非"隐藏下拉但保留一个选项"

**选择**：彻底删除 `UiField label="语音模型"` 节点，与 MiMo 的 `s2vVoiceModelHidden` 路径合并为一条永久为真的判定。

**理由**：保留一个只有单项的下拉在视觉上仍是"让用户选"，与产品原则相悖；且单项下拉在 a11y 上给出错误的"可交互"信号。

**代价**：`s2vVoiceModelOptions` / `s2vVoiceModelHidden` 两个 computed 失去模板消费者。**保留**它们（作为纯函数契约由 `useTtsVoices.test.js` 锁），因为 `tts-voices-shared.js` 的 `getS2VVoiceContext` 仍依赖 `s2vVoiceModelHidden` 区分 MiMo；同时 `CreateView.vue` 的 `loadS2VProviders` 也用 `s2vVoiceModelOptions.includes(...)` 做归一。彻底删除会牵连主进程能力表，超出本变更范围。

### D2：解析口径以前端 composable 为唯一入口，主进程逻辑不变

**选择**：在 `tts-voices-state.js` 新增 `resolveVoiceModelForProvider(provider)`，实现与主进程 `resolveProviderDefaultModel(provider, 'tts')` 等价的四级口径（用户默认 → 运营默许 `capability_models.tts` → `default_model` → 单能力 `models[0]` / 多模态 fail-closed）。`getS2VDefaultVoiceModel` 改为它的薄封装。

**理由**：前端不能 require 主进程模块（渲染层沙箱），且主进程该函数已被 9 处调用、测试齐全，复制等价逻辑到前端 composable 比"改造 IPC 让渲染层拿解析结果"小得多。

**防漂移**：新增一条**跨层一致性测试**（`voice-model-resolution-parity.test.js`），用同一组 provider 夹具分别喂给前端 composable 与主进程 `resolveProviderDefaultModel`，断言两者返回值逐一相等。这是本变更最重要的回归锁——它的逃逸分析见下。

### D3：运营中心 `capability_models` 扩到全类别，但输入框按类别动态生成

**选择**：`ModelPresets.vue` 的能力默认模型输入区从 `v-if="form.is_multimodal"` 改为按 `form.category` 计算能力键集合：

- `multimodal` → `form.capabilities`（逐项）
- 其它类别 → `[form.category]`（单项，即该 provider 自身类别）
- `category` 切换时清空不再适用的键（fail-closed，不留下脏键）

**理由**：单能力 provider 的"默许模型"本质上就是"该类别下的默认模型"，复用同一 JSON 字段比新增 `tts_default_model` 等 N 个字段更简洁，也让目录同步（`_to_catalog_item`）天然覆盖。

**代价**：`default_model` 与新字段语义重叠。处置：`default_model` 保留为**展示兼容字段**（运营中心与旧桌面端仍在读），保存时若 `capability_models[类别]` 有值则同步写入 `default_model`，保证旧版桌面端行为不回退。

### D4：总览视图做成独立端点而非前端聚合

**选择**：新增 `GET /api/v1/model-presets/capability-overview`（admin），返回按能力类别分组的 `{ capability: { provider_id, provider_name, model, is_configured }[] }`。

**理由**：运营中心的鉴权、隐藏项过滤、`include_hidden` 语义都在后端；前端聚合会把 `is_visible=0` 的缺口误报为"已配置"。同时该端点天然可被未来的"缺口巡检"复用。

## Risks / Trade-offs

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 删除下拉改变视觉布局 | `create-story2video-detail` 像素基线失配 | 按 QM-4 流程从 CI 渲染产物重取证基线；本机截图只作诊断 |
| 运营填了不在 `models` 里的模型 | 运行期 fail-closed 但用户不知道为什么 | 后端保存时校验 `capability_models[k] ∈ models`，前端输入框改为 `el-select` 限定 + allow-create 兜底 |
| 存量 `capability_models` 缺失单能力条目 | 单能力 provider 解析回退到 `default_model` | 迁移时按 `default_model` 回填 `capability_models[category]`，幂等且不覆盖已存在键 |
| 三套解析逻辑仍有第四处漏改 | 口径漂移复发 | D2 的跨层一致性测试 + 全仓 grep 锁（`scripts/` 无新解析实现的机械核查由代码 review 承担） |

## Migration Plan

1. 后端先上线 `capability_models` 全类别支持与校验（**向下兼容**：旧字段照常读）。
2. 后端迁移：为每个 `is_visible` provider 按 `category` 回填缺失的 `capability_models[category] = default_model`（仅当该 provider 非多模态且该键不存在时）。
3. 桌面端下线「语音模型」下拉；同版本内解析口径与主进程对齐。
4. 回滚：撤桌面端 PR 即恢复下拉；后端字段为纯新增语义，无需回滚。

## Open Questions

- 总览表是否需要"缺失项"红色角标之外的批量修复动作？本期只做定位与跳转，批量修复留给后续（避免一次改太多运营交互）。
