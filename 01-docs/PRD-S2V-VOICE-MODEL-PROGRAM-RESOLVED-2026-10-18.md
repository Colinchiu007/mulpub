# PRD：语音模型由程序与运营决定（故事讲述流水线「声音选项」去模型化）

| 项 | 内容 |
| --- | --- |
| 文档 ID | PRD-S2V-VOICE-MODEL-PROGRAM-RESOLVED-2026-10-18 |
| 版本 | v1.0 |
| 日期 | 2026-10-18 |
| 关联 change | `openspec/changes/s2v-voice-model-program-resolved` |
| 影响面 | 桌面端渲染层（故事讲述流水线配置面板）+ 运营中心（预设模型目录）+ 桌面端主进程（解析口径对齐） |
| 用户可见变更 | 「语音模型」下拉从「声音选项」区域移除；模型由程序按运营配置自动确定 |

---

## 1. 背景与问题

### 1.1 用户报告的界面问题

在「视频创作 → 故事讲述流水线」页的「声音选项」区域，当「语音生成器」选择「MiniMax（多模态）」时，会额外出现「语音模型」下拉（见用户截图）。该下拉在 MiniMax 多模态下**只有唯一候选** `speech-2.8-turbo`：

```
apps/desktop/src/views/video-creation/composables/tts-voices-state.js:109-112
if (provider.category === 'multimodal' && provider.capability_models && typeof provider.capability_models.tts === 'string') {
  const ttsModel = provider.capability_models.tts
  return strings.includes(ttsModel) ? [ttsModel] : [ttsModel, ...strings]
}
```

MiniMax TTS 单能力提供方同样只有唯一候选（`model-provider-seeds.js:159` 已把 `minimax-tts` 的 models 收敛为 `['speech-2.8-turbo']`）。

**结论：这个下拉没有任何信息增益，却把"用哪个具体模型"这个本该由程序/运营决定的决策推给了用户。**

### 1.2 产品原则

> 用户只选择**能力提供方**（"用谁家的语音能力"）；具体用哪个模型（Model ID）由程序按运营中心配置的默许模型确定。运营通过运营中心维护"每个能力类别下，每个模型厂商默认用哪个具体模型"。

该原则已在 2026-09-18 对 MiMo TTS 落地过一次（`s2vVoiceModelHidden`，PRD-S2V-PIPELINE-PAGE-UX §4.3.1），但当时是 **provider 特判**（`provider.id === 'mimo-tts'`），未推广到全 provider。

### 1.3 结构性根因：三套并行解析逻辑

桌面端目前有三处各自实现"默认模型解析"：

| # | 位置 | 能力域 | 多模态无能力声明时的兜底 |
| --- | --- | --- | --- |
| 1 | `apps/desktop/src/views/video-creation/composables/tts-voices-state.js:63-79` `getS2VDefaultVoiceModel` | 前端 TTS | `models[0]`（**可能取到 image/llm 模型**） |
| 2 | `apps/desktop/src/views/CreateView.vue:3201-3213` `getS2VDefaultVideoModel` | 前端视频 | `models[0]`（同上） |
| 3 | `apps/desktop/electron/services/model-provider-manager.js:86-106` `resolveProviderDefaultModel` | 主进程 | **fail-closed 返回 `''`** |

主进程口径是三者中唯一正确的（2026-08-27 双默认语义）。前端两处会猜 `models[0]`，这正是"多模态下语音模型下拉偶尔出现非 TTS 模型"这一同族问题反复出现的结构性原因（2026-08-09 已修过一次，见 01-docs/CHANGELOG.md:727）。

### 1.4 运营中心现状与缺口

**已有能力**：`ops-center/backend/models.py:81` 的 `ModelPreset.capability_models`（JSON 对象，如 `{"llm":"MiniMax-M2.7","tts":"speech-2.8-turbo"}`），`ModelPresets.vue:133-135` 为其提供了输入框。

**缺口**：

| 缺口 | 后果 |
| --- | --- |
| 输入框被 `v-if="form.is_multimodal"` 包裹（ModelPresets.vue:126） | 单能力 provider（category=tts/image/video）**无法**配置"本类别下的默许模型"，只能填 provider 级 `default_model`，语义模糊 |
| 无自洽校验 | 运营填了不在 `models` 列表里的模型 ID，运行期 fail-closed 但用户/运营都不知道为什么 |
| 无总览视角 | 运营无法一眼看出"图片能力下哪些提供方缺默许模型"，只能逐个点开编辑 |
| `default_model` 与 `capability_models` 语义重叠 | 两处都可填默认模型，容易不一致 |

---

## 2. 目标与非目标

### 2.1 目标

1. **移除「语音模型」下拉**：故事讲述流水线「声音选项」区域不再渲染该选择器，全 provider 生效。
2. **单一真源解析口径**：桌面端与主进程使用同一套四级优先级解析，消除三套并行实现。
3. **运营中心支持全类别能力默认模型**：任意 provider 均可配置其所属能力类别（多模态为其各项 capability）的默许模型。
4. **自洽校验 + 总览视图**：运营配置错误在前端即被拦截；缺口一眼可见。

### 2.2 非目标

- 不改主进程 `resolveProviderDefaultModel` 的优先级语义（已正确）。
- 不动图片/视频生成器的模型下拉（用户仍可选图片/视频模型）。
- 不改音色目录能力表 `tts-voice-catalog.js` 的白名单。
- 不做批量自动修复缺口（本期只定位与跳转）。

---

## 3. 功能逻辑

### 3.1 能力默认模型解析口径（单一真源）

```
resolveCapabilityDefaultModel(provider, capabilityType):
  ├─ 1. config.user_default_model   （桌面端「模型设置」用户选择，用户级，最高优先）
  │       └─ 必须 ∈ provider.models，否则视为失效继续往下
  ├─ 2. capability_models[type]     （运营中心按能力类别配置的默许模型）
  │       └─ 非空字符串即采用，**不校验 ∈ models**（运营目录权威，允许声明 models 之外的合法 ID）
  ├─ 3. config.default_model        （运营 provider 级默认，兼容存量字段）
  │       └─ **多模态 provider 跳过此级**；其余 provider 必须 ∈ models，否则视为失效继续往下
  └─ 4. 兜底：
          ├─ category === 'multimodal' → 返回 ''（fail-closed，禁止猜 models[0]）
          └─ 其它（单能力）          → 返回 models[0] || ''
```

**为什么第 2 级必须早于第 3 级（2026-10-18 跨家族评审 C1 实证）**：`minimax-multimodal` 目录下发同时含
`default_model = 'MiniMax-M2.7'`（∈ models，**LLM 模型**）与 `capability_models = {llm: MiniMax-M2.7, tts: speech-2.8-turbo, image: image-01, video: MiniMax-Hailuo-2.3}`。
旧顺序（provider 级默认优先）会让 tts / image / video 三个能力**全部解析成 LLM 模型**；新建任务时前端显式传
`params.voiceModel` 掩盖了它，只有断点续跑与播客这类走 `__resumeUseCurrentModels` 的路径才会踩到 ——
表现为「恢复后拿 LLM 模型当 TTS 用」→ `VOICE_NOT_IN_CATALOG` / 调用失败。本次**同时修正主进程**
`resolveProviderDefaultModel`（原先 default_model 优先）使两层同序，并补 4 条 parity 关键夹具
（缺它们则两条口径的分叉完全测不出来）。

**为什么第 3 级对多模态要跳过**：`default_model` 对多模态是「provider 主模型」（通常是 llm），
用它解 tts 会静默拿错模型；跳过它才能让「多模态缺能力声明 ⇒ fail-closed」这一意图真正成立。

与主进程 `resolveProviderDefaultModel(provider, type)` 的差异：**无**。两层逐项等价，由
`apps/desktop/electron/services/voice-model-resolution-parity.test.js`（31 例）做跨层一致性锁：
同一组 26 个夹具（含 `null`/非对象/空 models/脏 models/`capability_models` 为字符串/多模态缺声明/
**能力默认与 provider 级默认均有效且不同**）分别喂两层，断言返回值逐一相等；另配 4 条源码级防漂移锁
（校验**函数体内**的关键分支顺序，而不是全文 token 顺序）。

**MiMo 特例（正交保留）**：`mimo-tts` 由音色类型区分模型（预置音色 → `mimo-v2.5-tts`，克隆音色 →
`mimo-v2.5-tts-voiceclone`），这是能力 driven 的特殊分支，与"用户不该选模型"正交，逻辑完全不变：

| 用途 | 模型 |
| --- | --- |
| 预置音色目录（catalog） | `mimo-v2.5-tts` |
| 能力查询 / 克隆 registry / 克隆请求 | `mimo-v2.5-tts-voiceclone` |

### 3.2 桌面端行为

| 场景 | 行为 |
| --- | --- |
| 用户切换「语音生成器」 | 程序解析该提供方的默许模型，静默写入 `s2vConfig.voiceModel`；不渲染任何模型选择 UI |
| 用户恢复历史项目 | 历史 `voice.model` 若非当前解析值，装载时归一化为解析值（不弹错、不中断） |
| 用户通过「模型设置」修改某提供方的用户默认模型 | 下次进入流水线时按新口径解析（用户默认优先级最高） |
| 运营中心修改默许模型 | 目录同步到桌面端后，下次解析即生效（无需用户操作） |
| 解析结果为空（多模态未声明 tts 默许模型） | 「语音 / 音色 ID」下拉不渲染（依赖 `voiceModel` 非空），音色目录不请求；不出现空白控件 |

### 3.3 运营中心行为

**输入侧**（`ModelPresets.vue` 编辑弹窗）：

| provider 类别 | 能力默认模型输入区 |
| --- | --- |
| `multimodal` | 按 `capabilities` 逐项渲染（既有行为），每项一个输入框 |
| 其它单类别（llm/tts/image/video/speech_recognition/audio） | 渲染**单项**输入框，标签为「{类别中文名} 默认模型」 |
| 切换 category | 清空不再适用的 `capability_models` 键（fail-closed，不留脏键） |

**校验侧**（`upsert_model_preset`）：

| 规则 | 不满足时 |
| --- | --- |
| `capability_models` 必须是对象 | 400「capability_models 必须是对象」 |
| 键必须是该 provider 的 category 或其 capabilities 之一 | 400「能力默认模型键 {k} 不属于该预设的类别/能力」 |
| 非空值必须 ∈ `models` | 400「能力 {k} 的默认模型 {v} 不在模型列表中」 |
| 多模态：`capabilities` 中每一项都必须有 `capability_models` 条目 | 400「能力 {cap} 缺少默认模型（capability_models）」（既有规则，保留） |
| `default_model` 非空时必须 ∈ `models` | 400「默认模型 ID 必须在模型列表中」（既有规则，保留） |

**迁移**（`ensure_catalog_seeded`，幂等）：

```
对每个预设行：
  若 row.category !== 'multimodal'
     且 row.capability_models 中缺少 row.category 键
     且 row.default_model 非空：
        回填 capability_models[category] = default_model
```

不覆盖已存在的键；多模态行不参与（其键由 capabilities 驱动）。

**总览侧**（新增 `GET /api/v1/model-presets/capability-overview`，admin）：

响应结构：

```json
{
  "capabilities": [
    {
      "capability": "tts",
      "label": "TTS语音",
      "providers": [
        {
          "id": "minimax-tts",
          "name": "MiniMax TTS",
          "category": "tts",
          "model": "speech-2.8-turbo",
          "is_configured": true,
          "is_visible": true
        },
        {
          "id": "google-tts",
          "name": "Google TTS",
          "category": "tts",
          "model": "",
          "is_configured": false,
          "is_visible": true
        }
      ]
    }
  ]
}
```

- 仅统计 `is_visible=1` 的预设（隐藏项不计入缺口，否则运营会被已下线的提供方干扰）。
- 多模态 provider 按其 `capabilities` 出现在多个能力分组中。
- `is_configured=false` 即该能力缺口，前端高亮并可跳转到该行编辑。

---

## 4. 交互逻辑与显示项

### 4.1 桌面端「声音选项」区域（变更后）

```
声音
├── 语音生成器          [下拉：自动 Edge TTS / MiniMax TTS / MiniMax（多模态） / MiMo TTS / …]
├── 语音 / 音色 ID      [下拉：使用服务商默认音色 / 各音色]
│   └── （音色目录加载中显示骨架；失败显示 inline-error + 「刷新音色列表」按钮）
├── 背景音乐            [下拉 + 「管理」按钮]
├── 背景音乐音量        [滑块]
├── 旁白语速            [滑块]
└── 旁白音量            [滑块]
```

**移除项**：「语音模型」下拉整块（`S2vConfigPanels.vue:348-358`）。

**「语音 / 音色 ID」的显示条件（2026-10-19 回补）**：`已选提供方` **且**（`s2vVoiceContextModel` **或** `s2vConfig.voiceModel`）。
两者含义不同，缺一不可：

| 来源 | 何时有值 | 缺了会怎样 |
| --- | --- | --- |
| `s2vVoiceContextModel`（程序解析） | 正常路径：提供方已注册且运营配置了该能力默许模型 | 字段隐藏（正确：不知道用哪个模型就不该给空下拉） |
| `s2vConfig.voiceModel`（既有配置值） | 历史快照 / 配置档案回填后尚未重算；分发夹具显式给值 | 字段隐藏（**错误**：模型其实是已知的，只是还没走重算） |

两来源皆空才算「模型未知」，此时整项不渲染。`#3946` 首版只认第一个来源，导致 main 侧布局契约红（见 PR follow-up `s2v-tone-field-guard`）。

**折叠区摘要**（`CreateView.vue:2058`）：**保持逐字节不变**，仍为

```
{提供方} · {模型ID} · 已选音色
```

理由（两处硬约束 + 一条产品判断）：

1. **CJK 基线**：该模板含硬编码中文（`' · 已选音色'`），`check-locale-sync.js --cjk` 的基线键是 `文件||字面量`；
   改动这一行会让既有字面量被判定为"新增硬编码中文"（实测：改后跑出 `渲染端新增 1 处硬编码中文字符串`）。
2. **像素基线**：`create-story2video-detail` 截图包含折叠态摘要，改动会扩大 QM-4 漂移面。
3. **产品判断**：模型 ID 在这里是**只读回显**——它告诉用户"当前实际用的是哪个模型"，不暗示可选。
   摘要里出现它不违背"用户不该选择模型"，反而减少了"我到底在用哪个模型"的困惑。

配套：`S2V_SUMMARY_FIELDS.voice` 移除 `voiceModel`，即模型 ID **不参与**「该分组是否仍为默认值」的判定
（因为它不是用户设置项）；「语音 / 音色 ID」的显示条件改为「解析出的模型非空」。

### 4.2 运营中心「预设模型设置」页（变更后）

```
┌─────────────────────────────────────────────────────────────┐
│ 能力默认模型总览                                             │
│  llm   │ MiniMax ✓ MiniMax-M2.7 │ Anthropic ✓ claude-… │ …  │
│  tts   │ MiniMax TTS ✓ speech-2.8-turbo │ Google TTS ⚠ 未配置 │
│  image │ MiniMax Image ✓ image-01 │ Flux ✓ flux-pro │ …     │
│  video │ MiniMax ✓ MiniMax-Hailuo-2.3 │ …                    │
│  （⚠ 行高亮，点击跳转到该预设编辑）                          │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ 预设列表（既有表格，新增「能力默认模型」列，展示 JSON 摘要）  │
└─────────────────────────────────────────────────────────────┘
```

编辑弹窗新增（单能力 provider 时显示单项，多模态时显示多项）：

```
┌─ 多模态能力配置 ─────────────────────┐
│ 支持能力：[llm] [tts] [image] [video]│
│ 文字推理 默认模型：[el-select 限定]   │
│ TTS语音 默认模型：[el-select 限定]    │
│ …                                    │
└──────────────────────────────────────┘
```

---

## 5. 数据校验

### 5.1 桌面端

| 校验点 | 规则 | 失败处置 |
| --- | --- | --- |
| `resolveVoiceModelForProvider` 入参 | provider 为 null/非对象 | 返回 `''` |
| `models` 字段 | 非数组/含非字符串 | 过滤后使用 |
| 用户默认模型 | `typeof === 'string'` 且 trim 后 ∈ models | 否则视为失效，继续下一级 |
| 运营默许模型 | `typeof === 'string'` 且 trim 非空 | 否则继续下一级（**不校验 ∈ models**） |
| provider 级默认 | `typeof === 'string'` 且 ∈ models | 否则视为失效，继续下一级 |
| 多模态无任何声明 | — | 返回 `''`（fail-closed） |
| 历史 `voiceModel` 归一 | 与解析值不一致 | 静默改写为解析值 |

### 5.2 运营中心

| 字段 | 规则 | 错误文案 |
| --- | --- | --- |
| `capability_models` | 必须是 JSON 对象 | `capability_models 必须是对象` |
| 键归属 | ∈ `[category]` ∪ `capabilities` | `能力默认模型键 {k} 不属于该预设的类别/能力` |
| 值非空时 | ∈ `models` | `能力 {k} 的默认模型 {v} 不在模型列表中` |
| 多模态完整性 | `capabilities` 每项都有对应键 | `能力 {cap} 缺少默认模型（capability_models）` |
| `default_model` | ∈ `models`（既有） | `默认模型 ID 必须在模型列表中` |
| 前端输入 | `el-select` 限定 `models` 候选，`allow-create` 兜底 | 保存前前端二次校验（既有模式，`ModelPresets.vue:365`） |

---

## 6. 流程

### 6.1 桌面端语音模型解析时序

```
用户进入故事讲述流水线
   └─ loadS2VProviders()
        ├─ modelProviderList('tts')  →  s2vVoiceProviders
        ├─ 确定 voiceProvider（用户显式选择 > 多模态默认 > 首项）
        ├─ voiceModel = resolveVoiceModelForProvider(provider)   ← 程序解析，非用户输入
        ├─ 若 voiceModel 为空 → 不渲染「语音/音色 ID」，不请求目录
        └─ loadS2VVoiceData()  → catalog / capability（mimo 分支用双模型）
```

### 6.2 运营配置流转时序

```
运营在运营中心编辑某预设
   └─ 填写「TTS语音 默认模型 = speech-2.8-turbo」
        └─ upsert_model_preset 校验（§5.2）
             └─ 写库 + 同步 default_model（兼容旧桌面端）
                  └─ 桌面端目录同步 applyCatalog 覆盖 config.capability_models
                       └─ 下次进入流水线 → 解析即用新值
```

### 6.3 兼容迁移时序（后端启动）

```
ensure_catalog_seeded(db)
   └─ 对每个预设行：单类别 且 capability_models[category] 缺失 且 default_model 非空
        └─ 回填 capability_models[category] = default_model（不覆盖已存在键）
```

---

## 7. 测试与验收

### 7.1 回归锁（最重要）

**跨层一致性测试**（`apps/desktop/electron/services/voice-model-resolution-parity.test.js`，31 例）：

同一组 26 个 provider 夹具（覆盖：单能力有用户默认、单能力有运营默许、单能力两者皆无、单能力**能力默认与
provider 级默认均有效且不同**、多模态有 tts 声明、多模态**能力默认与 provider 级默认均有效且不同**、
多模态无 tts 声明但有 provider 级默认、用户默认失效、用户默认带空白、models 为空、models 含脏项、
provider 为 null/非对象/空对象、`capability_models` 为字符串等）分别喂给：

- 前端 `resolveVoiceModelForProvider(provider)`（经 composable 导出）
- 主进程 `resolveProviderDefaultModel(provider, 'tts')`

断言两者返回值**逐一相等**。另含 4 条源码级防漂移锁 + 1 条 MiMo 正交用例。

**逃逸分析**（为什么这条锁是必要的，以及它是怎么被证明"原本不够"的）：既有测试各自只测一层
（`useTtsVoices.test.js` 测前端、`model-provider-manager.resolve-default.test.js` 测主进程），没有任何
测试断言"两层口径相同"。因此历史上前端可以随意改兜底行为而不触发任何红。

**实证**：本变更首版把 `capability_models` 提到 `default_model` 之前（前端），而主进程仍是
`default_model` 优先 —— 首版 22 个夹具里**没有一个"两者均有效且不同"的用例**，于是 27 条测试全绿，
口径分叉完全没有暴露。跨家族评审（codex，OpenAI 家族）指出这一点后，补了 4 条关键夹具，
测试立刻在旧实现上变红。这条经历本身写进了 learnings：**一致性锁的效力取决于夹具是否覆盖每个边界的
"两侧都可能命中且取值不同"**，只覆盖 happy path 的锁是装饰性门禁。

### 7.1b 跨家族评审（QM-6）与处置

| 级别 | 问题 | 处置 |
| --- | --- | --- |
| CRITICAL C1 | 两层优先级顺序不一致（前端能力优先 / 主进程 provider 级默认优先）；真实分歧点是 `minimax-multimodal` 的 `default_model` 是 LLM 模型 | **改主进程与前端同序**（能力优先 + 多模态跳过 provider 级默认）；更新主进程 12 条测试（用例 2/4 重写、新增 8b/8c）；parity 补 4 条关键夹具；源码锁改为校验函数体内顺序 |
| MAJOR M1 | 恢复路径（配置档案 / 模板 / 运营 pipeline_options）不归一 `voiceModel`，陈旧值直达生成 | `_applyS2VSnapshotObject` 与 `applyS2VPipelineDefaults` 末尾统一重算；provider 失效时清空 |
| MAJOR M2 | 运营中心校验用"字符串化后的值"、落库用原始值 ⇒ 非字符串值静默通过校验、运行期被忽略、总览显示已配置 | 非字符串值直接 400「必须是字符串」；落库前统一 trim 成字符串；新增 2 条测试 |
| MINOR m1 | 多模态缺 tts 声明但仍可从 `default_model` 解析出非 TTS 模型 | C1 修复时加「多模态跳过 `default_model`」后消解，parity 夹具锁定返回空串 |
| MINOR m2 | 并发守卫 `providerId` trim 不对称（带空白的存量 id 会让请求结果被静默丢弃） | `getS2VVoiceProvider` 统一 trim 入参 |
| MINOR m3 | `capability_overview` 对 capabilities 里的未知键静默丢弃（运营 typo 不可见） | 本期接受并记录：总览只覆盖已知能力类别（清单见 §3.3）；后续如需可加 `ignored_capabilities` 字段 |

> 引擎侧的自动深审（`sh scripts/deep-review.sh`）本次**跑不通**：`codeagent-wrapper.exe` 在 critic 调用上
> `ETIMEDOUT`，且 `claude -p` 在本机非交互模式下对任意 prompt 均无输出（90s 探针无响应）。故改用
> `codex exec`（OpenAI 家族）对 diff 做人工跨家族评审，结论与处置如上；引擎失败记录保留在
> `.ccg/reviews/*.json` 的 `deepReview.error` 字段里，未被抹掉。

### 7.2 验收标准

| # | 标准 | 验证方式 |
| --- | --- | --- |
| A1 | 「语音生成器」选 MiniMax 多模态 / MiniMax TTS / MiMo TTS / 任一 provider，「语音模型」下拉均不渲染 | `S2vConfigPanels.test.js` + `CreateView.test.js` |
| A2 | 各 provider 下 `s2vConfig.voiceModel` 被解析为正确的默许模型 | `useTtsVoices.test.js` |
| A3 | 跨层口径完全一致（含 fail-closed 边界） | `voice-model-resolution-parity.test.js` |
| A4 | 运营为单能力 provider 配置类别默认模型可保存，且值 ∉ models 被 400 拦截 | `test_model_presets_api.py` |
| A5 | `capability-overview` 端点正确分组、隐藏项不计入、缺口标记正确 | `test_model_presets_api.py` |
| A6 | 存量行迁移后 `capability_models[category]` 被回填且不覆盖人工值 | `test_model_presets_api.py` |
| A7 | 目录同步项对所有 provider 均含非空 `capability_models` | `test_model_catalog_api.py` |
| A8 | 历史项目恢复时陈旧 `voice.model` 被归一化，无错误提示 | `CreateView.test.js` |
| A9 | 折叠区摘要仍展示生效模型（只读回显），且该行逐字节不变 | 像素基线重取证 + `check-locale-sync --cjk` PASS |
| A10 | QM-1 打包三层判据通过（stderr 空 + 进程存活） | electron-builder 实测 |

---

## 8. 提示文字

本期**不新增**用户可见提示文字（下拉已移除，无错误路径新增）。既有文字保持不变：

- 「未配置 TTS 模型时将使用自动 Edge TTS（免费）；如需 MiniMax 等语音模型与音色克隆能力，请先在「模型服务商」中配置。」
- 「当前服务商没有可用的语音模型。」（`s2vVoiceModelOptions` 为空时的兜底提示——该分支在解析失败时仍可能出现，**保留**）
- 「当前模型没有可用音色。」

运营中心侧新增的说明文字（总览卡片顶部）：

> 按能力类别维护每个模型提供方的默许模型（Model ID）。桌面应用在使用某种能力时，会按此处配置自动确定具体模型，不再要求用户选择。标黄的提供方尚未配置默许模型，桌面端将无法在该能力下使用它。

---

## 9. 影响面与兼容性

### 9.1 保留字段

`s2vConfig.voiceModel` **字段保留**，消费者（全部不受影响）：

- `CreateView.vue:3128` IPC `voice.model` 下发
- `s2v-config-snapshot.js:150` 运行快照
- `ResultView.vue:580` 项目语音上下文
- `story2video-stages.js:2836/3405` TTS 阶段
- `create-view-module-utils.js:347` 「上次选项」保存集合
- `ConfigSummary.vue:20-22` 配置摘要展示（该组件用于其它入口，不随本次移除）

### 9.2 兼容性

| 场景 | 行为 |
| --- | --- |
| 旧桌面端读新目录 | `default_model` 已同步写入，行为不回退 |
| 新桌面端读旧目录（无 `capability_models`） | 回退到 `default_model` → `models[0]`，与今天一致 |
| 历史运行快照含用户手选模型 | 归一化为当前默许模型（静默） |
| 运营给多模态配了 tts 默许模型但桌面端未升级 | 桌面端仍显示下拉（旧行为），无崩溃 |

---

## 10. 分期与后续

| 期 | 内容 | 状态 |
| --- | --- | --- |
| P0 | 移除「语音模型」下拉 + 桌面端解析口径统一 + 跨层一致性测试 | 本期 |
| P0 | 运营中心 `capability_models` 全类别 + 自洽校验 + 总览 | 本期 |
| P1 | 批量修复能力缺口（一键为所有缺口提供方填首个模型） | 后续 |
| P1 | 图片/视频生成器的模型下拉同构去化（若产品确认） | 待产品决策 |
| P2 | 解析口径上移为主进程 IPC（渲染层不再持有解析逻辑） | 后续，需评估 IPC 时序 |

---

## 11. 附录：改动文件清单

### 桌面端渲染层

| 文件 | 改动 |
| --- | --- |
| `apps/desktop/src/views/video-creation/S2vConfigPanels.vue` | 删除「语音模型」UiField 整块 |
| `apps/desktop/src/views/video-creation/s2v-panel-contract.js` | 白名单移除 `s2vVoiceModelOptions` / `s2vVoiceModelHidden` / `handleS2VVoiceModelChange`（若无其它消费者） |
| `apps/desktop/src/views/CreateView.vue` | 移除 computed 桥接与方法；摘要去模型片段；`S2V_SUMMARY_FIELDS.voice` 去 `voiceModel`；pipeline defaults 映射归一化 |
| `apps/desktop/src/views/video-creation/composables/tts-voices-state.js` | 新增 `resolveVoiceModelForProvider`；`getS2VDefaultVoiceModel` 改薄封装 |
| `apps/desktop/src/views/video-creation/composables/tts-voices-shared.js` | `getS2VVoiceContext` 改调解析函数 |
| `apps/desktop/src/views/video-creation/composables/useTtsVoices.js` | 导出面调整；`handleS2VVoiceModelChange` 处置 |

### 运营中心

| 文件 | 改动 |
| --- | --- |
| `ops-center/backend/models.py` | `ModelPreset` docstring |
| `ops-center/backend/services/model_preset_service.py` | 校验 + 迁移回填 + `capability_overview` |
| `ops-center/backend/routers/model_presets.py` | `GET /capability-overview` |
| `ops-center/frontend/src/views/ModelPresets.vue` | 全类别输入 + 总览卡片 |
| `ops-center/frontend/src/api/modelPresets.js` | `fetchCapabilityOverview` |

### 测试

| 文件 | 改动 |
| --- | --- |
| `apps/desktop/electron/services/voice-model-resolution-parity.test.js` | 新增（跨层一致性，最重要） |
| `apps/desktop/src/views/video-creation/composables/useTtsVoices.test.js` | 新增解析用例 |
| `apps/desktop/src/views/video-creation/S2vConfigPanels.test.js` | 新增「无语音模型项」用例 |
| `apps/desktop/src/views/CreateView.test.js` | 改写 MiMo/多模态既有用例 |
| `ops-center/backend/tests/test_model_presets_api.py` | 全类别校验 + 总览端点 + 迁移 |
| `ops-center/backend/tests/test_model_catalog_api.py` | 目录项含 `capability_models` |

### 文档

| 文件 | 改动 |
| --- | --- |
| `CHANGELOG.md` | 顶部条目 |
| `01-docs/PRD-S2V-VOICE-MODEL-PROGRAM-RESOLVED-2026-10-18.md` | 本文件 |
| `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` | §4.3.1 升级为全 provider；§9 目录 |
| `01-docs/PRD-video-creation.md` | §7.1.4 + 变更记录 |
| `01-docs/PRD.md` | 索引 |
| `ops-center/docs/PRD.md` | 预设模型章节 |
| `01-docs/learnings.md` | 置顶经验 |
